/**
 * League scoring and lineup helpers.
 *
 * Points = sum over scoring_settings of weight x stat. Sleeper's stat lines already carry
 * derived keys (bonus_rec_te, pts_allow_* buckets, fgm_* distance buckets...), so a plain
 * dot product matches Sleeper exactly. The one position-dependent rule is the TE reception
 * bonus: if a line lacks `bonus_rec_te` (older payloads, hand-built lines) it is derived from
 * `rec` when the player is a TE. Never hardcode weights: always pass the league's
 * scoring_settings.
 */
import type { ScoringSettings, StatLine } from "./types";

/** Round to Sleeper's 2 decimals. */
export function roundPoints(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Position-derived bonus keys: stat key -> [position, source stat]. */
const POSITION_BONUSES: Array<{ key: string; position: string; from: string }> = [
  { key: "bonus_rec_te", position: "TE", from: "rec" },
  { key: "bonus_rec_rb", position: "RB", from: "rec" },
  { key: "bonus_rec_wr", position: "WR", from: "rec" },
];

/**
 * Fantasy points for one stat line.
 * @param position the player's position (enables the TE bonus when the line lacks it)
 */
export function pointsFromStats(stats: StatLine | null | undefined, scoring: ScoringSettings, position?: string | null): number {
  if (!stats) return 0;
  let total = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    if (!weight) continue;
    const v = stats[key];
    if (typeof v === "number" && Number.isFinite(v)) total += v * weight;
  }
  if (position) {
    for (const b of POSITION_BONUSES) {
      const weight = scoring[b.key];
      if (!weight || b.position !== position || stats[b.key] !== undefined) continue;
      const v = stats[b.from];
      if (typeof v === "number" && Number.isFinite(v)) total += v * weight;
    }
  }
  return roundPoints(total);
}

/* ------------------------------------------------------------------ */
/* slots                                                               */
/* ------------------------------------------------------------------ */

/** Slot -> positions that may fill it (Sleeper slot names). */
export const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

export const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** Starting slots from roster_positions, in order (drops BN / IR / TAXI). */
export function starterSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((s) => !NON_STARTER_SLOTS.has(s));
}

/** Can a player with these positions (fantasy_positions, or a single position) fill `slot`? */
export function isEligible(slot: string, positions: string | readonly string[]): boolean {
  const allowed = SLOT_ELIGIBILITY[slot];
  if (!allowed) return false;
  const list = typeof positions === "string" ? [positions] : positions;
  return list.some((p) => allowed.includes(p));
}

export function isFlexSlot(slot: string): boolean {
  return (SLOT_ELIGIBILITY[slot]?.length ?? 0) > 1;
}

/* ------------------------------------------------------------------ */
/* optimal lineup                                                      */
/* ------------------------------------------------------------------ */

export interface LineupCandidate {
  playerId: string;
  /** fantasy_positions (or [position]). */
  positions: readonly string[];
  points: number;
}

export interface LineupAssignment {
  slot: string;
  /** null when no eligible player was available. */
  playerId: string | null;
  points: number;
}

export interface OptimalLineup {
  total: number;
  slots: LineupAssignment[];
}

/**
 * Best possible lineup for the given slots (exact: Hungarian assignment, so it is correct
 * even for non-nested flex rules). Ties break toward the earlier candidate.
 */
export function optimalLineup(slots: string[], candidates: LineupCandidate[]): OptimalLineup {
  const n = slots.length;
  if (n === 0) return { total: 0, slots: [] };
  // Columns: candidates plus n "empty" dummies (0 points, fit anywhere).
  const m = candidates.length + n;
  const BIG = 1e9;
  // cost[i][j] = -points (minimize); ineligible = BIG. Tiny index penalty keeps ties stable.
  const cost: number[][] = slots.map((slot) =>
    Array.from({ length: m }, (_, j) => {
      if (j >= candidates.length) return 0;
      const c = candidates[j];
      if (!isEligible(slot, c.positions)) return BIG;
      return -c.points + j * 1e-9;
    }),
  );
  const assignment = hungarian(cost, n, m);
  const out: LineupAssignment[] = slots.map((slot, i) => {
    const j = assignment[i];
    if (j < 0 || j >= candidates.length || cost[i][j] >= BIG) return { slot, playerId: null, points: 0 };
    return { slot, playerId: candidates[j].playerId, points: candidates[j].points };
  });
  return { total: roundPoints(out.reduce((s, a) => s + a.points, 0)), slots: out };
}

/**
 * Min-cost assignment of n rows to distinct columns (n <= m). Returns column per row.
 * Classic O(n^2 m) potentials implementation.
 */
function hungarian(cost: number[][], n: number, m: number): number[] {
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) res[p[j] - 1] = j - 1;
  return res;
}
