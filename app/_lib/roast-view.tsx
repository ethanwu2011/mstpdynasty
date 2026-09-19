/**
 * Turns roasts, issues and facts into RoastBlock data: the victim, the stat that earned it,
 * the text and the receipt. Formatting only: every number comes from the facts as given.
 */
import type { RoastBlockData, RoastReceiptItem } from "@/components/RoastBlock";
import { SampleMark } from "@/components/Tag";
import { formatEt } from "@/lib/time";
import type { DraftPickFact, Issue, Roast, StandingRow, TradeFact, WaiverFact, WeeklyFacts } from "@/lib/types";
import { fmtInt, fmtPts, fmtSigned, ordinal, pickLabel } from "./format";

/** "Sep 21" in Eastern time. */
export const shortDay = (ms: number) => formatEt(ms, { month: "short", day: "numeric" });

/* ------------------------------ anchors ------------------------------ */

/** Anchor id a page gives a roast's row, so permalinks land on it. */
export function roastAnchor(roast: Pick<Roast, "kind" | "facts" | "id">): string {
  if (roast.kind === "draft_pick" && !Array.isArray(roast.facts) && roast.facts.kind === "draft_pick") {
    return `pick-${roast.facts.pickNo}`;
  }
  return roast.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

/** Where a roast lives: trades and waivers on /trades, picks on /draft. */
export function roastHref(roast: Pick<Roast, "kind" | "facts" | "id">): string {
  const page = roast.kind === "draft_pick" ? "/draft" : "/trades";
  return `${page}#${roastAnchor(roast)}`;
}

/* ------------------------------ tags ------------------------------ */

/** Only placeholder data is marked. A facts-only item is just the facts: no badge, no apology. */
function sourceTags(source: Roast["source"] | "facts_only", placeholder = false) {
  if (placeholder || source === "placeholder") return <SampleMark />;
  return null;
}

/* ------------------------------ draft picks ------------------------------ */

export function pickStat(p: DraftPickFact): string {
  const label = pickLabel(p.round, p.pickInRound);
  switch (p.verdict) {
    case "reach":
      return p.reach ? `Reached ${fmtInt(p.reach)} spots` : `Reach at ${label}`;
    case "steal":
      return p.reach ? `Steal by ${fmtInt(Math.abs(p.reach))} spots` : `Steal at ${label}`;
    case "fair":
      return `${p.player.position} at ${label}`;
    case "unranked":
      return `Unranked at ${label}`;
  }
}

/** "Reach, 12", "Steal, 4", "Fair", "Unranked": the pick against its FantasyCalc rank, one way of saying it everywhere. */
export function pickVerdict(p: DraftPickFact): string {
  if (p.verdict === "reach") return p.reach ? `Reach, ${fmtInt(p.reach)}` : "Reach";
  if (p.verdict === "steal") return p.reach ? `Steal, ${fmtInt(-p.reach)}` : "Steal";
  if (p.verdict === "unranked") return "Unranked";
  return "Fair";
}

export function pickReceipt(p: DraftPickFact): RoastReceiptItem[] {
  return [
    { label: "Pick", value: `${pickLabel(p.round, p.pickInRound)} (${ordinal(p.pickNo)})` },
    { label: "Player", value: [p.player.name, p.player.position].filter(Boolean).join(", "), wide: true },
    { label: "FC rank", value: p.fcRank ? ordinal(p.fcRank) : "Unranked" },
    { label: "Vs FantasyCalc", value: pickVerdict(p) },
  ];
}

function pickFactsText(p: DraftPickFact): string {
  const who = p.team.managerName;
  const team = p.player.nflTeam ? `, ${p.player.nflTeam}` : "";
  const first = `${who} took ${p.player.name} (${p.player.position}${team}) at ${pickLabel(p.round, p.pickInRound)}, ${ordinal(p.pickNo)} overall.`;
  if (!p.fcRank) return `${first} FantasyCalc does not rank ${p.player.name}.`;
  const tail = p.reach && p.reach > 0 ? `, a reach of ${fmtInt(p.reach)} spots.` : p.reach && p.reach < 0 ? `, a steal of ${fmtInt(-p.reach)} spots.` : ".";
  return `${first} FantasyCalc ranks ${p.player.name} ${ordinal(p.fcRank)} overall${tail}`;
}

/** A pick that has not been roasted yet: the facts alone. */
export function pickFallback(p: DraftPickFact, placeholder = false): RoastBlockData {
  return {
    event: `Pick ${pickLabel(p.round, p.pickInRound)}`,
    kicker: `Round ${p.round}`,
    victim: p.team.managerName,
    stat: pickStat(p),
    text: pickFactsText(p),
    receipt: pickReceipt(p),
    at: p.pickedAt,
    href: `/draft#pick-${p.pickNo}`,
    tags: sourceTags("facts_only", placeholder),
  };
}

/* ------------------------------ trades and waivers ------------------------------ */

function tradeView(f: TradeFact): Omit<RoastBlockData, "text" | "at" | "href" | "tags"> {
  const sides = [...f.sides].sort((a, b) => a.net - b.net);
  const loser = sides[0];
  const event = `Trade, ${shortDay(f.createdAt)}`;
  const kicker = `Week ${f.week}`;
  if (!loser) return { event, kicker, victim: "Trade", stat: null };
  if (f.winnerRosterId === null) {
    return {
      event,
      kicker,
      victim: sides.map((s) => s.team.managerName).join(" & "),
      stat: `${fmtInt(f.valueGap)} value apart`,
      receipt: sides.map((s) => ({ label: s.team.managerName, value: `${fmtSigned(s.net)} · ${s.grade}` })),
    };
  }
  return {
    event,
    kicker,
    victim: loser.team.managerName,
    stat: `${fmtSigned(loser.net)} value`,
    receipt: [
      { label: "Sent", value: fmtInt(loser.valueOut) },
      { label: "Got back", value: fmtInt(loser.valueIn) },
      { label: "Net", value: fmtSigned(loser.net) },
      { label: "Grade", value: loser.grade },
    ],
  };
}

function worstWaiver(list: WaiverFact[]): WaiverFact | undefined {
  return (
    list.find((w) => w.isZeroBid && w.losingBids.length > 0) ??
    [...list].sort((a, b) => (b.overpayBy ?? 0) - (a.overpayBy ?? 0))[0]
  );
}

function waiverView(list: WaiverFact[]): Omit<RoastBlockData, "text" | "at" | "href" | "tags"> {
  const w = worstWaiver(list);
  if (!w) return { event: "Waivers", victim: "Waivers", stat: null };
  const stat = w.isZeroBid ? "$0 bid" : w.overpayBy ? `Overpaid by $${fmtInt(w.overpayBy)}` : w.bid !== null ? `$${fmtInt(w.bid)} bid` : "Free agent add";
  const topLosing = [...w.losingBids].sort((a, b) => b.bid - a.bid)[0];
  return {
    event: `${w.type === "waiver" ? "Waivers" : "Free agent"}, ${shortDay(w.createdAt)}`,
    kicker: `Week ${w.week}`,
    victim: w.team.managerName,
    stat,
    receipt: [
      { label: "Added", value: w.added.map((p) => p.name).join(", ") || "--", wide: true },
      { label: "Bid", value: w.bid === null ? "--" : `$${fmtInt(w.bid)}` },
      { label: "Next best", value: topLosing ? `$${fmtInt(topLosing.bid)}` : "None" },
      { label: "Dropped", value: w.dropped.map((p) => p.name).join(", ") || "--", wide: true },
    ],
  };
}

/* ------------------------------ roasts and issues ------------------------------ */

/**
 * Any stored roast as a RoastBlock. A pick is stamped with when it was made (null when the tick
 * never saw it land), never with when it was written up; trades and waivers keep the write-up time.
 */
export function roastToBlock(roast: Roast): RoastBlockData {
  const common = { text: roast.text, at: roast.createdAt as number | null, href: roastHref(roast), tags: sourceTags(roast.source) };
  const f = roast.facts;
  if (Array.isArray(f)) return { ...waiverView(f), ...common };
  switch (f.kind) {
    case "trade":
      return { ...tradeView(f), ...common };
    case "waiver":
      return { ...waiverView([f]), ...common };
    case "draft_pick":
      return {
        event: `Pick ${pickLabel(f.round, f.pickInRound)}`,
        kicker: `Round ${f.round}`,
        victim: f.team.managerName,
        stat: pickStat(f),
        receipt: pickReceipt(f),
        ...common,
        at: f.pickedAt,
      };
  }
}

/** "The Daily, Sep 19", "Week 5 Recap", "Draft Grades": an issue named as the event it is. */
export function issueEvent(issue: Pick<Issue, "title" | "kind" | "date">): string {
  if (issue.kind === "weekly_recap" || issue.kind === "draft_grades") return issue.title;
  return `${issue.title}, ${formatEt(Date.parse(`${issue.date}T12:00:00Z`), { month: "short", day: "numeric" })}`;
}

/** A newsletter issue as a RoastBlock: title in pixel caps, dek as the lede, the first paragraphs. */
export function issueToBlock(issue: Issue): RoastBlockData {
  const paragraphs = issue.sections
    .flatMap((s) => s.blocks)
    .filter((b): b is { type: "paragraph"; text: string } => b.type === "paragraph")
    .slice(0, 2)
    .map((b) => b.text);
  return {
    event: issueEvent(issue),
    kicker: issue.week && !/week/i.test(issue.title) ? `Week ${issue.week}` : undefined,
    victim: issue.title,
    lede: issue.dek,
    text: paragraphs.join("\n\n") || issue.note || "",
    at: issue.sentAt ?? issue.createdAt,
    href: `/newsletter/${issue.slug}`,
    tags: issue.placeholder ? <SampleMark /> : null,
  };
}

/** The newest of the latest roast and the latest issue, or null when neither exists. */
export function latestLead(roast: Roast | null | undefined, issue: Issue | null | undefined): RoastBlockData | null {
  const rAt = roast?.createdAt ?? -1;
  const iAt = issue ? (issue.sentAt ?? issue.createdAt) : -1;
  if (roast && rAt >= iAt) return roastToBlock(roast);
  if (issue) return issueToBlock(issue);
  return null;
}

/* ------------------------------ standings ------------------------------ */

/** Last place in the final table as a facts-only lead (offseason, nothing roasted yet). */
export function lastPlaceFallback(rows: StandingRow[], season: string): RoastBlockData | null {
  const t = rows[rows.length - 1];
  if (!t || t.wins + t.losses + t.ties === 0) return null;
  const rec = t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
  return {
    event: `${season} final`,
    kicker: "Last place",
    victim: t.team.managerName,
    stat: `${rec} record`,
    text: `${t.team.managerName} finished ${ordinal(t.rank)} of ${rows.length} at ${rec}, with ${fmtPts(t.pointsFor)} points for and ${fmtPts(t.pointsAgainst)} against.`,
    receipt: [
      { label: "Record", value: rec },
      { label: "Points for", value: fmtPts(t.pointsFor) },
      { label: "Points against", value: fmtPts(t.pointsAgainst) },
      { label: "Finish", value: `${ordinal(t.rank)} of ${rows.length}` },
    ],
    href: "/standings",
    tags: sourceTags("facts_only"),
  };
}

/* ------------------------------ weekly facts ------------------------------ */

/** The week's lowest score as a facts-only lead, for when nothing has been roasted yet. */
export function weeklyFallback(facts: WeeklyFacts): RoastBlockData | null {
  const t = facts.loserOfTheWeek ?? facts.lowest;
  if (!t) return null;
  const n = facts.teams.length;
  const opp = facts.teams.find((x) => x.team.rosterId === t.opponentRosterId);
  const lines = [
    `${t.team.managerName} scored ${fmtPts(t.points)} in week ${facts.week}, ${t.scoreRank === n ? "the lowest score in the league" : `${ordinal(t.scoreRank)} of ${n}`}.`,
  ];
  if (opp && t.result === "L") lines.push(`Lost to ${opp.team.managerName} by ${fmtPts(Math.abs(opp.points - t.points))}.`);
  if (t.benchPointsLeft > 0) lines.push(`Left ${fmtPts(t.benchPointsLeft)} points on the bench.`);
  if (t.zeroStarters.length) lines.push(`Started ${t.zeroStarters.length === 1 ? "a player" : `${t.zeroStarters.length} players`} who scored zero.`);
  return {
    event: `Week ${facts.week} final`,
    kicker: "Loser of the week",
    victim: t.team.managerName,
    stat: `${fmtPts(t.points)} points`,
    text: lines.join(" "),
    receipt: [
      { label: "Score", value: fmtPts(t.points) },
      { label: "Rank", value: `${t.scoreRank} of ${n}` },
      { label: "Bench left", value: fmtPts(t.benchPointsLeft) },
      { label: "All-play", value: `${t.allPlayWins}-${t.allPlayLosses}` },
    ],
    href: `/scores/${facts.week}`,
    tags: sourceTags("facts_only", facts.placeholder),
  };
}
