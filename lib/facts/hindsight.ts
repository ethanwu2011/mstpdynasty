/**
 * Trades in hindsight: every trade valued at the time (the stored FantasyCalc snapshot nearest
 * the trade) and today, the per-side change, a value-over-time series for a small dot chart,
 * and the worst-trade leaderboard. FantasyCalc only: KeepTradeCut has no public API.
 *
 * Snapshots are stored once per day the site runs (lib/fantasycalc.ts), starting 2026-09-18, so
 * history accrues forward: a trade older than the first snapshot has no "then" (null), never a
 * guessed one. The core (`computeTradeHindsight`) is pure over a ValuesSource, so it is tested
 * with hand-built snapshots.
 */
import { compactValues, getFantasyCalcValuesOn, listFantasyCalcDates } from "@/lib/fantasycalc";
import { etDate } from "@/lib/time";
import type {
  FantasyCalcSnapshot,
  FantasyCalcValues,
  PickAsset,
  PlayerAsset,
  RosterId,
  TradeFact,
  TradeHindsight,
  TradeHindsightBoard,
  TradeHindsightSide,
  TradeValuePoint,
} from "@/lib/types";
import type { FactsLoader } from "./load";
import { approxPickValue, computeTransactionFacts } from "./transactions";
import { FAIR_TRADE_BAND, tradeGrade, tradeShare } from "./util";

/** A stored snapshot this many days from the trade date (either side) still counts as "at the time". */
export const HINDSIGHT_THEN_WINDOW_DAYS = 3;
/** Most dots per trade chart (dates are sampled evenly, first and last always kept). */
export const MAX_SERIES_POINTS = 40;

export interface ValuesSource {
  /** Stored snapshot dates, oldest first. */
  dates: string[];
  valuesOn(date: string): Promise<FantasyCalcValues | null>;
  /** Today's live values (null when FantasyCalc is down: the last stored day is then "now"). */
  today: FantasyCalcValues | null;
  /** Today's full snapshot, for the ranks on the returned assets (optional). */
  todayFull?: FantasyCalcSnapshot | null;
}

const DAY_MS = 24 * 3600 * 1000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/** The stored date nearest `date` within the window (ties go to the earlier one), or null. */
export function nearestDate(dates: string[], date: string, windowDays = HINDSIGHT_THEN_WINDOW_DAYS): string | null {
  const target = dayNumber(date);
  let best: string | null = null;
  let bestGap = Infinity;
  for (const d of dates) {
    const gap = Math.abs(dayNumber(d) - target);
    if (gap <= windowDays && (gap < bestGap || (gap === bestGap && best !== null && d < best))) {
      best = d;
      bestGap = gap;
    }
  }
  return best;
}

/** Up to `max` items evenly spaced over `xs`, first and last always included. */
export function sampleEvenly<T>(xs: T[], max = MAX_SERIES_POINTS): T[] {
  if (xs.length <= max) return xs.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

function pseudoSnapshot(v: FantasyCalcValues): FantasyCalcSnapshot {
  return {
    fetchedAt: 0,
    date: v.date,
    bySleeperId: {},
    picks: Object.entries(v.picks).map(([name, value]) => ({
      sleeperId: name,
      name,
      position: "PICK",
      team: null,
      age: null,
      value,
      overallRank: 0,
      positionRank: 0,
      redraftValue: 0,
      trend30Day: 0,
    })),
  };
}

interface Assets {
  playersIn: PlayerAsset[];
  playersOut: PlayerAsset[];
  picksIn: PickAsset[];
  picksOut: PickAsset[];
}

/** Value received and given by one side on one day (unranked players count 0). */
export function sideValueOn(side: Assets, v: FantasyCalcValues): { valueIn: number; valueOut: number } {
  const snap = pseudoSnapshot(v);
  const player = (p: PlayerAsset) => v.values[p.playerId] ?? 0;
  const pick = (p: PickAsset) => approxPickValue(snap, p.season, p.round) ?? 0;
  const valueIn = side.playersIn.reduce((s, p) => s + player(p), 0) + side.picksIn.reduce((s, p) => s + pick(p), 0);
  const valueOut = side.playersOut.reduce((s, p) => s + player(p), 0) + side.picksOut.reduce((s, p) => s + pick(p), 0);
  return { valueIn: Math.round(valueIn), valueOut: Math.round(valueOut) };
}

function revalue(assets: Assets, now: FantasyCalcValues | null, full: FantasyCalcSnapshot | null): Assets {
  const snap = now ? pseudoSnapshot(now) : null;
  const player = (p: PlayerAsset): PlayerAsset => {
    const hit = full?.bySleeperId[p.playerId];
    return { ...p, value: now ? (now.values[p.playerId] ?? null) : null, overallRank: hit ? hit.overallRank : null };
  };
  const pick = (p: PickAsset): PickAsset => ({ ...p, value: snap ? approxPickValue(snap, p.season, p.round) : null });
  return {
    playersIn: assets.playersIn.map(player),
    playersOut: assets.playersOut.map(player),
    picksIn: assets.picksIn.map(pick),
    picksOut: assets.picksOut.map(pick),
  };
}

/** Hindsight for every trade. Pure over `src` (memoizes each day's values). */
export async function computeTradeHindsight(trades: TradeFact[], src: ValuesSource, season: string): Promise<TradeHindsight[]> {
  const cache = new Map<string, Promise<FantasyCalcValues | null>>();
  const valuesOn = (d: string) => {
    if (src.today && d === src.today.date) return Promise.resolve(src.today);
    let hit = cache.get(d);
    if (!hit) {
      hit = src.valuesOn(d).catch(() => null);
      cache.set(d, hit);
    }
    return hit;
  };
  const lastStored = src.dates[src.dates.length - 1] ?? null;
  const now = src.today ?? (lastStored ? await valuesOn(lastStored) : null);
  // One shared grid of sampled dates keeps the number of stored days read bounded.
  const grid = sampleEvenly(src.dates);

  const out: TradeHindsight[] = [];
  for (const t of trades) {
    const date = etDate(t.createdAt);
    const thenDate = nearestDate(src.dates, date);
    const then = thenDate ? await valuesOn(thenDate) : null;
    const start = thenDate ?? date;
    const seriesDates = [...new Set([...(thenDate ? [thenDate] : []), ...grid.filter((d) => d >= start)])].sort();
    if (now && !seriesDates.includes(now.date) && now.date >= start) seriesDates.push(now.date);
    const seriesValues = await Promise.all(seriesDates.map(valuesOn));

    const sides: TradeHindsightSide[] = t.sides.map((s) => {
      const nowV = now ? sideValueOn(s, now) : { valueIn: 0, valueOut: 0 };
      const thenV = then ? sideValueOn(s, then) : null;
      const netNow = nowV.valueIn - nowV.valueOut;
      const netThen = thenV ? thenV.valueIn - thenV.valueOut : null;
      const series: TradeValuePoint[] = [];
      seriesValues.forEach((v, i) => {
        if (!v) return;
        const x = sideValueOn(s, v);
        series.push({ date: seriesDates[i], valueIn: x.valueIn, net: x.valueIn - x.valueOut });
      });
      return {
        team: s.team,
        ...revalue(s, now, src.todayFull ?? null),
        faabIn: s.faabIn,
        faabOut: s.faabOut,
        valueInThen: thenV?.valueIn ?? null,
        valueOutThen: thenV?.valueOut ?? null,
        netThen,
        gradeThen: thenV ? tradeGrade(thenV.valueIn, thenV.valueOut) : null,
        valueInNow: nowV.valueIn,
        valueOutNow: nowV.valueOut,
        netNow,
        gradeNow: tradeGrade(nowV.valueIn, nowV.valueOut),
        delta: netThen === null ? null : netNow - netThen,
        series,
      };
    });

    const best = sides.reduce<TradeHindsightSide | null>((b, s) => (!b || s.netNow > b.netNow ? s : b), null);
    const worst = sides.reduce<TradeHindsightSide | null>((w, s) => (!w || s.netNow < w.netNow ? s : w), null);
    const winnerNowRosterId: RosterId | null =
      best && best.netNow > 0 && Math.abs(tradeShare(best.valueInNow, best.valueOutNow)) >= FAIR_TRADE_BAND ? best.team.rosterId : null;
    const loser = worst && worst.netNow < 0 ? worst : null;
    out.push({
      transactionId: t.transactionId,
      season,
      week: t.week,
      createdAt: t.createdAt,
      date,
      thenDate: then ? thenDate : null,
      nowDate: now?.date ?? null,
      sides,
      winnerNowRosterId,
      loserNowRosterId: loser?.team.rosterId ?? null,
      valueLost: loser ? loser.valueOutNow - loser.valueInNow : 0,
      lostSinceTrade: loser && loser.netThen !== null ? loser.netThen - loser.netNow : null,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || a.transactionId.localeCompare(b.transactionId));
}

/** Worst trades first: most value lost by the losing side as of today; trades nobody lost are left out. */
export function rankWorstTrades(trades: TradeHindsight[], limit = 10): TradeHindsight[] {
  return trades
    .filter((t) => t.valueLost > 0)
    .sort((a, b) => b.valueLost - a.valueLost || a.createdAt - b.createdAt || a.transactionId.localeCompare(b.transactionId))
    .slice(0, Math.max(0, limit));
}

/** Every trade of this league, in hindsight, from the stored daily snapshots. */
export async function computeHindsightBoard(loader: FactsLoader): Promise<TradeHindsightBoard> {
  const [tx, dates, todayFull] = await Promise.all([
    computeTransactionFacts(0, loader),
    listFantasyCalcDates().catch(() => [] as string[]),
    loader.fantasyCalc(),
  ]);
  const src: ValuesSource = {
    dates,
    valuesOn: getFantasyCalcValuesOn,
    today: todayFull ? compactValues(todayFull) : null,
    todayFull,
  };
  const trades = await computeTradeHindsight(tx.trades, src, loader.ctx.season);
  return {
    trades,
    snapshots: { count: dates.length, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null },
    placeholder: tx.placeholder,
  };
}
