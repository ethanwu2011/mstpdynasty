/**
 * The shape of The Roast's league memory (see memory.ts, which loads it). Kept apart from the
 * loader so the pure planners (plan.ts, items.ts) do not pull the facts, models and store
 * modules in with it.
 */
import type { DraftPickFact, FantasyCalcValue } from "@/lib/types";

/** What a draft pick payload needs beyond the pick itself. */
export interface DraftContext {
  /** Every pick in the draft so far (any order). */
  picks: DraftPickFact[];
  /** FantasyCalc player values sorted by overall rank (no draft picks), for "passed on". Null when unavailable. */
  fc: FantasyCalcValue[] | null;
  /** The draft's pick clock, in seconds (0 or null = none). */
  pickTimerSeconds: number | null;
  /** Rookie-only draft: overall FantasyCalc ranks include veterans, so nobody was "passed on". */
  rookieOnly: boolean;
}

export interface PayloadMemory {
  /** playerId -> draft slot ("1.03") in the league's draft. */
  draftSlots: Record<string, string>;
  /** rosterId -> up to two Wall of Shame headlines this season, different kinds. */
  rapSheet: Record<number, string[]>;
  /** rosterId -> times crowned Loser of the Week this season. */
  loserCrowns: Record<number, number>;
  /** rosterId -> playoff odds (percent) in the snapshot one week earlier. */
  playoffPctLastWeek: Record<number, number>;
  /** rosterId -> pre-kickoff win probability (percent) for this week's matchup. */
  winPctBefore: Record<number, number>;
  /** The Daily Roast while the draft is live: who is on the clock and for how long. */
  onTheClock: { manager: string; team: string; hoursSoFar: number | null } | null;
  draft: DraftContext | null;
}

export const EMPTY_MEMORY: PayloadMemory = {
  draftSlots: {},
  rapSheet: {},
  loserCrowns: {},
  playoffPctLastWeek: {},
  winPctBefore: {},
  onTheClock: null,
  draft: null,
};
