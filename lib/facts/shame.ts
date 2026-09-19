/**
 * Wall of Shame, all time (this league season): bench points left, zero-point starters,
 * lineup negligence, value lost in trades, $0 bids that lost, overpays, draft reaches.
 * Every headline is written by code from the facts, never by the LLM.
 */
import type { DraftFacts, ShameBoard, ShameEntry, ShameKind, TransactionFacts, WaiverFact, WeeklyFacts, ZeroStarterFact } from "@/lib/types";
import type { LosingBidFact } from "./transactions";
import { FAIR_TRADE_BAND, r1, tradeShare } from "./util";

/** How many bench-points entries to keep (worst first). */
export const SHAME_BENCH_TOP = 15;
/** How many draft reaches to keep. */
export const SHAME_REACH_TOP = 10;
/**
 * Overpay thresholds scale with the league's FAAB budget: a contested overpay counts from 5%
 * of the budget (min $3), an uncontested bid from 10% (min $10). Top N kept.
 */
export function overpayThresholds(budget: number): { contested: number; uncontested: number } {
  const b = budget > 0 ? budget : 100;
  return { contested: Math.max(3, Math.round(b * 0.05)), uncontested: Math.max(10, Math.round(b * 0.1)) };
}
export const SHAME_OVERPAY_TOP = 15;
export const SHAME_ZERO_BID_TOP = 15;

export const SHAME_KIND_ORDER: ShameKind[] = [
  "bench_points",
  "lineup_negligence",
  "zero_starter",
  "bad_trade",
  "zero_bid_lost",
  "overpay",
  "draft_reach",
];

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function zeroHeadline(z: ZeroStarterFact): string {
  switch (z.reason) {
    case "empty_slot":
      return `Left the ${z.slot} slot empty`;
    case "bye":
      return `Started ${z.name} on a bye week`;
    case "ir":
      return `Started ${z.name} while he was on IR`;
    case "out":
      return `Started ${z.name}, who was ruled out`;
    case "inactive":
      return `Started ${z.name}, who did not play`;
    case "played_zero":
      return `Started ${z.name}, who played and scored 0`;
  }
}

const NEGLIGENCE = new Set<ZeroStarterFact["reason"]>(["empty_slot", "bye", "ir", "out"]);

export function weeklyShame(weeks: WeeklyFacts[]): ShameEntry[] {
  const out: ShameEntry[] = [];
  const bench: ShameEntry[] = [];
  for (const wk of weeks) {
    for (const t of wk.teams) {
      if (t.benchPointsLeft > 0) {
        bench.push({
          id: `bench_points:${wk.season}:${wk.week}:${t.team.rosterId}`,
          kind: "bench_points",
          team: t.team,
          season: wk.season,
          week: wk.week,
          amount: t.benchPointsLeft,
          unit: "pts",
          headline: `Left ${fmt(r1(t.benchPointsLeft))} points on the bench`,
          detail: t.result === "L" ? `Scored ${fmt(t.points)} and lost` : `Scored ${fmt(t.points)}`,
          refId: null,
          occurredAt: null,
        });
      }
      t.zeroStarters.forEach((z, i) => {
        out.push({
          id: `${NEGLIGENCE.has(z.reason) ? "lineup_negligence" : "zero_starter"}:${wk.season}:${wk.week}:${t.team.rosterId}:${i}:${z.playerId}`,
          kind: NEGLIGENCE.has(z.reason) ? "lineup_negligence" : "zero_starter",
          team: t.team,
          season: wk.season,
          week: wk.week,
          amount: 0,
          unit: "pts",
          headline: zeroHeadline(z),
          detail: `Week ${wk.week}, ${z.slot}`,
          refId: z.playerId === "0" ? null : z.playerId,
          occurredAt: null,
        });
      });
    }
  }
  bench.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  return [...bench.slice(0, SHAME_BENCH_TOP), ...out];
}

const addedNames = (w: WaiverFact) => w.added.map((p) => p.name).join(" and ") || "nobody";

export function transactionShame(season: string, tx: TransactionFacts, faabBudget = 100): ShameEntry[] {
  const out: ShameEntry[] = [];
  const zeroBids: ShameEntry[] = [];
  const overpays: ShameEntry[] = [];
  const min = overpayThresholds(faabBudget);
  for (const t of tx.trades) {
    for (const s of t.sides) {
      if (s.net >= 0 || tradeShare(s.valueIn, s.valueOut) > -FAIR_TRADE_BAND) continue;
      const lost = -s.net;
      out.push({
        id: `bad_trade:${t.transactionId}:${s.team.rosterId}`,
        kind: "bad_trade",
        team: s.team,
        season,
        week: t.week,
        amount: lost,
        unit: "value",
        headline: `Lost ${fmt(lost)} in FantasyCalc value in one trade`,
        detail: `Gave ${fmt(s.valueOut)}, got ${fmt(s.valueIn)} (grade ${s.grade})`,
        refId: t.transactionId,
        occurredAt: t.createdAt,
      });
    }
  }
  for (const w of tx.waivers) {
    if (w.type !== "waiver" || w.bid === null) continue;
    for (const l of w.losingBids as LosingBidFact[]) {
      if (l.bid !== 0 || (l.reason && l.reason !== "outbid")) continue;
      zeroBids.push({
        id: `zero_bid_lost:${w.transactionId}:${l.team.rosterId}`,
        kind: "zero_bid_lost",
        team: l.team,
        season,
        week: w.week,
        amount: w.bid,
        unit: "$",
        headline: `Bid $0 on ${addedNames(w)} and lost to a $${w.bid} bid`,
        detail: `${w.team.teamName} won the claim`,
        refId: w.transactionId,
        occurredAt: w.createdAt,
      });
    }
    const contested = w.overpayBy !== null;
    const over = contested ? (w.overpayBy ?? 0) : w.bid;
    if ((contested && over >= min.contested) || (!contested && over >= min.uncontested)) {
      const secondBid = contested ? w.bid - over : null;
      overpays.push({
        id: `overpay:${w.transactionId}`,
        kind: "overpay",
        team: w.team,
        season,
        week: w.week,
        amount: over,
        unit: "$",
        headline: contested
          ? `Paid $${w.bid} for ${addedNames(w)} when the next bid was $${secondBid}`
          : `Paid $${w.bid} for ${addedNames(w)} and nobody else bid`,
        detail: contested ? `Overpaid by $${over}` : null,
        refId: w.transactionId,
        occurredAt: w.createdAt,
      });
    }
  }
  const worst = (a: ShameEntry, b: ShameEntry) => b.amount - a.amount || a.id.localeCompare(b.id);
  return [...out, ...zeroBids.sort(worst).slice(0, SHAME_ZERO_BID_TOP), ...overpays.sort(worst).slice(0, SHAME_OVERPAY_TOP)];
}

export function draftShame(season: string, draft: DraftFacts): ShameEntry[] {
  return draft.picks
    .filter((p) => p.verdict === "reach" && p.reach !== null)
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0) || a.pickNo - b.pickNo)
    .slice(0, SHAME_REACH_TOP)
    .map((p) => ({
      id: `draft_reach:${p.draftId}:${p.pickNo}`,
      kind: "draft_reach" as const,
      team: p.team,
      season,
      week: null,
      amount: p.reach ?? 0,
      unit: "picks" as const,
      headline: `Took ${p.player.name} at pick ${p.pickNo}, ${p.reach} spots before his FantasyCalc rank`,
      detail: `FantasyCalc rank ${p.fcRank}`,
      refId: `${p.draftId}:${p.pickNo}`,
      occurredAt: p.pickedAt,
    }));
}

export function assembleShame(entries: ShameEntry[]): ShameBoard {
  const order = new Map(SHAME_KIND_ORDER.map((k, i) => [k, i]));
  const sorted = [...entries].sort(
    (a, b) =>
      (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99) ||
      b.amount - a.amount ||
      (b.week ?? 0) - (a.week ?? 0) ||
      a.id.localeCompare(b.id),
  );
  return { entries: sorted, placeholder: false };
}
