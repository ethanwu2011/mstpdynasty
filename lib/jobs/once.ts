/**
 * "Do this once" bookkeeping for jobs and sends, on top of lib/store.
 *
 *   done:<name>   permanent marker (long TTL), written only after the work succeeded
 *   run:<name>    in-flight lock (short TTL), so two overlapping runs never both work on it
 *
 * If a run dies halfway, the in-flight lock simply expires and the next run retries.
 * Leaf module: imports only the store, so lib/email can use it without a cycle.
 */
import * as store from "@/lib/store";

export type ClaimState = "claimed" | "done" | "busy";

const DAY = 24 * 3600;
export const DONE_TTL_SECONDS = 400 * DAY;
export const INFLIGHT_TTL_SECONDS = 15 * 60;

const doneKey = (leagueId: string, name: string) => store.keys.snapshot(leagueId, `done:${name}`);
const inflightKey = (leagueId: string, name: string) => store.keys.lock(leagueId, `run:${name}`);

export async function getDone<T = unknown>(leagueId: string, name: string): Promise<T | null> {
  return store.get<T>(doneKey(leagueId, name));
}

export async function claimOnce(leagueId: string, name: string, inflightSeconds = INFLIGHT_TTL_SECONDS): Promise<ClaimState> {
  if (await getDone(leagueId, name)) return "done";
  if (!(await store.lock(inflightKey(leagueId, name), inflightSeconds))) return "busy";
  // Someone may have finished between the check and the lock.
  if (await getDone(leagueId, name)) {
    await store.unlock(inflightKey(leagueId, name));
    return "done";
  }
  return "claimed";
}

export async function markDone(leagueId: string, name: string, value: unknown = { at: Date.now() }, ttlSeconds = DONE_TTL_SECONDS): Promise<void> {
  await store.set(doneKey(leagueId, name), value ?? { at: Date.now() }, { ttlSeconds });
  await store.unlock(inflightKey(leagueId, name));
}

export async function releaseClaim(leagueId: string, name: string): Promise<void> {
  await store.unlock(inflightKey(leagueId, name));
}
