/**
 * Facts engine public API. OWNER: roast agent (lib/facts/**, lib/roast/**, config/roast-notes.ts,
 * tests/facts*, tests/roast*).
 *
 * Code computes every fact; the LLM never does. Everything here is deterministic for a given
 * set of Sleeper / FantasyCalc payloads and unit tested on the RT fixture league plus
 * hand-built cases (tests/facts*.test.ts).
 *
 *   weeklyFacts       scores, optimal lineups, bench points left, the swap that flips a loss,
 *                     zero-point starters, projected vs actual, all-play, robbed/fraud, streaks
 *   transactionFacts  trades with FantasyCalc value deltas and grades, waiver claims with
 *                     winning and failed competing bids, $0 bids, overpays, notable drops
 *   draftFacts        every pick with reach/steal, position runs, on the clock, grades
 *   tnfFacts          the Thursday game: who got cooked or carried
 *   shameEntries      the all-time Wall of Shame
 *   tradeHindsight    every trade valued at the time and today, with a value-over-time series
 *   worstTrades       the worst-trade-in-league-history leaderboard (value lost as of today)
 *
 * Also: standingsAsOf (regular-season standings at the end of any week) and lastCompletedWeek.
 * The Daily's injuries and lineup alerts are assembled by the ops agent
 * (lib/jobs/daily-facts.ts) from these facts plus its own snapshots.
 */
import { getLeagueContext } from "@/lib/league";
import * as store from "@/lib/store";
import type {
  DraftFacts,
  LeagueContext,
  ShameBoard,
  StandingRow,
  TnfFacts,
  TradeHindsight,
  TradeHindsightBoard,
  TransactionFacts,
  WeeklyFacts,
} from "@/lib/types";
import { computeDraftFacts } from "./draft";
import { computeHindsightBoard, rankWorstTrades } from "./hindsight";
import { createLoader, type FactsLoader } from "./load";
import { assembleShame, draftShame, transactionShame, weeklyShame } from "./shame";
import { computeTnfFacts } from "./tnf";
import { computeTransactionFacts } from "./transactions";
import { computeWeeklyFacts, lastCompletedWeek, standingsThrough } from "./weekly";

export { lastCompletedWeek } from "./weekly";
export { HINDSIGHT_THEN_WINDOW_DAYS, MAX_SERIES_POINTS } from "./hindsight";
export type { LosingBidFact, LosingBidReason } from "./transactions";

async function loaderFor(ctx?: LeagueContext): Promise<FactsLoader> {
  return createLoader(ctx ?? (await getLeagueContext()));
}

/** Weekly recap facts for a completed (or in-progress) week. */
export async function weeklyFacts(week: number, ctx?: LeagueContext): Promise<WeeklyFacts> {
  return computeWeeklyFacts(week, await loaderFor(ctx));
}

/** Trades and waiver/free-agent moves processed after `sinceMs` (and up to `untilMs`, default now). */
export async function transactionFacts(sinceMs: number, ctx?: LeagueContext, untilMs?: number): Promise<TransactionFacts> {
  return computeTransactionFacts(sinceMs, await loaderFor(ctx), untilMs);
}

/** Startup draft facts: every pick with FantasyCalc reach/steal, runs, and grades once complete. */
export async function draftFacts(ctx?: LeagueContext): Promise<DraftFacts> {
  return computeDraftFacts(await loaderFor(ctx));
}

/** Thursday night game: who got cooked or carried. */
export async function tnfFacts(week: number, ctx?: LeagueContext): Promise<TnfFacts> {
  return computeTnfFacts(week, await loaderFor(ctx));
}

/** Regular-season standings as of the end of `week`, computed from matchups. */
export async function standingsAsOf(week: number, ctx?: LeagueContext): Promise<StandingRow[]> {
  return standingsThrough(week, await loaderFor(ctx));
}

/** Bump when the WeeklyFacts shape or logic changes, so cached final weeks are recomputed. */
const WEEKLY_CACHE_VERSION = 2;
const WEEKLY_CACHE_TTL = 24 * 3600;

/**
 * Facts for a week that is already final (no projections). Cached for a day in the store, so
 * the Wall of Shame does not refetch every week's 2 MB stat file on each cold start.
 */
async function finalWeekFacts(week: number, loader: FactsLoader): Promise<WeeklyFacts> {
  const c = loader.ctx;
  const key = store.keys.snapshot(c.leagueId, `weekly-facts:v${WEEKLY_CACHE_VERSION}:${c.season}:${week}`);
  const cached = await store.get<WeeklyFacts>(key).catch(() => null);
  if (cached) return cached;
  const wk = await computeWeeklyFacts(week, loader, { withProjections: false });
  await store.set(key, wk, { ttlSeconds: WEEKLY_CACHE_TTL }).catch(() => undefined);
  return wk;
}

/**
 * Loser of the Week crowns per roster over weeks 1..throughWeek (only weeks already final),
 * for the writer's league memory. Uses the same per-week cache as the Wall of Shame.
 */
export async function loserOfTheWeekCounts(throughWeek: number, ctx?: LeagueContext): Promise<Record<number, number>> {
  const loader = await loaderFor(ctx);
  const last = Math.min(throughWeek, lastCompletedWeek(loader.ctx));
  const out: Record<number, number> = {};
  for (let w = 1; w <= last; w++) {
    const loser = (await finalWeekFacts(w, loader)).loserOfTheWeek;
    if (loser) out[loser.team.rosterId] = (out[loser.team.rosterId] ?? 0) + 1;
  }
  return out;
}

/** Wall of Shame, all time (this league season). */
export async function shameEntries(ctx?: LeagueContext): Promise<ShameBoard> {
  const loader = await loaderFor(ctx);
  const c = loader.ctx;
  const last = lastCompletedWeek(c);
  const weeks: WeeklyFacts[] = [];
  for (let w = 1; w <= last; w++) weeks.push(await finalWeekFacts(w, loader));
  const [tx, draft] = await Promise.all([computeTransactionFacts(0, loader), computeDraftFacts(loader)]);
  return assembleShame([
    ...weeklyShame(weeks),
    ...transactionShame(c.season, tx, c.league.settings.waiver_budget ?? 100),
    ...draftShame(c.season, draft),
  ]);
}

/**
 * Every trade in hindsight, newest first: value at the time (the stored FantasyCalc snapshot
 * nearest the trade, null before snapshots existed) and today per side, the change, and a
 * sampled daily series for a value-over-time dot chart.
 */
export async function tradeHindsight(ctx?: LeagueContext): Promise<TradeHindsightBoard> {
  return computeHindsightBoard(await loaderFor(ctx));
}

/** Worst trades in league history: most value the losing side has given away as of today. */
export async function worstTrades(limit = 10, ctx?: LeagueContext): Promise<TradeHindsight[]> {
  return rankWorstTrades((await tradeHindsight(ctx)).trades, limit);
}
