/**
 * Power rankings (pure): all-play record, points per game and projected lineup strength,
 * each rescaled across the league (best = 100, worst = 0) and blended with POWER_WEIGHTS.
 * Before any games, projected strength alone.
 */
import type { RosterId } from "@/lib/types";
import { POWER_WEIGHTS } from "./constants";
import { round } from "./math";

export interface PowerInput {
  rosterIds: RosterId[];
  /** One map per played week: roster id -> points (teams that played that week). */
  weeks: Array<Map<RosterId, number>>;
  /** Head-to-head record per roster. */
  records: Map<RosterId, { wins: number; losses: number; ties: number }>;
  /** Projected optimal-lineup points per roster. */
  strength: Map<RosterId, number>;
}

export interface PowerCalcRow {
  rosterId: RosterId;
  score: number;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayWinPct: number;
  pointsPerGame: number;
  projectedStrength: number;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  luck: number;
}

export const POWER_FORMULA_GAMES =
  "Score is 40% all-play win rate, 30% points per game and 30% projected starting-lineup points, each rescaled so the best team in the league is 100 and the worst is 0.";
export const POWER_FORMULA_PROJECTED =
  "No games yet, so the score is projected starting-lineup points, rescaled so the best team in the league is 100 and the worst is 0.";
export const POWER_FORMULA_EMPTY = "No rosters and no games yet, so every team is tied at zero.";

function rescale(values: Map<RosterId, number>): Map<RosterId, number> {
  const xs = [...values.values()];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return new Map([...values].map(([id, v]) => [id, hi > lo ? (100 * (v - lo)) / (hi - lo) : 50]));
}

export function computePower(input: PowerInput): { rows: PowerCalcRow[]; formula: string } {
  const ap = new Map(input.rosterIds.map((id) => [id, { w: 0, l: 0, expected: 0, pts: 0, games: 0 }]));
  for (const week of input.weeks) {
    const entries = [...week].filter(([id]) => ap.has(id));
    const opponents = entries.length - 1;
    if (opponents < 1) continue;
    for (const [id, pts] of entries) {
      const a = ap.get(id)!;
      let w = 0;
      let l = 0;
      for (const [other, op] of entries) {
        if (other === id) continue;
        if (pts > op) w++;
        else if (pts < op) l++;
        else {
          w += 0.5;
          l += 0.5;
        }
      }
      a.w += w;
      a.l += l;
      a.expected += w / opponents;
      a.pts += pts;
      a.games++;
    }
  }

  const anyGames = [...ap.values()].some((a) => a.games > 0);
  const strength = new Map(input.rosterIds.map((id) => [id, input.strength.get(id) ?? 0]));
  const anyStrength = [...strength.values()].some((v) => v > 0);
  const sStrength = rescale(strength);

  let scores: Map<RosterId, number>;
  let formula: string;
  if (anyGames) {
    const sAp = rescale(new Map([...ap].map(([id, a]) => [id, a.w + a.l > 0 ? a.w / (a.w + a.l) : 0])));
    const sPpg = rescale(new Map([...ap].map(([id, a]) => [id, a.games ? a.pts / a.games : 0])));
    scores = new Map(
      input.rosterIds.map((id) => [
        id,
        POWER_WEIGHTS.allPlay * sAp.get(id)! + POWER_WEIGHTS.pointsPerGame * sPpg.get(id)! + POWER_WEIGHTS.projected * sStrength.get(id)!,
      ]),
    );
    formula = POWER_FORMULA_GAMES;
  } else if (anyStrength) {
    scores = sStrength;
    formula = POWER_FORMULA_PROJECTED;
  } else {
    scores = new Map(input.rosterIds.map((id) => [id, 0]));
    formula = POWER_FORMULA_EMPTY;
  }

  const rows = input.rosterIds.map((id): PowerCalcRow => {
    const a = ap.get(id)!;
    const rec = input.records.get(id) ?? { wins: 0, losses: 0, ties: 0 };
    return {
      rosterId: id,
      score: round(scores.get(id)!, 1),
      allPlayWins: round(a.w, 1),
      allPlayLosses: round(a.l, 1),
      allPlayWinPct: a.w + a.l > 0 ? round(a.w / (a.w + a.l), 3) : 0,
      pointsPerGame: a.games ? round(a.pts / a.games) : 0,
      projectedStrength: round(strength.get(id)!),
      wins: rec.wins,
      losses: rec.losses,
      ties: rec.ties,
      games: a.games,
      luck: round(rec.wins + rec.ties / 2 - a.expected),
    };
  });
  rows.sort((x, y) => y.score - x.score || y.projectedStrength - x.projectedStrength || x.rosterId - y.rosterId);
  return { rows, formula };
}
