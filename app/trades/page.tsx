/*
 * DIRECTION (Trades, inside DESIGN.md's Jumbotron Specimen world)
 * THESIS: A trade ledger judged in hindsight. The side that got fleeced is shouted, both sides
 *   are laid out with what they got and what it is worth today against the day it happened, and
 *   the grade sits in a scoreboard tile: red for the loser, ink for the winner.
 * OWN-WORLD: DESIGN.md unchanged. Ruled panels, solid numbers, a dot chart of value over time.
 * STORY: See the latest trade and who is losing it, check the worst trades in league history,
 *   then scroll every trade and screenshot the worst one.
 * FIRST VIEWPORT: Left 8, the latest trade (loser and net in Jersey, the line, both sides, then
 *   and now). Right 4, the worst trades ever: value lost, most first.
 */
import type { Metadata } from "next";
import { listRoasts } from "@/lib/archive";
import { tradeHindsight, transactionFacts, worstTrades } from "@/lib/facts";
import { getLeagueContext } from "@/lib/league";
import { surfaceKeys } from "@/lib/roast";
import type { Roast, TradeFact, TradeHindsight } from "@/lib/types";
import { surfaceLinesFor } from "../_lib/lines";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { fireTick } from "../_lib/tick";
import { TradesView, type TradeItem } from "./view";

export const metadata: Metadata = {
  title: "Trades",
  description: "Every MSTP Dynasty trade with both sides, FantasyCalc value then and now, a grade, and the worst trades in league history.",
};

/** Waiver roasts shown under the trades. */
const WAIVER_ROASTS = 6;

export default async function TradesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  const [tx, tradeRoasts, waiverRoasts, board, worst, lines] = await Promise.all([
    safe(transactionFacts(0, ctx), null, "transaction facts"),
    safe(listRoasts(ctx.leagueId, "trade"), [] as Roast[], "trade roasts"),
    safe(listRoasts(ctx.leagueId, "waiver", WAIVER_ROASTS), [] as Roast[], "waiver roasts"),
    safe(tradeHindsight(ctx), null, "trade hindsight"),
    safe(worstTrades(10, ctx), [] as TradeHindsight[], "worst trades"),
    surfaceLinesFor(ctx, "trades", surfaceKeys.trades()),
    fireTick(),
  ]);
  const hindsightById = new Map((board?.trades ?? []).map((h) => [h.transactionId, h]));

  // A roasted trade carries the facts it was written from, so it still shows if Sleeper is down.
  const roastByTx = new Map<string, Roast>();
  for (const r of tradeRoasts) {
    if (!Array.isArray(r.facts) && r.facts.kind === "trade") roastByTx.set(r.facts.transactionId, r);
  }
  // Sample trades mean nothing before the draft; real archived roasts always beat samples.
  const samples = tx?.placeholder ?? false;
  const useFacts = tx && !(samples && (phase === "pre_draft" || roastByTx.size > 0));

  const items = new Map<string, TradeItem>();
  if (useFacts) {
    for (const t of tx.trades) {
      const roast = roastByTx.get(t.transactionId) ?? null;
      items.set(t.transactionId, {
        fact: roast ? (roast.facts as TradeFact) : t,
        roast,
        placeholder: samples,
        hindsight: hindsightById.get(t.transactionId) ?? null,
        line: lines[t.transactionId] ?? null,
      });
    }
  }
  for (const [id, roast] of roastByTx) {
    if (!items.has(id))
      items.set(id, {
        fact: roast.facts as TradeFact,
        roast,
        placeholder: roast.source === "placeholder",
        hindsight: hindsightById.get(id) ?? null,
        line: lines[id] ?? null,
      });
  }
  const trades = [...items.values()].sort((a, b) => b.fact.createdAt - a.fact.createdAt);

  const s = ctx.league.settings;
  const deadline = s.trade_deadline ?? null;
  return (
    <>
      <h1 className="sr-only">Trades: every MSTP Dynasty trade, graded then and now</h1>
      <TradesView
        trades={trades}
        worst={useFacts || roastByTx.size ? worst.filter((w) => items.has(w.transactionId)) : []}
        lines={lines}
        historyFrom={board?.snapshots.first ?? null}
        waiverRoasts={waiverRoasts}
        managers={ctx.managers.map((m) => ({ key: m.key, name: m.name, teamName: m.teamName }))}
        rules={{
          deadlineWeek: deadline && deadline > 0 && deadline <= ctx.lastWeek ? deadline : null,
          reviewDays: s.trade_review_days ?? null,
          pickTrading: s.pick_trading === undefined ? null : s.pick_trading === 1,
          faabBudget: s.waiver_type === 2 ? (s.waiver_budget ?? null) : null,
        }}
        phase={phase}
        season={ctx.season}
        factsFailed={tx === null}
      />
    </>
  );
}
