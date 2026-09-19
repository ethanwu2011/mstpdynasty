/** The four issues: names come from lib/roast, cadence and URL slugs live here. */
import { ISSUE_TITLES, issueTitle } from "@/lib/roast";
import { formatEt } from "@/lib/time";
import type { Issue, IssueKind, LeagueContext } from "@/lib/types";

export const ISSUE_ORDER: readonly IssueKind[] = ["daily", "thursday_fallout", "weekly_recap", "draft_grades"];

/** When each issue goes out, as a line under its name (the home page and /newsletter share it). */
export const CADENCE: Record<IssueKind, string> = {
  daily: "8 AM ET, only on mornings when something happened",
  thursday_fallout: "Fridays in season, after the Thursday game",
  weekly_recap: "Tuesdays in season",
  draft_grades: "Once, when the startup draft ends",
};

/** Cadence inside a sentence: "Week 5 Recap goes out every Tuesday in season." */
export const WHEN: Record<IssueKind, string> = {
  daily: "at 8 AM ET on any morning when something happened",
  thursday_fallout: "on Fridays in season, after the Thursday game",
  weekly_recap: "every Tuesday in season",
  draft_grades: "once, the day the startup draft ends",
};

/**
 * The recap to name wherever the four issues are listed: the newest recap's week, else the week
 * being played, else Week 1. Never the bare "Week N Recap" template.
 */
export function recapWeek(ctx: Pick<LeagueContext, "phase" | "week">, issues: Issue[] = []): number {
  const latest = issues.find((i) => i.kind === "weekly_recap" && typeof i.week === "number" && i.week > 0);
  if (latest?.week) return latest.week;
  return ctx.phase === "in_season" ? Math.max(1, ctx.week) : 1;
}

/** An issue's name in a list: "Week 5 Recap" for the recap, the fixed name for the others. */
export const issueLabel = (k: IssueKind, week: number) => (k === "weekly_recap" ? issueTitle(k, Math.max(1, week)) : ISSUE_TITLES[k]);

/** The name of every issue of a kind at once (filters, "No recaps yet"). */
export const KIND_PLURAL: Record<IssueKind, string> = {
  daily: "The Daily",
  thursday_fallout: "Thursday Night Fallout",
  weekly_recap: "Recaps",
  draft_grades: "Draft Grades",
};

export const kindSlug = (k: IssueKind) => k.replace(/_/g, "-");

export function kindFromSlug(slug: string | undefined): IssueKind | null {
  if (!slug) return null;
  return ISSUE_ORDER.find((k) => kindSlug(k) === slug) ?? null;
}

export const issueName = (k: IssueKind) => ISSUE_TITLES[k] ?? k;

/** Noon UTC on the issue's ET date: always the same calendar day in New York. */
export const issueDay = (i: Pick<Issue, "date">) => Date.parse(`${i.date}T12:00:00Z`);

/** Sent and approved issues are public; drafts and skipped ones are not. */
export const isPublic = (i: Pick<Issue, "status">) => i.status === "sent" || i.status === "approved";

/** "Tue Nov 4, 2025" */
export const dayLabel = (i: Pick<Issue, "date">) =>
  formatEt(issueDay(i), { weekday: "short", month: "short", day: "numeric", year: "numeric" }).replace(/^(\w{3}),/, "$1");

export const monthLabel = (i: Pick<Issue, "date">) => formatEt(issueDay(i), { month: "long", year: "numeric" });
