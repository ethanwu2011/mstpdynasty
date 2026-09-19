/**
 * Persistence for published content: issues (newsletters), instant roasts and weekly odds
 * snapshots. Shared and FROZEN: jobs write through here, pages read through here.
 * Keys follow lib/store.ts `keys`.
 */
import * as store from "./store";
import type { Issue, IssueKind, LegacyIssueKind, OddsSnapshot, Roast, RoastItemKind } from "./types";

/* ------------------------------ issues ------------------------------ */

const LEGACY_KINDS: Record<LegacyIssueKind, IssueKind> = { daily_roast: "daily", weekly_roast: "weekly_recap" };
const LEGACY_TITLES: Record<string, (i: Issue) => string> = {
  "The Daily Roast": () => "The Daily",
  "The Weekly Roast": (i) => (i.week ? `Week ${i.week} Recap` : "Week N Recap"),
};

/** Notes older facts-only issues carried. A facts-only issue now has no note: the facts simply run. */
const LEGACY_NOTES = new Set(["The writer called in sick. Facts only today.", "The roast writer called in sick. Facts only today."]);

/**
 * An issue stored before the 2026-09-18 rename, read as the current kind and title
 * ("daily_roast" -> "daily", "The Weekly Roast" -> "Week 5 Recap"), without the old facts-only
 * note. The slug stays, so old links work.
 */
export function upgradeIssue(issue: Issue): Issue {
  const kind = LEGACY_KINDS[issue.kind as unknown as LegacyIssueKind];
  const retitle = LEGACY_TITLES[issue.title];
  const dropNote = issue.note !== null && LEGACY_NOTES.has(issue.note);
  if (!kind && !retitle && !dropNote) return issue;
  return {
    ...issue,
    kind: kind ?? issue.kind,
    title: retitle ? retitle(issue) : issue.title,
    note: dropNote ? null : issue.note,
  };
}

export async function saveIssue(issue: Issue): Promise<void> {
  await store.set(store.keys.issue(issue.leagueId, issue.slug), issue);
}

export async function getIssue(leagueId: string, slug: string): Promise<Issue | null> {
  const issue = await store.get<Issue>(store.keys.issue(leagueId, slug));
  return issue ? upgradeIssue(issue) : null;
}

/** Newest first (by date, then createdAt). `includeUnsent` also returns drafts awaiting review. */
export async function listIssues(
  leagueId: string,
  opts: { limit?: number; includeUnsent?: boolean } = {},
): Promise<Issue[]> {
  const ks = await store.list(store.keys.issuePrefix(leagueId));
  const issues = (await Promise.all(ks.map((k) => store.get<Issue>(k)))).filter((x): x is Issue => Boolean(x)).map(upgradeIssue);
  const visible = opts.includeUnsent ? issues : issues.filter((i) => i.status === "sent" || i.status === "approved");
  visible.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return opts.limit ? visible.slice(0, opts.limit) : visible;
}

/* ------------------------------ roasts ------------------------------ */

export async function saveRoast(roast: Roast): Promise<void> {
  await store.set(store.keys.roast(roast.leagueId, roast.id), roast);
}

export async function getRoast(leagueId: string, roastId: string): Promise<Roast | null> {
  return store.get<Roast>(store.keys.roast(leagueId, roastId));
}

/** Newest first. Roast ids start with their kind ("trade:", "waiver:", "pick:"). */
export async function listRoasts(leagueId: string, kind?: RoastItemKind, limit?: number): Promise<Roast[]> {
  const prefix = kind === "draft_pick" ? "pick" : kind;
  const ks = await store.list(store.keys.roastPrefix(leagueId, prefix));
  const roasts = (await Promise.all(ks.map((k) => store.get<Roast>(k)))).filter((x): x is Roast => Boolean(x));
  roasts.sort((a, b) => b.createdAt - a.createdAt);
  return limit ? roasts.slice(0, limit) : roasts;
}

/** Roast id helpers, so every agent builds the same ids. */
export const roastIds = {
  trade: (transactionId: string) => `trade:${transactionId}`,
  waiver: (batchId: string) => `waiver:${batchId}`,
  pick: (draftId: string, pickNo: number) => `pick:${draftId}:${String(pickNo).padStart(3, "0")}`,
};

/* --------------------------- odds snapshots -------------------------- */

export async function saveOddsSnapshot(leagueId: string, season: string, snap: OddsSnapshot): Promise<void> {
  await store.set(store.keys.oddsSnapshot(leagueId, season, snap.week), snap);
}

/** Oldest week first. */
export async function listOddsSnapshots(leagueId: string, season: string): Promise<OddsSnapshot[]> {
  const ks = await store.list(store.keys.oddsPrefix(leagueId, season));
  const snaps = (await Promise.all(ks.map((k) => store.get<OddsSnapshot>(k)))).filter((x): x is OddsSnapshot => Boolean(x));
  return snaps.sort((a, b) => a.week - b.week);
}
