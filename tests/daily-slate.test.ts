import { describe, expect, it } from "vitest";
import { planDaily } from "@/lib/roast/plan";
import type { DailyFacts, TeamRef, TeamWinProb, WinProb } from "@/lib/types";

const team = (rosterId: number, managerName: string, teamName = managerName): TeamRef => ({ rosterId, managerName, teamName, managerKey: managerName.toLowerCase() });
const side = (t: TeamRef, projected: number, winProb: number): TeamWinProb => ({ team: t, actual: 0, projected, mean: projected, sd: 20, winProb, starters: [] });
const matchup = (id: number, home: TeamWinProb, away: TeamWinProb): WinProb => ({ week: 3, matchupId: id, home, away, isFinal: false });

const quiet = (slate: DailyFacts["slate"]): DailyFacts => ({
  kind: "daily",
  date: "2026-09-24",
  sinceMs: 0,
  trades: [],
  waivers: [],
  injuries: [],
  lineupAlerts: [],
  draftPicks: [],
  slate,
  hasMaterial: true,
});

describe("the Daily on a week's first game day", () => {
  const slate = {
    week: 3,
    first: true,
    matchups: [
      matchup(1, side(team(1, "Justin", "Shough and Fhough"), 161.14, 0.321), side(team(2, "Brandon"), 183.08, 0.679)),
      matchup(5, side(team(3, "Peter"), 189.6, 0.77), side(team(4, "Anish"), 155.8, 0.23)),
    ],
  };

  it("previews every matchup with projections and win odds, and opens on the biggest underdog", () => {
    const plan = planDaily(quiet(slate), 100);
    expect(plan.facts.week).toBe(3);
    expect(plan.facts.matchups).toEqual([
      { home: { manager: "Justin", team: "Shough and Fhough", projected: 161.1, winPct: 32 }, away: { manager: "Brandon", team: "Brandon", projected: 183.1, winPct: 68 } },
      { home: { manager: "Peter", team: "Peter", projected: 189.6, winPct: 77 }, away: { manager: "Anish", team: "Anish", projected: 155.8, winPct: 23 } },
    ]);
    expect(plan.slots.find((s) => s.id === "cold-open")?.brief).toMatch(/about Anish, the biggest underdog of week 3, the league's first real week/);
    expect(plan.slots.map((s) => s.id)).toContain("slate");
    const section = plan.sections.find((s) => s.heading === "Week 3: the slate");
    expect(section?.blocks.find((b) => b.type === "table")).toMatchObject({ rows: [["Shough and Fhough (Justin)", "161.1", "32%", "Brandon", "183.1", "68%"], ["Peter", "189.6", "77%", "Anish", "155.8", "23%"]] });
    expect(plan.task).toContain("and the slate for week 3, the league's first real week.");
    expect(plan.managers.sort()).toEqual(["Anish", "Brandon", "Justin", "Peter"]);
  });

  it("names each side's best and weakest starters and who plays tonight", () => {
    const line = (playerId: string, name: string, position: string, nflTeam: string, projected: number) =>
      ({ playerId, name, position, slot: position, nflTeam, actual: 0, projected, fractionRemaining: 1, expected: projected, status: "pre" }) as TeamWinProb["starters"][number];
    const home = { ...side(team(1, "Justin"), 150, 0.4), starters: [line("1", "Ace", "QB", "BUF", 22.4), line("2", "Deuce", "WR", "MIA", 15.06), line("3", "Dud", "TE", "KC", 2.1), line("0", "Empty", "FLEX", "", 0)] };
    const away = side(team(2, "Brandon"), 160, 0.6);
    const plan = planDaily(quiet({ week: 3, first: false, matchups: [matchup(1, home, away)], tonight: ["MIA", "BUF"] }), 100);
    const m = (plan.facts.matchups as Array<{ home: Record<string, unknown>; away: Record<string, unknown> }>)[0];
    expect(m.home.stars).toEqual([{ name: "Ace", pos: "QB", projected: 22.4 }, { name: "Deuce", pos: "WR", projected: 15.1 }]);
    expect(m.home.weakest).toEqual({ name: "Dud", pos: "TE", projected: 2.1 });
    expect(m.home.tonight).toEqual([{ name: "Ace", pos: "QB", projected: 22.4 }, { name: "Deuce", pos: "WR", projected: 15.1 }]);
    expect(m.away).not.toHaveProperty("stars");
    expect(plan.slots.find((s) => s.id === "cold-open")?.brief).toMatch(/about Justin, the biggest underdog of week 3\./);
  });

  it("a matchup's two win chances add to 100, even when both would round up (37.5 and 62.5)", () => {
    const plan = planDaily(quiet({ week: 3, first: false, matchups: [matchup(1, side(team(1, "Justin"), 150, 0.375), side(team(2, "Brandon"), 160, 0.625))] }), 100);
    const m = (plan.facts.matchups as Array<{ home: Record<string, unknown>; away: Record<string, unknown> }>)[0];
    expect([m.home.winPct, m.away.winPct]).toEqual([38, 62]);
    const section = plan.sections.find((s) => s.heading === "Week 3: the slate");
    expect(section?.blocks.find((b) => b.type === "table")).toMatchObject({ rows: [["Justin", "150.0", "38%", "Brandon", "160.0", "62%"]] });
  });

  it("every matchup's win chances add to 100", () => {
    for (let k = 0; k <= 200; k++) {
      const p = k / 200;
      const plan = planDaily(quiet({ week: 3, first: false, matchups: [matchup(1, side(team(1, "Justin"), 150, p), side(team(2, "Brandon"), 160, 1 - p))] }), 100);
      const m = (plan.facts.matchups as Array<{ home: { winPct: number }; away: { winPct: number } }>)[0];
      expect(m.home.winPct + m.away.winPct, `home ${p}`).toBe(100);
    }
  });

  it("leaves the Daily as it was without a slate", () => {
    const plan = planDaily(quiet(null), 100);
    expect(plan.facts.matchups).toBeUndefined();
    expect(plan.slots.map((s) => s.id)).not.toContain("slate");
  });
});
