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
  it("Tuesday in season: Week N Recap for the week that just ended, and no Daily", () => {
    const plan = planDaily(input("2026-09-29"));
    expect(plan.weekday).toBe(2);
    expect(jobs(input("2026-09-29"))).toEqual(["weekly_recap:3"]);
    expect(plan.jobs.find((j) => j.job === "weekly_recap")?.key).toBe("weekly_recap:2026:3");
    expect(plan.skipped.map((s) => s.job)).toEqual(["draft_grades", "sunday_recap", "sunday_preview", "thursday_fallout", "daily"]);
    expect(plan.skipped.find((s) => s.job === "daily")?.detail).toBe("In season the weekly issues replace it.");
  });

  it("Friday in season: Thursday Night Fallout for this week", () => {
    expect(jobs(input("2026-09-25"))).toEqual(["thursday_fallout:3"]);
    expect(planDaily(input("2026-09-25")).jobs[0].key).toBe("thursday_fallout:2026:3");
  });

  it("Sunday in season: the Sunday Preview for the week played today", () => {
    expect(jobs(input("2026-09-27"))).toEqual(["sunday_preview:3"]);
    expect(planDaily(input("2026-09-27")).jobs[0].key).toBe("sunday_preview:2026:3");
  });

  it("Monday in season: the Sunday Recap for the week played yesterday", () => {
    expect(jobs(input("2026-09-28"))).toEqual(["sunday_recap:3"]);
    expect(planDaily(input("2026-09-28")).jobs[0].key).toBe("sunday_recap:2026:3");
  });

  it("a quiet Wednesday in season: nothing", () => {
    const plan = planDaily(input("2026-09-30"));
    expect(jobs(input("2026-09-30"))).toEqual([]);
    expect(plan.skipped.find((s) => s.job === "weekly_recap")?.detail).toBe("Only on Tuesdays.");
    expect(plan.skipped.find((s) => s.job === "sunday_preview")?.detail).toBe("Only on Sundays.");
  });

  it("the Sunday issues skip weeks that are not league weeks and the offseason", () => {
    expect(jobs(input("2026-09-20", { startWeek: 3 }))).toEqual([]);
    expect(planDaily(input("2026-09-20", { startWeek: 3 })).skipped.find((s) => s.job === "sunday_preview")?.detail).toBe("Week 2 is not a league week.");
    expect(jobs(input("2026-09-28", { phase: "offseason" }))).toEqual(["daily"]);
  });

  it("pre-draft: no weekly or Thursday issues even on Tuesday and Friday", () => {
    const pre = { phase: "pre_draft" as const, currentWeek: 2, draft: { draftId: "draft-1", status: "pre_draft" as const, isStartup: true, lastPicked: null } };
    expect(jobs(input("2026-09-22", pre))).toEqual(["daily"]);
    expect(jobs(input("2026-09-25", pre))).toEqual(["daily"]);
    expect(planDaily(input("2026-09-22", pre)).skipped.find((s) => s.job === "draft_grades")?.detail).toBe("Draft is pre draft.");
  });

  it("drafting: The Daily covers the picks; nothing else", () => {
    const live = { phase: "drafting" as const, draft: { draftId: "draft-1", status: "drafting" as const, isStartup: true, lastPicked: at("2026-09-21") } };
    expect(jobs(input("2026-09-22", live))).toEqual(["daily"]);
    expect(jobs(input("2026-09-25", live))).toEqual(["daily"]);
  });

  it("the morning after the startup draft completes: Draft Grades once", () => {
    const done = { phase: "in_season" as const, draft: { draftId: "draft-1", status: "complete" as const, isStartup: true, lastPicked: at("2026-09-23") - 3600_000 } };
    expect(jobs(input("2026-09-24", done))).toEqual(["draft_grades"]);
    expect(planDaily(input("2026-09-24", done)).jobs[0].key).toBe("draft_grades:draft-1");
    // a rookie draft never gets Draft Grades, and a long-finished startup draft is not re-graded
    expect(jobs(input("2026-09-24", { draft: { ...done.draft, isStartup: false } }))).toEqual([]);
    const late = planDaily(input("2026-11-25", done));
    expect(late.jobs.map((j) => j.job)).toEqual([]);
    expect(late.skipped.find((s) => s.job === "draft_grades")?.detail).toBe("Draft finished more than 21 days ago.");
  });

  it("the Tuesday after the championship still gets its Week N Recap; week 18 does not", () => {
    expect(jobs(input("2027-01-05", { phase: "complete" }))).toEqual(["weekly_recap:17", "daily"]);
    expect(jobs(input("2027-01-12", { phase: "offseason" }))).toEqual(["daily"]);
  });

  it("weeks before the league's start week are skipped", () => {
    expect(jobs(input("2026-09-22", { startWeek: 3 }))).toEqual([]);
    expect(jobs(input("2026-09-29", { startWeek: 3 }))).toEqual(["weekly_recap:3"]);
  });

  it("falls back to the league's current week when the schedule is unavailable", () => {
    expect(jobs(input("2026-09-29", { schedule: [], currentWeek: 3 }))).toEqual(["weekly_recap:3"]);
    expect(jobs(input("2026-09-25", { schedule: [], currentWeek: 3 }))).toEqual(["thursday_fallout:3"]);
    expect(jobs(input("2026-09-27", { schedule: [], currentWeek: 3 }))).toEqual(["sunday_preview:3"]);
  });
});
