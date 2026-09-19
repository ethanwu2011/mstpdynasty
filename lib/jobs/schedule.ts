/**
 * Which issues the daily cron builds on a given America/New_York date. Pure (no I/O) so
 * every decision is unit tested with hand-built schedules.
 *
 *   The Daily Roast         every day; it only gets built when there is material
 *   Thursday Night Fallout  Fridays in season, when the week had an early (Wed/Thu) game
 *   The Weekly Roast        Tuesdays, for the league week that ended in the last six days
 *                           (also the Tuesday right after the championship week)
 *   Draft Grades            once, after the startup draft completes (within 21 days)
 *
 * Weeks come from the NFL schedule's game dates, not from Sleeper's NFL state (which flips
 * weeks on its own timetable). With no schedule, the league's current week is the fallback.
 */
import { weekdayOfDate } from "@/lib/time";
import type { IssueKind, JobOutcome, NflGame, SeasonPhase, SleeperDraftStatus } from "@/lib/types";

export const DAY_MS = 24 * 3600 * 1000;
/** Draft Grades are only built this long after the last pick (a wiped store must not re-send them months later). */
export const DRAFT_GRADES_WINDOW_DAYS = 21;

const TUESDAY = 2;
const FRIDAY = 5;

/** "YYYY-MM-DD" plus n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return t.toISOString().slice(0, 10);
}

function datesByWeek(schedule: NflGame[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const g of schedule) {
    if (!g.date || !Number.isFinite(g.week)) continue;
    const list = out.get(g.week) ?? [];
    list.push(g.date);
    out.set(g.week, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

/** The week whose last game was 1 to 6 days before `date` (the latest one if several). */
export function recapWeekFor(schedule: NflGame[], date: string): number | null {
  const from = addDays(date, -6);
  let best: number | null = null;
  for (const [week, dates] of datesByWeek(schedule)) {
    const last = dates[dates.length - 1];
    if (last < date && last >= from && (best === null || week > best)) best = week;
  }
  return best;
}

/** The week that had a game on one of the two days before `date` and still has games left. */
export function earlyGamesWeekFor(schedule: NflGame[], date: string): number | null {
  const window = new Set([addDays(date, -1), addDays(date, -2)]);
  for (const [week, dates] of datesByWeek(schedule)) {
    if (dates.some((d) => window.has(d)) && dates.some((d) => d >= date)) return week;
  }
  return null;
}

/** The first week with a game on or after `date` (the week lineups are being set for). */
export function upcomingWeekFor(schedule: NflGame[], date: string): number | null {
  let best: number | null = null;
  for (const [week, dates] of datesByWeek(schedule)) {
    if (dates.some((d) => d >= date) && (best === null || week < best)) best = week;
  }
  return best;
}

/** The most common game date of a week (its Sunday, in practice). */
export function mainDateOfWeek(schedule: NflGame[], week: number): string | null {
  const counts = new Map<string, number>();
  for (const g of schedule) if (g.week === week && g.date) counts.set(g.date, (counts.get(g.date) ?? 0) + 1);
  let best: string | null = null;
  for (const [d, c] of counts) if (best === null || c > (counts.get(best) ?? 0) || (c === counts.get(best) && d < best)) best = d;
  return best;
}

export interface PlanDraft {
  draftId: string;
  status: SleeperDraftStatus;
  /** The league's first-ever (startup) draft, as opposed to a rookie draft. */
  isStartup: boolean;
  /** Sleeper `last_picked`, epoch ms. */
  lastPicked: number | null;
}

export interface PlanInput {
  /** ET calendar date, "YYYY-MM-DD". */
  date: string;
  nowMs: number;
  phase: SeasonPhase;
  season: string;
  /** ctx.week: fallback when the schedule is unavailable. */
  currentWeek: number;
  /** First league week (Sleeper settings.start_week, default 1). */
  startWeek: number;
  /** Last league week (championship). */
  lastWeek: number;
  /** NFL regular-season schedule for the league season (may be empty). */
  schedule: NflGame[];
  draft: PlanDraft | null;
}

export type PlannedJob =
  | { job: "draft_grades"; key: string; draftId: string }
  | { job: "weekly_roast"; key: string; week: number }
  | { job: "thursday_fallout"; key: string; week: number }
  | { job: "daily_roast"; key: string };

export interface DailyPlan {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  jobs: PlannedJob[];
  /** One entry per issue kind that is not planned today, with the reason. */
  skipped: JobOutcome[];
}

/** Execution and report order. */
export const JOB_ORDER: IssueKind[] = ["draft_grades", "weekly_roast", "thursday_fallout", "daily_roast"];

const skip = (job: IssueKind, detail: string): JobOutcome => ({ job, status: "skipped", detail });

export function planDaily(input: PlanInput): DailyPlan {
  const { date, phase, season, startWeek, lastWeek, schedule, draft } = input;
  const weekday = weekdayOfDate(date);
  const jobs: PlannedJob[] = [];
  const skipped: JobOutcome[] = [];
  const hasGames = phase !== "pre_draft" && phase !== "drafting";
  const inRange = (w: number) => w >= Math.max(1, startWeek) && w <= lastWeek;

  // Draft Grades: once, after the startup draft completes.
  if (!draft) skipped.push(skip("draft_grades", "No draft."));
  else if (!draft.isStartup) skipped.push(skip("draft_grades", "Not the startup draft."));
  else if (draft.status !== "complete") skipped.push(skip("draft_grades", `Draft is ${draft.status.replace(/_/g, " ")}.`));
  else if (draft.lastPicked !== null && input.nowMs - draft.lastPicked > DRAFT_GRADES_WINDOW_DAYS * DAY_MS) {
    skipped.push(skip("draft_grades", `Draft finished more than ${DRAFT_GRADES_WINDOW_DAYS} days ago.`));
  } else jobs.push({ job: "draft_grades", key: `draft_grades:${draft.draftId}`, draftId: draft.draftId });

  // The Weekly Roast: Tuesdays, recap of the week that just ended.
  if (weekday !== TUESDAY) skipped.push(skip("weekly_roast", "Only on Tuesdays."));
  else if (!hasGames) skipped.push(skip("weekly_roast", "No games before the draft is done."));
  else {
    const week = schedule.length ? recapWeekFor(schedule, date) : phase === "in_season" ? input.currentWeek : null;
    if (!week) skipped.push(skip("weekly_roast", "No week ended in the last six days."));
    else if (!inRange(week)) skipped.push(skip("weekly_roast", `Week ${week} is not a league week.`));
    else if (phase !== "in_season" && week !== lastWeek) skipped.push(skip("weekly_roast", "Not in season."));
    else jobs.push({ job: "weekly_roast", key: `weekly_roast:${season}:${week}`, week });
  }

  // Thursday Night Fallout: Fridays in season, after an early-week game.
  if (weekday !== FRIDAY) skipped.push(skip("thursday_fallout", "Only on Fridays."));
  else if (phase !== "in_season") skipped.push(skip("thursday_fallout", "Not in season."));
  else {
    const week = schedule.length ? earlyGamesWeekFor(schedule, date) : input.currentWeek || null;
    if (!week) skipped.push(skip("thursday_fallout", "No Thursday game this week."));
    else if (!inRange(week)) skipped.push(skip("thursday_fallout", `Week ${week} is not a league week.`));
    else jobs.push({ job: "thursday_fallout", key: `thursday_fallout:${season}:${week}`, week });
  }

  // The Daily Roast: every day, built only when there is material.
  jobs.push({ job: "daily_roast", key: `daily_roast:${date}` });

  const order = (k: string) => JOB_ORDER.indexOf(k as IssueKind);
  jobs.sort((a, b) => order(a.job) - order(b.job));
  skipped.sort((a, b) => order(a.job) - order(b.job));
  return { date, weekday, jobs, skipped };
}
