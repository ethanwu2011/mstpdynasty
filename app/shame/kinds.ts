/** Wall of Shame vocabulary: how each kind of entry is named, ranked and measured on the page. */
import type { ShameEntry, ShameKind } from "@/lib/types";
import { fmtInt, fmtPts } from "../_lib/format";

export interface KindMeta {
  /** URL value for ?kind= */
  slug: string;
  /** Ledger and record-wall title. */
  title: string;
  /** Tag text. */
  short: string;
  /** One plain line: what gets you on the wall for this. */
  rule: string;
  /** Ranked by amount (worst first). False = every entry weighs the same (zero-point starters). */
  ranked: boolean;
  /** Caption under the record number. */
  unitLabel: string;
  /** Phrase for a manager's count, singular and plural. */
  count: [string, string];
  /** Header of the ledger's number column (ranked kinds only). */
  column: string;
}

/** Page order: the week-to-week sins first, then money and value, then the draft. */
export const KIND_ORDER: readonly ShameKind[] = [
  "bench_points",
  "zero_starter",
  "lineup_negligence",
  "bad_trade",
  "zero_bid_lost",
  "overpay",
  "draft_reach",
];

export const KINDS: Record<ShameKind, KindMeta> = {
  bench_points: {
    slug: "bench",
    title: "Bench points left",
    short: "Bench",
    rule: "The most points left on a bench in one week",
    ranked: true,
    unitLabel: "Points on the bench",
    count: ["of the worst bench weeks", "of the worst bench weeks"],
    column: "Left on bench",
  },
  zero_starter: {
    slug: "zero",
    title: "Zero-point starters",
    short: "Zero",
    rule: "Starting a player who scores nothing",
    ranked: false,
    unitLabel: "Starters who scored zero",
    count: ["zero-point starter", "zero-point starters"],
    column: "",
  },
  lineup_negligence: {
    slug: "lineup",
    title: "Lineup negligence",
    short: "Lineup",
    rule: "Starting someone on a bye, ruled out or on IR, or leaving a slot empty",
    ranked: false,
    unitLabel: "Dead lineup slots",
    count: ["dead lineup slot", "dead lineup slots"],
    column: "",
  },
  bad_trade: {
    slug: "trades",
    title: "Worst trades",
    short: "Trade",
    rule: "Dynasty value lost in one trade, by FantasyCalc",
    ranked: true,
    unitLabel: "Value given away",
    count: ["trade that lost value", "trades that lost value"],
    column: "Value lost",
  },
  zero_bid_lost: {
    slug: "zero-bids",
    title: "$0 bids that lost",
    short: "$0 bid",
    rule: "Bidding nothing on a waiver claim and losing it",
    ranked: true,
    unitLabel: "The bid that beat $0",
    count: ["$0 bid that lost", "$0 bids that lost"],
    column: "Winning bid",
  },
  overpay: {
    slug: "overpays",
    title: "Biggest overpays",
    short: "Overpay",
    rule: "Waiver bids far past the next best bid",
    ranked: true,
    unitLabel: "Overpaid by",
    count: ["overpay", "overpays"],
    column: "Overpaid by",
  },
  draft_reach: {
    slug: "reaches",
    title: "Draft reaches",
    short: "Reach",
    rule: "Drafting a player well ahead of his FantasyCalc rank",
    ranked: true,
    unitLabel: "Spots too early",
    count: ["draft reach", "draft reaches"],
    column: "Too early by",
  },
};

export function kindFromSlug(slug: string | undefined): ShameKind | null {
  if (!slug) return null;
  return KIND_ORDER.find((k) => KINDS[k].slug === slug) ?? null;
}

/** The number alone, for the record wall ("78.68", "$103", "3,515"). */
export function amountText(e: Pick<ShameEntry, "amount" | "unit">): string {
  switch (e.unit) {
    case "pts":
      return fmtPts(e.amount, Number.isInteger(e.amount) ? 0 : 2);
    case "$":
      return `$${fmtInt(e.amount)}`;
    case "value":
      return fmtInt(e.amount);
    case "picks":
      return fmtInt(e.amount);
  }
}

/** The damage column ("78.68 pts", "$103", "3,515 value", "23 spots"). */
export function damageText(e: Pick<ShameEntry, "amount" | "unit">): string {
  switch (e.unit) {
    case "pts":
      return `${amountText(e)} pts`;
    case "$":
      return amountText(e);
    case "value":
      return `${amountText(e)} value`;
    case "picks":
      return `${amountText(e)} ${e.amount === 1 ? "spot" : "spots"}`;
  }
}

/** Where an entry's receipt lives on the site, when there is one. */
export function entryHref(e: ShameEntry): string | null {
  switch (e.kind) {
    case "bad_trade":
      return e.refId ? `/trades#trade-${e.refId.replace(/[^a-zA-Z0-9_-]+/g, "-")}` : "/trades";
    case "draft_reach": {
      const pick = e.refId?.split(":").pop();
      return pick && /^\d+$/.test(pick) ? `/draft#pick-${Number(pick)}` : "/draft";
    }
    case "bench_points":
    case "zero_starter":
    case "lineup_negligence":
      return e.week ? `/scores/${e.week}` : null;
    case "zero_bid_lost":
    case "overpay":
      return null;
  }
}

/** Worst first within a kind: by amount for ranked kinds, most recent first otherwise. */
export function sortKind(kind: ShameKind, entries: ShameEntry[]): ShameEntry[] {
  const ranked = KINDS[kind].ranked;
  return [...entries].sort((a, b) =>
    ranked
      ? b.amount - a.amount || (b.week ?? 0) - (a.week ?? 0) || a.id.localeCompare(b.id)
      : (b.week ?? 0) - (a.week ?? 0) || a.team.managerName.localeCompare(b.team.managerName) || a.id.localeCompare(b.id),
  );
}

export function groupByKind(entries: ShameEntry[]): Map<ShameKind, ShameEntry[]> {
  const map = new Map<ShameKind, ShameEntry[]>();
  for (const k of KIND_ORDER) {
    const list = entries.filter((e) => e.kind === k);
    if (list.length) map.set(k, sortKind(k, list));
  }
  return map;
}
