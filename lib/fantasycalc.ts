/**
 * FantasyCalc dynasty values (2QB, 10 teams, PPR), mapped by Sleeper id.
 * Cached daily: one snapshot per ET date in the KV store (plus a compact copy kept for years),
 * so trade grades can use the value on the day of the trade and trades can be judged in
 * hindsight. The day's first read fetches FantasyCalc fresh (bypassing the Next data cache, so a
 * day's snapshot is never yesterday's payload); every later read that day is a store read.
 * The daily cron and the tick call ensureDailySnapshot() so a snapshot is taken every day even
 * when nobody opens a page, with at most one fetch a day.
 */
import { z } from "zod";
import { fetchJson, isFixtureMode } from "./http";
import * as store from "./store";
import { etDate } from "./time";
import type { FantasyCalcSnapshot, FantasyCalcValue, FantasyCalcValues } from "./types";

export const FANTASYCALC_URL =
  "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=10&ppr=1";
export const FANTASYCALC_REVALIDATE = 24 * 3600;

const RowSchema = z.looseObject({
  player: z.looseObject({
    name: z.string(),
    sleeperId: z.union([z.string(), z.number()]).nullable().optional(),
    position: z.string().nullable().optional(),
    maybeTeam: z.string().nullable().optional(),
    maybeAge: z.number().nullable().optional(),
  }),
  value: z.number(),
  overallRank: z.number(),
  positionRank: z.number().nullable().optional(),
  redraftValue: z.number().nullable().optional(),
  trend30Day: z.number().nullable().optional(),
});

export function parseFantasyCalc(payload: unknown, fetchedAt = Date.now()): FantasyCalcSnapshot {
  if (!Array.isArray(payload)) throw new Error("FantasyCalc: expected an array");
  const bySleeperId: Record<string, FantasyCalcValue> = {};
  const picks: FantasyCalcValue[] = [];
  for (const raw of payload) {
    const parsed = RowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const r = parsed.data;
    const sleeperId = r.player.sleeperId === null || r.player.sleeperId === undefined ? "" : String(r.player.sleeperId);
    if (!sleeperId) continue;
    const v: FantasyCalcValue = {
      sleeperId,
      name: r.player.name,
      position: r.player.position ?? "",
      team: r.player.maybeTeam ?? null,
      age: r.player.maybeAge ?? null,
      value: r.value,
      overallRank: r.overallRank,
      positionRank: r.positionRank ?? 0,
      redraftValue: r.redraftValue ?? 0,
      trend30Day: r.trend30Day ?? 0,
    };
    bySleeperId[sleeperId] = v;
    if (v.position === "PICK") picks.push(v);
  }
  return { fetchedAt, date: etDate(fetchedAt), bySleeperId, picks };
}

let memo: { exp: number; snap: FantasyCalcSnapshot } | null = null;

/** Today's values (ET date). Falls back to the latest stored snapshot if FantasyCalc is down. */
export async function getFantasyCalc(): Promise<FantasyCalcSnapshot> {
  const now = Date.now();
  if (memo && memo.exp > now && memo.snap.date === etDate(now)) return memo.snap;

  if (isFixtureMode()) {
    const snap = parseFantasyCalc(await fetchJson(FANTASYCALC_URL));
    memo = { exp: now + 3600_000, snap };
    return snap;
  }

  const today = etDate(now);
  try {
    const stored = await store.get<FantasyCalcSnapshot>(store.keys.fantasyCalc(today));
    if (stored) {
      memo = { exp: now + 3600_000, snap: stored };
      return stored;
    }
  } catch {
    // fall through
  }

  try {
    // Fresh on purpose: this payload becomes today's stored snapshot for good.
    const snap = parseFantasyCalc(await fetchJson(FANTASYCALC_URL, { noStore: true }), now);
    try {
      await store.set(store.keys.fantasyCalc(today), snap, { ttlSeconds: 400 * 24 * 3600 });
      await store.set(store.keys.fantasyCalcLatest(), snap);
      // Compact copy, kept for years: trade hindsight and value charts read one per day.
      await store.set(store.keys.fantasyCalcValues(today), compactValues(snap), { ttlSeconds: VALUES_TTL_SECONDS });
    } catch {
      // best effort
    }
    memo = { exp: now + 3600_000, snap };
    return snap;
  } catch (err) {
    const latest = await store.get<FantasyCalcSnapshot>(store.keys.fantasyCalcLatest()).catch(() => null);
    if (latest) return latest;
    throw err;
  }
}

export interface DailySnapshotResult {
  /** ET date "YYYY-MM-DD". */
  date: string;
  /**
   * "stored": fetched and stored now. "present": today's snapshot was already stored.
   * "waiting": an earlier attempt today failed; retried after SNAPSHOT_RETRY_SECONDS.
   * "fixture": fixture mode never stores snapshots. "error": FantasyCalc or the store failed.
   */
  status: "stored" | "present" | "waiting" | "fixture" | "error";
  detail?: string;
}

/** After a failed fetch, the next attempt waits this long (the tick runs every 2 minutes). */
export const SNAPSHOT_RETRY_SECONDS = 30 * 60;
let snapshotDate: string | null = null;

/**
 * Make sure today's (ET) FantasyCalc snapshot is stored: the daily cron and the tick call this,
 * so history accrues every day. At most one fetch a day; a failure is retried at most every
 * SNAPSHOT_RETRY_SECONDS. Never throws.
 */
export async function ensureDailySnapshot(now: number = Date.now()): Promise<DailySnapshotResult> {
  const date = etDate(now);
  if (isFixtureMode()) return { date, status: "fixture" };
  if (snapshotDate === date) return { date, status: "present" };
  try {
    const have =
      (await store.get<FantasyCalcValues>(store.keys.fantasyCalcValues(date))) ?? (await store.get<FantasyCalcSnapshot>(store.keys.fantasyCalc(date)));
    if (have) {
      snapshotDate = date;
      return { date, status: "present" };
    }
    if (!(await store.lock(store.keys.fantasyCalcFetchLock(date), SNAPSHOT_RETRY_SECONDS))) return { date, status: "waiting" };
    const snap = await getFantasyCalc();
    if (snap.date !== date || !(await store.get(store.keys.fantasyCalc(date)))) {
      return { date, status: "error", detail: "FantasyCalc did not answer; kept the last stored snapshot." };
    }
    snapshotDate = date;
    return { date, status: "stored", detail: `${Object.keys(snap.bySleeperId).length} values.` };
  } catch (err) {
    return { date, status: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Tests: forget which day this process already snapshotted. */
export function resetSnapshotMemoForTests(): void {
  snapshotDate = null;
  memo = null;
}

/** Snapshot stored for a past ET date, if the site was running that day. */
export async function getFantasyCalcOn(date: string): Promise<FantasyCalcSnapshot | null> {
  if (isFixtureMode()) return null;
  return store.get<FantasyCalcSnapshot>(store.keys.fantasyCalc(date)).catch(() => null);
}

/** Compact values are small, so they outlive the full snapshots (trade hindsight goes back years). */
export const VALUES_TTL_SECONDS = 5 * 365 * 24 * 3600;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sleeper id -> value and pick name -> value of one snapshot. */
export function compactValues(snap: FantasyCalcSnapshot): FantasyCalcValues {
  const values: Record<string, number> = {};
  const picks: Record<string, number> = {};
  for (const [id, v] of Object.entries(snap.bySleeperId)) if (v.position !== "PICK") values[id] = v.value;
  for (const p of snap.picks) picks[p.name] = p.value;
  return { date: snap.date, values, picks };
}

/**
 * ET dates with a stored snapshot (full or compact), oldest first. Empty in fixture mode (like
 * getFantasyCalcOn) and on a fresh store: history accrues forward, one snapshot per day the site runs.
 */
export async function listFantasyCalcDates(): Promise<string[]> {
  if (isFixtureMode()) return [];
  const suffix = (prefix: string) => (k: string) => k.slice(prefix.length);
  const [full, compact] = await Promise.all([
    store.list(store.keys.fantasyCalcPrefix()).catch(() => [] as string[]),
    store.list(store.keys.fantasyCalcValues("")).catch(() => [] as string[]),
  ]);
  const dates = new Set([
    ...full.map(suffix(store.keys.fantasyCalcPrefix())),
    ...compact.map(suffix(store.keys.fantasyCalcValues(""))),
  ]);
  return [...dates].filter((d) => DATE_RE.test(d)).sort();
}

/** Compact values stored for an ET date, derived (and cached) from the full snapshot when only that exists. */
export async function getFantasyCalcValuesOn(date: string): Promise<FantasyCalcValues | null> {
  if (isFixtureMode() || !DATE_RE.test(date)) return null;
  const hit = await store.get<FantasyCalcValues>(store.keys.fantasyCalcValues(date)).catch(() => null);
  if (hit) return hit;
  const full = await store.get<FantasyCalcSnapshot>(store.keys.fantasyCalc(date)).catch(() => null);
  if (!full) return null;
  const compact = compactValues(full);
  await store.set(store.keys.fantasyCalcValues(date), compact, { ttlSeconds: VALUES_TTL_SECONDS }).catch(() => undefined);
  return compact;
}

export function valueOf(snap: FantasyCalcSnapshot, sleeperId: string): FantasyCalcValue | null {
  return snap.bySleeperId[sleeperId] ?? null;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

/**
 * FantasyCalc value of a future rookie pick. FantasyCalc names picks like
 * "2027 1st (Early)" / "2027 1st (Mid)" / "2027 1st (Late)" or "2027 1st".
 * `tier` picks early/mid/late when known, otherwise the generic or mid value is used.
 */
export function pickValue(
  snap: FantasyCalcSnapshot,
  season: string | number,
  round: number,
  tier?: "early" | "mid" | "late",
): FantasyCalcValue | null {
  const base = `${season} ${ORDINAL[round] ?? `${round}th`}`;
  const byName = (name: string) => snap.picks.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
  if (tier) {
    const hit = byName(`${base} (${tier[0].toUpperCase()}${tier.slice(1)})`);
    if (hit) return hit;
  }
  return byName(base) ?? byName(`${base} (Mid)`) ?? null;
}
