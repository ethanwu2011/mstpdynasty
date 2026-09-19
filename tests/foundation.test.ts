/** Foundation smoke tests: store, fixture paths, league context, ESPN + FantasyCalc parsing. */
import { describe, expect, it } from "vitest";
import { fixtureRelPath } from "@/lib/http";
import { getStore } from "@/lib/store";
import { computePhase, getLeagueContext, seasonWeeks, standingsFromRosters } from "@/lib/league";
import { fractionRemaining, getGameClocks } from "@/lib/espn";
import { getFantasyCalc, pickValue } from "@/lib/fantasycalc";
import { byeTeams, getDraftPicks, getSchedule, getTransactions, sleeperUrl } from "@/lib/sleeper";
import { etDate, etToMs, weekdayOfDate } from "@/lib/time";
import type { NflState, SleeperLeague } from "@/lib/types";
import { hasFixtures, loadManifest } from "./helpers/fixtures";

describe("store (memory backend under vitest)", () => {
  it("get/set/del/list/lock", async () => {
    const s = getStore();
    expect(s.backend).toBe("memory");
    await s.set("t:a", { x: 1 });
    await s.set("t:b", [1, 2]);
    await s.set("u:c", "no");
    expect(await s.get("t:a")).toEqual({ x: 1 });
    expect(await s.list("t:")).toEqual(["t:a", "t:b"]);
    await s.del("t:a");
    expect(await s.get("t:a")).toBeNull();
    expect(await s.lock("lk", 60)).toBe(true);
    expect(await s.lock("lk", 60)).toBe(false);
    await s.unlock("lk");
    expect(await s.lock("lk", 60)).toBe(true);
  });
});

describe("fixture paths", () => {
  it("mirror the URL, with a sorted sanitized query", () => {
    expect(fixtureRelPath(sleeperUrl.matchups("123", 4))).toBe("sleeper/v1/league/123/matchups/4.json");
    expect(fixtureRelPath(sleeperUrl.projections("2025", 1))).toBe(
      "sleeper/projections/nfl/2025/1@position__=QB+position__=RB+position__=TE+position__=WR+season_type=regular.json",
    );
  });
});

describe("time", () => {
  it("formats Eastern dates and converts wall clock to ms", () => {
    expect(etDate(Date.UTC(2026, 8, 19, 1, 0))).toBe("2026-09-18");
    expect(etToMs(2026, 9, 18, 21, 0)).toBe(Date.UTC(2026, 8, 19, 1, 0));
    expect(weekdayOfDate("2026-09-18")).toBe(5);
  });
});

describe("phase", () => {
  const league = (status: SleeperLeague["status"], season = "2026") =>
    ({ status, season, settings: { playoff_week_start: 15, playoff_teams: 6 } }) as unknown as SleeperLeague;
  const state = (week: number, season = "2026", season_type = "regular") => ({ week, season, season_type }) as NflState;

  it("covers pre_draft, drafting, in_season, offseason, complete", () => {
    expect(seasonWeeks(league("in_season"))).toEqual({ playoffWeekStart: 15, lastRegularSeasonWeek: 14, lastWeek: 17 });
    expect(computePhase(league("pre_draft"), null, state(2), 17)).toBe("pre_draft");
    expect(computePhase(league("pre_draft"), { status: "drafting" } as never, state(2), 17)).toBe("drafting");
    expect(computePhase(league("drafting"), { status: "paused" } as never, state(2), 17)).toBe("drafting");
    expect(computePhase(league("in_season"), null, state(5), 17)).toBe("in_season");
    expect(computePhase(league("in_season"), null, state(18), 17)).toBe("offseason");
    expect(computePhase(league("in_season", "2025"), null, state(2), 17)).toBe("offseason");
    expect(computePhase(league("complete", "2025"), null, state(2), 17)).toBe("complete");
  });

  it("espn fraction remaining", () => {
    expect(fractionRemaining("pre", 0, 0)).toBe(1);
    expect(fractionRemaining("post", 4, 0)).toBe(0);
    expect(fractionRemaining("in", 2, 0)).toBe(0.5);
    expect(fractionRemaining("in", 3, 450)).toBe(0.375);
    expect(fractionRemaining("in", 5, 300)).toBe(0);
  });
});

describe.skipIf(!hasFixtures())("fixture-backed data layer", () => {
  it("loads the MSTP context: pre-draft, 10 managers all matched", async () => {
    const ctx = await getLeagueContext({ leagueId: loadManifest().mstp.leagueId });
    expect(ctx.league.name).toBe("MSTP Dynasty");
    expect(ctx.managers).toHaveLength(10);
    expect(ctx.managers.every((m) => m.matched)).toBe(true);
    expect(ctx.managers.find((m) => m.isCommissioner)?.name).toBe("Ethan");
    expect(ctx.starterSlots).toHaveLength(11);
    expect(ctx.isDevLeague).toBe(false);
  });

  it("loads the RT context: complete, standings, draft, transactions", async () => {
    const m = loadManifest();
    const ctx = await getLeagueContext({ leagueId: m.rt.leagueId });
    expect(ctx.phase).toBe("complete");
    expect(ctx.isDevLeague).toBe(true);
    expect(ctx.week).toBe(17);
    const standings = standingsFromRosters(ctx);
    expect(standings).toHaveLength(10);
    const totalWins = standings.reduce((s, r) => s + r.wins + r.ties / 2, 0);
    expect(totalWins).toBe(70); // 10 teams x 14 regular-season weeks / 2
    const picks = await getDraftPicks(m.rt.draftIds[0]);
    expect(picks.length).toBeGreaterThan(0);
    const txs = await getTransactions(m.rt.leagueId, 1);
    expect(txs.some((t) => t.type === "trade")).toBe(true);
    expect(txs.some((t) => t.type === "waiver" && t.status === "failed")).toBe(true);
  });

  it("schedule, byes, ESPN clocks and FantasyCalc parse", async () => {
    const schedule = await getSchedule("2025");
    expect(schedule.filter((g) => g.week === 1)).toHaveLength(16);
    expect(byeTeams(schedule, 5).length).toBeGreaterThan(0);
    const clocks = await getGameClocks({ season: "2025", week: 1 });
    expect(clocks).toHaveLength(16);
    expect(clocks.every((c) => c.state === "post" && c.fractionRemaining === 0)).toBe(true);
    expect(clocks.some((c) => c.home === "WAS" || c.away === "WAS")).toBe(true);
    const fc = await getFantasyCalc();
    expect(Object.keys(fc.bySleeperId).length).toBeGreaterThan(300);
    expect(pickValue(fc, Number(fc.date.slice(0, 4)) + 1, 1)).not.toBeNull();
  });
});
