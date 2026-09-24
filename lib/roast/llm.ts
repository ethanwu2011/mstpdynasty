/**
 * The one Claude call. Three kinds of request share one frozen system prompt (persona.ts):
 *   issue  a full newsletter (The Daily, Thursday Night Fallout, Week N Recap, Draft Grades):
 *          one or two a day, the product people read, so it goes to claude-opus-5 with the
 *          server-side fallback, exactly as docs/SITE_SPEC.md first specified.
 *   item   one draft pick, trade or waiver run: one per event (a draft day is dozens).
 *   lines  one batch of stat-table one-liners.
 * Items and lines are the volume, so they go to claude-sonnet-5 at a lower effort. No
 * temperature / top_p / budget_tokens / assistant prefill. The system prompt carries the only
 * cache breakpoint (the user message is different every time, so caching it only paid the
 * cache-write premium); the volume kinds keep it for an hour so a slow stretch of the draft
 * still reads it from cache.
 *
 * Refusal is checked before content is read; any API error becomes a typed failure so the
 * caller can publish facts only. Nothing here throws.
 *
 * Three spend guards sit in front of every call:
 *   - On Vercel the writer only runs with the shared store (Upstash). Without it each instance
 *     keeps its own /tmp store, so every cold start would find no locks and no stored lines and
 *     write everything again, and nothing it wrote would reach the other instances' pages.
 *   - A store-backed cap of MAX_WRITER_CALLS_PER_DAY calls per Eastern day, across instances.
 *   - A dollar budget per Eastern day (WRITER_DAILY_BUDGET_USD, default
 *     DEFAULT_DAILY_BUDGET_USD), priced from each reply's token usage. Each kind may spend up
 *     to its BUDGET_SHARE of it, so stat lines run out first and never starve the newsletter.
 */
import Anthropic from "@anthropic-ai/sdk";
import { configured } from "@/lib/env";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type { RoastUsage } from "@/lib/types";
import { SYSTEM_PROMPT } from "./persona";
import { recordWriterStatus } from "./status";

/** What a call writes (see the header). */
export type RoastKind = "issue" | "item" | "lines";

export const ROAST_MODELS: Record<RoastKind, string> = {
  issue: "claude-opus-5",
  item: "claude-sonnet-5",
  lines: "claude-sonnet-5",
};
/** The newsletter's model. */
export const ROAST_MODEL = ROAST_MODELS.issue;
export const ROAST_MAX_TOKENS = 16000;
/** Output ceilings per kind (thinking included): an item is a few sentences, a batch of lines one per row. */
export const MAX_TOKENS: Record<RoastKind, number> = { issue: ROAST_MAX_TOKENS, item: 8000, lines: 8000 };
/** Effort per kind (undefined = the model's default). Lower effort means less thinking, which bills as output. */
export const EFFORT: Record<RoastKind, "low" | "medium" | undefined> = { issue: undefined, item: "medium", lines: "low" };
/** Server-side fallback, for the newsletter's model only. */
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
 * A batch of lines must fit the jobs' deadlines (see LINES_REQUEST in surfaces.ts).
 */
export const ITEM_REQUEST: RoastRequestOptions = { timeout: 90_000, maxRetries: 1 };
export const ISSUE_REQUEST: RoastRequestOptions = { timeout: 180_000, maxRetries: 1 };
export const LINES_REQUEST: RoastRequestOptions = { timeout: 70_000, maxRetries: 1 };
const REQUEST: Record<RoastKind, RoastRequestOptions> = { issue: ISSUE_REQUEST, item: ITEM_REQUEST, lines: LINES_REQUEST };

/** Writer calls allowed per Eastern day, across every instance (a runaway guard, far above normal use). */
export const MAX_WRITER_CALLS_PER_DAY = 400;

/** Spend ceiling per Eastern day in dollars, unless WRITER_DAILY_BUDGET_USD says otherwise. */
export const DEFAULT_DAILY_BUDGET_USD = 1.5;
/** The share of the day's budget each kind may have spent before it starts a call. */
export const BUDGET_SHARE: Record<RoastKind, number> = { lines: 0.4, item: 0.85, issue: 1 };

/** Dollars per million tokens, [input, output], by model id prefix. Unknown models price as the dearest. */
const PRICES: Array<[string, number, number]> = [
  ["claude-opus-5", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-haiku-4-5", 1, 5],
];

/** What one reply cost in dollars. Cache reads bill at 0.1x input; cache writes are priced at the 1-hour 2x (the dearer of the two). */
export function costUsd(model: string | null, usage: RoastUsage | null): number {
  if (!usage) return 0;
  const [, input, output] = PRICES.find(([prefix]) => (model ?? "").startsWith(prefix)) ?? PRICES[0];
  const tokens =
    usage.inputTokens * input + usage.cacheCreationInputTokens * input * 2 + usage.cacheReadInputTokens * input * 0.1 + usage.outputTokens * output;
  return tokens / 1e6;
}

export function dailyBudgetUsd(raw = process.env.WRITER_DAILY_BUDGET_USD): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_BUDGET_USD;
}

const spendKey = (now: number) => store.keys.rate(`writer-spend-micro:${etDate(now)}`);

/** Dollars the writer has spent today (Eastern), across every instance. */
export async function spentTodayUsd(now = Date.now()): Promise<number> {
  const micro = await store.get<number>(spendKey(now)).catch(() => null);
  return Number(micro ?? 0) / 1e6 || 0;
}

/**
 * True while `kind` may still start a call today. Jobs check it before they pick work, so an
 * item that cannot be written today is not counted as a failed attempt. Fails closed.
 */
export async function withinBudget(kind: RoastKind, now = Date.now()): Promise<boolean> {
  try {
    return (await spentTodayUsd(now)) < dailyBudgetUsd() * BUDGET_SHARE[kind];
  } catch {
    return false;
  }
}

async function recordSpend(model: string | null, usage: RoastUsage | null, now = Date.now()): Promise<void> {
  const micro = Math.round(costUsd(model, usage) * 1e6);
  if (micro > 0) await store.incrBy(spendKey(now), micro, 2 * 86_400).catch(() => undefined);
}

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
let keyIndex = 0;

/**
 * ANTHROPIC_API_KEY as pasted can hold more than one key or stray whitespace
 * (seen in production: three keys in one value). Use each sk-ant token in turn.
 */
export function apiKeyCandidates(raw = process.env.ANTHROPIC_API_KEY ?? ""): string[] {
  const tokens = raw.match(/sk-ant-[A-Za-z0-9_-]+/g) ?? [];
  const unique = [...new Set(tokens)];
  if (unique.length) return unique;
  const trimmed = raw.trim();
  return trimmed ? [trimmed.split(/\s+/)[0]] : [];
}

/** Remove anything key-shaped before text reaches a log or the store. */
export function scrubSecrets(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]");
}

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
  const keys = apiKeyCandidates();
  if (!keys.length) return null;
  sdkClient ??= new Anthropic({ apiKey: keys[Math.min(keyIndex, keys.length - 1)] }) as unknown as RoastClient;
  return sdkClient;
}

/** True when a call would actually be attempted (key set, or a test client injected, and a shared store on Vercel). */
export function hasRoastClient(): boolean {
  if (sharedStoreMissing()) return false;
  return override !== undefined ? override !== null : configured.anthropic();
}

/** The exact request body for a kind. Pure, so its bytes are tested. */
export function buildRoastRequest(userContent: string, kind: RoastKind = "issue"): CreateParams {
  const effort = EFFORT[kind];
  const model = ROAST_MODELS[kind];
  return {
    model,
    max_tokens: MAX_TOKENS[kind],
    ...(model === ROAST_MODEL ? { betas: [...ROAST_BETAS], fallbacks: "default" as const } : {}),
    ...(effort ? { output_config: { effort } } : {}),
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: kind === "issue" ? { type: "ephemeral" } : { type: "ephemeral", ttl: "1h" } }],
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
export async function callRoastModel(userContent: string, label: string, kind: RoastKind, options: RoastRequestOptions = REQUEST[kind]): Promise<RoastCallResult> {
  const client = getClient();
  if (!client) {
    const detail = sharedStoreMissing() ? "the writer needs the shared store (Upstash) on Vercel" : "ANTHROPIC_API_KEY is not set";
    return { ok: false, reason: "not_configured", detail, model: null, usage: null };
  }
  if (!(await withinBudget(kind))) {
    const detail = `daily writer budget reached for ${kind} (spent $${(await spentTodayUsd()).toFixed(2)} of $${dailyBudgetUsd().toFixed(2)})`;
    console.warn(`[roast] ${label}: ${detail}`);
    return { ok: false, reason: "error", detail, model: null, usage: null };
  }
  if (!(await withinDailyCap())) {
    const detail = `daily cap of ${MAX_WRITER_CALLS_PER_DAY} writer calls reached`;
    console.warn(`[roast] ${label}: ${detail}`);
    await recordWriterStatus({ ok: false, at: Date.now(), reason: "error", detail });
    return { ok: false, reason: "error", detail, model: null, usage: null };
  }
  let msg: BetaMessage;
  try {
    msg = await client.beta.messages.create(buildRoastRequest(userContent, kind), options);
  } catch (err) {
    const detail = scrubSecrets(describeError(err));
    // A rejected key: move to the next candidate for the following call.
    if (err instanceof Anthropic.AuthenticationError && override === undefined && keyIndex < apiKeyCandidates().length - 1) {
      keyIndex += 1;
      sdkClient = null;
    }
    console.warn(`[roast] ${label}: ${detail}`);
    await recordWriterStatus({ ok: false, at: Date.now(), reason: "error", detail });
    return { ok: false, reason: "error", detail, model: null, usage: null };
  }
  const usage = usageOf(msg);
  await recordSpend(msg.model, usage);
  console.info(
    `[roast] ${label}: model=${msg.model} stop=${msg.stop_reason} in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadInputTokens} cache_write=${usage.cacheCreationInputTokens} cost=$${costUsd(msg.model, usage).toFixed(4)}`,
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
