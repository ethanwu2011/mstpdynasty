/**
 * Models public API. OWNER: models agent (lib/models/**, tests/models*).
 *
 *   getWinProbabilities  live win probability per matchup (ESPN clocks + league-scored projections)
 *   runSeasonSim         seeded Monte Carlo of the rest of the season and the playoff bracket
 *   getPowerRankings     all-play, points per game and projected strength, blended
 *   getOddsHistory       one odds snapshot per week (from the store; backfilled on demand)
 *   draftOdds            "if the season started today" playoff and title odds from drafted rosters
 *
 * Signatures follow docs/CONTRACTS.md; the extra trailing options are optional.
 * Pieces: data.ts (loading), winprob.ts, sim.ts, power.ts (pure math), constants.ts.
 */
import { listOddsSnapshots, saveOddsSnapshot } from "@/lib/archive";
import { getLeagueContext, teamRef } from "@/lib/league";
import { rosterPotentialPoints } from "@/lib/sleeper";
import type {
  DraftOdds,
  LeagueContext,
  OddsHistory,
  OddsSnapshot,
  PowerRankings,
  RosterId,
  SimOptions,
  SimResult,
  SimTeamOdds,
  SleeperMatchup,
  WinProbWeek,
} from "@/lib/types";
import { DEFAULT_RUNS, EMPTY_TEAM_MEAN, MEAN_PRIOR_GAMES, PRIOR_SD, SD_PRIOR_GAMES } from "./constants";
import {
  type SeasonFrame,
  type TeamRecord,
  completedThrough,
  firstRoundHolders,
  knownPlayoffResults,
  lineupStrength,
  loadMatchupsByWeek,
  mergeRates,
  pairMatchups,
  playerRates,
  projectionWeeks,
  range,
  recordsFromMatchups,
  replacementRates,
  roundRobinPairs,
  safePlayers,
  safeSchedule,
  seasonFrame,
  seasonRates,
  strengthRosters,
  teamPoints,
  uncoveredSlotAverages,
  weekHasScores,
} from "./data";
import { computeDraftOdds, type DraftOddsOptions } from "./draft-odds";
import { hash32, mean, round, sampleSd } from "./math";
import { computePower } from "./power";
import { type SimInput, simulateSeason } from "./sim";
import { type WinProbOptions, loadWinProbabilities } from "./winprob";

export { VARIANCE_COEF, PRIOR_SD, MEAN_PRIOR_GAMES, SD_PRIOR_GAMES, DEFAULT_RUNS, POWER_WEIGHTS } from "./constants";
export type { WinProbOptions } from "./winprob";
export { DRAFT_ODDS_CACHE_SECONDS, draftOddsBasis, type DraftOddsOptions } from "./draft-odds";

/* ------------------------------------------------------------------ */
/* win probability                                                     */
/* ------------------------------------------------------------------ */

/**
 * Win probability for every matchup in `week`: live during games (ESPN clocks), projections
 * before kickoff, exactly 0 / 1 once every starter's game is final. `opts.pregame` forces the
 * pre-kickoff view for any week (used for backtests).
 */
export async function getWinProbabilities(week: number, ctx?: LeagueContext, opts: WinProbOptions = {}): Promise<WinProbWeek> {
  const c = ctx ?? (await getLeagueContext());
  return loadWinProbabilities(week, c, opts);
}

/* ------------------------------------------------------------------ */
/* shared: projected strength and records                              */
/* ------------------------------------------------------------------ */

/**
 * Projected optimal-lineup points per roster for `week` (rosters as of that week when Sleeper
 * has them). `source` "season" rates players by Sleeper's season projections per game first
 * (draft odds), "week" by the next two weeks' projections.
 */
async function teamStrengths(
  ctx: LeagueContext,
  frame: SeasonFrame,
  week: number,
  byWeek: Map<number, SleeperMatchup[]>,
  playedWeeks: number[],
  source: "week" | "season" = "week",
): Promise<Map<RosterId, number>> {
  const [players, rosters, schedule] = await Promise.all([safePlayers(), strengthRosters(ctx, week, byWeek), safeSchedule(ctx)]);
  const weekly = await playerRates(ctx, projectionWeeks(frame, week), schedule);
  const rates = source === "season" ? mergeRates(await seasonRates(ctx), weekly) : weekly;
  const fallbacks = uncoveredSlotAverages(ctx, byWeek, playedWeeks);
  // Draft odds rate an open starting spot at replacement level (the best player nobody has yet),
  // so mid-draft odds measure the players drafted, not who happens to have picked most recently.
  const taken = new Set([...rosters.values()].flat());
  for (const r of ctx.rosters) for (const id of [...r.players, ...r.reserve, ...r.taxi]) taken.add(id);
  const replacement = source === "season" ? replacementRates(rates, players, taken) : undefined;
  const out = new Map<RosterId, number>();
  for (const r of ctx.rosters) out.set(r.roster_id, lineupStrength(ctx, rosters.get(r.roster_id) ?? [], rates, players, fallbacks, replacement));
  return out;
}

interface Season {
  frame: SeasonFrame;
  byWeek: Map<number, SleeperMatchup[]>;
  rosterIds: RosterId[];
}

async function loadSeason(ctx: LeagueContext): Promise<Season> {
  const frame = seasonFrame(ctx);
  const byWeek = await loadMatchupsByWeek(ctx, range(frame.startWeek, frame.lastRegularSeasonWeek));
  return { frame, byWeek, rosterIds: ctx.rosters.map((r) => r.roster_id) };
}

/** Regular-season weeks through `asOf` that have scores. */
function playedWeeks(s: Season, asOf: number): number[] {
  return range(s.frame.startWeek, Math.min(asOf, s.frame.lastRegularSeasonWeek)).filter((w) => weekHasScores(s.byWeek.get(w)));
}

const clampWeek = (frame: SeasonFrame, w: number) => Math.min(Math.max(w, frame.startWeek), frame.lastRegularSeasonWeek);

/* ------------------------------------------------------------------ */
/* season simulator                                                    */
/* ------------------------------------------------------------------ */

export interface TeamParams {
  mean: number;
  sd: number;
  games: number;
  observedMean: number | null;
  projected: number;
}

/**
 * Weekly score distribution per team:
 *   mean = w x observed mean + (1 - w) x projected strength (centered on the league's observed
 *          scoring level once games exist), w = games / (games + MEAN_PRIOR_GAMES)
 *   sd   = v x observed sd + (1 - v) x PRIOR_SD, v = games / (games + SD_PRIOR_GAMES), 0 below two games
 */
export function teamParams(
  rosterIds: RosterId[],
  records: Map<RosterId, TeamRecord>,
  strength: Map<RosterId, number>,
): Map<RosterId, TeamParams> {
  const allScores = rosterIds.flatMap((id) => records.get(id)?.scores ?? []);
  const leagueObs = allScores.length ? mean(allScores) : null;
  const strengths = rosterIds.map((id) => strength.get(id) ?? 0);
  const anyStrength = strengths.some((v) => v > 0);
  const leagueProj = mean(strengths);
  const out = new Map<RosterId, TeamParams>();
  for (const id of rosterIds) {
    const scores = records.get(id)?.scores ?? [];
    const g = scores.length;
    const s = strength.get(id) ?? 0;
    const prior = anyStrength ? (leagueObs !== null ? s + (leagueObs - leagueProj) : s) : (leagueObs ?? EMPTY_TEAM_MEAN);
    const w = g / (g + MEAN_PRIOR_GAMES);
    const obsMean = g ? mean(scores) : prior;
    const v = g >= 2 ? g / (g + SD_PRIOR_GAMES) : 0;
    out.set(id, {
      mean: w * obsMean + (1 - w) * prior,
      sd: v * sampleSd(scores) + (1 - v) * PRIOR_SD,
      games: g,
      observedMean: g ? mean(scores) : null,
      projected: s,
    });
  }
  return out;
}

export interface PreparedSim {
  asOfWeek: number;
  input: Omit<SimInput, "runs" | "seed">;
  records: Map<RosterId, TeamRecord>;
  params: Map<RosterId, TeamParams>;
}

/** Everything the simulator needs, conditioned on weeks through `fromWeek - 1` (default: last completed week). */
export async function prepareSeasonSim(ctx: LeagueContext, fromWeek?: number, strength: "week" | "season" = "week"): Promise<PreparedSim> {
  const season = await loadSeason(ctx);
  const { frame, byWeek, rosterIds } = season;
  const asOfWeek = fromWeek !== undefined ? Math.max(0, fromWeek - 1) : await completedThrough(ctx);
  const played = playedWeeks(season, asOfWeek);
  const playedSet = new Set(played);
  const records = recordsFromMatchups(rosterIds, byWeek, played);

  const weeks: Array<Array<[RosterId, RosterId]>> = [];
  for (const w of range(frame.startWeek, frame.lastRegularSeasonWeek)) {
    if (playedSet.has(w)) continue;
    const pairs = pairMatchups(byWeek.get(w) ?? []);
    if (w <= asOfWeek && !pairs.length) continue; // before the league existed
    weeks.push(pairs.length ? pairs.map((p) => [p.a.roster_id, p.b.roster_id]) : roundRobinPairs(rosterIds, w - frame.startWeek));
  }

  const strengths = await teamStrengths(ctx, frame, clampWeek(frame, asOfWeek + 1), byWeek, played, strength);
  const params = teamParams(rosterIds, records, strengths);
  const [known, holders] = await Promise.all([knownPlayoffResults(ctx, frame, asOfWeek), firstRoundHolders(ctx)]);

  return {
    asOfWeek,
    records,
    params,
    input: {
      teams: rosterIds.map((id) => {
        const r = records.get(id)!;
        const p = params.get(id)!;
        const games = r.wins + r.losses + r.ties;
        // Sleeper's Max PF counts the same games only when its record matches the one rebuilt
        // here (a sim as of an earlier week would otherwise see later weeks' max points).
        const sleeper = ctx.rosters.find((x) => x.roster_id === id);
        const sameGames = sleeper && sleeper.settings.wins + sleeper.settings.losses + (sleeper.settings.ties ?? 0) === games;
        const potential = sleeper && sameGames ? rosterPotentialPoints(sleeper) : 0;
        const maxPointsFor = potential > r.pointsFor ? potential : r.pointsFor;
        const maxGap = games > 0 ? (maxPointsFor - r.pointsFor) / games : 0;
        return { rosterId: id, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor, maxPointsFor, maxGap, mean: p.mean, sd: p.sd };
      }),
      weeks,
      playoffTeams: frame.playoffTeams,
      reseed: frame.reseed,
      known,
      firstPickHolder: holders,
    },
  };
}

export function defaultSeed(ctx: LeagueContext, asOfWeek: number): number {
  return hash32(`${ctx.leagueId}:${ctx.season}:${asOfWeek}`);
}

/** Monte Carlo season odds (10,000 seeded runs by default). Percentages are 0..100. */
export async function runSeasonSim(opts: SimOptions = {}): Promise<SimResult> {
  const ctx = opts.ctx ?? (await getLeagueContext());
  const prep = await prepareSeasonSim(ctx, opts.fromWeek, opts.strength ?? "week");
  const runs = Math.max(1, Math.floor(opts.runs ?? DEFAULT_RUNS));
  const seed = (opts.seed ?? defaultSeed(ctx, prep.asOfWeek)) >>> 0;
  const counts = simulateSeason({ ...prep.input, runs, seed });
  const pct = (k: number) => round((k * 100) / runs, 2);

  const teams: SimTeamOdds[] = counts.rosterIds.map((id, i) => {
    const r = prep.records.get(id)!;
    const p = prep.params.get(id)!;
    return {
      team: teamRef(ctx, id),
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      meanPoints: round(p.mean),
      sdPoints: round(p.sd),
      expectedWins: round(counts.winsSum[i] / runs),
      playoffPct: pct(counts.playoff[i]),
      byePct: pct(counts.bye[i]),
      titlePct: pct(counts.title[i]),
      lastPlacePct: pct(counts.last[i]),
      firstPickPct: pct(counts.firstPick[i]),
    };
  });
  teams.sort(
    (a, b) =>
      b.titlePct - a.titlePct || b.playoffPct - a.playoffPct || b.expectedWins - a.expectedWins || a.team.rosterId - b.team.rosterId,
  );

  const result: SimResult = { season: ctx.season, asOfWeek: prep.asOfWeek, runs, seed, generatedAt: Date.now(), teams, placeholder: false };
  if (opts.persist) {
    try {
      await saveOddsSnapshot(ctx.leagueId, ctx.season, toSnapshot(result));
    } catch {
      // persisting is best effort; the odds are still returned
    }
  }
  return result;
}

function toSnapshot(r: SimResult): OddsSnapshot {
  return {
    week: r.asOfWeek,
    generatedAt: r.generatedAt,
    teams: r.teams.map((t) => ({
      rosterId: t.team.rosterId,
      playoffPct: t.playoffPct,
      titlePct: t.titlePct,
      byePct: t.byePct,
      lastPlacePct: t.lastPlacePct,
      expectedWins: t.expectedWins,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* power rankings                                                      */
/* ------------------------------------------------------------------ */

/** Power rankings through the last completed regular-season week (`opts.asOfWeek` overrides). */
export async function getPowerRankings(ctx?: LeagueContext, opts: { asOfWeek?: number } = {}): Promise<PowerRankings> {
  const c = ctx ?? (await getLeagueContext());
  const season = await loadSeason(c);
  const { frame, byWeek, rosterIds } = season;
  const through = Math.min(opts.asOfWeek ?? (await completedThrough(c)), frame.lastRegularSeasonWeek);
  const played = playedWeeks(season, through);
  const strength = await teamStrengths(c, frame, clampWeek(frame, through + 1), byWeek, played);

  const calc = (weeks: number[]) =>
    computePower({
      rosterIds,
      weeks: weeks.map((w) => {
        const scores = new Map<RosterId, number>();
        for (const { a, b } of pairMatchups(byWeek.get(w) ?? [])) {
          scores.set(a.roster_id, teamPoints(a));
          scores.set(b.roster_id, teamPoints(b));
        }
        return scores;
      }),
      records: recordsFromMatchups(rosterIds, byWeek, weeks),
      strength,
    });

  const now = calc(played);
  const previous = played.length >= 2 ? calc(played.slice(0, -1)) : null;
  const prevRank = new Map(previous?.rows.map((r, i) => [r.rosterId, i + 1]) ?? []);

  return {
    season: c.season,
    asOfWeek: played.length ? played[played.length - 1] : 0,
    formula: now.formula,
    rows: now.rows.map((r, i) => ({
      rank: i + 1,
      previousRank: prevRank.get(r.rosterId) ?? null,
      team: teamRef(c, r.rosterId),
      score: r.score,
      allPlayWinPct: r.allPlayWinPct,
      allPlayWins: r.allPlayWins,
      allPlayLosses: r.allPlayLosses,
      pointsPerGame: r.pointsPerGame,
      projectedStrength: r.projectedStrength,
      wins: r.wins,
      losses: r.losses,
      luck: r.luck,
    })),
    placeholder: false,
  };
}

/* ------------------------------------------------------------------ */
/* odds history                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute and store odds snapshots for every completed week that has none yet (plus the
 * preseason snapshot). Jobs call this after a gap or a store reset. Returns the snapshots it wrote.
 */
export async function backfillOddsHistory(
  ctx?: LeagueContext,
  opts: { runs?: number; force?: boolean } = {},
): Promise<OddsSnapshot[]> {
  const c = ctx ?? (await getLeagueContext());
  const frame = seasonFrame(c);
  const through = await completedThrough(c);
  if (through < frame.startWeek) return [];
  const have = new Set((await listOddsSnapshots(c.leagueId, c.season).catch(() => [])).map((s) => s.week));
  const written: OddsSnapshot[] = [];
  for (const asOf of [frame.startWeek - 1, ...range(frame.startWeek, Math.min(through, frame.lastWeek))]) {
    if (!opts.force && have.has(asOf)) continue;
    const r = await runSeasonSim({ ctx: c, fromWeek: asOf + 1, runs: opts.runs ?? DEFAULT_RUNS, persist: true });
    written.push(toSnapshot(r));
  }
  return written;
}

/**
 * One odds snapshot per week, oldest first. Snapshots are written by `runSeasonSim({ persist: true })`
 * (the weekly job). `opts.backfill` fills missing completed weeks first; it defaults to on only
 * for fixture data (local dev), where it costs nothing.
 */
export async function getOddsHistory(ctx?: LeagueContext, opts: { backfill?: boolean; runs?: number } = {}): Promise<OddsHistory> {
  const c = ctx ?? (await getLeagueContext());
  let through = Number.POSITIVE_INFINITY;
  if (opts.backfill ?? c.isFixture) {
    try {
      through = await completedThrough(c);
      await backfillOddsHistory(c, { runs: opts.runs });
    } catch {
      // history is optional; fall through to whatever is stored
    }
  }
  const stored = await listOddsSnapshots(c.leagueId, c.season).catch(() => [] as OddsSnapshot[]);
  // Dev week overrides can leave snapshots from "later" weeks in the local store: hide them.
  return { season: c.season, snapshots: stored.filter((s) => s.week <= through), placeholder: false };
}

/* ------------------------------------------------------------------ */
/* draft odds                                                          */
/* ------------------------------------------------------------------ */

/**
 * "If the season started today": playoff and title odds from the drafted rosters, while the
 * startup draft is live ("drafting") and after it until the first league week is final
 * ("preseason"). `available: false` (no teams) otherwise or before the first pick. 10,000 seeded
 * runs by default; each team's weekly mean is the best legal lineup of the players it has,
 * rated by Sleeper's season projections per projected game (weekly projections for anyone
 * without a season line); the bracket follows the league's `playoff_seed_type` (reseeded or
 * fixed). Cached per draft and pick count for DRAFT_ODDS_CACHE_SECONDS (a seed or `fresh` skips
 * the cache).
 */
export async function draftOdds(ctx?: LeagueContext, opts: DraftOddsOptions = {}): Promise<DraftOdds> {
  return computeDraftOdds(ctx, opts, (o) => runSeasonSim({ ctx: o.ctx, runs: o.runs, seed: o.seed, strength: "season" }));
}
