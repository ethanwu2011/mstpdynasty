/**
 * Roast engine public API. OWNER: roast agent (lib/facts/**, lib/roast/**, config/roast-notes.ts,
 * tests/facts*, tests/roast*).
 *
 * FOUNDATION STUB: never calls the LLM. Returns facts-only issues and placeholder roasts with
 * the right shapes. The real implementation follows docs/SITE_SPEC.md "Roast engine": code
 * computes facts, The Roast only jokes about the facts it is handed, every number in the
 * output is checked against the facts payload, and on refusal / API error it publishes a
 * facts-only version with "The roast writer called in sick. Facts only today."
 */
import { configured } from "@/lib/env";
import { getLeagueContext } from "@/lib/league";
import { etDate } from "@/lib/time";
import type { Issue, IssueFacts, IssueKind, IssueSection, LeagueContext, Roast, RoastItemFact, RoastItemKind } from "@/lib/types";
import { roastIds } from "@/lib/archive";

export const ISSUE_TITLES: Record<IssueKind, string> = {
  daily_roast: "The Daily Roast",
  thursday_fallout: "Thursday Night Fallout",
  weekly_roast: "The Weekly Roast",
  draft_grades: "Draft Grades",
};

/** True when ANTHROPIC_API_KEY is set. When false, show "not configured yet" and publish facts only. */
export function isRoastConfigured(): boolean {
  return configured.anthropic();
}

function factsOnlySections(facts: IssueFacts): IssueSection[] {
  switch (facts.kind) {
    case "daily_roast":
      return [
        {
          heading: "Overnight admissions",
          blocks: [
            { type: "paragraph", text: `${facts.trades.length} trades, ${facts.waivers.length} waiver moves, ${facts.draftPicks.length} draft picks.` },
          ],
        },
      ];
    case "thursday_fallout":
      return [
        {
          heading: "Thursday night",
          blocks: [
            {
              type: "table",
              columns: ["Team", "Banked", "Projected"],
              rows: facts.tnf.teams.map((t) => [t.team.teamName, t.banked, t.projected]),
            },
          ],
        },
      ];
    case "weekly_roast":
      return [
        {
          heading: `Week ${facts.week}`,
          blocks: [
            {
              type: "table",
              columns: ["Home", "Pts", "Away", "Pts"],
              rows: facts.weekly.matchups.map((m) => [m.home.team.teamName, m.home.points, m.away.team.teamName, m.away.points]),
            },
          ],
        },
      ];
    case "draft_grades":
      return [
        {
          heading: "Draft",
          blocks: [{ type: "paragraph", text: `${facts.draft.picks.length} picks made.` }],
        },
      ];
  }
}

/** Write a full newsletter issue from its facts. */
export async function roastIssue(kind: IssueKind, facts: IssueFacts, ctx?: LeagueContext): Promise<Issue> {
  const c = ctx ?? (await getLeagueContext());
  const now = Date.now();
  const date = etDate(now);
  const week = "week" in facts ? facts.week : null;
  return {
    id: `${c.leagueId}:${date}:${kind}`,
    slug: `${date}-${kind.replace(/_/g, "-")}`,
    kind,
    leagueId: c.leagueId,
    season: c.season,
    week,
    date,
    title: ISSUE_TITLES[kind],
    dek: "Placeholder issue from the foundation stub.",
    sections: factsOnlySections(facts),
    factsOnly: true,
    note: isRoastConfigured() ? "The roast writer called in sick. Facts only today." : "The roast writer is not set up yet.",
    status: "draft",
    createdAt: now,
    sentAt: null,
    recipientCount: null,
    model: null,
    usage: null,
    imageUrl: null,
    placeholder: true,
  };
}

function itemId(kind: RoastItemKind, fact: RoastItemFact): { id: string; rosterIds: number[] } {
  if (Array.isArray(fact)) {
    return { id: roastIds.waiver(fact[0]?.batchId ?? "empty"), rosterIds: [...new Set(fact.map((w) => w.team.rosterId))] };
  }
  switch (fact.kind) {
    case "trade":
      return { id: roastIds.trade(fact.transactionId), rosterIds: fact.sides.map((s) => s.team.rosterId) };
    case "waiver":
      return { id: roastIds.waiver(fact.batchId), rosterIds: [fact.team.rosterId] };
    case "draft_pick":
      return { id: roastIds.pick(fact.draftId, fact.pickNo), rosterIds: [fact.team.rosterId] };
  }
  return { id: `${kind}:unknown`, rosterIds: [] };
}

/** 1-3 sentence instant roast of one trade, one waiver batch, or one draft pick. */
export async function roastItem(kind: RoastItemKind, fact: RoastItemFact, ctx?: LeagueContext): Promise<Roast> {
  const c = ctx ?? (await getLeagueContext());
  const { id, rosterIds } = itemId(kind, fact);
  return {
    id,
    kind,
    leagueId: c.leagueId,
    rosterIds,
    text: "Placeholder roast. No roast yet.",
    facts: fact,
    source: "placeholder",
    model: null,
    createdAt: Date.now(),
    usage: null,
  };
}
