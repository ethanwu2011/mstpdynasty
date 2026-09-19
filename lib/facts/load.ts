/**
 * Per-call data loader for the facts engine: memoizes Sleeper / FantasyCalc reads so one
 * facts computation (for example the all-time Wall of Shame, which walks every week) reads
 * each payload once. Every loader degrades to an empty value instead of throwing, so a flaky
 * undocumented endpoint never takes a page down.
 */
import { getFantasyCalc, getFantasyCalcOn } from "@/lib/fantasycalc";
import { getMatchups, getPlayers, getSchedule, getTransactions, getWeekProjections, getWeekStats } from "@/lib/sleeper";
import type {
  FantasyCalcSnapshot,
  LeagueContext,
  NflGame,
  PlayersMap,
  SleeperMatchup,
  SleeperTransaction,
  WeekStats,
} from "@/lib/types";

export interface FactsLoader {
  ctx: LeagueContext;
  players(): Promise<PlayersMap>;
  matchups(week: number): Promise<SleeperMatchup[]>;
  stats(week: number): Promise<WeekStats | null>;
  projections(week: number): Promise<WeekStats | null>;
  schedule(): Promise<NflGame[]>;
  transactions(leg: number): Promise<SleeperTransaction[]>;
  /** Today's FantasyCalc values, or null when unavailable. */
  fantasyCalc(): Promise<FantasyCalcSnapshot | null>;
  /** FantasyCalc values stored for an ET date, else today's. */
  fantasyCalcOn(date: string): Promise<FantasyCalcSnapshot | null>;
}

function memo<K, V>(fn: (k: K) => Promise<V>): (k: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (k: K) => {
    let hit = cache.get(k);
    if (!hit) {
      hit = fn(k);
      cache.set(k, hit);
    }
    return hit;
  };
}

export function createLoader(ctx: LeagueContext): FactsLoader {
  const once = <V>(fn: () => Promise<V>) => {
    let p: Promise<V> | null = null;
    return () => (p ??= fn());
  };
  const fantasyCalc = once(() => getFantasyCalc().catch(() => null));
  return {
    ctx,
    players: once(() => getPlayers().catch(() => ({}) as PlayersMap)),
    matchups: memo((week: number) => getMatchups(ctx.leagueId, week).catch(() => [] as SleeperMatchup[])),
    stats: memo((week: number) => getWeekStats(ctx.season, week).catch(() => null)),
    projections: memo((week: number) => getWeekProjections(ctx.season, week).catch(() => null)),
    schedule: once(() => getSchedule(ctx.season).catch(() => [] as NflGame[])),
    transactions: memo((leg: number) => getTransactions(ctx.leagueId, leg).catch(() => [] as SleeperTransaction[])),
    fantasyCalc,
    fantasyCalcOn: memo(async (date: string) => (await getFantasyCalcOn(date).catch(() => null)) ?? (await fantasyCalc())),
  };
}
