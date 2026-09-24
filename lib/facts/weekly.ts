/**
 * Weekly facts: scores, margins, optimal lineups, bench points left, the swap that would
 * have flipped a loss, zero-point starters, projected vs actual, all-play, robbed / fraud,
 * streaks and standings as of the week.
 */
import { leagueStartWeek, teamRef } from "@/lib/league";
import { pointsFromStats } from "@/lib/scoring";
import { byeTeams } from "@/lib/sleeper";
import type {
  FantasyCalcSnapshot,
  LeagueContext,
  MatchupFact,
  PlayersMap,
  RosterId,
  SleeperMatchup,
  StandingRow,
  StarterPerformance,
  SwapFact,
  TeamWeekFact,
  WeekStats,
  WeeklyFacts,
  ZeroStarterFact,
} from "@/lib/types";
import { benchPointsLeft, bestSwap, flipSwapFor, starterPointsTotal, teamOptimal, zeroStarterReason, type SwapCandidate, type TeamWeekInput } from "./lineup";
import type { FactsLoader } from "./load";
import { competitionRanks, emptySlotAsset, playerAsset, positionsOf, r2 } from "./util";

/** Robbed = lost with a top-N score; fraud = won with a bottom-N score. */
export const ROBBED_FRAUD_N = 3;

export type WeekResult = "W" | "L" | "T";

export interface TeamResult {
  rosterId: RosterId;
  points: number;
  opponentRosterId: RosterId | null;
  opponentPoints: number | null;
  result: WeekResult | null;
}

/** Final points Sleeper counts for a matchup row (commissioner override wins). */
export function matchupPoints(m: SleeperMatchup): number {
  return r2(m.custom_points ?? m.points);
}

/** Head-to-head results for one week of matchups (pairs by matchup_id). */
export function weekResults(matchups: SleeperMatchup[]): Map<RosterId, TeamResult> {
  const byMatchup = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id === null) continue;
    byMatchup.set(m.matchup_id, [...(byMatchup.get(m.matchup_id) ?? []), m]);
  }
  const out = new Map<RosterId, TeamResult>();
  for (const m of matchups) {
    const group = m.matchup_id === null ? [] : (byMatchup.get(m.matchup_id) ?? []);
    const opp = group.length === 2 ? group.find((x) => x.roster_id !== m.roster_id) : undefined;
    const points = matchupPoints(m);
    if (!opp) {
      out.set(m.roster_id, { rosterId: m.roster_id, points, opponentRosterId: null, opponentPoints: null, result: null });
      continue;
    }
    const oppPoints = matchupPoints(opp);
    const result: WeekResult = points > oppPoints ? "W" : points < oppPoints ? "L" : "T";
    out.set(m.roster_id, { rosterId: m.roster_id, points, opponentRosterId: opp.roster_id, opponentPoints: oppPoints, result });
  }
  return out;
}

/** "3W" style streak from a result sequence (oldest first). "" when empty. */
export function streakOf(results: WeekResult[]): string {
  if (!results.length) return "";
  const last = results[results.length - 1];
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return `${n}${last}`;
}

/** A week counts toward records once any points were scored in it. */
function weekHasScores(ms: SleeperMatchup[]): boolean {
  return ms.some((m) => matchupPoints(m) !== 0);
}

/**
 * Regular-season standings through `week` computed from matchups: wins (ties half), then
 * points for, then points against (fewer ranks higher, the better point differential), then
 * roster id. Weeks with no points yet are skipped.
 */
export async function standingsThrough(week: number, loader: FactsLoader): Promise<StandingRow[]> {
  const ctx = loader.ctx;
  const last = Math.min(week, ctx.lastRegularSeasonWeek);
  const acc = new Map<RosterId, { wins: number; losses: number; ties: number; pf: number; pa: number; results: WeekResult[] }>();
  for (const r of ctx.rosters) acc.set(r.roster_id, { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, results: [] });
  for (let w = leagueStartWeek(ctx.league); w <= last; w++) {
    const ms = await loader.matchups(w);
    if (!weekHasScores(ms)) continue;
    for (const res of weekResults(ms).values()) {
      const a = acc.get(res.rosterId);
      if (!a || res.result === null) continue;
      a.pf += res.points;
      a.pa += res.opponentPoints ?? 0;
      a.results.push(res.result);
      if (res.result === "W") a.wins++;
      else if (res.result === "L") a.losses++;
      else a.ties++;
    }
  }
  const rows = [...acc.entries()].map(([rosterId, a]) => ({
    team: teamRef(ctx, rosterId),
    wins: a.wins,
    losses: a.losses,
    ties: a.ties,
    pointsFor: r2(a.pf),
    pointsAgainst: r2(a.pa),
    streak: streakOf(a.results),
  }));
  rows.sort(
    (a, b) =>
      b.wins + b.ties / 2 - (a.wins + a.ties / 2) ||
      b.pointsFor - a.pointsFor ||
      a.pointsAgainst - b.pointsAgainst ||
      a.team.rosterId - b.team.rosterId,
  );
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

/**
 * Fill StandingRow.previousRank from the standings one week earlier. Stays null when that
 * earlier week had no games yet (there is no "before" to move from).
 */
async function withPreviousRanks(rows: StandingRow[], week: number, loader: FactsLoader): Promise<StandingRow[]> {
  const prev = week >= 2 ? await standingsThrough(week - 1, loader) : [];
  const played = prev.some((r) => r.wins + r.losses + r.ties > 0);
  const byRoster = new Map(prev.map((r) => [r.team.rosterId, r.rank]));
  return rows.map((r) => ({ ...r, previousRank: played ? (byRoster.get(r.team.rosterId) ?? null) : null }));
}

/** Last week whose results are final: Sleeper's last_scored_leg, else the week before the current one. */
export function lastCompletedWeek(ctx: LeagueContext): number {
  const scored = ctx.league.settings.last_scored_leg ?? 0;
  const week = scored > 0 ? Math.min(scored, ctx.lastWeek) : ctx.phase === "complete" ? ctx.lastWeek : Math.max(0, ctx.week - 1);
  // A week before the league's start_week was never played (see dropPreStartWeeks).
  return week >= (ctx.league.settings.start_week ?? 1) ? week : 0;
}

interface WeekEnv {
  week: number;
  players: PlayersMap;
  stats: WeekStats | null;
  projections: WeekStats | null;
  byes: Set<string>;
  /** NFL teams whose game this week is final; "all" for past weeks. */
  finalTeams: Set<string> | "all";
  isCurrentWeek: boolean;
  snap: FantasyCalcSnapshot | null;
}

function teamInput(ctx: LeagueContext, m: SleeperMatchup, players: PlayersMap, stats: WeekStats | null): TeamWeekInput {
  return {
    slots: ctx.starterSlots,
    starters: ctx.starterSlots.map((_, i) => m.starters[i] ?? "0"),
    startersPoints: ctx.starterSlots.map((_, i) => m.starters_points[i] ?? 0),
    players: m.players,
    playersPoints: m.players_points,
    positionsOf: (id) => positionsOf(players, id, stats?.[id]?.position ?? null),
  };
}

function swapFact(ctx: LeagueContext, rosterId: RosterId, c: SwapCandidate, env: WeekEnv): SwapFact {
  const asset = (id: string) =>
    id === "0" ? emptySlotAsset(c.slot) : playerAsset(env.players, id, env.snap, { position: env.stats?.[id]?.position ?? null });
  return {
    team: teamRef(ctx, rosterId),
    benchPlayer: { ...asset(c.benchId), points: c.benchPoints },
    starter: { ...asset(c.starterId), points: c.starterPoints },
    slot: c.slot,
    gain: c.gain,
  };
}

function zeroStarters(ctx: LeagueContext, m: SleeperMatchup, env: WeekEnv): ZeroStarterFact[] {
  const out: ZeroStarterFact[] = [];
  ctx.starterSlots.forEach((slot, i) => {
    const id = m.starters[i] ?? "0";
    const points = id === "0" ? 0 : (m.starters_points[i] ?? m.players_points[id] ?? 0);
    const row = id === "0" ? undefined : env.stats?.[id];
    const info = id === "0" ? null : env.players[id];
    const nflTeam = row?.team ?? info?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : null);
    const played = env.stats ? (row?.stats.gp ?? 0) > 0 || (row !== undefined && points !== 0) : null;
    const gameFinal = env.finalTeams === "all" || (nflTeam !== null && env.finalTeams.has(nflTeam));
    const reason = zeroStarterReason({
      playerId: id,
      points,
      nflTeam,
      byeTeams: env.byes,
      played,
      gameFinal,
      injuryStatus: env.isCurrentWeek ? (info?.injury_status ?? null) : null,
    });
    if (!reason) return;
    const asset = id === "0" ? emptySlotAsset(slot) : playerAsset(env.players, id, null, { position: row?.position ?? null });
    out.push({ team: teamRef(ctx, m.roster_id), playerId: id, name: asset.name, position: asset.position, slot, reason });
  });
  return out;
}

/** One player's projection in league scoring, or null when Sleeper has none. */
function playerProjection(ctx: LeagueContext, id: string, env: WeekEnv): number | null {
  const row = env.projections?.[id];
  if (!row) return null;
  return r2(pointsFromStats(row.stats, ctx.scoring, row.position ?? env.players[id]?.pos ?? null));
}

function performance(ctx: LeagueContext, id: string, points: number, env: WeekEnv): StarterPerformance {
  const asset = playerAsset(env.players, id, null, { position: env.stats?.[id]?.position ?? null });
  return { playerId: id, name: asset.name, position: asset.position, points: r2(points), projected: playerProjection(ctx, id, env) };
}

/**
 * Who carried a team, who sank it, and who sat on the bench: the top-scoring starter, the
 * starter furthest below his projection, and the top-scoring bench player (ties go to the
 * earlier slot / the player listed first).
 */
function playerStories(ctx: LeagueContext, input: TeamWeekInput, env: WeekEnv): Pick<TeamWeekFact, "topStarter" | "worstStarter" | "boomBench"> {
  const starters = input.starters
    .map((id, i) => ({ id, points: id === "0" ? 0 : (input.startersPoints[i] ?? input.playersPoints[id] ?? 0) }))
    .filter((x) => x.id !== "0");
  const starting = new Set(starters.map((x) => x.id));
  const bench = [...new Set(input.players.filter((id) => id && id !== "0" && !starting.has(id)))].map((id) => ({ id, points: input.playersPoints[id] ?? 0 }));
  const top = starters.reduce<(typeof starters)[number] | null>((b, x) => (!b || x.points > b.points ? x : b), null);
  let worst: { id: string; points: number; short: number } | null = null;
  for (const x of starters) {
    const proj = playerProjection(ctx, x.id, env);
    if (proj === null) continue;
    const short = proj - x.points;
    if (short > 0 && (!worst || short > worst.short)) worst = { ...x, short };
  }
  const boom = bench.reduce<(typeof bench)[number] | null>((b, x) => (x.points > 0 && (!b || x.points > b.points) ? x : b), null);
  return {
    topStarter: top ? performance(ctx, top.id, top.points, env) : null,
    worstStarter: worst ? performance(ctx, worst.id, worst.points, env) : null,
    boomBench: boom ? performance(ctx, boom.id, boom.points, env) : null,
  };
}

function projectedPoints(ctx: LeagueContext, m: SleeperMatchup, env: WeekEnv): number | null {
  if (!env.projections || Object.keys(env.projections).length === 0) return null;
  let total = 0;
  for (const id of ctx.starterSlots.map((_, i) => m.starters[i] ?? "0")) {
    if (id === "0") continue;
    const row = env.projections[id];
    if (!row) continue;
    total += pointsFromStats(row.stats, ctx.scoring, row.position ?? env.players[id]?.pos ?? null);
  }
  return r2(total);
}

/** Compute WeeklyFacts for `week` using the loader's league context. */
export async function computeWeeklyFacts(week: number, loader: FactsLoader, opts: { withProjections?: boolean } = {}): Promise<WeeklyFacts> {
  const ctx = loader.ctx;
  const withProjections = opts.withProjections ?? true;
  const [matchups, players, stats, projections, schedule, snap] = await Promise.all([
    week >= 1 ? loader.matchups(week) : Promise.resolve([] as SleeperMatchup[]),
    loader.players(),
    week >= 1 ? loader.stats(week) : Promise.resolve(null),
    week >= 1 && withProjections ? loader.projections(week) : Promise.resolve(null),
    loader.schedule(),
    loader.fantasyCalc(),
  ]);
  const isPast = ctx.phase === "complete" || ctx.phase === "offseason" || week < ctx.week || week <= lastCompletedWeek(ctx);
  const weekGames = schedule.filter((g) => g.week === week);
  const finalTeams: Set<string> | "all" = isPast
    ? "all"
    : new Set(weekGames.filter((g) => g.status === "complete").flatMap((g) => [g.home, g.away]));
  const env: WeekEnv = {
    week,
    players,
    stats,
    projections,
    byes: new Set(schedule.length ? byeTeams(schedule, week) : []),
    finalTeams,
    isCurrentWeek: !isPast,
    snap,
  };

  // Results (W/L, robbed, fraud, the flip swap, Loser of the Week) only once the week is final.
  const isFinal = isPast || (weekGames.length > 0 && weekGames.every((g) => g.status === "complete"));
  const played = matchups.filter((m) => m.starters.length > 0 || m.players.length > 0);
  const standingsWeek = isFinal ? week : week - 1;
  const standings = week >= 1 ? await withPreviousRanks(await standingsThrough(standingsWeek, loader), standingsWeek, loader) : [];
  const results = weekResults(played);
  const pointsList = played.map((m) => matchupPoints(m));
  const ranks = competitionRanks(pointsList, true);
  const n = played.length;
  const standingsByRoster = new Map(standings.map((s) => [s.team.rosterId, s]));

  const inputs = new Map<RosterId, TeamWeekInput>();
  const teams: TeamWeekFact[] = played.map((m, i) => {
    const input = teamInput(ctx, m, players, stats);
    inputs.set(m.roster_id, input);
    const optimal = teamOptimal(input);
    const points = matchupPoints(m);
    const res = results.get(m.roster_id);
    const result = isFinal ? (res?.result ?? null) : null;
    const scoreRank = ranks[i];
    const inRegularSeason = week <= ctx.lastRegularSeasonWeek;
    return {
      team: teamRef(ctx, m.roster_id),
      points,
      projected: projectedPoints(ctx, m, env),
      optimalPoints: r2(Math.max(optimal.total, starterPointsTotal(input))),
      benchPointsLeft: benchPointsLeft(input, optimal),
      opponentRosterId: res?.opponentRosterId ?? null,
      result,
      allPlayWins: pointsList.filter((p, j) => j !== i && p < points).length,
      allPlayLosses: pointsList.filter((p, j) => j !== i && p > points).length,
      scoreRank,
      robbed: result === "L" && scoreRank <= ROBBED_FRAUD_N,
      fraud: result === "W" && scoreRank > n - ROBBED_FRAUD_N,
      zeroStarters: zeroStarters(ctx, m, env),
      streak: inRegularSeason ? (standingsByRoster.get(m.roster_id)?.streak ?? "") : "",
      // The biggest bench mistake whether or not it cost the week (flipSwap is only the ones that did).
      benchMistake: (() => {
        const best = bestSwap(input);
        return best ? swapFact(ctx, m.roster_id, best, env) : null;
      })(),
      ...playerStories(ctx, input, env),
    };
  });
  teams.sort((a, b) => a.team.rosterId - b.team.rosterId);
  const byRoster = new Map(teams.map((t) => [t.team.rosterId, t]));

  const matchupFacts: MatchupFact[] = [];
  const seen = new Set<number>();
  for (const m of [...played].sort((a, b) => (a.matchup_id ?? 0) - (b.matchup_id ?? 0) || a.roster_id - b.roster_id)) {
    if (m.matchup_id === null || seen.has(m.matchup_id)) continue;
    const pair = played.filter((x) => x.matchup_id === m.matchup_id).sort((a, b) => a.roster_id - b.roster_id);
    if (pair.length !== 2) continue;
    seen.add(m.matchup_id);
    const home = byRoster.get(pair[0].roster_id)!;
    const away = byRoster.get(pair[1].roster_id)!;
    const margin = r2(Math.abs(home.points - away.points));
    const winner = !isFinal ? null : home.points > away.points ? home : away.points > home.points ? away : null;
    const loser = winner === home ? away : winner === away ? home : null;
    let flipSwap: SwapFact | null = null;
    if (loser) {
      const cand = flipSwapFor(inputs.get(loser.team.rosterId)!, margin);
      if (cand) flipSwap = swapFact(ctx, loser.team.rosterId, cand, env);
    }
    matchupFacts.push({ matchupId: m.matchup_id, home, away, margin, winnerRosterId: winner?.team.rosterId ?? null, flipSwap });
  }

  const byPoints = [...teams].sort((a, b) => b.points - a.points || a.team.rosterId - b.team.rosterId);
  const losers = byPoints.filter((t) => t.result === "L");
  const loserOfTheWeek =
    [...losers].sort((a, b) => a.points - b.points || b.benchPointsLeft - a.benchPointsLeft)[0] ?? byPoints[byPoints.length - 1] ?? null;
  const anyScores = teams.some((t) => t.points !== 0);
  const loserFinal = isFinal ? loserOfTheWeek : null;

  return {
    week,
    season: ctx.season,
    matchups: matchupFacts,
    teams,
    highest: anyScores ? (byPoints[0] ?? null) : null,
    lowest: anyScores ? (byPoints[byPoints.length - 1] ?? null) : null,
    loserOfTheWeek: anyScores ? loserFinal : null,
    standings,
    placeholder: false,
  };
}
