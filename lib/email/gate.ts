/**
 * Request-level auth helpers shared by proxy.ts and the API routes: the optional site
 * password gate (SITE_PASSWORD), the cron bearer check (CRON_SECRET) and redirect
 * sanitizing. Lives under lib/email because that is the ops agent's folder; it imports
 * nothing heavy so the proxy bundle stays small. Server-only.
 */
import { createHmac } from "node:crypto";
import { safeEqual } from "./sign";

export const GATE_COOKIE = "mstp_gate";
/** 90 days. */
export const GATE_MAX_AGE_SECONDS = 90 * 24 * 3600;

export function gateEnabled(): boolean {
  return Boolean(process.env.SITE_PASSWORD);
}

/**
 * Cookie value for a correct password. Derived from the password, ADMIN_SECRET and
 * GATE_VERSION (all optional but the password), so changing the password or bumping
 * GATE_VERSION signs everyone out.
 */
export function gateToken(password: string | undefined = process.env.SITE_PASSWORD): string | null {
  if (!password) return null;
  return createHmac("sha256", password)
    .update(`mstpdynasty:gate:v1:${process.env.ADMIN_SECRET ?? ""}:${process.env.GATE_VERSION ?? ""}`)
    .digest("base64url");
}

export function isGateCookieValid(value: string | undefined | null): boolean {
  const expected = gateToken();
  if (!expected || !value) return false;
  return safeEqual(value, expected);
}

export function checkPassword(input: unknown): boolean {
  const password = process.env.SITE_PASSWORD;
  if (!password || typeof input !== "string") return false;
  return safeEqual(input, password);
}

/**
 * Paths the proxy lets through without the site password:
 *   /enter and /api/enter            the gate itself (password guesses are rate limited)
 *   /api/cron/*                      has its own bearer secret
 *   /api/unsubscribe, /api/admin/approve, /api/subscribe/confirm
 *                                    HMAC-signed links clicked from an email client
 *   /api/tick                        checks the gate cookie OR the cron bearer itself when the
 *                                    gate is on (checkTickAuth), so an uptime pinger can use it
 *   static assets and icons
 */
const UNGATED_EXACT = new Set([
  "/enter",
  "/api/enter",
  "/api/tick",
  "/api/unsubscribe",
  "/api/admin/approve",
  "/api/subscribe/confirm",
  "/favicon.ico",
  "/robots.txt",
]);
const UNGATED_PREFIX = ["/api/cron/", "/_next/", "/icon", "/apple-icon"];

export function isUngatedPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return UNGATED_EXACT.has(p) || UNGATED_PREFIX.some((x) => p.startsWith(x));
}

/** A same-site relative path to send the visitor back to, or "/". Blocks open redirects. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/";
  const s = next.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return "/";
  if (s.length > 512 || /[\u0000-\u001f\u007f\\]/.test(s)) return "/";
  if (s === "/enter" || s.startsWith("/enter?")) return "/";
  return s;
}

export type CronAuth = { ok: true } | { ok: false; status: 401 | 503; error: string };

/** True when a key that spends money or sends email is set (then dev routes need CRON_SECRET too). */
function hasPaidKeys(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/**
 * `Authorization: Bearer ${CRON_SECRET}` (what Vercel Cron sends). Without CRON_SECRET the
 * route is refused in production, and in dev it is open only while no RESEND_API_KEY or
 * ANTHROPIC_API_KEY is set: `next dev` listens on every interface, so anyone on the same
 * network could otherwise send real email and spend real tokens. (The Host header is not a
 * way out: the client picks it.) So `curl localhost:3000/api/cron/daily` works with no setup,
 * and needs the bearer once real keys are in .env.local.
 */
export function checkCronAuth(req: Request): CronAuth {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") return { ok: false, status: 503, error: "CRON_SECRET is not set." };
    if (hasPaidKeys()) {
      return { ok: false, status: 503, error: "CRON_SECRET is not set (required in dev once RESEND_API_KEY or ANTHROPIC_API_KEY is set)." };
    }
    return { ok: true };
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !safeEqual(match[1], secret)) return { ok: false, status: 401, error: "Unauthorized." };
  return { ok: true };
}

/** Value of the gate cookie on a plain Request (route handlers), if any. */
export function gateCookieFrom(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === GATE_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * /api/tick: open while the gate is off (the cooldown lock is taken before any work). With the
 * gate on it needs the gate cookie or, when CRON_SECRET is set, the cron bearer.
 */
export function checkTickAuth(req: Request): CronAuth {
  if (!gateEnabled()) return { ok: true };
  if (isGateCookieValid(gateCookieFrom(req))) return { ok: true };
  if (process.env.CRON_SECRET && checkCronAuth(req).ok) return { ok: true };
  return { ok: false, status: 401, error: "Password required." };
}

/**
 * Best-effort client address for rate limits. Vercel sets x-real-ip; elsewhere the first
 * x-forwarded-for hop. "unknown" (one shared bucket) when neither is there, as under next dev.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = real || forwarded || "unknown";
  return ip.slice(0, 64).replace(/[^0-9A-Za-z.:_-]/g, "_");
}
