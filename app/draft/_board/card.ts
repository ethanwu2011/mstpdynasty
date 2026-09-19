/**
 * The data behind a pick's roast card, flattened to plain strings on the server so the one
 * shared card on the page (PickCardHost) can show any pick without shipping a card per pick.
 */
import type { DraftPickFact } from "@/lib/types";
import { etStamp, fmtInt, ordinal, pickLabel } from "../../_lib/format";
import { pickStat } from "../../_lib/roast-view";
import type { BoardCell } from "./model";

export interface PickCardData {
  pickNo: number;
  label: string;
  round: number;
  manager: string;
  rosterId: number;
  stat: string;
  text: string;
  player: string;
  position: string;
  nflTeam: string;
  /** Original owner when the pick changed hands. */
  via: string | null;
  source: "sample" | "facts" | "roast";
  atIso: string | null;
  atLabel: string | null;
  byline: string;
  receipt: Array<{ label: string; value: string }>;
}

const spots = (n: number) => `${fmtInt(n)} ${Math.abs(n) === 1 ? "spot" : "spots"}`;

/** The plain facts of a pick, for when the writer has not written about it yet. */
export function pickFacts(p: DraftPickFact): string {
  const team = p.player.nflTeam ? `, ${p.player.nflTeam}` : "";
  const took = `${p.team.managerName} took ${p.player.name} (${p.player.position}${team}) at ${pickLabel(p.round, p.pickInRound)}, ${ordinal(p.pickNo)} overall.`;
  if (!p.fcRank) return `${took} FantasyCalc does not rank him.`;
  const rank = `FantasyCalc ranks him ${ordinal(p.fcRank)}.`;
  if (p.verdict === "reach" && p.reach) return `${took} ${rank} That is ${spots(p.reach)} early.`;
  if (p.verdict === "steal" && p.reach) return `${took} ${rank} He fell ${spots(-p.reach)} past his rank.`;
  return `${took} ${rank}`;
}

function verdictValue(p: DraftPickFact): string {
  if (p.verdict === "reach") return p.reach ? `Reach, ${fmtInt(p.reach)}` : "Reach";
  if (p.verdict === "steal") return p.reach ? `Steal, ${fmtInt(-p.reach)}` : "Steal";
  if (p.verdict === "unranked") return "Unranked";
  return "Fair";
}

export function cardData(cell: BoardCell, placeholder: boolean): PickCardData | null {
  const p = cell.pick;
  if (!p) return null;
  const roast = cell.roast;
  const at = roast?.createdAt ?? p.pickedAt;
  const llm = roast?.source === "llm";
  return {
    pickNo: cell.pickNo,
    label: cell.label,
    round: cell.round,
    manager: p.team.managerName,
    rosterId: p.team.rosterId,
    stat: pickStat(p),
    text: roast?.text?.trim() || pickFacts(p),
    player: p.player.name,
    position: p.player.position || "--",
    nflTeam: p.player.nflTeam ?? "FA",
    via: cell.traded ? cell.columnName : null,
    source: placeholder ? "sample" : llm ? "roast" : "facts",
    atIso: at ? new Date(at).toISOString() : null,
    atLabel: at ? etStamp(at) : null,
    byline: llm ? "MSTP Dynasty" : "the numbers",
    receipt: [
      { label: "Pick", value: `${cell.label} (${ordinal(p.pickNo)})` },
      { label: "FC rank", value: p.fcRank ? ordinal(p.fcRank) : "Unranked" },
      { label: "Position rank", value: p.fcPositionRank ? `${p.player.position}${p.fcPositionRank}` : "--" },
      { label: "Verdict", value: verdictValue(p) },
    ],
  };
}
