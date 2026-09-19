/**
 * Draft facts: every pick with FantasyCalc reach/steal, position runs, who is on the clock,
 * when picks resume while the draft is paused (config/draft.ts, never Sleeper's autopause
 * window) and grades once complete. There is no time on the clock: the tick only knows when it
 * first noticed a pick, not when the pick was made.
 *
 * Reach = expected pick - pickNo: positive = taken earlier than FantasyCalc says (a reach),
 * negative = the player fell (a steal). (The lib/types.ts comment writes the formula the other
 * way round; the sign convention "positive = reach" from the spec is what we follow.)
 * For a startup draft (player_type 0) the expected pick is
 * the FantasyCalc overall rank. For a rookie-only draft (player_type 1) it is the player's
 * rank by FantasyCalc value within that rookie class, since overall ranks would make every
 * rookie pick look like a steal.
 */
import { DRAFT_RESUMES_LABEL } from "@/config/draft";
import { teamRef } from "@/lib/league";
import * as store from "@/lib/store";
import type {
  DraftFacts,
  DraftGrade,
  DraftPickFact,
  FantasyCalcSnapshot,
  LeagueContext,
  PlayersMap,
  RosterId,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTradedPick,
} from "@/lib/types";
import { getDraftPicks, getDraftTradedPicks } from "@/lib/sleeper";
import type { FactsLoader } from "./load";
import { draftGrade, playerAsset } from "./util";

/** Minimum run length reported in DraftFacts.positionRuns. */
export const MIN_POSITION_RUN = 3;

/** A pick is a reach/steal when |reach| >= max(REACH_MIN, pickNo x REACH_SHARE). */
export const REACH_MIN = 3;
export const REACH_SHARE = 0.2;

export function reachThreshold(pickNo: number): number {
  return Math.max(REACH_MIN, Math.round(pickNo * REACH_SHARE));
}

export function verdictFor(pickNo: number, reach: number | null): DraftPickFact["verdict"] {
  if (reach === null) return "unranked";
  const t = reachThreshold(pickNo);
  if (reach >= t) return "reach";
  if (reach <= -t) return "steal";
  return "fair";
}

/**
 * Draft slot (1-based column) that owns overall pick `pickNo`.
 * Snake drafts alternate direction each round; with a reversal round R (3RR = 3), rounds
 * R and later flip parity, so round R repeats round R-1's direction.
 */
export function slotForPick(pickNo: number, teams: number, type: string, reversalRound = 0): { round: number; pickInRound: number; slot: number } {
  const round = Math.floor((pickNo - 1) / teams) + 1;
  const pickInRound = ((pickNo - 1) % teams) + 1;
  if (type !== "snake") return { round, pickInRound, slot: pickInRound };
  let reverse = round % 2 === 0;
  if (reversalRound > 0 && round >= reversalRound) reverse = !reverse;
  return { round, pickInRound, slot: reverse ? teams - pickInRound + 1 : pickInRound };
}

/** Roster that makes pick `pickNo`, following slot_to_roster_id and draft pick trades. */
export function rosterForPick(draft: SleeperDraft, pickNo: number, traded: SleeperTradedPick[]): RosterId | null {
  const teams = draft.settings.teams || Object.keys(draft.slot_to_roster_id ?? {}).length;
  if (!teams || !draft.slot_to_roster_id) return null;
  const { round, slot } = slotForPick(pickNo, teams, draft.type, draft.settings.reversal_round ?? 0);
  const original = draft.slot_to_roster_id[String(slot)];
  if (original === undefined) return null;
  const trade = traded.find((t) => t.round === round && t.roster_id === original && String(t.season) === String(draft.season));
  return trade ? trade.owner_id : original;
}

/** Lengths of same-position runs: runLength[i] = length of the run containing pick i. */
export function positionRunLengths(positions: string[]): number[] {
  const out = new Array<number>(positions.length).fill(1);
  let start = 0;
  for (let i = 1; i <= positions.length; i++) {
    if (i < positions.length && positions[i] === positions[start]) continue;
    for (let j = start; j < i; j++) out[j] = i - start;
    start = i;
  }
  return out;
}

export function positionRuns(picks: Array<{ pickNo: number; position: string }>): DraftFacts["positionRuns"] {
  const lengths = positionRunLengths(picks.map((p) => p.position));
  const runs: DraftFacts["positionRuns"] = [];
  for (let i = 0; i < picks.length; i++) {
    if (lengths[i] >= MIN_POSITION_RUN && (i === 0 || picks[i - 1].position !== picks[i].position)) {
      runs.push({ position: picks[i].position, startPick: picks[i].pickNo, length: lengths[i] });
    }
  }
  return runs;
}

/**
 * First-seen timestamps the tick records (lib/jobs/draft-seen.ts), stored under
 * keys.snapshot(leagueId, "draft-pick-seen") as { [draftId]: { [pickNo]: epochMs } }.
 * A flat { [pickNo]: epochMs } map (or {pickedAt} objects) is accepted too.
 */
export function parsePickSeen(raw: unknown, draftId?: string): Map<number, number> {
  const out = new Map<number, number>();
  if (!raw || typeof raw !== "object") return out;
  let src = raw as Record<string, unknown>;
  if (draftId !== undefined && src[draftId] && typeof src[draftId] === "object") src = src[draftId] as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    const n = Number(k);
    const t =
      typeof v === "number"
        ? v
        : v && typeof v === "object"
          ? Number((v as Record<string, unknown>).pickedAt ?? (v as Record<string, unknown>).seenAt ?? NaN)
          : NaN;
    if (Number.isInteger(n) && Number.isFinite(t)) out.set(n, t);
  }
  return out;
}

/**
 * When picks resume, for a draft in this state: the commissioner's time (config/draft.ts) while
 * the draft is paused, otherwise nothing. Never Sleeper's autopause window.
 */
export function resumesAtFor(status: SleeperDraft["status"]): string | null {
  return status === "paused" ? DRAFT_RESUMES_LABEL : null;
}

export interface DraftEnv {
  ctx: LeagueContext;
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
  traded: SleeperTradedPick[];
  players: PlayersMap;
  snap: FantasyCalcSnapshot | null;
  seen: Map<number, number>;
}

/**
 * Expected-pick ranks for a rookie draft: FantasyCalc value rank within the rookie class
 * (players whose experience now equals the years since the draft season).
 */
function rookieRanks(env: DraftEnv): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!env.snap) return ranks;
  const yearsSince = Math.max(0, Number(env.ctx.state.season || env.draft.season) - Number(env.draft.season));
  const drafted = new Set(env.picks.map((p) => p.player_id));
  const pool = Object.values(env.snap.bySleeperId).filter((v) => {
    if (v.position === "PICK") return false;
    const p = env.players[v.sleeperId];
    return drafted.has(v.sleeperId) || (p ? p.years_exp === yearsSince : false);
  });
  pool.sort((a, b) => b.value - a.value || a.overallRank - b.overallRank);
  pool.forEach((v, i) => ranks.set(v.sleeperId, i + 1));
  return ranks;
}

export function buildDraftPicks(env: DraftEnv): DraftPickFact[] {
  const { draft, snap } = env;
  const teams = draft.settings.teams || Object.keys(draft.slot_to_roster_id ?? {}).length || env.ctx.rosters.length;
  const rookieOnly = draft.settings.player_type === 1;
  const rookie = rookieOnly ? rookieRanks(env) : null;
  const picks = [...env.picks].sort((a, b) => a.pick_no - b.pick_no);
  const runLengths = positionRunLengths(picks.map((p) => p.metadata?.position ?? env.players[p.player_id]?.pos ?? ""));
  return picks.map((p, i) => {
    const name = [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(" ") || undefined;
    const player = playerAsset(env.players, p.player_id, snap, {
      name,
      position: p.metadata?.position ?? null,
      team: p.metadata?.team ?? null,
    });
    const fc = snap?.bySleeperId[p.player_id] ?? null;
    const fcRank = rookie ? (rookie.get(p.player_id) ?? null) : (fc?.overallRank ?? null);
    const reach = fcRank === null ? null : fcRank - p.pick_no;
    return {
      kind: "draft_pick",
      draftId: draft.draft_id,
      pickNo: p.pick_no,
      round: p.round,
      pickInRound: ((p.pick_no - 1) % Math.max(1, teams)) + 1,
      team: teamRef(env.ctx, p.roster_id),
      player,
      fcRank,
      fcPositionRank: fc?.positionRank ?? null,
      reach,
      verdict: verdictFor(p.pick_no, reach),
      pickedAt: env.seen.get(p.pick_no) ?? null,
      positionRun: runLengths[i],
    };
  });
}

export function draftGrades(ctx: LeagueContext, picks: DraftPickFact[]): DraftGrade[] {
  const rosterIds = [...new Set([...ctx.rosters.map((r) => r.roster_id), ...picks.map((p) => p.team.rosterId)])];
  const totals = rosterIds.map((rid) => ({
    rid,
    total: picks.filter((p) => p.team.rosterId === rid).reduce((s, p) => s + (p.player.value ?? 0), 0),
  }));
  const mean = totals.reduce((s, t) => s + t.total, 0) / Math.max(1, totals.length);
  const sorted = [...totals].sort((a, b) => b.total - a.total || a.rid - b.rid);
  return sorted.map((t, i) => {
    const own = picks.filter((p) => p.team.rosterId === t.rid && p.reach !== null);
    const best = [...own].sort((a, b) => (a.reach ?? 0) - (b.reach ?? 0) || a.pickNo - b.pickNo)[0] ?? null;
    const worst = [...own].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0) || a.pickNo - b.pickNo)[0] ?? null;
    return {
      team: teamRef(ctx, t.rid),
      grade: draftGrade(t.total, mean),
      totalValue: Math.round(t.total),
      valueRank: i + 1,
      bestPick: best && (best.reach ?? 0) < 0 ? best : null,
      worstPick: worst && (worst.reach ?? 0) > 0 ? worst : null,
    };
  });
}

export async function computeDraftFacts(loader: FactsLoader): Promise<DraftFacts> {
  const ctx = loader.ctx;
  const draft = ctx.draft;
  if (!draft) {
    return {
      draftId: "",
      status: "pre_draft",
      startTime: null,
      rounds: 0,
      teams: ctx.rosters.length,
      picks: [],
      onTheClock: null,
      resumesAt: null,
      positionRuns: [],
      grades: null,
      placeholder: false,
    };
  }
  const [rawPicks, traded, players, snap, seenRaw] = await Promise.all([
    getDraftPicks(draft.draft_id).catch(() => [] as SleeperDraftPick[]),
    getDraftTradedPicks(draft.draft_id).catch(() => [] as SleeperTradedPick[]),
    loader.players(),
    loader.fantasyCalc(),
    store.get<unknown>(store.keys.snapshot(ctx.leagueId, "draft-pick-seen")).catch(() => null),
  ]);
  const env: DraftEnv = { ctx, draft, picks: rawPicks, traded, players, snap, seen: parsePickSeen(seenRaw, draft.draft_id) };
  const picks = buildDraftPicks(env);
  const teams = draft.settings.teams || ctx.rosters.length;
  const totalPicks = (draft.settings.rounds || 0) * teams;
  const live = draft.status === "drafting" || draft.status === "paused";
  let onTheClock: DraftFacts["onTheClock"] = null;
  const next = picks.length + 1;
  if (live && next <= totalPicks) {
    const rid = rosterForPick(draft, next, traded);
    const { round } = slotForPick(next, teams, draft.type, draft.settings.reversal_round ?? 0);
    if (rid !== null) onTheClock = { pickNo: next, round, team: teamRef(ctx, rid) };
  }
  return {
    draftId: draft.draft_id,
    status: draft.status,
    startTime: draft.start_time,
    rounds: draft.settings.rounds,
    teams,
    picks,
    onTheClock,
    resumesAt: resumesAtFor(draft.status),
    positionRuns: positionRuns(picks.map((p) => ({ pickNo: p.pickNo, position: p.player.position }))),
    grades: draft.status === "complete" && picks.length ? draftGrades(ctx, picks) : null,
    placeholder: false,
  };
}
