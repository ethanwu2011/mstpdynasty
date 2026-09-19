/*
 * DIRECTION (one issue, inside DESIGN.md's Jumbotron Specimen world)
 * THESIS: The email, set as a broadsheet page. The issue name is shouted in pixel caps, every
 *   section sits under its own black header bar, and the reading column stays 65 to 75 characters.
 * FIRST VIEWPORT: The masthead (issue name in Jersey, dek, date, byline), then the first section
 *   beside the table of contents and the subscribe link.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getIssue, listIssues } from "@/lib/archive";
import { getLeagueContext } from "@/lib/league";
import type { Issue } from "@/lib/types";
import { Button } from "@/components/Button";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";
import { safe } from "../../_lib/phase";
import { dayLabel, isPublic } from "../issue-kinds";
import { IssueView } from "./issue-view";

type Params = Promise<{ slug: string }>;

function decode(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/** undefined = the store did not answer; null = no such issue. */
async function loadIssue(slug: string): Promise<{ issue: Issue | null | undefined; leagueId: string }> {
  const ctx = await getLeagueContext();
  const issue = await safe<Issue | null | undefined>(getIssue(ctx.leagueId, slug), undefined, "issue");
  return { issue: issue && isPublic(issue) ? issue : issue === undefined ? undefined : null, leagueId: ctx.leagueId };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const { issue } = await loadIssue(decode(slug));
  if (!issue) return { title: "Issue" };
  return { title: `${issue.title}, ${dayLabel(issue)}`, description: issue.dek || undefined };
}

export default async function IssuePage({ params }: { params: Params }) {
  const { slug: raw } = await params;
  const slug = decode(raw);
  const { issue, leagueId } = await loadIssue(slug);

  if (issue === undefined) {
    return (
      <Board>
        <Panel label="The Roast" labelRight={<span className="text-paper-shade">Off the air</span>}>
          <div className="flex flex-col gap-6">
            <h1 className="type-display m-0 text-j3 md:text-j4">This issue did not load</h1>
            <p className="measure m-0 text-body md:text-lede">
              The store that keeps every issue did not answer. Nothing was deleted. Try again in a minute.
            </p>
            <DotMatrixFill label="No signal." rows={5} density={0.3} />
            <div className="flex flex-wrap gap-3">
              <Button href={`/newsletter/${encodeURIComponent(slug)}`} variant="primary">
                Try again
              </Button>
              <Button href="/newsletter">Every issue</Button>
            </div>
          </div>
        </Panel>
      </Board>
    );
  }
  if (!issue) notFound();

  const all = await safe(listIssues(leagueId), [] as Issue[], "issues");
  const i = all.findIndex((x) => x.slug === issue.slug);
  return <IssueView issue={issue} older={i >= 0 ? (all[i + 1] ?? null) : null} newer={i > 0 ? all[i - 1] : null} />;
}
