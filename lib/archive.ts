/**
 * Persistence for published content: issues (newsletters), instant roasts and weekly odds
 * snapshots. Shared and FROZEN: jobs write through here, pages read through here.
 * Keys follow lib/store.ts `keys`.
 */
import * as store from "./store";
import type { Issue, OddsSnapshot, Roast, RoastItemKind } from "./types";

/* ------------------------------ issues ------------------------------ */

export async function saveIssue(issue: Issue): Promise<void> {
  await store.set(store.keys.issue(issue.leagueId, issue.slug), issue);
}

export async function getIssue(leagueId: string, slug: string): Promise<Issue | null> {
  return store.get<Issue>(store.keys.issue(leagueId, slug));
}

/** Newest first (by date, then createdAt). `includeUnsent` also returns drafts awaiting review. */
export async function listIssues(
  leagueId: string,
  opts: { limit?: number; includeUnsent?: boolean } = {},
): Promise<Issue[]> {
  const ks = await store.list(store.keys.issuePrefix(leagueId));
  const issues = (await Promise.all(ks.map((k) => store.get<Issue>(k)))).filter((x): x is Issue => Boolean(x));
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
