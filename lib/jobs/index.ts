/**
 * Jobs public API. OWNER: ops agent (lib/jobs/**, lib/email/**, app/api/**, proxy.ts,
 * app/enter/**, app/subscribe/**, tests/ops*).
 *
 * FOUNDATION STUB: reports every job as skipped. The real implementation:
 *   runDaily(now): called by /api/cron/daily once a day. Decides by ET date and league phase:
 *     The Daily Roast every day (only when there is material), Thursday Night Fallout on
 *     Fridays in season, The Weekly Roast on Tuesdays in season, Draft Grades once after the
 *     startup draft completes; stores a weekly odds snapshot; never emails about a dev league.
 *   runTick(now): called via after() from page renders and /api/tick. Under a KV lock with a
 *     2-minute cooldown, roasts any new trades, waiver batches and draft picks (saved through
 *     lib/archive.ts) and records first-seen timestamps for draft picks.
 */
import type { JobRunReport } from "@/lib/types";

const TICK_COOLDOWN_SECONDS = 120;

export async function runDaily(now: Date = new Date()): Promise<JobRunReport> {
  const t = now.getTime();
  return {
    kind: "daily",
    startedAt: t,
    finishedAt: Date.now(),
    locked: false,
    outcomes: [
      { job: "daily_roast", status: "skipped", detail: "Not implemented yet (foundation stub)." },
      { job: "thursday_fallout", status: "skipped", detail: "Not implemented yet (foundation stub)." },
      { job: "weekly_roast", status: "skipped", detail: "Not implemented yet (foundation stub)." },
      { job: "draft_grades", status: "skipped", detail: "Not implemented yet (foundation stub)." },
    ],
  };
}

export async function runTick(now: Date = new Date()): Promise<JobRunReport> {
  const t = now.getTime();
  return {
    kind: "tick",
    startedAt: t,
    finishedAt: Date.now(),
    locked: false,
    outcomes: [
      { job: "roast_trades", status: "skipped", detail: `Not implemented yet (foundation stub). Cooldown will be ${TICK_COOLDOWN_SECONDS}s.` },
      { job: "roast_waivers", status: "skipped", detail: "Not implemented yet (foundation stub)." },
      { job: "roast_picks", status: "skipped", detail: "Not implemented yet (foundation stub)." },
    ],
  };
}
