/**
 * "If the season started today": playoff and title odds from the drafted rosters, while the
 * startup draft is live and after it until the first league week is final. It is the season
 * simulator (10,000 seeded runs, the league's own reseed rule from `playoff_seed_type`) with no
 * games played, so every team's weekly mean is its projected best lineup from the players
 * drafted so far: each player rated by his Sleeper season projection in league scoring divided
 * by his projected games (at most 17; his next weeks' projections when Sleeper has no season
 * line). A starting spot a team has not filled yet is rated at replacement level, the best
 * player at that position nobody has drafted, so a team that happens to have picked last does
 * not jump the table between picks. Cached per pick count, so a page render after a new pick
 * recomputes once and every other render reads the store.
 */
import { getLeagueContext, teamRef } from "@/lib/league";
import { getDraftPicks } from "@/lib/sleeper";
import * as store from "@/lib/store";
import type { DraftOdds, DraftOddsTeam, LeagueContext, SimResult, SleeperDraftPick } from "@/lib/types";
import { DEFAULT_RUNS } from "./constants";
import { completedThrough, seasonFrame } from "./data";
import { round } from "./math";

/** A cached result is reused for the same draft and pick count within this window. */
export const DRAFT_ODDS_CACHE_SECONDS = 6 * 3600;
const CACHE_NAME = "draft-odds:v3";

type RunSim = (opts: { ctx: LeagueContext; runs: number; seed?: number }) => Promise<SimResult>;

export interface DraftOddsOptions {
  /** Default DEFAULT_RUNS (10,000). */
  runs?: number;
  seed?: number;
  /** Skip the cache (tests, or a job that wants a fresh number). */
  fresh?: boolean;
}

/** Which "if the season started today" view applies right now, if any. */
export async function draftOddsBasis(ctx: LeagueContext): Promise<DraftOdds["basis"]> {
  if (ctx.phase === "drafting") return "drafting";
  if (!ctx.draft || ctx.draft.status !== "complete" || ctx.phase === "complete") return null;
  const frame = seasonFrame(ctx);
  return (await completedThrough(ctx)) < frame.startWeek ? "preseason" : null;
}

function empty(ctx: LeagueContext, basis: DraftOdds["basis"], picksMade: number, totalPicks: number): DraftOdds {
  return {
    season: ctx.season,
    available: false,
    basis,
    draftId: ctx.draft?.draft_id ?? null,
    picksMade,
    totalPicks,
    runs: 0,
    seed: 0,
    generatedAt: Date.now(),
    teams: [],
    placeholder: false,
  };
}

interface Cached {
  draftId: string | null;
  basis: DraftOdds["basis"];
  picksMade: number;
  runs: number;
  result: DraftOdds;
}

export async function computeDraftOdds(ctx: LeagueContext | undefined, opts: DraftOddsOptions, runSim: RunSim): Promise<DraftOdds> {
  const c = ctx ?? (await getLeagueContext());
  const basis = await draftOddsBasis(c);
  const d = c.draft;
  const totalPicks = d ? (d.settings.rounds ?? 0) * (d.settings.teams ?? c.rosters.length) : 0;
  let picks: SleeperDraftPick[] = [];
  if (basis && d) picks = await getDraftPicks(d.draft_id).catch(() => [] as SleeperDraftPick[]);
  const made = picks.filter((p) => p.player_id);
  const rosterCounts = new Map<number, number>();
  if (basis === "drafting") for (const p of made) rosterCounts.set(p.roster_id, (rosterCounts.get(p.roster_id) ?? 0) + 1);
  else for (const r of c.rosters) rosterCounts.set(r.roster_id, r.players.length);
  const anyone = [...rosterCounts.values()].some((n) => n > 0);
  if (!basis || !anyone) return empty(c, basis, made.length, totalPicks);

  const runs = Math.max(1, Math.floor(opts.runs ?? DEFAULT_RUNS));
  const key = store.keys.snapshot(c.leagueId, CACHE_NAME);
  if (!opts.fresh && opts.seed === undefined) {
    const hit = await store.get<Cached>(key).catch(() => null);
    if (
      hit &&
      hit.draftId === (d?.draft_id ?? null) &&
      hit.basis === basis &&
      hit.picksMade === made.length &&
      hit.runs === runs &&
      Date.now() - hit.result.generatedAt < DRAFT_ODDS_CACHE_SECONDS * 1000
    ) {
      // Names come from today's league context, never the cached copy (a result cached before a
      // naming change would otherwise print the old team names until it expires).
      return { ...hit.result, teams: hit.result.teams.map((t) => ({ ...t, team: teamRef(c, t.team.rosterId) })) };
    }
  }

  const sim = await runSim({ ctx: c, runs, seed: opts.seed });
  const points = sim.teams.map((t) => t.meanPoints);
  const teams: DraftOddsTeam[] = sim.teams.map((t) => ({
    team: teamRef(c, t.team.rosterId),
    playersDrafted: rosterCounts.get(t.team.rosterId) ?? 0,
    projectedPoints: round(t.meanPoints),
    projectedRank: 1 + points.filter((p) => p > t.meanPoints).length,
    playoffPct: t.playoffPct,
    titlePct: t.titlePct,
    byePct: t.byePct,
    lastPlacePct: t.lastPlacePct,
    expectedWins: t.expectedWins,
  }));
  teams.sort((a, b) => b.titlePct - a.titlePct || b.playoffPct - a.playoffPct || a.projectedRank - b.projectedRank || a.team.rosterId - b.team.rosterId);
  const result: DraftOdds = {
    season: c.season,
    available: true,
    basis,
    draftId: d?.draft_id ?? null,
    picksMade: made.length,
    totalPicks,
    runs: sim.runs,
    seed: sim.seed,
    generatedAt: sim.generatedAt,
    teams,
    placeholder: sim.placeholder,
  };
  if (opts.seed === undefined) {
    await store
      .set<Cached>(key, { draftId: result.draftId, basis, picksMade: made.length, runs, result }, { ttlSeconds: DRAFT_ODDS_CACHE_SECONDS })
      .catch(() => undefined);
  }
  return result;
}
