/*
 * DIRECTION (Newsletter archive, inside DESIGN.md's Jumbotron Specimen world)
 * THESIS: the newsletter's back catalog, filed like a stadium's program stack. The latest issue leads
 *   at full pixel volume; the rest are rows you can scan by date, name and the one-line dek.
 * FIRST VIEWPORT: Left 8, the latest issue (title in Jersey, dek, opening lines, read link).
 *   Right 4, the four issues with cadence and counts, and the subscribe button.
 */
import type { Metadata } from "next";
import { listIssues } from "@/lib/archive";
import { getLeagueContext } from "@/lib/league";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { fireTick } from "../_lib/tick";
import { kindFromSlug } from "./issue-kinds";
import { NewsletterView } from "./view";

export const metadata: Metadata = {
  title: "The newsletter, every issue",
  description: "Every issue of The Daily, Thursday Night Fallout, the Week N Recap and Draft Grades for the MSTP Dynasty league.",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewsletterPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const [phase, params, issues] = await Promise.all([
    pagePhase(ctx, searchParams),
    searchParams,
    safe(listIssues(ctx.leagueId), null, "issues"),
    fireTick(),
  ]);
  return (
    <>
      <h1 className="sr-only">Every newsletter issue</h1>
      <NewsletterView issues={issues} kind={kindFromSlug(one(params.kind))} phase={phase} />
    </>
  );
}
