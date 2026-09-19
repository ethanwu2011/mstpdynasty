/**
 * Rate limits on top of the store's atomic counter (store.incr). Counters are fixed windows
 * that start at the first hit. Every check fails OPEN when the store is down: a KV outage must
 * not lock the league out of its own site, and the routes keep their other defenses (the
 * password delay).
 *
 *   password gate      attempts per IP and overall, counted BEFORE the password is checked so
 *                      parallel guesses cannot race past the limit
 *   admin bearer       bearer attempts on the admin routes (POST /api/admin/test-email, the
 *                      counts on /api/health), per IP and overall, also counted BEFORE the
 *                      secret is compared, right or wrong
 */
import "server-only";
import * as store from "@/lib/store";

export const GATE_WINDOW_SECONDS = 15 * 60;
/** Password attempts per IP per window (right or wrong). */
export const GATE_ATTEMPTS_PER_IP = 10;
/** Password attempts per window across every IP. */
export const GATE_ATTEMPTS_GLOBAL = 100;

export const ADMIN_WINDOW_SECONDS = 15 * 60;
/** Admin bearer attempts per IP per window (right or wrong). */
export const ADMIN_ATTEMPTS_PER_IP = 10;
/** Admin bearer attempts per window across every IP. */
export const ADMIN_ATTEMPTS_GLOBAL = 30;

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

/**
 * Count one admin bearer attempt from `ip` before the secret is compared. False = refuse it
 * without comparing. Counting first (like the password gate) means parallel guesses cannot all
 * pass the check before any of them is counted.
 */
export async function allowAdminAttempt(ip: string): Promise<boolean> {
  const [mine, all] = await Promise.all([
    within(`admin:ip:${ip}`, ADMIN_ATTEMPTS_PER_IP, ADMIN_WINDOW_SECONDS),
    within("admin:all", ADMIN_ATTEMPTS_GLOBAL, ADMIN_WINDOW_SECONDS),
  ]);
  return mine && all;
}
