/**
 * Pure lineup math for one team-week: optimal lineup, bench points left, the best single
 * bench/starter swap, and zero-point starters. No I/O, so every case is unit tested with
 * hand-built rosters.
 *
 * Candidate pool = every player Sleeper lists on the roster for that week (matchup
 * `players`), which is also how Sleeper computes its own max points ("ppts"). The weekly
 * matchup payload does not say who was on taxi or IR that week, so this matches Sleeper
 * rather than guessing.
 */
import { isEligible, optimalLineup, type OptimalLineup } from "@/lib/scoring";
import { r2 } from "./util";

export interface TeamWeekInput {
  /** Starting slots in roster_positions order (ctx.starterSlots). */
  slots: string[];
  /** Matchup starters, aligned with `slots`; "0" = empty slot. */
  starters: string[];
  /** Points per starter, aligned with `starters`. */
  startersPoints: number[];
  /** Every player on the roster that week (starters included). */
  players: string[];
  playersPoints: Record<string, number>;
  /** fantasy_positions for eligibility. */
  positionsOf: (playerId: string) => string[];
}

export interface SwapCandidate {
  slot: string;
  slotIndex: number;
  starterId: string;
  starterPoints: number;
  benchId: string;
  benchPoints: number;
  gain: number;
}

export function starterPointsTotal(input: TeamWeekInput): number {
  return r2(input.starters.reduce((s, id, i) => s + (id === "0" ? 0 : (input.startersPoints[i] ?? input.playersPoints[id] ?? 0)), 0));
}

export function teamOptimal(input: TeamWeekInput): OptimalLineup {
  const candidates = [...new Set(input.players.filter((id) => id && id !== "0"))].map((id) => ({
    playerId: id,
    positions: input.positionsOf(id),
    points: input.playersPoints[id] ?? 0,
  }));
  return optimalLineup(input.slots, candidates);
}

/** Bench points left = optimal lineup total minus what the starters scored (never negative). */
export function benchPointsLeft(input: TeamWeekInput, optimal = teamOptimal(input)): number {
  return r2(Math.max(0, optimal.total - starterPointsTotal(input)));
}

/**
 * Every single bench -> starter replacement (the bench player takes that starter's slot,
 * if eligible), best gain first. Ties break toward the earlier slot, then the bench
 * player listed first.
 */
export function swapCandidates(input: TeamWeekInput): SwapCandidate[] {
  const starting = new Set(input.starters.filter((id) => id !== "0"));
  const bench = [...new Set(input.players.filter((id) => id && id !== "0" && !starting.has(id)))];
  const out: SwapCandidate[] = [];
  input.slots.forEach((slot, i) => {
    const starterId = input.starters[i] ?? "0";
    const starterPoints = starterId === "0" ? 0 : (input.startersPoints[i] ?? input.playersPoints[starterId] ?? 0);
    for (const benchId of bench) {
      if (!isEligible(slot, input.positionsOf(benchId))) continue;
      const benchPoints = input.playersPoints[benchId] ?? 0;
      const gain = r2(benchPoints - starterPoints);
      if (gain <= 0) continue;
      out.push({ slot, slotIndex: i, starterId, starterPoints: r2(starterPoints), benchId, benchPoints: r2(benchPoints), gain });
    }
  });
  const benchOrder = new Map(bench.map((id, i) => [id, i]));
  out.sort((a, b) => b.gain - a.gain || a.slotIndex - b.slotIndex || (benchOrder.get(a.benchId) ?? 0) - (benchOrder.get(b.benchId) ?? 0));
  return out;
}

/** The biggest single swap, or null when no bench player outscored an eligible starter. */
export function bestSwap(input: TeamWeekInput): SwapCandidate | null {
  return swapCandidates(input)[0] ?? null;
}

/**
 * The single swap that would have flipped a loss by `margin` into a win (gain strictly
 * greater than the margin). Returns the biggest such swap, or null.
 */
export function flipSwapFor(input: TeamWeekInput, margin: number): SwapCandidate | null {
  const best = bestSwap(input);
  return best && best.gain > margin ? best : null;
}

/* ------------------------------------------------------------------ */
/* zero-point starters                                                 */
/* ------------------------------------------------------------------ */

export type ZeroReason = "bye" | "out" | "ir" | "inactive" | "empty_slot" | "played_zero";

export interface ZeroStarterInput {
  playerId: string;
  points: number;
  /** The player's NFL team that week (stat row team, else current team). */
  nflTeam: string | null;
  /** NFL teams on bye this week. */
  byeTeams: ReadonlySet<string>;
  /** true = recorded a game that week (stats gp > 0); false = no game played; null = unknown. */
  played: boolean | null;
  /** true when the player's game is over (or the week is in the past). */
  gameFinal: boolean;
  /** Current Sleeper injury status ("Out", "IR"...), used only for the current week. */
  injuryStatus: string | null;
}

/**
 * Why a starter produced nothing, or null when he is not a zero-point starter.
 * Negative scores from a player who played are not "zero" and return null.
 */
export function zeroStarterReason(s: ZeroStarterInput): ZeroReason | null {
  if (s.playerId === "0" || !s.playerId) return "empty_slot";
  if (s.points > 0) return null;
  const onBye = s.nflTeam !== null && s.byeTeams.has(s.nflTeam);
  if (onBye && s.played !== true) return "bye";
  const status = (s.injuryStatus ?? "").toLowerCase();
  if (s.played !== true) {
    if (status === "ir" || status === "pup" || status === "injured reserve") return "ir";
    if (status === "out" || status === "sus" || status === "na") return "out";
    if (!s.gameFinal) return null;
    return "inactive";
  }
  if (!s.gameFinal) return null;
  return s.points === 0 ? "played_zero" : null;
}
