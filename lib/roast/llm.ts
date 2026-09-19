/**
 * The one Claude call, exactly as docs/SITE_SPEC.md specifies:
 *   client.beta.messages.create({ model: "claude-opus-5", max_tokens: 16000,
 *     betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
 *     cache_control: { type: "ephemeral" }, system, messages: [{ role: "user", content }] })
 * No temperature / top_p / budget_tokens / assistant prefill (all 400 on this model).
 * The frozen system prompt also carries its own ephemeral breakpoint so it is a guaranteed
 * cache read across different requests (the top-level automatic breakpoint lands on the
 * per-request user message).
 *
 * Refusal is checked before content is read; any API error becomes a typed failure so the
 * caller can publish facts only. Nothing here throws.
 *
 * Two spend guards sit in front of every call:
 *   - On Vercel the writer only runs with the shared store (Upstash). Without it each instance
 *     keeps its own /tmp store, so every cold start would find no locks and no stored lines and
 *     write everything again, and nothing it wrote would reach the other instances' pages.
 *   - A store-backed cap of MAX_WRITER_CALLS_PER_DAY calls per Eastern day, across instances.
 */
import Anthropic from "@anthropic-ai/sdk";
import { configured } from "@/lib/env";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type { RoastUsage } from "@/lib/types";
import { SYSTEM_PROMPT } from "./persona";
import { recordWriterStatus } from "./status";

export const ROAST_MODEL = "claude-opus-5";
export const ROAST_MAX_TOKENS = 16000;
export const ROAST_BETAS = ["server-side-fallback-2026-07-01"] as const;

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** Per-request transport options (a subset of the SDK's RequestOptions). */
export interface RoastRequestOptions {
  timeout?: number;
  maxRetries?: number;
}

/** The slice of the SDK client the roast engine uses (so tests can pass a fake). */
export interface RoastClient {
  beta: { messages: { create(params: CreateParams, options?: RoastRequestOptions): Promise<BetaMessage> } };
}

/**
 * Per-request limits, well under the routes' 300-second maxDuration (the SDK default is a
 * 10-minute timeout with 2 retries). An item roast is a few sentences; a full issue is longer.
 */
export const ITEM_REQUEST: RoastRequestOptions = { timeout: 90_000, maxRetries: 1 };
export const ISSUE_REQUEST: RoastRequestOptions = { timeout: 180_000, maxRetries: 1 };

/** Writer calls allowed per Eastern day, across every instance (a runaway guard, far above normal use). */
export const MAX_WRITER_CALLS_PER_DAY = 400;

/**
 * True on Vercel while the store is not the shared one (Upstash): then the writer stays off, so
 * per-instance /tmp stores cannot multiply model calls by the number of instances.
 */
export function sharedStoreMissing(): boolean {
  return Boolean(process.env.VERCEL) && store.pickBackend() !== "upstash";
}

/** Count one call against today's cap. Fails closed: a store that cannot count cannot store the result either. */
async function withinDailyCap(now = Date.now()): Promise<boolean> {
  try {
    return (await store.incr(store.keys.rate(`writer-calls:${etDate(now)}`), 86_400)) <= MAX_WRITER_CALLS_PER_DAY;
  } catch {
    return false;
  }
}

let override: RoastClient | null | undefined;
let sdkClient: RoastClient | null = null;

/**
 * Tests: inject a fake client (or null to force "not configured"). Pass undefined to go back
 * to the real SDK client.
 */
export function setRoastClient(client: RoastClient | null | undefined): void {
  override = client;
}

function getClient(): RoastClient | null {
  if (sharedStoreMissing()) return null;
  if (override !== undefined) return override;
  if (!configured.anthropic()) return null;
  // Exactly as the spec says: `new Anthropic()` reads ANTHROPIC_API_KEY from the environment.
  sdkClient ??= new Anthropic() as unknown as RoastClient;
  return sdkClient;
}

/** True when a call would actually be attempted (key set, or a test client injected, and a shared store on Vercel). */
export function hasRoastClient(): boolean {
  if (sharedStoreMissing()) return false;
  return override !== undefined ? override !== null : configured.anthropic();
}

/** The exact request body. Pure, so its bytes are tested. */
export function buildRoastRequest(userContent: string): CreateParams {
  return {
    model: ROAST_MODEL,
    max_tokens: ROAST_MAX_TOKENS,
    betas: [...ROAST_BETAS],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  };
}

export type RoastCallResult =
  | { ok: true; text: string; model: string; usage: RoastUsage; stopReason: string | null }
  | { ok: false; reason: "not_configured" | "refusal" | "error" | "empty"; detail: string; model: string | null; usage: RoastUsage | null };

function usageOf(msg: BetaMessage): RoastUsage {
  const u = msg.usage;
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export function addUsage(a: RoastUsage | null, b: RoastUsage | null): RoastUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `rate limited (429): ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return `authentication failed (401): ${err.message}`;
  if (err instanceof Anthropic.BadRequestError) return `bad request (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `connection error: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** One call to the writer. `label` is only for the log line. */
export async function callRoastModel(userContent: string, label = "roast", options: RoastRequestOptions = ITEM_REQUEST): Promise<RoastCallResult> {
  const client = getClient();
  if (!client) {
    const detail = sharedStoreMissing() ? "the writer needs the shared store (Upstash) on Vercel" : "ANTHROPIC_API_KEY is not set";
    return { ok: false, reason: "not_configured", detail, model: null, usage: null };
  }
  if (!(await withinDailyCap())) {
    const detail = `daily cap of ${MAX_WRITER_CALLS_PER_DAY} writer calls reached`;
    console.warn(`[roast] ${label}: ${detail}`);
    await recordWriterStatus({ ok: false, at: Date.now(), reason: "error", detail });
    return { ok: false, reason: "error", detail, model: null, usage: null };
  }
  let msg: BetaMessage;
  try {
    msg = await client.beta.messages.create(buildRoastRequest(userContent), options);
  } catch (err) {
    const detail = describeError(err);
    console.warn(`[roast] ${label}: ${detail}`);
    await recordWriterStatus({ ok: false, at: Date.now(), reason: "error", detail });
    return { ok: false, reason: "error", detail, model: null, usage: null };
  }
  const usage = usageOf(msg);
  console.info(
    `[roast] ${label}: model=${msg.model} stop=${msg.stop_reason} in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadInputTokens} cache_write=${usage.cacheCreationInputTokens}`,
  );
  await recordWriterStatus({
    ok: msg.stop_reason !== "refusal",
    at: Date.now(),
    model: msg.model,
    reason: msg.stop_reason === "refusal" ? "refusal" : undefined,
    detail: msg.stop_reason === "refusal" ? String(msg.stop_details?.category ?? "refused") : undefined,
  });
  if (msg.stop_reason === "refusal") {
    return { ok: false, reason: "refusal", detail: msg.stop_details?.category ?? "refused", model: msg.model, usage };
  }
  const text = (msg.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) return { ok: false, reason: "empty", detail: `no text (stop_reason ${msg.stop_reason})`, model: msg.model, usage };
  return { ok: true, text, model: msg.model, usage, stopReason: msg.stop_reason };
}
