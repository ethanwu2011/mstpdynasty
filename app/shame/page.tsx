/*
 * DIRECTION (Wall of Shame, inside DESIGN.md's Jumbotron Specimen world)
 * THESIS: A stadium records board for bad decisions. The most wanted manager is shouted first,
 *   the tally and the all-time records prove it, and the ledger underneath is the whole box score.
 * OWN-WORLD: DESIGN.md unchanged. Paper, ink, one red for the alarm (the record holder, the top
 *   offender, the worst row of each ledger). Doto for record numbers, dot tallies for counts.
 * STORY: See who is most wanted and why, find your own name in the rap sheets, check the record
 *   book, then dig the ledger and screenshot the row that hurts.
 * FIRST VIEWPORT: Left 8, the most wanted (name and entry count in Jersey, the breakdown, the
 *   receipt). Right 4, rap sheets: every manager ranked by entries with one dot per entry.
 * FORM: Structure 3 of the surface list (the record book). Seed ad982c29.
 */
import type { Metadata } from "next";
import { shameEntries } from "@/lib/facts";
import { getLeagueContext } from "@/lib/league";
import { surfaceKeys } from "@/lib/roast";
import { surfaceLinesFor } from "../_lib/lines";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { fireTick } from "../_lib/tick";
import { kindFromSlug } from "./kinds";
import { ShameView } from "./view";

export const metadata: Metadata = {
  title: "Wall of Shame",
  description:
    "Every bad decision in the MSTP Dynasty league, ranked worst first: bench points left, zero-point starters, lopsided trades, $0 bids and overpays.",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ShamePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const [phase, params] = await Promise.all([pagePhase(ctx, searchParams), searchParams]);
  const [board, lines] = await Promise.all([
    safe(shameEntries(ctx), null, "shame"),
    surfaceLinesFor(ctx, "shame", surfaceKeys.shame(ctx.season)),
    fireTick(),
  ]);

  // Sample entries mean nothing before any games or picks exist: show the empty wall instead.
  const hideSample = phase === "pre_draft" || phase === "drafting";
  const usable = board && hideSample && board.placeholder ? { entries: [], placeholder: false } : board;
  const whoKey = one(params.who)?.toLowerCase() ?? null;

  return (
    <>
      <h1 className="sr-only">Wall of Shame: every bad decision in the league, ranked worst first</h1>
      <ShameView
        board={usable}
        managers={ctx.managers.map((m) => ({ key: m.key, name: m.name, teamName: m.teamName }))}
        season={ctx.season}
        phase={phase}
        kind={kindFromSlug(one(params.kind))}
        who={whoKey}
        lines={lines}
      />
    </>
  );
}
