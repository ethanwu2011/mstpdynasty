/**
 * The shape of the newsletter writer's league memory (see memory.ts, which loads it). Kept apart from the
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
  /**
   * The Daily while the draft is live: who is on the clock now, at which pick, how many rounds
   * are left (this one included), and when picks resume while the draft is paused. Never how
   * long anyone has been on the clock: the site does not know when a pick was made.
   */
  onTheClock: { manager: string; team: string; pick: string; roundsLeft: number; resumesAt?: string } | null;
  /** The commissioner's first name, so the writer knows who never gets spared. */
  commissioner: string | null;
  /** Starting lineup slots per position ({ QB: 2, TE: 1, FLEX: 3 }), for draft issues. */
  starters: Record<string, number> | null;
  draft: DraftContext | null;
}

/** Starting slots per position, in lineup order: ["QB", "QB", "TE"] -> { QB: 2, TE: 1 }. */
export function starterCounts(slots: readonly string[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const s of slots) if (s) out[s] = (out[s] ?? 0) + 1;
  return Object.keys(out).length ? out : null;
}

export const EMPTY_MEMORY: PayloadMemory = {
  draftSlots: {},
  rapSheet: {},
  loserCrowns: {},
  playoffPctLastWeek: {},
  winPctBefore: {},
  onTheClock: null,
  commissioner: null,
  starters: null,
  draft: null,
};
