/**
 * Draft pick timestamps. Sleeper's pick objects carry no time, so the tick records when it
 * first sees each new pick, and lib/facts reads the result to fill DraftPickFact.pickedAt.
 * That is when the site noticed the pick, not when it was made, so it never becomes a time on
 * the clock.
 *
 * Store key: keys.snapshot(leagueId, "draft-pick-seen")
 * Value:     { [draftId]: { [pickNo]: epochMs } }
 *
 * When a tick sees exactly one new pick, the time is Sleeper's draft `last_picked` (exact) or
 * the tick time. When several picks landed between ticks, only the latest one gets a time and
 * the others stay unknown: better null than a made-up time.
 */
import { getRoast, roastIds } from "@/lib/archive";
import { DRAFT_PICK_RANKS, parsePickRanks, type FrozenPickRank } from "@/lib/facts/draft";
import * as store from "@/lib/store";
import type { DraftPickFact, SleeperDraft, SleeperDraftPick } from "@/lib/types";

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

/* ------------------------------------------------------------------ */
/* frozen FantasyCalc ranks                                            */
/* ------------------------------------------------------------------ */

export type DraftPickRanks = Record<string, Record<string, FrozenPickRank>>;

const ranksKey = (leagueId: string) => store.keys.snapshot(leagueId, DRAFT_PICK_RANKS);

/** The ranks a pick's stored write-up was written from, when it has one for this same player. */
function writtenRanks(fact: unknown, p: DraftPickFact): FrozenPickRank | null {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) return null;
  const f = fact as Partial<DraftPickFact>;
  if (f.kind !== "draft_pick" || f.pickNo !== p.pickNo || f.player?.playerId !== p.player.playerId) return null;
  return { fcRank: f.fcRank ?? null, fcPositionRank: f.fcPositionRank ?? null };
}

/**
 * Freeze the FantasyCalc ranks of every pick that has none yet: the ranks its stored write-up
 * states when it has one (so the card's heading, receipt and chips agree with the words), else
 * the ranks in `picks` (today's snapshot, which is the day the tick first sees a new pick).
 * A frozen rank is never changed. Returns the draft's frozen ranks after the write.
 */
export async function freezeDraftPickRanks(leagueId: string, draftId: string, picks: DraftPickFact[]): Promise<Map<number, FrozenPickRank>> {
  const current = parsePickRanks(await store.get<DraftPickRanks>(ranksKey(leagueId)).catch(() => null), draftId);
  if (picks.every((p) => current.has(p.pickNo))) return current;
  const lockKey = store.keys.lock(leagueId, `${DRAFT_PICK_RANKS}:write`);
  if (!(await store.lock(lockKey, 30).catch(() => false))) return current;
  try {
    const all = (await store.get<DraftPickRanks>(ranksKey(leagueId))) ?? {};
    const known: Record<string, FrozenPickRank> = { ...(all[draftId] ?? {}) };
    const missing = picks.filter((p) => !known[String(p.pickNo)]);
    const written = await Promise.all(missing.map((p) => getRoast(leagueId, roastIds.pick(draftId, p.pickNo)).catch(() => null)));
    missing.forEach((p, i) => {
      known[String(p.pickNo)] = writtenRanks(written[i]?.facts, p) ?? { fcRank: p.fcRank, fcPositionRank: p.fcPositionRank };
    });
    all[draftId] = known;
    await store.set(ranksKey(leagueId), all, { ttlSeconds: 400 * 24 * 3600 });
    return parsePickRanks(all, draftId);
  } finally {
    await store.unlock(lockKey).catch(() => undefined);
  }
}
