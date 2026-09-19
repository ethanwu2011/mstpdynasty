/**
 * HMAC-signed tokens for links that arrive by email (approve an issue, unsubscribe). Keyed by
 * ADMIN_SECRET; unsubscribe links and opt-out refs by OPTOUT_SECRET when it is set (it should
 * never be rotated), else ADMIN_SECRET. Rotating ADMIN_SECRET without OPTOUT_SECRET set starts
 * the opt-out list over and breaks every unsubscribe link already sent. Server-only.
 *
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. The MAC covers the
 * version and the encoded payload, is checked in constant time BEFORE the payload is
 * parsed, and the payload carries its purpose so a token minted for one link can never
 * be replayed on another. Tokens carry no email address: recipients are referenced by
 * an HMAC of their address (`subscriberRef`), so nothing personal ends up in a URL.
 */
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "approve" | "unsub";

export interface TokenPayload {
  /** Purpose. */
  p: TokenPurpose;
  /** League id. */
  l: string;
  /** Expiry, epoch SECONDS. Absent = never expires (unsubscribe links). */
  exp?: number;
  /** Issue slug (approve). */
  s?: string;
  /** Recipient reference, see subscriberRef() (unsub). */
  r?: string;
  /** Nonce (approve links are single use). */
  n?: string;
}

export type VerifyFailure = "not_configured" | "malformed" | "bad_signature" | "expired" | "wrong_purpose";
export type VerifyResult = { ok: true; payload: TokenPayload } | { ok: false; reason: VerifyFailure };

const VERSION = "v1";
const MAX_TOKEN_LENGTH = 2048;
const B64URL = /^[A-Za-z0-9_-]+$/;

export function adminSecret(): string | null {
  const s = process.env.ADMIN_SECRET;
  return s && s.length > 0 ? s : null;
}

/**
 * The key for opt-outs and unsubscribe links: OPTOUT_SECRET (set once, never rotated), else
 * ADMIN_SECRET. Kept apart so rotating ADMIN_SECRET (the bearer for the admin route, the
 * natural thing to rotate after a leak) cannot put back everyone who opted out.
 */
export function optOutSecret(): string | null {
  const s = process.env.OPTOUT_SECRET;
  return s && s.length > 0 ? s : adminSecret();
}

/** Every secret an opt-out ref or unsubscribe link may have been made with, newest first. */
export function optOutSecrets(): string[] {
  return [...new Set([optOutSecret(), adminSecret()].filter((s): s is string => Boolean(s)))];
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`mstpdynasty:${VERSION}:${body}`).digest("base64url");
}

/** Constant-time string comparison (hashes first so unequal lengths leak nothing). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function newNonce(): string {
  return randomBytes(12).toString("base64url");
}

/** Deterministic, non-reversible 22-char id derived from `input` under the secret. */
export function deriveId(input: string, secret: string | null = adminSecret()): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret).update(`mstpdynasty:id:${input}`).digest("base64url").slice(0, 22);
}

/** Stable, non-reversible reference to a recipient's address, for tokens and opt-outs (the derivation string stays "subscriber:" so old links keep working). */
export function subscriberRef(email: string, secret: string | null = optOutSecret()): string | null {
  return deriveId(`subscriber:${email.trim().toLowerCase()}`, secret);
}

/** Sign a payload. Returns null when ADMIN_SECRET is not set. */
export function signToken(payload: TokenPayload, secret: string | null = adminSecret()): string | null {
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${VERSION}.${body}.${mac(secret, body)}`;
}

function isPayload(v: unknown): v is TokenPayload {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.p !== "approve" && o.p !== "unsub") return false;
  if (typeof o.l !== "string" || !o.l) return false;
  if (o.exp !== undefined && typeof o.exp !== "number") return false;
  for (const k of ["s", "r", "n"] as const) if (o[k] !== undefined && typeof o[k] !== "string") return false;
  return true;
}

/**
 * Verify a token for `purpose`. `now` is epoch ms (defaults to the clock), `secret`
 * overrides ADMIN_SECRET (tests).
 */
export function verifyToken(
  token: string | null | undefined,
  purpose: TokenPurpose,
  opts: { now?: number; secret?: string | null } = {},
): VerifyResult {
  const secret = opts.secret === undefined ? adminSecret() : opts.secret;
  if (!secret) return { ok: false, reason: "not_configured" };
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [, body, sig] = parts;
  if (!B64URL.test(body) || !B64URL.test(sig)) return { ok: false, reason: "malformed" };
  if (!safeEqual(sig, mac(secret, body))) return { ok: false, reason: "bad_signature" };

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isPayload(payload)) return { ok: false, reason: "malformed" };
  if (payload.p !== purpose) return { ok: false, reason: "wrong_purpose" };
  const nowMs = opts.now ?? Date.now();
  if (payload.exp !== undefined && nowMs >= payload.exp * 1000) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

/** An unsubscribe token signed with OPTOUT_SECRET or ADMIN_SECRET (links sent before OPTOUT_SECRET was set keep working). */
export function verifyUnsubToken(token: string | null | undefined, opts: { now?: number } = {}): VerifyResult {
  const secrets = optOutSecrets();
  if (!secrets.length) return { ok: false, reason: "not_configured" };
  let last: VerifyResult = { ok: false, reason: "bad_signature" };
  for (const secret of secrets) {
    last = verifyToken(token, "unsub", { ...opts, secret });
    if (last.ok || last.reason !== "bad_signature") return last;
  }
  return last;
}
