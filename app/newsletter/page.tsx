/*
 * DIRECTION (Newsletter archive, inside DESIGN.md's Jumbotron Specimen world)
 * THESIS: The league newsletter's back catalog, filed like a stadium's program stack. The latest
 *   issue leads at full pixel volume; the rest are rows you can scan by date, name and dek.
 * FIRST VIEWPORT: Left 8, the latest issue (title in Jersey, dek, opening lines, read link).
 *   Right 4, the issues with cadence and counts.
 */
import type { Metadata } from "next";
import { listIssues } from "@/lib/archive";
import { getLeagueContext } from "@/lib/league";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { fireTick } from "../_lib/tick";
import { issueLabel, kindFromSlug, recapWeek } from "./issue-kinds";
import { NewsletterView } from "./view";

export async function generateMetadata(): Promise<Metadata> {
  let recap = issueLabel("weekly_recap", 1);
  try {
    recap = issueLabel("weekly_recap", recapWeek(await getLeagueContext()));
  } catch {
    // The league did not load: name the first recap.
  }
  return {
    title: "Every issue",
    description: `Every issue of Thursday Night Fallout, the Sunday Preview, the Sunday Recap, ${recap}, The Daily and Draft Grades for the MSTP Dynasty league.`,
  };
}

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
      <NewsletterView issues={issues} kind={kindFromSlug(one(params.kind))} phase={phase} recapWeek={recapWeek({ phase, week: ctx.week }, issues ?? [])} />
    </>
  );
}
