/*
 * DIRECTION (Trades, inside DESIGN.md's Jumbotron Specimen world)
 * THESIS: A trade ledger that reads like a box score. The side that got fleeced is shouted, both
 *   sides are laid out with what they got and what it is worth, and the grade sits in a scoreboard
 *   tile: red for the loser, ink for the winner.
 * OWN-WORLD: DESIGN.md unchanged. Ruled panels, Doto nets, a 20-cell dot split of the value.
 * STORY: See the latest trade and who lost it, check the running balance of who keeps paying,
 *   then scroll every trade and screenshot the worst one.
 * FIRST VIEWPORT: Left 8, the latest trade (loser and net in Jersey, the roast, both sides).
 *   Right 4, the trade balance: net value by manager, worst first.
 */
import type { Metadata } from "next";
import { listRoasts } from "@/lib/archive";
import { transactionFacts } from "@/lib/facts";
import { getLeagueContext } from "@/lib/league";
import type { Roast, TradeFact } from "@/lib/types";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { fireTick } from "../_lib/tick";
import { TradesView, type TradeItem } from "./view";

export const metadata: Metadata = {
  title: "Trades",
  description: "Every MSTP Dynasty trade with both sides, the FantasyCalc value that changed hands, a grade and the roast.",
};

/** Waiver roasts shown under the trades. */
const WAIVER_ROASTS = 6;

export default async function TradesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  const [tx, tradeRoasts, waiverRoasts] = await Promise.all([
    safe(transactionFacts(0, ctx), null, "transaction facts"),
    safe(listRoasts(ctx.leagueId, "trade"), [] as Roast[], "trade roasts"),
    safe(listRoasts(ctx.leagueId, "waiver", WAIVER_ROASTS), [] as Roast[], "waiver roasts"),
    fireTick(),
  ]);

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
      items.set(t.transactionId, { fact: roast ? (roast.facts as TradeFact) : t, roast, placeholder: samples });
    }
  }
  for (const [id, roast] of roastByTx) {
    if (!items.has(id)) items.set(id, { fact: roast.facts as TradeFact, roast, placeholder: roast.source === "placeholder" });
  }
  const trades = [...items.values()].sort((a, b) => b.fact.createdAt - a.fact.createdAt);

  const s = ctx.league.settings;
  const deadline = s.trade_deadline ?? null;
  return (
    <>
      <h1 className="sr-only">Trades: every MSTP Dynasty trade, graded and roasted</h1>
      <TradesView
        trades={trades}
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
