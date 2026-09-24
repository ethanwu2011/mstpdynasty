/**
 * The stat-surface one-liners, kept up to date by the jobs (never by a page render).
 *
 *   instant  trades, draft picks, and "if the season started today" odds while the draft is
 *            live or just over. The tick refreshes them on every run, so a new trade or pick
 *            gets its line within a tick or two.
 *   tables   standings, season odds, power rankings, matchups, team pages, the Wall of Shame.
 *            The daily job refreshes them, and the tick sweeps them at most once an hour (so a
 *            week that just went final gets its lines without waiting for tomorrow's cron).
 *
 * Each surface is built from facts (lib/roast/surface-rows.ts) and handed to
 * refreshSurfaceLines, which only asks the writer for rows that are new or whose facts changed,
 * rewrites a row at most once a day, and stores the result where the pages read it. Without
 * the writer (no ANTHROPIC_API_KEY) nothing is built at all. A per-surface claim keeps the
 * tick and the daily job from writing the same surface at once.
 */
import "server-only";
import { draftFacts, lastCompletedWeek, shameEntries, standingsAsOf, tradeHindsight, transactionFacts, weeklyFacts } from "@/lib/facts";
import { getFantasyCalc, valueOf } from "@/lib/fantasycalc";
import { teamRef } from "@/lib/league";
import { draftOdds, draftOddsBasis, getPowerRankings, getWinProbabilities, runSeasonSim } from "@/lib/models";
import {
  draftContext,
  draftOddsRows,
  draftRows,
  finalMatchupRows,
  getStoredSurfaceLines,
  hasRoastClient,
  oddsRows,
  powerRows,
  pregameMatchupRows,
  refreshSurfaceLines,
  shameRows,
  standingsRows,
  surfaceKeys,
  teamRows,
  tradeRows,
  type RefreshOptions,
  type RefreshResult,
  type TeamPageInput,
} from "@/lib/roast";
import { getDraftPicks, getPlayers, playerInfo } from "@/lib/sleeper";
import * as store from "@/lib/store";
import type { FantasyCalcSnapshot, JobOutcome, LeagueContext, PlayersMap, RoastSurface, StandingRow, SurfaceRow } from "@/lib/types";
import { ROAST_VOICE } from "./tick";

/** The tick sweeps the tables at most this often. */
export const TABLE_SWEEP_SECONDS = 1800;
/** Draft odds move with every pick: a line whose numbers went stale may be rewritten this soon while the draft is live. */
export const DRAFT_ODDS_LINES_STALE_MS = 20 * 60_000;
/** Rows asked per surface per run (the rest wait for the next run). */
export const MAX_LINE_ROWS_PER_RUN = 80;
/** Claim on one surface while its lines are being written (released when done). */
const CLAIM_SECONDS = 300;
/** Surfaces written at the same time (each is one model call per batch). */
const SURFACE_CONCURRENCY = 3;

export type LinesScope = "instant" | "all";

interface SurfaceJob {
  surface: RoastSurface;
  /** Builds the rows and the key (null = nothing to write for this surface right now). */
  build: () => Promise<{ key: string; rows: SurfaceRow[]; opts?: Partial<RefreshOptions> } | null>;
}

const hasGames = (rows: StandingRow[]) => rows.some((r) => r.wins + r.losses + r.ties > 0);

/** Players each roster holds (drafted so far while the startup draft fills empty rosters). */
async function teamInputs(ctx: LeagueContext, standings: StandingRow[] | null): Promise<TeamPageInput[]> {
  const [players, fc] = await Promise.all([getPlayers().catch(() => ({}) as PlayersMap), getFantasyCalc().catch(() => null as FantasyCalcSnapshot | null)]);
  let held = new Map(ctx.rosters.map((r) => [r.roster_id, r.players]));
  if (![...held.values()].some((ps) => ps.length > 0) && ctx.draft) {
    const picks = await getDraftPicks(ctx.draft.draft_id).catch(() => []);
    held = new Map(ctx.rosters.map((r) => [r.roster_id, picks.filter((p) => p.roster_id === r.roster_id && p.player_id).map((p) => p.player_id)]));
  }
  const byRoster = new Map((standings ?? []).map((s) => [s.team.rosterId, s]));
  return ctx.rosters.map((r) => {
    const s = byRoster.get(r.roster_id);
    const team = s?.team ?? teamRef(ctx, r.roster_id);
    return {
      team,
      players: [...new Set(held.get(r.roster_id) ?? [])].map((id) => {
        const info = playerInfo(players, id);
        const v = fc ? valueOf(fc, id) : null;
        return { name: info.name, position: info.pos, age: info.age, nflTeam: info.team, value: v ? v.value : null };
      }),
      record: s && hasGames(standings ?? []) ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}` : null,
      rank: s && hasGames(standings ?? []) ? s.rank : null,
    };
  });
}

function instantJobs(ctx: LeagueContext): SurfaceJob[] {
  const jobs: SurfaceJob[] = [];
  jobs.push({
    surface: "trades",
    build: async () => {
      // Hindsight reads a stored FantasyCalc day per sampled date, so only build it when a
      // trade has no line yet (the table sweep refreshes the values once a day).
      const tx = await transactionFacts(0, ctx);
      if (!tx.trades.length) return null;
      const stored = await getStoredSurfaceLines("trades", surfaceKeys.trades(), ctx);
      if (tx.trades.every((t) => stored?.lines[t.transactionId])) return null;
      return { key: surfaceKeys.trades(), rows: tradeRows((await tradeHindsight(ctx)).trades) };
    },
  });
  const d = ctx.draft;
  if (d && d.status !== "pre_draft") {
    jobs.push({
      surface: "draft",
      build: async () => {
        const df = await draftFacts(ctx);
        if (df.placeholder || !df.picks.length) return null;
        const dctx = await draftContext(ctx, df.picks).catch(() => null);
        return { key: surfaceKeys.draft(df.draftId), rows: draftRows(df.picks, dctx) };
      },
    });
  }
  jobs.push({
    surface: "odds",
    build: async () => {
      if (!(await draftOddsBasis(ctx))) return null;
      const odds = await draftOdds(ctx);
      if (!odds.available || odds.placeholder) return null;
      return {
        key: surfaceKeys.odds(ctx.season, 0),
        rows: draftOddsRows(odds),
        opts: {
          staleAfterMs: odds.basis === "drafting" ? DRAFT_ODDS_LINES_STALE_MS : undefined,
          context:
            odds.basis === "drafting"
              ? "These are odds for a season that started today with only the players drafted so far, every open starting spot filled by the best player nobody has drafted."
              : "These are preseason odds from the drafted rosters, before any games.",
        },
      };
    },
  });
  return jobs;
}

function tableJobs(ctx: LeagueContext): SurfaceJob[] {
  const inSeason = ctx.phase === "in_season" || ctx.phase === "complete" || ctx.phase === "offseason";
  const lcw = lastCompletedWeek(ctx);
  let standingsMemo: Promise<StandingRow[] | null> | null = null;
  const standings = () =>
    (standingsMemo ??= inSeason && lcw >= 1 ? standingsAsOf(lcw, ctx).catch(() => null) : Promise.resolve(null));

  const jobs: SurfaceJob[] = [];
  jobs.push({
    surface: "standings",
    build: async () => {
      const rows = await standings();
      if (!rows || !hasGames(rows)) return null;
      const before = lcw > 1 ? await standingsAsOf(lcw - 1, ctx).catch(() => null) : null;
      return { key: surfaceKeys.standings(ctx.season, lcw), rows: standingsRows(rows, before) };
    },
  });
  jobs.push({
    surface: "odds",
    build: async () => {
      if (!inSeason || lcw < 1) return null;
      // Until the league's first week is final the odds on the site are the drafted-roster ones
      // (the instant job above, asOfWeek 0). A draft that ends mid NFL season has final NFL
      // weeks behind it that are not league weeks, so this sim would claim "week 3" of a
      // season nobody has played.
      if (await draftOddsBasis(ctx)) return null;
      const sim = await runSeasonSim({ ctx });
      if (sim.placeholder || sim.asOfWeek < 1) return null;
      return { key: surfaceKeys.odds(ctx.season, sim.asOfWeek), rows: oddsRows(sim) };
    },
  });
  jobs.push({
    surface: "power",
    build: async () => {
      if (!inSeason) return null;
      const p = await getPowerRankings(ctx);
      if (p.placeholder || p.asOfWeek < 1) return null;
      return { key: surfaceKeys.power(ctx.season, p.asOfWeek), rows: powerRows(p) };
    },
  });
  jobs.push({
    surface: "matchups",
    build: async () => {
      if (!inSeason) return null;
      const rows: SurfaceRow[] = [];
      // The week that just went final, with results...
      if (lcw >= 1) {
        const w = await weeklyFacts(lcw, ctx);
        if (!w.placeholder && w.matchups.length) rows.push(...finalMatchupRows(w));
        if (rows.length) return { key: surfaceKeys.matchups(ctx.season, lcw), rows, opts: { maxAgeMs: 0 } };
      }
      return null;
    },
  });
  jobs.push({
    surface: "matchups",
    build: async () => {
      // ...and the week being played, from its projections before kickoff.
      if (ctx.phase !== "in_season" || ctx.week <= lcw || ctx.week < 1) return null;
      const wp = await getWinProbabilities(ctx.week, ctx, { pregame: true });
      if (wp.placeholder || !wp.matchups.length) return null;
      return { key: surfaceKeys.matchups(ctx.season, ctx.week), rows: pregameMatchupRows(wp) };
    },
  });
  jobs.push({
    surface: "team",
    build: async () => {
      const rows = teamRows(await teamInputs(ctx, await standings()));
      return rows.length ? { key: surfaceKeys.team(ctx.season), rows } : null;
    },
  });
  jobs.push({
    surface: "shame",
    build: async () => {
      const board = await shameEntries(ctx);
      if (board.placeholder || !board.entries.length) return null;
      return { key: surfaceKeys.shame(ctx.season), rows: shameRows(board.entries) };
    },
  });
  jobs.push({
    surface: "trades",
    build: async () => {
      const h = await tradeHindsight(ctx);
      if (h.placeholder || !h.trades.length) return null;
      return { key: surfaceKeys.trades(), rows: tradeRows(h.trades) };
    },
  });
  return jobs;
}

export interface RefreshLinesOptions {
  now?: number;
  /** "instant" (the tick) or "all" (the daily job, and the tick's hourly table sweep). */
  scope: LinesScope;
  /** Stop starting new surfaces and model calls after this time (epoch ms). */
  deadline?: number;
}

function describe(surface: RoastSurface, r: RefreshResult | null, err: string | null): string {
  if (err) return `${surface}: error (${err})`;
  if (!r) return `${surface}: nothing to write`;
  switch (r.status) {
    case "fresh":
      return `${surface}: up to date`;
    case "throttled":
      return `${surface}: changed, rewritten at most once a day`;
    case "written":
      return `${surface}: wrote ${r.written} line${r.written === 1 ? "" : "s"}${r.failed ? `, ${r.failed} failed the checks` : ""}${r.pending ? `, ${r.pending} next run` : ""}`;
    case "skipped":
      return `${surface}: ${r.asked ? `${r.asked} asked, none written (checks failed or the writer is down)` : "no writer"}`;
    case "busy":
      return `${surface}: being written by another run`;
  }
}

/**
 * Refresh the one-liners for `scope`. One JobOutcome ("lines"), never throws. Without the
 * writer it returns at once without building anything.
 */
export async function refreshLines(ctx: LeagueContext, opts: RefreshLinesOptions): Promise<JobOutcome> {
  if (!hasRoastClient()) return { job: "lines", status: "skipped", detail: "The writer is not configured, so there are no one-liners to write." };
  const now = opts.now ?? Date.now();
  const jobs = opts.scope === "all" ? [...instantJobs(ctx).filter((j) => j.surface !== "trades"), ...tableJobs(ctx)] : instantJobs(ctx);
  const results = new Array<{ part: string | null; wrote: number; error: boolean }>(jobs.length);
  const runOne = async (job: SurfaceJob): Promise<{ part: string | null; wrote: number; error: boolean }> => {
    if (opts.deadline !== undefined && Date.now() > opts.deadline) return { part: `${job.surface}: out of time, next run`, wrote: 0, error: false };
    let built: Awaited<ReturnType<SurfaceJob["build"]>>;
    try {
      built = await job.build();
    } catch (err) {
      return { part: describe(job.surface, null, err instanceof Error ? err.message : String(err)), wrote: 0, error: true };
    }
    if (!built || !built.rows.length) return { part: null, wrote: 0, error: false };
    // One run at a time per surface, claimed only when there is something to write.
    const claimKey = store.keys.lock(ctx.leagueId, `lines:${job.surface}:${built.key}`);
    const claim = async () => ((await store.lock(claimKey, CLAIM_SECONDS)) ? () => store.unlock(claimKey) : null);
    try {
      const r = await refreshSurfaceLines(job.surface, built.key, built.rows, ctx, {
        now,
        deadline: opts.deadline,
        maxRows: MAX_LINE_ROWS_PER_RUN,
        claim,
        // A new voice makes every stored line due again, pick lines included.
        voice: ROAST_VOICE,
        ...built.opts,
      });
      return { part: r.status === "fresh" ? null : describe(job.surface, r, null), wrote: r.written ?? 0, error: false };
    } catch (err) {
      return { part: describe(job.surface, null, err instanceof Error ? err.message : String(err)), wrote: 0, error: true };
    }
  };
  // A small pool: surfaces run side by side, their parts are reported in a fixed order.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SURFACE_CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await runOne(jobs[i]);
      }
    }),
  );
  const parts = results.map((r) => r.part).filter((p): p is string => Boolean(p));
  const wrote = results.reduce((s, r) => s + r.wrote, 0);
  const errors = results.filter((r) => r.error).length;
  const status: JobOutcome["status"] = wrote ? "ran" : errors ? "error" : "skipped";
  return { job: "lines", status, detail: parts.length ? `${parts.join("; ")}.` : "Every line is up to date." };
}

/**
 * The tick's share: the instant surfaces every run, plus the tables at most once per
 * TABLE_SWEEP_SECONDS (a store cooldown shared by every instance).
 */
export async function tickLines(ctx: LeagueContext, now: number, deadline: number): Promise<JobOutcome> {
  if (!hasRoastClient()) return { job: "lines", status: "skipped", detail: "The writer is not configured, so there are no one-liners to write." };
  const sweep = await store.lock(store.keys.lock(ctx.leagueId, "lines-sweep"), TABLE_SWEEP_SECONDS).catch(() => false);
  return refreshLines(ctx, { now, scope: sweep ? "all" : "instant", deadline });
}
