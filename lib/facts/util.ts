/**
 * Small shared helpers for the facts engine. Pure: no I/O.
 */
import { valueOf } from "@/lib/fantasycalc";
import { playerInfo } from "@/lib/sleeper";
import { roundPoints } from "@/lib/scoring";
import type { FantasyCalcSnapshot, LetterGrade, PlayerAsset, PlayerInfo, PlayersMap } from "@/lib/types";

export const r2 = roundPoints;
export const r1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

const ORDINALS = ["", "1st", "2nd", "3rd"];
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return ORDINALS[n % 10] ? `${n}${ORDINALS[n % 10].slice(1)}` : `${n}th`;
}

/** A player as a fact asset, with FantasyCalc value/rank when the snapshot has it. */
export function playerAsset(
  players: PlayersMap,
  id: string,
  snap: FantasyCalcSnapshot | null,
  hint?: { name?: string; position?: string | null; team?: string | null },
): PlayerAsset {
  const info: PlayerInfo = playerInfo(players, id, hint);
  const fc = snap ? valueOf(snap, id) : null;
  return {
    playerId: id,
    name: info.name,
    position: info.pos || hint?.position || "",
    nflTeam: info.team,
    age: info.age ?? (fc?.age !== null && fc?.age !== undefined ? Math.floor(fc.age) : null),
    value: fc ? fc.value : null,
    overallRank: fc ? fc.overallRank : null,
  };
}

/** Placeholder asset for an empty starting slot. */
export function emptySlotAsset(slot: string): PlayerAsset {
  return { playerId: "0", name: "Empty slot", position: slot, nflTeam: null, age: null, value: null, overallRank: null };
}

/**
 * Competition ranking ("1224"): equal values share the best rank.
 * `desc` true ranks the highest value first.
 */
export function competitionRanks(values: number[], desc = true): number[] {
  return values.map((v) => 1 + values.filter((o) => (desc ? o > v : o < v)).length);
}

/** Positions that can fill slots (Sleeper fantasy_positions, falling back to the primary position). */
export function positionsOf(players: PlayersMap, id: string, fallback?: string | null): string[] {
  const p = players[id];
  if (p?.positions?.length) return p.positions;
  if (p?.pos) return [p.pos];
  if (fallback) return [fallback];
  return /^[A-Z]{2,3}$/.test(id) ? ["DEF"] : [];
}

/* ------------------------------------------------------------------ */
/* letter grades                                                        */
/* ------------------------------------------------------------------ */

/**
 * Trade grade from the share of value won or lost: net / max(valueIn, valueOut).
 * Within +-FAIR_TRADE_BAND the trade is fair and both sides get a B.
 */
export const FAIR_TRADE_BAND = 0.05;

/** Winning side: share >= threshold. */
const TRADE_WIN_STEPS: Array<[number, LetterGrade]> = [
  [0.35, "A+"],
  [0.2, "A"],
  [0.1, "A-"],
  [FAIR_TRADE_BAND, "B+"],
];
/** Losing side: share > threshold (mirror image, so the two sides of a 2-team trade are symmetric). */
const TRADE_LOSE_STEPS: Array<[number, LetterGrade]> = [
  [-FAIR_TRADE_BAND, "B"],
  [-0.1, "B-"],
  [-0.15, "C+"],
  [-0.2, "C"],
  [-0.25, "C-"],
  [-0.3, "D+"],
  [-0.4, "D"],
  [-0.5, "D-"],
];

export function tradeShare(valueIn: number, valueOut: number): number {
  const base = Math.max(valueIn, valueOut);
  return base > 0 ? Math.round(((valueIn - valueOut) / base) * 1e6) / 1e6 : 0;
}

export function tradeGrade(valueIn: number, valueOut: number): LetterGrade {
  const share = tradeShare(valueIn, valueOut);
  for (const [min, grade] of TRADE_WIN_STEPS) if (share >= min) return grade;
  for (const [min, grade] of TRADE_LOSE_STEPS) if (share > min) return grade;
  return "F";
}

/**
 * Draft grade from a team's drafted value relative to the league mean
 * (share = total / mean - 1).
 */
const DRAFT_GRADE_STEPS: Array<[number, LetterGrade]> = [
  [0.15, "A+"],
  [0.1, "A"],
  [0.06, "A-"],
  [0.03, "B+"],
  [0, "B"],
  [-0.03, "B-"],
  [-0.06, "C+"],
  [-0.1, "C"],
  [-0.15, "C-"],
  [-0.2, "D"],
];

export function draftGrade(total: number, mean: number): LetterGrade {
  const share = mean > 0 ? Math.round((total / mean - 1) * 1e6) / 1e6 : 0;
  for (const [min, grade] of DRAFT_GRADE_STEPS) if (share >= min) return grade;
  return "F";
}
