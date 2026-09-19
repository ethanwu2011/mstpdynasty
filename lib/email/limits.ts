/**
 * Rate limits on top of the store's atomic counter (store.incr). Counters are fixed windows
 * that start at the first hit. Every check fails OPEN when the store is down: a KV outage must
 * not lock the league out of its own site, and the routes keep their other defenses (the
 * password delay, the per-address confirmation lock).
 *
 *   password gate      attempts per IP and overall, counted BEFORE the password is checked so
 *                      parallel guesses cannot race past the limit
 *   subscribe          sign-ups per IP, and confirmation emails per hour for the whole site
 *                      (protects the Resend quota the issues depend on)
 */
import "server-only";
import * as store from "@/lib/store";

export const GATE_WINDOW_SECONDS = 15 * 60;
/** Password attempts per IP per window (right or wrong). */
export const GATE_ATTEMPTS_PER_IP = 10;
/** Password attempts per window across every IP. */
export const GATE_ATTEMPTS_GLOBAL = 100;

export const SUBSCRIBE_WINDOW_SECONDS = 3600;
/** Sign-up posts per IP per hour. */
export const SUBSCRIBES_PER_IP = 5;
/** Confirmation emails per hour for the whole site. */
export const CONFIRM_EMAILS_PER_HOUR = 20;

async function within(name: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    return (await store.incr(store.keys.rate(name), windowSeconds)) <= limit;
  } catch (err) {
    console.error(`[limits] ${name}: store unavailable, allowing`, err);
    return true;
  }
}

/** Count one password attempt. False = refuse it without checking the password. */
export async function allowGateAttempt(ip: string): Promise<boolean> {
  const [mine, all] = await Promise.all([
    within(`gate:ip:${ip}`, GATE_ATTEMPTS_PER_IP, GATE_WINDOW_SECONDS),
    within("gate:all", GATE_ATTEMPTS_GLOBAL, GATE_WINDOW_SECONDS),
  ]);
  return mine && all;
}

/** Count one sign-up post from `ip`. */
export async function allowSubscribeAttempt(ip: string): Promise<boolean> {
  return within(`subscribe:ip:${ip}`, SUBSCRIBES_PER_IP, SUBSCRIBE_WINDOW_SECONDS);
}

/** Count one confirmation email against the site-wide hourly budget. */
export async function allowConfirmEmail(): Promise<boolean> {
  return within("confirm-mail:all", CONFIRM_EMAILS_PER_HOUR, SUBSCRIBE_WINDOW_SECONDS);
}
