/**
 * Data loading for the models: season frame, completed weeks, records from matchups,
 * league-scored projections, projected lineup strength. Everything here is defensive:
 * a missing week, a failed undocumented endpoint or an empty roster degrades to empty data,
 * never a crash.
 */
import { getGameClocks } from "@/lib/espn";
import { playoffRounds } from "@/lib/league";
import { SLOT_ELIGIBILITY, optimalLineup, pointsFromStats } from "@/lib/scoring";
import {
  PROJECTION_POSITIONS,
  byeTeams,
  getDraftPicks,
  getMatchups,
  getPlayers,
  getSchedule,
  getTradedPicks,
  getWeekProjections,
  getWinnersBracket,
} from "@/lib/sleeper";
import type { LeagueContext, NflGame, NflGameClock, PlayerId, PlayersMap, RosterId, SleeperMatchup } from "@/lib/types";
import { mean } from "./math";

/* ------------------------------------------------------------------ */
/* season frame                                                        */
/* ------------------------------------------------------------------ */

export interface SeasonFrame {
  startWeek: number;
  lastRegularSeasonWeek: number;
  playoffWeekStart: number;
  lastWeek: number;
  playoffTeams: number;
  /** playoff_seed_type 1 = reseed every round; anything else = fixed bracket. */
  reseed: boolean;
  /** Weeks per playoff round (playoff_round_type 0 = 1). */
  weeksPerRound: number;
}

export function seasonFrame(ctx: LeagueContext): SeasonFrame {
  const s = ctx.league.settings;
  let startWeek = s.start_week && s.start_week >= 1 ? s.start_week : 1;
  if (!s.start_week) {
    // Sleeper only sets start_week once the league is scheduled. Before that, a league that is
    // still drafting mid-season can start no earlier than next week.
    const sameSeason = ctx.state.season === ctx.season && ctx.state.season_type === "regular";
    if ((ctx.phase === "pre_draft" || ctx.phase === "drafting") && sameSeason && ctx.state.week >= 1) {
      startWeek = ctx.state.week + 1;
    }
  }
  const lastRegularSeasonWeek = ctx.lastRegularSeasonWeek;
  return {
    startWeek: Math.min(startWeek, lastRegularSeasonWeek),
    lastRegularSeasonWeek,
    playoffWeekStart: ctx.playoffWeekStart,
    lastWeek: ctx.lastWeek,
    playoffTeams: Math.min(s.playoff_teams ?? 6, ctx.rosters.length),
    reseed: s.playoff_seed_type === 1,
    weeksPerRound: s.playoff_round_type === 0 || s.playoff_round_type === undefined ? 1 : 2,
  };
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let w = from; w <= to; w++) out.push(w);
  return out;
}

/* ------------------------------------------------------------------ */
/* matchups and records                                                */
/* ------------------------------------------------------------------ */

export async function safeMatchups(ctx: LeagueContext, week: number): Promise<SleeperMatchup[]> {
  if (week < 1) return [];
  try {
    return await getMatchups(ctx.leagueId, week);
  } catch {
    return [];
  }
}

export async function loadMatchupsByWeek(ctx: LeagueContext, weeks: number[]): Promise<Map<number, SleeperMatchup[]>> {
  const rows = await Promise.all(weeks.map(async (w) => [w, await safeMatchups(ctx, w)] as const));
  return new Map(rows);
}

/** Sleeper's authoritative team score (a commissioner override wins). */
export const teamPoints = (m: SleeperMatchup): number => m.custom_points ?? m.points;

export interface Pairing {
  matchupId: number;
  /** Lower roster id. */
  a: SleeperMatchup;
  b: SleeperMatchup;
}

/** Head-to-head pairs of a week, by matchup id. Matchup ids with other than two teams are skipped. */
export function pairMatchups(ms: SleeperMatchup[]): Pairing[] {
  const byId = new Map<number, SleeperMatchup[]>();
  for (const m of ms) {
    if (m.matchup_id === null || m.matchup_id === undefined) continue;
    const list = byId.get(m.matchup_id) ?? [];
    list.push(m);
    byId.set(m.matchup_id, list);
  }
  const out: Pairing[] = [];
  for (const [matchupId, list] of byId) {
    if (list.length !== 2) continue;
    const [a, b] = [...list].sort((x, y) => x.roster_id - y.roster_id);
    out.push({ matchupId, a, b });
  }
  return out.sort((x, y) => x.matchupId - y.matchupId);
}

/** A week counts as played when its matchups carry any points. */
export function weekHasScores(ms: SleeperMatchup[] | undefined): boolean {
  return Boolean(ms?.some((m) => m.matchup_id !== null && teamPoints(m) !== 0));
}

export interface TeamRecord {
  rosterId: RosterId;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Weekly scores in played weeks, in week order. */
  scores: number[];
}

/** Regular-season records from matchups over `weeks` (head to head, ties half). */
export function recordsFromMatchups(
  rosterIds: RosterId[],
  byWeek: Map<number, SleeperMatchup[]>,
  weeks: number[],
): Map<RosterId, TeamRecord> {
  const recs = new Map<RosterId, TeamRecord>(
    rosterIds.map((id) => [id, { rosterId: id, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, scores: [] }]),
  );
  for (const w of weeks) {
    for (const { a, b } of pairMatchups(byWeek.get(w) ?? [])) {
      const ra = recs.get(a.roster_id);
      const rb = recs.get(b.roster_id);
      if (!ra || !rb) continue;
      const pa = teamPoints(a);
      const pb = teamPoints(b);
      ra.scores.push(pa);
      rb.scores.push(pb);
      ra.pointsFor += pa;
      rb.pointsFor += pb;
      ra.pointsAgainst += pb;
      rb.pointsAgainst += pa;
      if (pa > pb) {
        ra.wins++;
        rb.losses++;
      } else if (pb > pa) {
        rb.wins++;
        ra.losses++;
      } else {
        ra.ties++;
        rb.ties++;
      }
    }
  }
  for (const r of recs.values()) {
    r.pointsFor = Math.round(r.pointsFor * 100) / 100;
    r.pointsAgainst = Math.round(r.pointsAgainst * 100) / 100;
  }
  return recs;
}

/** Deterministic round-robin (circle method) for weeks Sleeper has not scheduled yet. */
export function roundRobinPairs(rosterIds: RosterId[], round: number): Array<[RosterId, RosterId]> {
  const ids: number[] = [...rosterIds].sort((x, y) => x - y);
  if (ids.length % 2) ids.push(-1);
  const n = ids.length;
  if (n < 2) return [];
  const r = ((round % (n - 1)) + (n - 1)) % (n - 1);
  // Rotate everyone but the first.
  const rest = ids.slice(1);
  const rotated = [ids[0], ...rest.slice(rest.length - r), ...rest.slice(0, rest.length - r)];
  const out: Array<[RosterId, RosterId]> = [];
  for (let i = 0; i < n / 2; i++) {
    const x = rotated[i];
    const y = rotated[n - 1 - i];
    if (x < 0 || y < 0) continue;
    out.push(x < y ? [x, y] : [y, x]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* game clocks and completed weeks                                     */
/* ------------------------------------------------------------------ */

/** ESPN clocks for a league week; null when ESPN is unavailable. */
export async function clocksForWeek(ctx: LeagueContext, week: number): Promise<NflGameClock[] | null> {
  const isCurrent = ctx.state.season === ctx.season && ctx.state.season_type === "regular" && ctx.state.week === week;
  try {
    if (isCurrent) {
      const live = await getGameClocks();
      if (live.length && live.every((g) => g.week === null || g.week === week)) return live;
    }
    const clocks = await getGameClocks({ season: ctx.season, week });
    return clocks.length ? clocks : null;
  } catch {
    return null;
  }
}

export async function safeSchedule(ctx: LeagueContext): Promise<NflGame[] | null> {
  try {
    const s = await getSchedule(ctx.season);
    return s.length ? s : null;
  } catch {
    return null;
  }
}

/** true when every NFL game of the week is final (ESPN first, Sleeper schedule second). */
export async function weekIsFinal(ctx: LeagueContext, week: number): Promise<boolean> {
  const clocks = await clocksForWeek(ctx, week);
  if (clocks) return clocks.every((g) => g.state === "post");
  const schedule = await safeSchedule(ctx);
  const games = schedule?.filter((g) => g.week === week) ?? [];
  return games.length > 0 && games.every((g) => g.status === "complete");
}

/**
 * Last league week whose games are all final (0 when nothing has been played).
 * Complete leagues return the last playoff week.
 */
export async function completedThrough(ctx: LeagueContext): Promise<number> {
  if (ctx.phase === "complete") return ctx.lastWeek;
  if (ctx.phase === "pre_draft" || ctx.phase === "drafting") return 0;
  if (ctx.phase === "offseason") {
    const after =
      Number(ctx.state.season) > Number(ctx.season) ||
      (ctx.state.season === ctx.season && (ctx.state.season_type === "post" || ctx.state.week > ctx.lastWeek));
    return after ? ctx.lastWeek : 0;
  }
  const w = ctx.week;
  if (w < 1) return 0;
  return (await weekIsFinal(ctx, w)) ? w : w - 1;
}

/* ------------------------------------------------------------------ */
/* projections                                                         */
/* ------------------------------------------------------------------ */

export interface ProjectionRow {
  points: number;
  team: string | null;
  position: string | null;
}

/** Sleeper projection stat lines scored with this league's scoring_settings. Empty on failure. */
export async function scoredProjections(ctx: LeagueContext, week: number): Promise<Map<PlayerId, ProjectionRow>> {
  const out = new Map<PlayerId, ProjectionRow>();
  if (week < 1) return out;
  let rows;
  try {
    rows = await getWeekProjections(ctx.season, week);
  } catch {
    return out;
  }
  for (const [id, row] of Object.entries(rows)) {
    out.set(id, { points: pointsFromStats(row.stats, ctx.scoring, row.position), team: row.team, position: row.position });
  }
  return out;
}

export async function safePlayers(): Promise<PlayersMap> {
  try {
    return await getPlayers();
  } catch {
    return {};
  }
}

/**
 * Average starter points per position for slots projections do not cover (K, DEF), from the
 * league's own matchups in `weeks`. Used as the projection for those players.
 */
export function uncoveredSlotAverages(
  ctx: LeagueContext,
  byWeek: Map<number, SleeperMatchup[]>,
  weeks: number[],
): Map<string, number> {
  const covered = new Set<string>(PROJECTION_POSITIONS);
  const pts = new Map<string, number[]>();
  ctx.starterSlots.forEach((slot, i) => {
    const eligible = SLOT_ELIGIBILITY[slot];
    if (!eligible || eligible.length !== 1 || covered.has(eligible[0])) return;
    const list = pts.get(eligible[0]) ?? [];
    for (const w of weeks) {
      for (const m of byWeek.get(w) ?? []) {
        if (m.matchup_id === null || !m.starters[i] || m.starters[i] === "0") continue;
        const p = m.starters_points[i];
        if (typeof p === "number") list.push(p);
      }
    }
    pts.set(eligible[0], list);
  });
  const out = new Map<string, number>();
  for (const [pos, list] of pts) if (list.length) out.set(pos, mean(list));
  return out;
}

/* ------------------------------------------------------------------ */
/* projected lineup strength                                           */
/* ------------------------------------------------------------------ */

/**
 * Players each roster can start, for projected strength:
 *   1. the rosters Sleeper recorded in that week's matchups (historical weeks, backtests),
 *   2. else current rosters minus IR and taxi,
 *   3. else, during a startup draft, the players picked so far.
 */
export async function strengthRosters(
  ctx: LeagueContext,
  week: number,
  byWeek?: Map<number, SleeperMatchup[]>,
): Promise<Map<RosterId, PlayerId[]>> {
  const ms = byWeek?.get(week) ?? (await safeMatchups(ctx, week));
  const withPlayers = ms.filter((m) => m.players.length > 0);
  if (withPlayers.length >= Math.max(1, Math.ceil(ctx.rosters.length / 2))) {
    return new Map(ctx.rosters.map((r) => [r.roster_id, ms.find((m) => m.roster_id === r.roster_id)?.players ?? []]));
  }
  const current = new Map(
    ctx.rosters.map((r) => {
      const benched = new Set([...r.reserve, ...r.taxi]);
      return [r.roster_id, r.players.filter((p) => !benched.has(p))];
    }),
  );
  const anyone = [...current.values()].some((ps) => ps.length > 0);
  if (anyone || !ctx.draft) return current;
  try {
    const picks = await getDraftPicks(ctx.draft.draft_id);
    const fromDraft = new Map<RosterId, PlayerId[]>(ctx.rosters.map((r) => [r.roster_id, []]));
    for (const p of picks) {
      if (!p.player_id) continue;
      fromDraft.get(p.roster_id)?.push(p.player_id);
    }
    return fromDraft;
  } catch {
    return current;
  }
}

/** Two projection weeks starting at `week`, clamped to the regular season. */
export function projectionWeeks(frame: SeasonFrame, week: number): number[] {
  const w1 = Math.min(Math.max(week, frame.startWeek), frame.lastRegularSeasonWeek);
  const w2 = w1 < frame.lastRegularSeasonWeek ? w1 + 1 : w1 - 1;
  return w2 >= frame.startWeek && w2 !== w1 ? [w1, w2] : [w1];
}

export interface PlayerRate {
  points: number;
  position: string | null;
}

/**
 * Per-player weekly projection rate: his projection in the first of `weeks` in which his NFL
 * team plays, so a bye does not zero out a starter for the whole season while later weeks
 * (and any news they carry) are only used to cover a bye.
 */
export async function playerRates(
  ctx: LeagueContext,
  weeks: number[],
  schedule: NflGame[] | null,
): Promise<Map<PlayerId, PlayerRate>> {
  const tables = await Promise.all(weeks.map((w) => scoredProjections(ctx, w)));
  const out = new Map<PlayerId, PlayerRate>();
  tables.forEach((table, k) => {
    const byes = new Set(schedule ? byeTeams(schedule, weeks[k]) : []);
    for (const [id, row] of table) {
      if (out.has(id) || (row.team && byes.has(row.team))) continue;
      out.set(id, { points: row.points, position: row.position });
    }
  });
  return out;
}

/** Projected optimal-lineup points for one roster. */
export function lineupStrength(
  ctx: LeagueContext,
  playerIds: PlayerId[],
  rates: Map<PlayerId, PlayerRate>,
  players: PlayersMap,
  fallbacks: Map<string, number>,
): number {
  const candidates = playerIds.map((id) => {
    const info = players[id];
    const rate = rates.get(id);
    const position = info?.pos || rate?.position || "";
    const positions = info?.positions?.length ? info.positions : position ? [position] : [];
    const points = rate ? rate.points : (fallbacks.get(position) ?? 0);
    return { playerId: id, positions, points };
  });
  return optimalLineup(ctx.starterSlots, candidates).total;
}

/* ------------------------------------------------------------------ */
/* playoffs and picks                                                  */
/* ------------------------------------------------------------------ */

/**
 * Winners-bracket results already decided by `throughWeek`, per round index (0-based):
 * "lowId-highId" -> winner roster id. Place games (5th, 3rd) are included but never collide
 * with title-path pairs in the same round of a real bracket, and the sim only looks up pairs
 * it actually plays.
 */
export async function knownPlayoffResults(
  ctx: LeagueContext,
  frame: SeasonFrame,
  throughWeek: number,
): Promise<Array<Map<string, RosterId>>> {
  const rounds = playoffRounds(frame.playoffTeams);
  const out: Array<Map<string, RosterId>> = Array.from({ length: rounds }, () => new Map());
  if (throughWeek < frame.playoffWeekStart) return out;
  let bracket;
  try {
    bracket = await getWinnersBracket(ctx.leagueId);
  } catch {
    return out;
  }
  for (const m of bracket) {
    if (!m.w || !m.t1 || !m.t2 || m.r < 1 || m.r > rounds) continue;
    if (m.p !== undefined && m.p !== 1) continue; // place games do not affect the title path
    const roundEnds = frame.playoffWeekStart + m.r * frame.weeksPerRound - 1;
    if (roundEnds > throughWeek) continue;
    out[m.r - 1].set(pairKey(m.t1, m.t2), m.w);
  }
  return out;
}

export const pairKey = (x: RosterId, y: RosterId) => (x < y ? `${x}-${y}` : `${y}-${x}`);

/** Next season's first-round pick: original roster -> roster holding it now. */
export async function firstRoundHolders(ctx: LeagueContext): Promise<Map<RosterId, RosterId>> {
  const next = String(Number(ctx.season) + 1);
  const out = new Map<RosterId, RosterId>(ctx.rosters.map((r) => [r.roster_id, r.roster_id]));
  try {
    for (const p of await getTradedPicks(ctx.leagueId)) {
      if (p.season === next && p.round === 1 && out.has(p.roster_id)) out.set(p.roster_id, p.owner_id);
    }
  } catch {
    // no trades known: everyone holds their own pick
  }
  return out;
}
