/**
 * Live win probability per matchup.
 *
 *   starter mean     = actual so far + projection x fraction of his NFL game remaining
 *   starter variance = (VARIANCE_COEF x projection)^2 x fraction remaining
 *   P(home wins)     = Phi((mean_home - mean_away) / sqrt(var_home + var_away))
 *
 * When every starter's game is final the result is exactly 1, 0 (or 0.5 on a tie) from
 * Sleeper's scores; "final" comes from each starter's game status, never from the clock, and
 * a game in overtime keeps OT_FRACTION of variance. Before kickoff it is projections only.
 *
 * `buildWinProbWeek` is pure (all data passed in) so it is unit tested with synthetic clocks;
 * `loadWinProbabilities` does the IO.
 */
import { playerInfo } from "@/lib/sleeper";
import { optimalLineup } from "@/lib/scoring";
import { teamRef } from "@/lib/league";
import type {
  LeagueContext,
  NflGameClock,
  PlayerGameStatus,
  PlayerId,
  PlayersMap,
  SleeperMatchup,
  StarterLine,
  TeamWinProb,
  WinProb,
  WinProbWeek,
} from "@/lib/types";
import { LIVE_PROB_FLOOR, OT_FRACTION, OUT_STATUSES, VARIANCE_COEF } from "./constants";
import {
  type ProjectionRow,
  clocksForWeek,
  loadMatchupsByWeek,
  pairMatchups,
  range,
  safeMatchups,
  safePlayers,
  safeSchedule,
  scoredProjections,
  seasonFrame,
  strengthRosters,
  teamPoints,
  uncoveredSlotAverages,
} from "./data";
import { normalCdf, round } from "./math";

/** How to treat games when no ESPN clock is available. */
export type WeekTiming = "past" | "current" | "future";

export interface WinProbInput {
  ctx: LeagueContext;
  week: number;
  matchups: SleeperMatchup[];
  players: PlayersMap;
  projections: Map<PlayerId, ProjectionRow>;
  /** ESPN clocks for the week; null when unavailable. */
  clocks: NflGameClock[] | null;
  /** Fallback when clocks are null: past = all final, future = all not started, current = schedule status. */
  timing: WeekTiming;
  /** Sleeper schedule status per team for the week ("pre_game" | "in_game" | "complete"), used when clocks are null. */
  scheduleStatus?: Map<string, string>;
  /** Projection for positions Sleeper does not project (K, DEF): league average at the slot. */
  fallbacks?: Map<string, number>;
  /** Ignore clocks and actual points: the pre-game view. */
  pregame?: boolean;
  /** Only for the league's current week: injury statuses from the players map are trusted. */
  useInjuries?: boolean;
  /** Players to build a projected lineup from when a team has no starters set (future weeks). */
  rosterFallback?: Map<number, PlayerId[]>;
  now?: number;
}

interface ClockInfo {
  fraction: number;
  state: "pre" | "in" | "post";
}

function clockMap(clocks: NflGameClock[]): Map<string, ClockInfo> {
  const out = new Map<string, ClockInfo>();
  for (const g of clocks) {
    const info = { fraction: g.fractionRemaining, state: g.state };
    out.set(g.home, info);
    out.set(g.away, info);
  }
  return out;
}

function scheduleClock(status: string | undefined): ClockInfo | null {
  if (!status) return null;
  if (status === "complete") return { fraction: 0, state: "post" };
  if (status === "in_game") return { fraction: 0.5, state: "in" };
  return { fraction: 1, state: "pre" };
}

interface TeamCalc {
  tw: Omit<TeamWinProb, "winProb">;
  variance: number;
  allFinal: boolean;
  anyStarted: boolean;
}

function starterLines(input: WinProbInput, m: SleeperMatchup): StarterLine[] {
  const { ctx, players, projections, fallbacks } = input;
  const clocks = input.pregame || !input.clocks ? null : clockMap(input.clocks);
  let starters = m.starters;
  const unset = !starters.length || starters.every((s) => !s || s === "0");
  if (unset) {
    // No lineup set yet (future week): use the best projected lineup from the roster.
    const pool = m.players.length ? m.players : (input.rosterFallback?.get(m.roster_id) ?? []);
    const candidates = pool.map((id) => {
      const info = players[id];
      const row = projections.get(id);
      const pos = info?.pos || row?.position || "";
      return {
        playerId: id,
        positions: info?.positions?.length ? info.positions : pos ? [pos] : [],
        points: row ? row.points : (fallbacks?.get(pos) ?? 0),
      };
    });
    starters = optimalLineup(ctx.starterSlots, candidates).slots.map((s) => s.playerId ?? "0");
  }

  return ctx.starterSlots.map((slot, i): StarterLine => {
    const playerId = starters[i] ?? "0";
    if (!playerId || playerId === "0") {
      return { playerId: "0", name: "Empty", position: "", slot, nflTeam: null, actual: 0, projected: 0, fractionRemaining: 0, expected: 0, status: "empty" };
    }
    const row = projections.get(playerId);
    const info = playerInfo(players, playerId, { position: row?.position ?? null, team: row?.team ?? null });
    const position = info.pos || row?.position || "";
    const nflTeam = row?.team ?? info.team ?? null;
    const actual = input.pregame ? 0 : round(m.starters_points[i] ?? m.players_points[playerId] ?? 0);
    let projected = row ? row.points : (fallbacks?.get(position) ?? 0);

    let fraction: number;
    let status: PlayerGameStatus;
    if (input.pregame) {
      fraction = 1;
      status = "pre";
    } else {
      let clock: ClockInfo | null;
      if (clocks) {
        clock = nflTeam ? (clocks.get(nflTeam) ?? null) : null;
      } else if (input.timing === "past") {
        clock = { fraction: 0, state: "post" };
      } else if (input.timing === "future") {
        clock = { fraction: 1, state: "pre" };
      } else {
        clock = scheduleClock(nflTeam ? input.scheduleStatus?.get(nflTeam) : undefined) ?? { fraction: 1, state: "pre" };
      }
      if (!clock) {
        // No game this week for his team (bye), or no team at all. A scorer is never on bye.
        fraction = 0;
        status = actual !== 0 ? "final" : nflTeam ? "bye" : "out";
      } else {
        // A game still "in" with no regulation clock left is in overtime (or about to be):
        // keep some time on it so the result is not called early.
        fraction = clock.state === "in" && clock.fraction <= 0 ? OT_FRACTION : clock.fraction;
        status = clock.state === "post" ? "final" : clock.state === "in" ? "live" : "pre";
      }
    }
    const injured = input.useInjuries && info.injury_status && OUT_STATUSES.has(info.injury_status);
    if (injured && status !== "final" && status !== "live") {
      status = "out";
      projected = 0;
    }
    if (status === "bye" || status === "out") projected = 0;
    projected = round(projected);
    return {
      playerId,
      name: info.name,
      position,
      slot,
      nflTeam,
      actual,
      projected,
      fractionRemaining: round(fraction, 4),
      expected: round(actual + projected * fraction),
      status,
    };
  });
}

/** Starter statuses that can add no more points. */
const FINAL_STATUSES = new Set<PlayerGameStatus>(["final", "bye", "out", "empty"]);

function teamCalc(input: WinProbInput, m: SleeperMatchup): TeamCalc {
  const starters = starterLines(input, m);
  let remaining = 0;
  let variance = 0;
  let projected = 0;
  for (const s of starters) {
    projected += s.projected;
    remaining += s.projected * s.fractionRemaining;
    variance += (VARIANCE_COEF * s.projected) ** 2 * s.fractionRemaining;
  }
  const actual = input.pregame ? 0 : round(teamPoints(m));
  return {
    tw: {
      team: teamRef(input.ctx, m.roster_id),
      actual,
      projected: round(projected),
      mean: round(actual + remaining),
      sd: round(Math.sqrt(variance)),
      starters,
    },
    variance,
    // Final from each starter's game status, never from the clock: a game in overtime has no
    // regulation clock left but is still live.
    allFinal: !input.pregame && starters.every((s) => FINAL_STATUSES.has(s.status)),
    anyStarted: !input.pregame && starters.some((s) => s.status === "live" || s.status === "final"),
  };
}

/**
 * P(home wins). Exactly 1 / 0 / 0.5 only when final; until then it stays inside
 * [LIVE_PROB_FLOOR, 1 - LIVE_PROB_FLOOR], even if no variance is left (a live starter
 * projected for 0 can still score).
 */
export function winProbability(
  home: { actual: number; mean: number },
  away: { actual: number; mean: number },
  homeVar: number,
  awayVar: number,
  isFinal: boolean,
): number {
  if (isFinal) return home.actual > away.actual ? 1 : home.actual < away.actual ? 0 : 0.5;
  const total = homeVar + awayVar;
  const diff = home.mean - away.mean;
  const p = total > 0 ? round(normalCdf(diff / Math.sqrt(total)), 4) : diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return Math.min(1 - LIVE_PROB_FLOOR, Math.max(LIVE_PROB_FLOOR, p));
}

export function buildWinProbWeek(input: WinProbInput): WinProbWeek {
  const out: WinProb[] = [];
  let allFinal = true;
  let anyStarted = false;
  for (const { matchupId, a, b } of pairMatchups(input.matchups)) {
    const h = teamCalc(input, a);
    const w = teamCalc(input, b);
    const isFinal = h.allFinal && w.allFinal;
    const p = winProbability(h.tw, w.tw, h.variance, w.variance, isFinal);
    allFinal &&= isFinal;
    anyStarted ||= h.anyStarted || w.anyStarted;
    out.push({
      week: input.week,
      matchupId,
      home: { ...h.tw, winProb: p },
      away: { ...w.tw, winProb: round(1 - p, 4) },
      isFinal,
    });
  }
  const basis: WinProbWeek["basis"] = !out.length
    ? "none"
    : input.pregame
      ? "projections"
      : allFinal
        ? "final"
        : anyStarted
          ? "live"
          : "projections";
  return { week: input.week, season: input.ctx.season, generatedAt: input.now ?? Date.now(), basis, matchups: out, placeholder: false };
}

export interface WinProbOptions {
  /** Pre-game view: projections only, ignoring clocks and points already scored. */
  pregame?: boolean;
}

function weekTiming(ctx: LeagueContext, week: number): WeekTiming {
  if (ctx.phase === "complete") return "past";
  const s = Number(ctx.state.season);
  const season = Number(ctx.season);
  if (season < s) return "past";
  if (season > s) return "future";
  if (ctx.state.season_type === "post" || ctx.state.season_type === "off") return "past";
  if (week < ctx.state.week) return "past";
  if (week > ctx.state.week) return "future";
  return "current";
}

export async function loadWinProbabilities(week: number, ctx: LeagueContext, opts: WinProbOptions = {}): Promise<WinProbWeek> {
  const matchups = await safeMatchups(ctx, week);
  if (!pairMatchups(matchups).length) {
    return { week, season: ctx.season, generatedAt: Date.now(), basis: "none", matchups: [], placeholder: false };
  }
  const frame = seasonFrame(ctx);
  const timing = weekTiming(ctx, week);
  const needsFallback = ctx.starterSlots.some((s) => s === "K" || s === "DEF");
  const priorWeeks = needsFallback ? range(frame.startWeek, week - 1) : [];
  const unsetLineups = matchups.some((m) => !m.starters.length || m.starters.every((s) => !s || s === "0"));

  const [players, projections, clocks, prior, rosterFallback] = await Promise.all([
    safePlayers(),
    scoredProjections(ctx, week),
    opts.pregame ? Promise.resolve(null) : clocksForWeek(ctx, week),
    loadMatchupsByWeek(ctx, priorWeeks),
    unsetLineups ? strengthRosters(ctx, week) : Promise.resolve(undefined),
  ]);

  let scheduleStatus: Map<string, string> | undefined;
  if (!clocks && timing === "current" && !opts.pregame) {
    const schedule = await safeSchedule(ctx);
    scheduleStatus = new Map();
    for (const g of schedule?.filter((x) => x.week === week) ?? []) {
      scheduleStatus.set(g.home, g.status);
      scheduleStatus.set(g.away, g.status);
    }
  }

  return buildWinProbWeek({
    ctx,
    week,
    matchups,
    players,
    projections,
    clocks,
    timing,
    scheduleStatus,
    fallbacks: uncoveredSlotAverages(ctx, prior, priorWeeks),
    pregame: opts.pregame,
    useInjuries: timing === "current",
    rosterFallback,
  });
}
