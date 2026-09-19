/**
 * The startup draft board as data: one cell per pick, laid out by round (rows) and draft
 * slot (columns). Pure layout math on the Sleeper draft object and the facts engine's picks.
 * It never grades a pick: reach, steal and value come from `draftFacts()` as given.
 */
import { managerFor } from "@/lib/league";
import type { DraftFacts, DraftPickFact, LeagueContext, Roast, SleeperDraft, SleeperDraftStatus, SleeperTradedPick } from "@/lib/types";
import { pickAt, roundRunsForward } from "../../_lib/draft";

export type CellState = "made" | "clock" | "future";

/** Where the board is in its life, which decides the panels around it. */
export type BoardStage = "pre" | "live" | "paused" | "done";

export interface BoardColumn {
  slot: number;
  rosterId: number | null;
  manager: string;
  teamName: string;
}

export interface BoardCell {
  pickNo: number;
  round: number;
  pickInRound: number;
  /** Draft slot, which is also the board column (1-based). */
  slot: number;
  /** "4.07" */
  label: string;
  /** The roster whose column this is (the original owner of the pick). */
  columnRosterId: number | null;
  /** The roster that made the pick, or holds it when it is still to come. */
  ownerRosterId: number | null;
  ownerName: string | null;
  /** Manager of the column's team (the pick's original owner). */
  columnName: string | null;
  /** The pick changed hands: made or held by someone other than the column's team. */
  traded: boolean;
  state: CellState;
  pick: DraftPickFact | null;
  roast: Roast | null;
  latest: boolean;
}

export interface BoardRound {
  round: number;
  /** true: slot 1 picks first (left to right). */
  forward: boolean;
  /** The third-round reversal (or whichever round the league set). */
  reversal: boolean;
  cells: BoardCell[];
  made: number;
}

export interface BoardModel {
  draftId: string;
  type: string;
  status: SleeperDraftStatus;
  rounds: number;
  teams: number;
  total: number;
  made: number;
  columns: BoardColumn[];
  roundRows: BoardRound[];
  clock: BoardCell | null;
  latest: BoardCell | null;
  /** Round on the clock, or the last round with a pick, or 1. */
  currentRound: number;
  reversalRound: number;
  orderSet: boolean;
}

/** Draft pick roasts keyed by overall pick number, for one draft. */
export function roastsByPick(roasts: Roast[], draftId: string): Map<number, Roast> {
  const out = new Map<number, Roast>();
  for (const r of roasts) {
    const f = r.facts;
    if (r.kind !== "draft_pick" || Array.isArray(f) || f.kind !== "draft_pick" || f.draftId !== draftId) continue;
    const prev = out.get(f.pickNo);
    if (!prev || r.createdAt > prev.createdAt) out.set(f.pickNo, r);
  }
  return out;
}

export function buildBoard({
  ctx,
  draft,
  facts,
  roasts = [],
  tradedPicks = [],
  stage,
}: {
  ctx: LeagueContext;
  draft: SleeperDraft;
  facts: DraftFacts | null;
  roasts?: Roast[];
  tradedPicks?: SleeperTradedPick[];
  stage: BoardStage;
}): BoardModel {
  const teams = draft.settings.teams || facts?.teams || ctx.rosters.length || 10;
  const rounds = draft.settings.rounds || facts?.rounds || 0;
  const total = rounds * teams;
  const settings = { ...draft.settings, teams, rounds };
  const shape = { type: draft.type, settings, slot_to_roster_id: draft.slot_to_roster_id };

  const columns: BoardColumn[] = Array.from({ length: teams }, (_, i) => {
    const slot = i + 1;
    const rosterId = draft.slot_to_roster_id?.[String(slot)] ?? null;
    const m = rosterId !== null ? managerFor(ctx, rosterId) : null;
    return { slot, rosterId, manager: m?.name ?? `Slot ${slot}`, teamName: m?.teamName ?? "Order not set" };
  });

  // Startup picks traded before they were made: round + original roster -> current holder.
  const heldBy = new Map<string, number>();
  for (const t of tradedPicks) heldBy.set(`${t.round}:${t.roster_id}`, t.owner_id);

  const picks = new Map<number, DraftPickFact>();
  for (const p of facts?.picks ?? []) if (p.pickNo >= 1 && p.pickNo <= total) picks.set(p.pickNo, p);
  const byPick = roastsByPick(roasts, draft.draft_id);
  const latestNo = picks.size ? Math.max(...picks.keys()) : 0;

  const live = stage === "live" || stage === "paused";
  let clockNo: number | null = null;
  if (live) {
    const next = facts?.onTheClock?.pickNo ?? latestNo + 1;
    clockNo = next >= 1 && next <= total && !picks.has(next) ? next : null;
  }

  const reversalRound = draft.type === "snake" ? (draft.settings.reversal_round ?? 0) : 0;
  const list: BoardRound[] = [];
  for (let round = 1; round <= rounds; round++) {
    const cells: BoardCell[] = [];
    for (let k = 1; k <= teams; k++) {
      const pickNo = (round - 1) * teams + k;
      const at = pickAt(shape, pickNo);
      const pick = picks.get(pickNo) ?? null;
      const columnRosterId = at.rosterId;
      const ownerRosterId = pick
        ? pick.team.rosterId
        : columnRosterId !== null
          ? (heldBy.get(`${round}:${columnRosterId}`) ?? columnRosterId)
          : null;
      const ownerName = pick ? pick.team.managerName : ownerRosterId !== null ? managerFor(ctx, ownerRosterId).name : null;
      cells.push({
        pickNo,
        round,
        pickInRound: at.pickInRound,
        slot: at.slot,
        label: at.label,
        columnRosterId,
        ownerRosterId,
        ownerName,
        columnName: columnRosterId !== null ? managerFor(ctx, columnRosterId).name : null,
        traded: columnRosterId !== null && ownerRosterId !== null && ownerRosterId !== columnRosterId,
        state: pick ? "made" : pickNo === clockNo ? "clock" : "future",
        pick,
        roast: byPick.get(pickNo) ?? null,
        latest: pickNo === latestNo,
      });
    }
    list.push({
      round,
      forward: roundRunsForward(shape, round),
      reversal: reversalRound > 0 && round === reversalRound,
      cells,
      made: cells.filter((c) => c.state === "made").length,
    });
  }

  const flat = list.flatMap((r) => r.cells);
  const clock = flat.find((c) => c.state === "clock") ?? null;
  const latest = flat.find((c) => c.latest) ?? null;
  return {
    draftId: draft.draft_id,
    type: draft.type,
    status: draft.status,
    rounds,
    teams,
    total,
    made: picks.size,
    columns,
    roundRows: list,
    clock,
    latest,
    currentRound: clock?.round ?? latest?.round ?? 1,
    reversalRound,
    orderSet: Boolean(draft.slot_to_roster_id && Object.keys(draft.slot_to_roster_id).length),
  };
}

/** Every pick a roster made or holds, in pick order. */
export function picksFor(board: BoardModel, rosterId: number): BoardCell[] {
  return board.roundRows.flatMap((r) => r.cells).filter((c) => c.ownerRosterId === rosterId);
}

/** "Snake, round 3 flip" / "Linear". */
export function orderName(board: Pick<BoardModel, "type" | "reversalRound">): string {
  if (board.type !== "snake") return board.type === "linear" ? "Linear" : board.type;
  return board.reversalRound > 0 ? `Snake, round ${board.reversalRound} flip` : "Snake";
}

/** First and last name for the two-line cell ("Marvin" / "Harrison Jr."). */
export function splitName(name: string): { first: string; last: string } {
  const i = name.indexOf(" ");
  return i < 0 ? { first: "", last: name } : { first: name.slice(0, i), last: name.slice(i + 1) };
}
