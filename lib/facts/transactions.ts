/**
 * Transaction facts: trades graded by FantasyCalc value, waiver claims with their winning
 * bid, the failed competing bids from the same waiver run, $0 bids, overpays and notable
 * drops. The pure builder takes raw Sleeper transactions so it is tested on hand-built runs.
 */
import { pickValue } from "@/lib/fantasycalc";
import { teamRef } from "@/lib/league";
import { etDate } from "@/lib/time";
import type {
  FantasyCalcSnapshot,
  LeagueContext,
  LosingBid,
  PickAsset,
  PlayersMap,
  SleeperTransaction,
  TradeFact,
  TradeSide,
  TransactionFacts,
  WaiverFact,
} from "@/lib/types";
import type { FactsLoader } from "./load";
import { FAIR_TRADE_BAND, ordinal, playerAsset, tradeGrade, tradeShare } from "./util";

/** A dropped player at or above this FantasyCalc value is a "notable drop" (about the top 150). */
export const NOTABLE_DROP_VALUE = 1500;

/** Why a competing claim failed. Sleeper only says it in the transaction note. */
export type LosingBidReason = NonNullable<LosingBid["reason"]>;

/** LosingBid with its reason always filled (optional on the shared type). */
export interface LosingBidFact extends LosingBid {
  reason: LosingBidReason;
}

export function losingBidReason(tx: SleeperTransaction): LosingBidReason {
  const note = tx.metadata?.notes ?? "";
  if (/claimed by another/i.test(note)) return "outbid";
  if (/too many players|roster (is )?full/i.test(note)) return "roster_full";
  return "other";
}

export interface TransactionEnv {
  ctx: LeagueContext;
  players: PlayersMap;
  /** FantasyCalc values to grade a transaction with (by the transaction's ET date). */
  snapFor: (tx: SleeperTransaction) => FantasyCalcSnapshot | null;
  /** true when the league uses FAAB (waiver_type 2): otherwise bids are meaningless. */
  faab: boolean;
}

/**
 * FantasyCalc value of a rookie pick. FantasyCalc only lists upcoming drafts, so a pick for a
 * season it no longer (or does not yet) list is valued like the same round in the nearest
 * season it does list.
 */
export function approxPickValue(snap: FantasyCalcSnapshot, season: string | number, round: number): number | null {
  const exact = pickValue(snap, season, round);
  if (exact) return exact.value;
  const seasons = [...new Set(snap.picks.map((p) => Number(p.name.slice(0, 4))).filter((y) => Number.isFinite(y)))].sort(
    (a, b) => Math.abs(a - Number(season)) - Math.abs(b - Number(season)) || a - b,
  );
  for (const y of seasons) {
    const hit = pickValue(snap, y, round);
    if (hit) return hit.value;
  }
  return null;
}

function pickAsset(env: TransactionEnv, pick: SleeperTransaction["draft_picks"][number], snap: FantasyCalcSnapshot | null): PickAsset {
  const orig = teamRef(env.ctx, pick.roster_id);
  return {
    season: String(pick.season),
    round: pick.round,
    originalRosterId: pick.roster_id,
    label: `${pick.season} ${ordinal(pick.round)} (via ${orig.teamName})`,
    value: snap ? approxPickValue(snap, pick.season, pick.round) : null,
  };
}

const sumValues = (xs: Array<{ value: number | null }>) => xs.reduce((s, x) => s + (x.value ?? 0), 0);

export function buildTrade(tx: SleeperTransaction, env: TransactionEnv): TradeFact {
  const snap = env.snapFor(tx);
  const rosterIds = [...new Set(tx.roster_ids)].sort((a, b) => a - b);
  const sides: TradeSide[] = rosterIds.map((rid) => {
    const playersIn = Object.entries(tx.adds ?? {})
      .filter(([, to]) => to === rid)
      .map(([pid]) => playerAsset(env.players, pid, snap));
    const playersOut = Object.entries(tx.drops ?? {})
      .filter(([, from]) => from === rid)
      .map(([pid]) => playerAsset(env.players, pid, snap));
    const picksIn = tx.draft_picks.filter((p) => p.owner_id === rid).map((p) => pickAsset(env, p, snap));
    const picksOut = tx.draft_picks.filter((p) => p.previous_owner_id === rid).map((p) => pickAsset(env, p, snap));
    const faabIn = tx.waiver_budget.filter((b) => b.receiver === rid).reduce((s, b) => s + b.amount, 0);
    const faabOut = tx.waiver_budget.filter((b) => b.sender === rid).reduce((s, b) => s + b.amount, 0);
    const valueIn = Math.round(sumValues(playersIn) + sumValues(picksIn));
    const valueOut = Math.round(sumValues(playersOut) + sumValues(picksOut));
    return {
      team: teamRef(env.ctx, rid),
      playersIn,
      playersOut,
      picksIn,
      picksOut,
      faabIn,
      faabOut,
      valueIn,
      valueOut,
      net: valueIn - valueOut,
      grade: tradeGrade(valueIn, valueOut),
    };
  });
  const nets = sides.map((s) => s.net);
  const best = sides.reduce<TradeSide | null>((b, s) => (!b || s.net > b.net ? s : b), null);
  const winnerRosterId =
    best && Math.abs(tradeShare(best.valueIn, best.valueOut)) >= FAIR_TRADE_BAND && best.net > 0 ? best.team.rosterId : null;
  return {
    kind: "trade",
    transactionId: tx.transaction_id,
    week: tx.leg,
    createdAt: tx.status_updated || tx.created,
    sides,
    winnerRosterId,
    valueGap: nets.length ? Math.round((Math.max(...nets) - Math.min(...nets)) / 2) : 0,
  };
}

/**
 * Waiver runs: claims processed together share status_updated (a failed claim can be filed
 * under a different leg than the claim that beat it, so the leg is not part of the key).
 */
export function waiverBatchId(tx: SleeperTransaction): string {
  return tx.type === "waiver" ? `w-${tx.status_updated}` : `fa-${tx.transaction_id}`;
}

export function buildWaivers(txs: SleeperTransaction[], env: TransactionEnv): WaiverFact[] {
  const failed = txs.filter((t) => t.type === "waiver" && t.status === "failed");
  const out: WaiverFact[] = [];
  for (const tx of txs) {
    if (tx.status !== "complete" || (tx.type !== "waiver" && tx.type !== "free_agent")) continue;
    if (!tx.adds && !tx.drops) continue;
    const rid = tx.roster_ids[0] ?? Number(Object.values(tx.adds ?? tx.drops ?? {})[0]);
    const snap = env.snapFor(tx);
    const added = Object.keys(tx.adds ?? {}).map((pid) => playerAsset(env.players, pid, snap));
    const dropped = Object.keys(tx.drops ?? {}).map((pid) => playerAsset(env.players, pid, snap));
    const isWaiver = tx.type === "waiver";
    const bid = isWaiver && env.faab ? (tx.settings?.waiver_bid ?? 0) : null;
    const batchId = waiverBatchId(tx);
    const addedIds = new Set(Object.keys(tx.adds ?? {}));
    const competitors = isWaiver
      ? failed.filter(
          (f) =>
            f.status_updated === tx.status_updated &&
            (f.roster_ids[0] ?? -1) !== rid &&
            Object.keys(f.adds ?? {}).some((pid) => addedIds.has(pid)),
        )
      : [];
    // One losing bid per roster (a manager can file several claims on one player with different drops): keep the highest.
    const bestByRoster = new Map<number, LosingBidFact>();
    for (const f of competitors) {
      const bid: LosingBidFact = {
        team: teamRef(env.ctx, f.roster_ids[0] ?? 0),
        bid: env.faab ? (f.settings?.waiver_bid ?? 0) : 0,
        reason: losingBidReason(f),
      };
      const prev = bestByRoster.get(bid.team.rosterId);
      if (!prev || bid.bid > prev.bid || (bid.bid === prev.bid && bid.reason === "outbid")) bestByRoster.set(bid.team.rosterId, bid);
    }
    const losingBids = [...bestByRoster.values()].sort((a, b) => b.bid - a.bid || a.team.rosterId - b.team.rosterId);
    const outbid = losingBids.filter((l) => l.reason === "outbid");
    const overpayBy = bid !== null && outbid.length ? Math.max(0, bid - outbid[0].bid) : null;
    out.push({
      kind: "waiver",
      transactionId: tx.transaction_id,
      type: isWaiver ? "waiver" : "free_agent",
      week: tx.leg,
      createdAt: tx.status_updated || tx.created,
      team: teamRef(env.ctx, rid),
      added,
      dropped,
      bid,
      isZeroBid: bid === 0,
      losingBids,
      overpayBy,
      notableDrop: dropped.some((d) => (d.value ?? 0) >= NOTABLE_DROP_VALUE),
      batchId,
    });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || a.transactionId.localeCompare(b.transactionId));
}

/** Legs to scan for transactions (Sleeper files them by league week). */
export function legsToScan(ctx: LeagueContext): number[] {
  const maxLeg = ctx.phase === "complete" || ctx.phase === "offseason" ? ctx.lastWeek + 1 : Math.min(ctx.lastWeek + 1, Math.max(1, ctx.week) + 1);
  return Array.from({ length: Math.max(1, maxLeg) }, (_, i) => i + 1);
}

export async function computeTransactionFacts(sinceMs: number, loader: FactsLoader, untilMs = Date.now()): Promise<TransactionFacts> {
  const ctx = loader.ctx;
  const [players, legs] = await Promise.all([loader.players(), Promise.all(legsToScan(ctx).map((l) => loader.transactions(l)))]);
  const all = legs.flat();
  const inWindow = (t: SleeperTransaction) => {
    const at = t.status_updated || t.created;
    return at > sinceMs && at <= untilMs;
  };
  // Load the FantasyCalc snapshot for each transaction's ET date (falls back to today's).
  const dates = [...new Set(all.filter((t) => inWindow(t) && t.status === "complete").map((t) => etDate(t.status_updated || t.created)))];
  const snaps = new Map<string, FantasyCalcSnapshot | null>();
  await Promise.all(dates.map(async (d) => snaps.set(d, await loader.fantasyCalcOn(d))));
  const env: TransactionEnv = {
    ctx,
    players,
    snapFor: (tx) => snaps.get(etDate(tx.status_updated || tx.created)) ?? null,
    faab: ctx.league.settings.waiver_type === 2,
  };
  const trades = all
    .filter((t) => t.type === "trade" && t.status === "complete" && inWindow(t))
    .map((t) => buildTrade(t, env))
    .sort((a, b) => a.createdAt - b.createdAt || a.transactionId.localeCompare(b.transactionId));
  // Competing failed claims can be outside the window only if the run straddles it; pass them all.
  const waivers = buildWaivers(
    all.filter((t) => (t.type === "waiver" || t.type === "free_agent") && (t.status === "failed" || inWindow(t))),
    env,
  ).filter((w) => w.createdAt > sinceMs && w.createdAt <= untilMs);
  return { sinceMs, untilMs, trades, waivers, placeholder: false };
}
