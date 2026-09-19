/** Draft order math from the Sleeper draft object (snake with an optional reversal round). */
import type { SleeperDraft } from "@/lib/types";
import { pickLabel } from "./format";

/** True when `round` runs slot 1 to slot N. */
export function roundRunsForward(draft: Pick<SleeperDraft, "type" | "settings">, round: number): boolean {
  if (draft.type !== "snake") return true;
  const reversal = draft.settings.reversal_round ?? 0;
  // Snake flips every round. From the reversal round on, the flip is shifted by one
  // (a "3rd round reversal" runs round 3 in the same direction as round 2).
  return reversal > 0 && round >= reversal ? round % 2 === 0 : round % 2 === 1;
}

export interface SlotPick {
  round: number;
  pickInRound: number;
  pickNo: number;
  label: string;
}

/** The picks a draft slot makes in the first `rounds` rounds. */
export function slotPicks(draft: Pick<SleeperDraft, "type" | "settings">, slot: number, rounds = 3): SlotPick[] {
  const teams = draft.settings.teams;
  const out: SlotPick[] = [];
  for (let round = 1; round <= Math.min(rounds, draft.settings.rounds); round++) {
    const pickInRound = roundRunsForward(draft, round) ? slot : teams + 1 - slot;
    out.push({ round, pickInRound, pickNo: (round - 1) * teams + pickInRound, label: pickLabel(round, pickInRound) });
  }
  return out;
}

/** Round, pick in round, slot and roster for an overall pick number. */
export function pickAt(draft: Pick<SleeperDraft, "type" | "settings" | "slot_to_roster_id">, pickNo: number) {
  const teams = draft.settings.teams;
  const round = Math.ceil(pickNo / teams);
  const pickInRound = pickNo - (round - 1) * teams;
  const slot = roundRunsForward(draft, round) ? pickInRound : teams + 1 - pickInRound;
  const rosterId = draft.slot_to_roster_id?.[String(slot)] ?? null;
  return { round, pickInRound, slot, rosterId, label: pickLabel(round, pickInRound) };
}

/** Draft order as [{ slot, rosterId }] when Sleeper has set it. */
export function draftOrder(draft: Pick<SleeperDraft, "slot_to_roster_id" | "settings">): Array<{ slot: number; rosterId: number }> {
  const map = draft.slot_to_roster_id;
  if (!map) return [];
  return Object.entries(map)
    .map(([slot, rosterId]) => ({ slot: Number(slot), rosterId }))
    .filter((x) => Number.isFinite(x.slot) && typeof x.rosterId === "number")
    .sort((a, b) => a.slot - b.slot);
}
