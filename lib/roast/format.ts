/**
 * Deterministic text helpers shared by the issue/item planners. Everything here is plain text
 * (no HTML); web and email escape it when they render.
 */
import type { DraftPickFact, IssueBlock, TeamRef } from "@/lib/types";

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

/** Scores the way Sleeper shows them: 2 decimals. */
export const pts = (n: number) => r2(n).toFixed(2);
/** Whole percent, but never rounded into a certainty it is not (99.8 is "over 99%", 0.3 is "under 1%"). */
/**
 * A percentage the way the odds tables print it (pctText: toFixed(1)), and never a certainty the
 * sims did not produce: above 0 is at least 0.1, short of 100 at most 99.9 ("<0.1" and ">99.9").
 */
export const tablePct = (n: number) => (!Number.isFinite(n) || n <= 0 ? 0 : n >= 100 ? 100 : Math.min(99.9, Math.max(0.1, Number(n.toFixed(1)))));

/** The odds as shown: to one decimal, so two teams that read the same tie on the page too. */
const shownPct = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 10);

/**
 * The one order every odds table uses (the boards, /odds and the stat lines' rank): title odds as
 * shown, then playoff odds as shown, then the unrounded numbers, then first name.
 */
export function oddsOrder(a: { titlePct: number; playoffPct: number; team: TeamRef }, b: { titlePct: number; playoffPct: number; team: TeamRef }): number {
  return (
    shownPct(b.titlePct) - shownPct(a.titlePct) ||
    shownPct(b.playoffPct) - shownPct(a.playoffPct) ||
    b.titlePct - a.titlePct ||
    b.playoffPct - a.playoffPct ||
    a.team.managerName.localeCompare(b.team.managerName)
  );
}

export const pct = (n: number) => (n > 0 && n < 0.5 ? "under 1%" : n >= 99.5 && n < 100 ? "over 99%" : `${Math.round(n)}%`);
export const money = (n: number) => `$${Math.round(n)}`;
export const num = (n: number) => Math.round(n).toLocaleString("en-US");
export const signed = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `-${num(-n)}` : "0");

/** "Team Name (Manager)" */
export const label = (t: TeamRef) => (t.teamName === t.managerName ? t.managerName : `${t.teamName} (${t.managerName})`);

/** Compact team identity for the FACTS payload. */
export const who = (t: TeamRef) => ({ manager: t.managerName, team: t.teamName });

/** "1.05" style draft slot. */
export const pickLabel = (p: Pick<DraftPickFact, "round" | "pickInRound">) => `${p.round}.${String(p.pickInRound).padStart(2, "0")}`;

export const para = (text: string): IssueBlock => ({ type: "paragraph", text });

/** Join sentences, skipping empties. */
export const sentences = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(" ");

/** Replace dashes the copy rules forbid (em/en dashes) with plain punctuation. */
export function noLongDashes(s: string): string {
  return s
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1-$2")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}
