/**
 * Environment access in one place. Server-only: never import from a client component.
 * Everything here works with no env vars set.
 */
import "server-only";
import type { NewsletterMode } from "./types";

/** The real league. LEAGUE_ID overrides it for local dev (e.g. the RT fixture league). */
export const MSTP_LEAGUE_ID = "1406497799725424640";

export function leagueId(): string {
  return process.env.LEAGUE_ID?.trim() || MSTP_LEAGUE_ID;
}

/** True for any league other than MSTP Dynasty. Never publish or email about a dev league. */
export function isDevLeague(id: string = leagueId()): boolean {
  return id !== MSTP_LEAGUE_ID;
}

export function newsletterMode(): NewsletterMode {
  return process.env.NEWSLETTER_MODE === "auto" ? "auto" : "review";
}

export function siteUrl(): string {
  const raw = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
}

/** Sender of every email: the league itself, no persona. */
export const DEFAULT_EMAIL_FROM = "MSTP Dynasty <league@mstpdynasty.com>";

export function emailFrom(): string {
  return process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
}

/**
 * Roast lore from env ROAST_NOTES: a JSON object of manager first name -> text.
 * Lore never lives in the repo (it is public). The store key `keys.roastNotes()` is the other
 * source; env wins. Returns {} when unset or invalid.
 */
export function roastNotesFromEnv(): Record<string, string> {
  const raw = process.env.ROAST_NOTES;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Which optional integrations have their secrets. Use these to show "not configured yet" states. */
export const configured = {
  anthropic: () => Boolean(process.env.ANTHROPIC_API_KEY),
  resend: () => Boolean(process.env.RESEND_API_KEY),
  commissionerEmail: () => Boolean(process.env.COMMISSIONER_EMAIL),
  /** LEAGUE_EMAILS (comma-separated, a Vercel secret, never in the repo) is set. */
  leagueEmails: () => Boolean(process.env.LEAGUE_EMAILS?.trim()),
  kv: () =>
    Boolean(
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
        (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    ),
  password: () => Boolean(process.env.SITE_PASSWORD),
  cron: () => Boolean(process.env.CRON_SECRET),
  admin: () => Boolean(process.env.ADMIN_SECRET),
  image: () => (process.env.IMAGE_PROVIDER ?? "none") !== "none",
};
