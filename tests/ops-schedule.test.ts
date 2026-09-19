/** Which issues the daily cron plans for sample America/New_York dates and league phases. */
import { describe, expect, it } from "vitest";
import { addDays, earlyGamesWeekFor, planDaily, recapWeekFor, upcomingWeekFor, type PlanInput } from "@/lib/jobs/schedule";
import { etDate, etToMs } from "@/lib/time";
import { fakeSchedule } from "./ops-helpers";

const schedule = fakeSchedule();
const at = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return etToMs(y, m, d, 8, 0);
};

function input(date: string, over: Partial<PlanInput> = {}): PlanInput {
  return {
    date,
    nowMs: at(date),
    phase: "in_season",
    season: "2026",
    currentWeek: 4,
    startWeek: 1,
    lastWeek: 17,
    schedule,
    draft: { draftId: "draft-1", status: "complete", isStartup: true, lastPicked: at("2026-08-05") },
    ...over,
  };
}

const jobs = (i: PlanInput) => planDaily(i).jobs.map((j) => ("week" in j ? `${j.job}:${j.week}` : j.job));

describe("date helpers", () => {
  it("the cron's 12:00 UTC is the same ET date, morning", () => {
    expect(etDate(new Date("2026-09-29T12:00:00Z"))).toBe("2026-09-29");
    expect(etDate(new Date("2026-12-01T12:00:00Z"))).toBe("2026-12-01");
    // late evening ET is still the previous calendar day
    expect(etDate(new Date("2026-09-30T02:30:00Z"))).toBe("2026-09-29");
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("finds the recap, early-game and upcoming weeks from game dates", () => {
    expect(recapWeekFor(schedule, "2026-09-29")).toBe(3);
    // Monday: week 3's Monday game is still to come and week 2 ended a week ago
    expect(recapWeekFor(schedule, "2026-09-28")).toBeNull();
    expect(earlyGamesWeekFor(schedule, "2026-09-25")).toBe(3);
    expect(earlyGamesWeekFor(schedule, "2026-09-26")).toBe(3);
    expect(earlyGamesWeekFor(schedule, "2026-09-30")).toBeNull();
    expect(upcomingWeekFor(schedule, "2026-09-29")).toBe(4);
    expect(upcomingWeekFor(schedule, "2026-09-27")).toBe(3);
  });
});

describe("planDaily", () => {
  it("Tuesday in season: The Weekly Roast for the week that just ended, plus The Daily Roast", () => {
    const plan = planDaily(input("2026-09-29"));
    expect(plan.weekday).toBe(2);
    expect(jobs(input("2026-09-29"))).toEqual(["weekly_roast:3", "daily_roast"]);
    expect(plan.jobs.find((j) => j.job === "weekly_roast")?.key).toBe("weekly_roast:2026:3");
    expect(plan.skipped.map((s) => s.job)).toEqual(["draft_grades", "thursday_fallout"]);
  });

  it("Friday in season: Thursday Night Fallout for this week, plus The Daily Roast", () => {
    expect(jobs(input("2026-09-25"))).toEqual(["thursday_fallout:3", "daily_roast"]);
    expect(planDaily(input("2026-09-25")).jobs[0].key).toBe("thursday_fallout:2026:3");
  });

  it("a quiet Wednesday in season: only The Daily Roast (which sends nothing without material)", () => {
    const plan = planDaily(input("2026-09-30"));
    expect(jobs(input("2026-09-30"))).toEqual(["daily_roast"]);
    expect(plan.jobs[0].key).toBe("daily_roast:2026-09-30");
    expect(plan.skipped.find((s) => s.job === "weekly_roast")?.detail).toBe("Only on Tuesdays.");
  });

  it("pre-draft: no weekly or Thursday issues even on Tuesday and Friday", () => {
    const pre = { phase: "pre_draft" as const, currentWeek: 2, draft: { draftId: "draft-1", status: "pre_draft" as const, isStartup: true, lastPicked: null } };
    expect(jobs(input("2026-09-22", pre))).toEqual(["daily_roast"]);
    expect(jobs(input("2026-09-25", pre))).toEqual(["daily_roast"]);
    expect(planDaily(input("2026-09-22", pre)).skipped.find((s) => s.job === "draft_grades")?.detail).toBe("Draft is pre draft.");
  });

  it("drafting: The Daily Roast covers the picks; nothing else", () => {
    const live = { phase: "drafting" as const, draft: { draftId: "draft-1", status: "drafting" as const, isStartup: true, lastPicked: at("2026-09-21") } };
    expect(jobs(input("2026-09-22", live))).toEqual(["daily_roast"]);
    expect(jobs(input("2026-09-25", live))).toEqual(["daily_roast"]);
  });

  it("the morning after the startup draft completes: Draft Grades once", () => {
    const done = { phase: "in_season" as const, draft: { draftId: "draft-1", status: "complete" as const, isStartup: true, lastPicked: at("2026-09-23") - 3600_000 } };
    expect(jobs(input("2026-09-24", done))).toEqual(["draft_grades", "daily_roast"]);
    expect(planDaily(input("2026-09-24", done)).jobs[0].key).toBe("draft_grades:draft-1");
    // a rookie draft never gets Draft Grades, and a long-finished startup draft is not re-graded
    expect(jobs(input("2026-09-24", { draft: { ...done.draft, isStartup: false } }))).toEqual(["daily_roast"]);
    const late = planDaily(input("2026-11-25", done));
    expect(late.jobs.map((j) => j.job)).toEqual(["daily_roast"]);
    expect(late.skipped.find((s) => s.job === "draft_grades")?.detail).toBe("Draft finished more than 21 days ago.");
  });

  it("the Tuesday after the championship still gets its Weekly Roast; week 18 does not", () => {
    expect(jobs(input("2027-01-05", { phase: "complete" }))).toEqual(["weekly_roast:17", "daily_roast"]);
    expect(jobs(input("2027-01-12", { phase: "offseason" }))).toEqual(["daily_roast"]);
  });

  it("weeks before the league's start week are skipped", () => {
    expect(jobs(input("2026-09-22", { startWeek: 3 }))).toEqual(["daily_roast"]);
    expect(jobs(input("2026-09-29", { startWeek: 3 }))).toEqual(["weekly_roast:3", "daily_roast"]);
  });

  it("falls back to the league's current week when the schedule is unavailable", () => {
    expect(jobs(input("2026-09-29", { schedule: [], currentWeek: 3 }))).toEqual(["weekly_roast:3", "daily_roast"]);
    expect(jobs(input("2026-09-25", { schedule: [], currentWeek: 3 }))).toEqual(["thursday_fallout:3", "daily_roast"]);
  });
});
