/**
 * FantasyCalc dynasty values (2QB, 10 teams, PPR), mapped by Sleeper id.
 * Cached daily: Next data cache (payload is ~0.5 MB) + a per-ET-date snapshot in the KV
 * store, so trade grades can use the value on the day of the trade.
 */
import { z } from "zod";
import { fetchJson, isFixtureMode } from "./http";
import * as store from "./store";
import { etDate } from "./time";
import type { FantasyCalcSnapshot, FantasyCalcValue } from "./types";

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
    const snap = parseFantasyCalc(
      await fetchJson(FANTASYCALC_URL, { revalidate: FANTASYCALC_REVALIDATE, tags: ["fantasycalc"] }),
      now,
    );
    try {
      await store.set(store.keys.fantasyCalc(today), snap, { ttlSeconds: 400 * 24 * 3600 });
      await store.set(store.keys.fantasyCalcLatest(), snap);
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

/** Snapshot stored for a past ET date, if the site was running that day. */
export async function getFantasyCalcOn(date: string): Promise<FantasyCalcSnapshot | null> {
  if (isFixtureMode()) return null;
  return store.get<FantasyCalcSnapshot>(store.keys.fantasyCalc(date)).catch(() => null);
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
