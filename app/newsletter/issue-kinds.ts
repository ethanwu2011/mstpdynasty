/** The four issues: names come from lib/roast, cadence and URL slugs live here. */
import { ISSUE_TITLES } from "@/lib/roast";
import { formatEt } from "@/lib/time";
import type { Issue, IssueKind } from "@/lib/types";

export const ISSUE_ORDER: readonly IssueKind[] = ["daily_roast", "thursday_fallout", "weekly_roast", "draft_grades"];

export const CADENCE: Record<IssueKind, string> = {
  daily_roast: "8 AM ET, only on mornings with something to roast",
  thursday_fallout: "Fridays in season, after the Thursday game",
  weekly_roast: "Tuesdays in season, the full recap",
  draft_grades: "Once, when the startup draft ends",
};

/** Cadence inside a sentence: "The Weekly Roast goes out every Tuesday in season." */
export const WHEN: Record<IssueKind, string> = {
  daily_roast: "at 8 AM ET on any morning with something to roast",
  thursday_fallout: "on Fridays in season, after the Thursday game",
  weekly_roast: "every Tuesday in season with the full recap",
  draft_grades: "once, the day the startup draft ends",
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
