/**
 * Draft pick timestamps. Sleeper's pick objects carry no time, so the tick records when it
 * first sees each new pick, and lib/facts reads the result to fill
 * DraftPickFact.pickedAt / secondsOnClock.
 *
 * Store key: keys.snapshot(leagueId, "draft-pick-seen")
 * Value:     { [draftId]: { [pickNo]: epochMs } }
 *
 * When a tick sees exactly one new pick, the time is Sleeper's draft `last_picked` (exact) or
 * the tick time. When several picks landed between ticks, only the latest one gets a time and
 * the others stay unknown: better null than a made-up 0 seconds on the clock.
 */
import * as store from "@/lib/store";
import type { SleeperDraft, SleeperDraftPick } from "@/lib/types";

export const DRAFT_PICK_SEEN = "draft-pick-seen";

export type DraftPickSeen = Record<string, Record<string, number>>;

const seenKey = (leagueId: string) => store.keys.snapshot(leagueId, DRAFT_PICK_SEEN);

/** pickNo -> first-seen epoch ms for one draft (only picks whose time is known). */
export async function readDraftPickTimes(leagueId: string, draftId: string): Promise<Record<number, number>> {
  const all = (await store.get<DraftPickSeen>(seenKey(leagueId)).catch(() => null)) ?? {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(all[draftId] ?? {})) if (Number.isFinite(Number(k)) && typeof v === "number") out[Number(k)] = v;
  return out;
}

/**
 * Record the newest pick's time. Only while the draft is live (or finished within the last
 * hour), so replaying an old draft never invents timestamps. Returns the pick number recorded.
 */
export async function recordDraftPickTimes(
  leagueId: string,
  draft: SleeperDraft,
  picks: SleeperDraftPick[],
  now: number,
): Promise<number | null> {
  const live = draft.status === "drafting" || draft.status === "paused";
  const justFinished = draft.status === "complete" && draft.last_picked !== null && now - draft.last_picked < 3600_000;
  if ((!live && !justFinished) || picks.length === 0) return null;

  // Read-modify-write under a short lock, so two overlapping ticks cannot drop each other's times.
  const lockKey = store.keys.lock(leagueId, `${DRAFT_PICK_SEEN}:write`);
  if (!(await store.lock(lockKey, 30))) return null;
  try {
    return await recordLocked(leagueId, draft, picks, now);
  } finally {
    await store.unlock(lockKey);
  }
}

async function recordLocked(leagueId: string, draft: SleeperDraft, picks: SleeperDraftPick[], now: number): Promise<number | null> {
  const all = (await store.get<DraftPickSeen>(seenKey(leagueId))) ?? {};
  const known = all[draft.draft_id] ?? {};
  const knownNos = Object.keys(known).map(Number).filter(Number.isFinite);
  const maxKnown = knownNos.length ? Math.max(...knownNos) : 0;
  const latest = Math.max(...picks.map((p) => p.pick_no));
  if (latest <= maxKnown) return null;

  const prevTime = maxKnown ? known[String(maxKnown)] : 0;
  const lp = draft.last_picked;
  // `last_picked` can lag the picks list by a cache cycle; only trust it when it moved forward.
  const at = lp && lp > prevTime && lp <= now ? lp : now;
  all[draft.draft_id] = { ...known, [String(latest)]: at };
  await store.set(seenKey(leagueId), all, { ttlSeconds: 400 * 24 * 3600 });
  return latest;
}
