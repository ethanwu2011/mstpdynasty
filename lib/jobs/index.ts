/**
 * Jobs public API. OWNER: ENGINE agent (lib/**, app/api/**, proxy.ts, tests/**).
 *
 *   runDaily(now)  /api/cron/daily, once a day (Vercel cron, 12:00 UTC = 8 AM EDT / 7 AM EST).
 *                  Stores today's FantasyCalc snapshot first (trades in hindsight read one per
 *                  day). Then plans by America/New_York date and league phase
 *                  (lib/jobs/schedule.ts): The Daily every day when there is material, Thursday
 *                  Night Fallout on Fridays in season, Week N Recap on Tuesdays, Draft Grades
 *                  once after the startup draft. Week N Recap and Draft Grades also store an
 *                  odds snapshot. Each issue is built and delivered exactly once
 *                  (lib/jobs/issues.ts). Last, the one-liners on every stat table
 *                  (lib/jobs/lines.ts), inside what is left of the run's time.
 *   runTick(now)   /api/tick and page renders via after(). Takes the 2-minute cooldown lock
 *                  FIRST (before loading the league, so a request loop costs one KV command
 *                  each), then an in-flight lock held until the run ends (a slow run can
 *                  outlast the cooldown). Writes up new trades, waiver runs and draft picks and
 *                  stamps draft pick times (lib/jobs/tick.ts), takes the day's FantasyCalc
 *                  snapshot if nobody has yet (one fetch a day at most), and refreshes the
 *                  one-liners for trades, picks and draft odds (plus every table, at most
 *                  hourly). Never emails.
 *
 * Both return a JobRunReport, never throw, and write a run log (keys.jobRun). Nothing is
 * emailed about a dev league. With no keys, issues are facts-only and email reports
 * "not configured".
 */
import "server-only";
import { leagueId as envLeagueId } from "@/lib/env";
import { getLeagueContext } from "@/lib/league";
import { getSchedule } from "@/lib/sleeper";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type { JobOutcome, JobRunReport, LeagueContext, NflGame } from "@/lib/types";
import { ensureDailySnapshot, type DailySnapshotResult } from "@/lib/fantasycalc";
import { runIssueJob } from "./issues";
import { refreshLines, tickLines } from "./lines";
import { logJobRun } from "./log";
import { JOB_ORDER, planDaily, type PlanDraft } from "./schedule";
import { TICK_COOLDOWN_SECONDS, TICK_RUN_LOCK_SECONDS, tickOutcomes } from "./tick";

export { listJobRuns } from "./log";
export { readDraftPickTimes, DRAFT_PICK_SEEN } from "./draft-seen";
export { planDaily, recapWeekFor, earlyGamesWeekFor } from "./schedule";
export { MAX_ROASTS_PER_TICK, TICK_COOLDOWN_SECONDS } from "./tick";
export { sendTestEmail } from "./test-email";
export { refreshLines, tickLines, TABLE_SWEEP_SECONDS, DRAFT_ODDS_LINES_MAX_AGE_MS } from "./lines";

/** Longer than the cron function's max duration, so a crashed run cannot block tomorrow's. */
const DAILY_LOCK_SECONDS = 600;
/** Rookie drafts are short; the startup draft fills whole rosters. */
const STARTUP_MIN_ROUNDS = 10;
/**
 * The daily run starts no new one-liner call after this much of its 300-second budget (a call
 * is at most two 70-second tries, LINES_REQUEST). What is left goes out on the tick's sweep.
 */
export const DAILY_LINES_DEADLINE_MS = 150_000;
/** Same for the tick (its item write-ups come first). */
export const TICK_LINES_DEADLINE_MS = 150_000;

/** The FantasyCalc snapshot as a job outcome (null when there is nothing worth reporting). */
function snapshotOutcome(r: DailySnapshotResult, always: boolean): JobOutcome | null {
  if (r.status === "stored") return { job: "fantasycalc_snapshot", status: "ran", detail: `Stored the FantasyCalc values for ${r.date}. ${r.detail ?? ""}`.trim() };
  if (r.status === "error") return { job: "fantasycalc_snapshot", status: "error", detail: r.detail ?? "FantasyCalc snapshot failed." };
  if (!always) return null;
  const why = r.status === "present" ? "already stored" : r.status === "fixture" ? "fixture data, never stored" : "an earlier try failed, retrying later";
  return { job: "fantasycalc_snapshot", status: "skipped", detail: `FantasyCalc values for ${r.date}: ${why}.` };
}

export interface JobOptions {
  /** Use this league context instead of loading one (tests, or a caller that already has it). */
  ctx?: LeagueContext;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function planDraft(ctx: LeagueContext): PlanDraft | null {
  const d = ctx.draft;
  if (!d) return null;
  return {
    draftId: d.draft_id,
    status: d.status,
    isStartup: !ctx.league.previous_league_id || (d.settings.rounds ?? 0) >= STARTUP_MIN_ROUNDS,
    lastPicked: d.last_picked ?? null,
  };
}

const order = (o: JobOutcome) => {
  const i = JOB_ORDER.indexOf(o.job as (typeof JOB_ORDER)[number]);
  return i === -1 ? -1 : i;
};

export async function runDaily(now: Date = new Date(), opts: JobOptions & { schedule?: NflGame[] } = {}): Promise<JobRunReport> {
  const startedAt = Date.now();
  const t = now.getTime();
  const report = (outcomes: JobOutcome[], locked = false): JobRunReport => ({ kind: "daily", startedAt, finishedAt: Date.now(), locked, outcomes });

  let ctx: LeagueContext;
  try {
    ctx = opts.ctx ?? (await getLeagueContext());
  } catch (err) {
    return report([{ job: "league", status: "error", detail: `Could not load the league: ${errText(err)}` }]);
  }

  const lockKey = store.keys.lock(ctx.leagueId, "daily");
  if (!(await store.lock(lockKey, DAILY_LOCK_SECONDS).catch(() => false))) {
    return report([{ job: "daily", status: "skipped", detail: "Another daily run is in progress." }], true);
  }
  try {
    const schedule = opts.schedule ?? (await getSchedule(ctx.season).catch(() => [] as NflGame[]));
    const plan = planDaily({
      date: etDate(t),
      nowMs: t,
      phase: ctx.phase,
      season: ctx.season,
      currentWeek: ctx.week,
      startWeek: ctx.league.settings.start_week ?? 1,
      lastWeek: ctx.lastWeek,
      schedule,
      draft: planDraft(ctx),
    });
    // Today's values first: trade grades and hindsight in today's issues read them.
    const snapshot = snapshotOutcome(await ensureDailySnapshot(t), true);
    const ran = await Promise.all(plan.jobs.map((job) => runIssueJob(job, ctx, t, schedule)));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][plan.weekday];
    const head: JobOutcome = {
      job: "plan",
      status: "ran",
      detail: `${plan.date} (${weekday} ET), phase ${ctx.phase}, week ${ctx.week}${ctx.isDevLeague ? ", dev league" : ""}.`,
    };
    const lines = await refreshLines(ctx, { now: t, scope: "all", deadline: startedAt + DAILY_LINES_DEADLINE_MS }).catch(
      (err): JobOutcome => ({ job: "lines", status: "error", detail: errText(err) }),
    );
    const r = report([head, ...(snapshot ? [snapshot] : []), ...[...plan.skipped, ...ran].sort((a, b) => order(a) - order(b)), lines]);
    await logJobRun(ctx.leagueId, r);
    return r;
  } catch (err) {
    const r = report([{ job: "daily", status: "error", detail: errText(err) }]);
    await logJobRun(ctx.leagueId, r);
    return r;
  } finally {
    await store.unlock(lockKey).catch(() => {});
  }
}

export async function runTick(now: Date = new Date(), opts: JobOptions & { ignoreCooldown?: boolean } = {}): Promise<JobRunReport> {
  const startedAt = Date.now();
  const report = (outcomes: JobOutcome[], locked = false): JobRunReport => ({ kind: "tick", startedAt, finishedAt: Date.now(), locked, outcomes });
  // Locks first: the league id comes from env (or the caller's context), so a locked-out
  // request never touches Sleeper.
  const l = opts.ctx?.leagueId ?? envLeagueId();
  if (!opts.ignoreCooldown) {
    const got = await store.lock(store.keys.lock(l, "tick"), TICK_COOLDOWN_SECONDS).catch(() => false);
    if (!got) return report([], true);
  }
  const runKey = store.keys.lock(l, "tick-run");
  if (!(await store.lock(runKey, TICK_RUN_LOCK_SECONDS).catch(() => false))) return report([], true);
  try {
    let ctx: LeagueContext;
    try {
      ctx = opts.ctx ?? (await getLeagueContext());
    } catch (err) {
      return report([{ job: "league", status: "error", detail: `Could not load the league: ${errText(err)}` }]);
    }
    try {
      const t = now.getTime();
      const items = await tickOutcomes(ctx, t);
      const snapshot = snapshotOutcome(await ensureDailySnapshot(t), false);
      const lines = await tickLines(ctx, t, startedAt + TICK_LINES_DEADLINE_MS).catch(
        (err): JobOutcome => ({ job: "lines", status: "error", detail: errText(err) }),
      );
      const r = report([...items, ...(snapshot ? [snapshot] : []), ...(lines.status === "skipped" ? [] : [lines])]);
      if (r.outcomes.some((o) => o.status !== "skipped")) await logJobRun(ctx.leagueId, r);
      return r;
    } catch (err) {
      const r = report([{ job: "tick", status: "error", detail: errText(err) }]);
      await logJobRun(ctx.leagueId, r);
      return r;
    }
  } finally {
    await store.unlock(runKey).catch(() => {});
  }
}
