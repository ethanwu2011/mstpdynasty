/**
 * Plans for the instant item posts (site only): one trade, one waiver batch, one draft pick.
 * Same shape as issue plans: a FACTS payload, one "roast" slot (1 to 3 sentences, same voice as
 * the newsletter), and a deterministic facts-only line used when the model is unavailable or
 * fails the checks.
 */
import { roastIds } from "@/lib/archive";
import type { DraftPickFact, RoastItemFact, RoastItemKind, TradeFact, WaiverFact } from "@/lib/types";
import { label, num, pickLabel } from "./format";
import type { DraftContext } from "./memory-shape";
import { pickPayload, tradePayload, waiverLine, waiversPayload, type SlotSpec, type WaiverMode } from "./plan";

export interface ItemPlan {
  kind: RoastItemKind;
  id: string;
  rosterIds: number[];
  header: string;
  task: string;
  slots: SlotSpec[];
  facts: Record<string, unknown>;
  factsOnlyText: string;
  managers: string[];
}

/** Extra context the caller can pass (all optional; each one only adds FACTS). */
export interface PickContext {
  /** Every pick in the draft so far (any order). */
  picks?: DraftPickFact[];
  /** FantasyCalc values, pick clock and draft type for a pick's "passed on", clock limit and position count. */
  draft?: Omit<DraftContext, "picks"> | null;
  /** The commissioner's first name: added to FACTS when he is in the item (he is never spared). */
  commissioner?: string | null;
  /** Starting lineup slots per position, for draft picks ({ QB: 2, TE: 1 }). */
  starters?: Record<string, number> | null;
  /** "priority" when the league does not run on FAAB (default "faab"). */
  waiverMode?: WaiverMode;
  /** playerId -> draft slot ("1.03"), for "draftedAt" on player objects. */
  draftSlots?: Record<string, string>;
}

export function tradeFactsOnly(t: TradeFact): string {
  const winner = t.sides.find((s) => s.team.rosterId === t.winnerRosterId);
  const values = t.sides.map((s) => `${s.team.managerName} gets ${num(s.valueIn)} in FantasyCalc value and gives ${num(s.valueOut)} (${s.grade})`).join("; ");
  return winner ? `${values}. ${winner.team.managerName} wins it by ${num(t.valueGap)}.` : `${values}. Fair by value.`;
}

export function waiverFactsOnly(ws: WaiverFact[]): string {
  return ws.map(waiverLine).join(" ");
}

export function pickFactsOnly(p: DraftPickFact): string {
  const base = `Pick ${pickLabel(p)}: ${label(p.team)} took ${p.player.name} (${p.player.position}).`;
  if (p.fcRank === null) return `${base} FantasyCalc does not rank him.`;
  if (p.verdict === "reach") return `${base} FantasyCalc rank ${p.fcRank}, a reach of ${p.reach} spots.`;
  if (p.verdict === "steal") return `${base} FantasyCalc rank ${p.fcRank}, a steal of ${Math.abs(p.reach ?? 0)} spots.`;
  return `${base} FantasyCalc rank ${p.fcRank}, about right.`;
}

const ROAST_SLOT = (brief: string): SlotSpec => ({ id: "roast", brief });

const ITEM_BRIEF = "1 to 3 sentences.";

/** FACTS gets the commissioner only when he is one of the managers in the item. */
function withCommissioner(facts: Record<string, unknown>, managers: string[], commissioner: string | null | undefined): Record<string, unknown> {
  return commissioner && managers.includes(commissioner) ? { ...facts, commissioner } : facts;
}

/** Plan an item roast. The fact's own shape decides the kind (`kind` is kept for the public signature). */
export function planItem(kind: RoastItemKind, fact: RoastItemFact, faabBudget: number, extra: PickContext = {}): ItemPlan {
  void kind;
  if (Array.isArray(fact) || (fact as WaiverFact).kind === "waiver") {
    const batch = Array.isArray(fact) ? fact : [fact as WaiverFact];
    const managers = [...new Set(batch.flatMap((w) => [w.team.managerName, ...w.losingBids.map((l) => l.team.managerName)]))];
    return {
      kind: "waiver",
      id: roastIds.waiver(batch[0]?.batchId ?? "empty"),
      rosterIds: [...new Set(batch.map((w) => w.team.rosterId))],
      header: batch.length === 1 && batch[0].type === "free_agent" ? "ITEM: free agent move" : "ITEM: waiver run",
      task:
        (extra.waiverMode ?? "faab") === "faab"
          ? "One post on these moves, 1 to 3 brutal sentences. Go after the worst decision: a $0 bid that lost, an overpay, a bid that failed because the roster was full, or a bad drop."
          : "One post on these moves, 1 to 3 brutal sentences. Go after the worst decision: a claim lost on waiver priority, a claim that failed because the roster was full, or a bad drop. This league has no bids.",
      slots: [ROAST_SLOT(ITEM_BRIEF)],
      facts: withCommissioner(waiversPayload(batch, faabBudget, extra.waiverMode ?? "faab", extra.draftSlots), managers, extra.commissioner),
      factsOnlyText: waiverFactsOnly(batch),
      managers,
    };
  }
  if ((fact as TradeFact).kind === "trade") {
    const t = fact as TradeFact;
    const managers = t.sides.map((s) => s.team.managerName);
    return {
      kind: "trade",
      id: roastIds.trade(t.transactionId),
      rosterIds: t.sides.map((s) => s.team.rosterId),
      header: "ITEM: trade",
      task: "One post on this trade, 1 to 3 brutal sentences. Make clear who won it by value, and hit both sides.",
      slots: [ROAST_SLOT(ITEM_BRIEF)],
      facts: withCommissioner(tradePayload(t, extra.draftSlots), managers, extra.commissioner),
      factsOnlyText: tradeFactsOnly(t),
      managers,
    };
  }
  const p = fact as DraftPickFact;
  const all = (extra.picks ?? []).filter((x) => x.draftId === p.draftId);
  const draft: DraftContext | null = extra.draft ? { ...extra.draft, picks: all } : null;
  const earlierOwn = all.filter((x) => x.team.rosterId === p.team.rosterId && x.pickNo < p.pickNo).sort((a, b) => a.pickNo - b.pickNo);
  const justBefore = all.filter((x) => x.pickNo < p.pickNo && x.pickNo >= p.pickNo - 3).sort((a, b) => a.pickNo - b.pickNo);
  return {
    kind: "draft_pick",
    id: roastIds.pick(p.draftId, p.pickNo),
    rosterIds: [p.team.rosterId],
    header: "ITEM: draft pick",
    task: "One post on this draft pick, 1 to 3 brutal sentences. Use the reach or steal, who he passed on and who took that player, how many at that position he now has, the position run or his earlier picks if they are in FACTS.",
    slots: [ROAST_SLOT(ITEM_BRIEF)],
    facts: withCommissioner(
      {
        ...pickPayload(p, draft),
        ...(extra.starters ? { starters: extra.starters } : {}),
        earlierPicks: earlierOwn.map((x) => ({ pick: pickLabel(x), player: x.player.name, pos: x.player.position })),
        justBefore: justBefore.map((x) => ({ pick: pickLabel(x), manager: x.team.managerName, player: x.player.name, pos: x.player.position })),
      },
      [p.team.managerName],
      extra.commissioner,
    ),
    factsOnlyText: pickFactsOnly(p),
    managers: [p.team.managerName],
  };
}

