/**
 * Win chances a matchup prints add to 100: at one decimal in Thursday Night Fallout, the Sunday
 * Recap and the pre-kickoff memory (sidePct1), and whole in the pregame matchup lines (sidePct).
 * Hand-built win probabilities; the models and facts modules are mocked. No fixtures, no network.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/models", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/models")>();
  return { ...mod, getWinProbabilities: vi.fn() };
});
vi.mock("@/lib/facts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/facts")>();
  const offline = async () => Promise.reject(new Error("not in these tests"));
  return { ...mod, draftFacts: vi.fn(offline), shameEntries: vi.fn(offline), loserOfTheWeekCounts: vi.fn(offline) };
});

import { getWinProbabilities } from "@/lib/models";
import { issueMemory } from "@/lib/roast/memory";
import { EMPTY_MEMORY, type PayloadMemory } from "@/lib/roast/memory-shape";
import { planSundayPreview, planSundayRecap, planThursday, sidePct1 } from "@/lib/roast/plan";
import { pregameMatchupRows } from "@/lib/roast/surface-rows";
import type { SundayPreviewFacts, SundayRecapFacts, TeamRef, TeamWinProb, ThursdayFalloutFacts, WinProb, WinProbWeek } from "@/lib/types";
import { fakeCtx } from "./ops-helpers";

const team = (id: number): TeamRef => ({ rosterId: id, teamName: `Team ${id}`, managerName: `Manager ${id}`, managerKey: `m${id}` });
const side = (id: number, winProb: number): TeamWinProb => ({ team: team(id), actual: 20, projected: 120, mean: 120, sd: 20, winProb, starters: [] });
const matchup = (id: number, home: TeamWinProb, away: TeamWinProb): WinProb => ({ week: 4, matchupId: id, home, away, isFinal: false });
const week = (matchups: WinProb[]): WinProbWeek => ({ week: 4, season: "2026", generatedAt: 0, basis: "live", matchups, placeholder: false });

// Each pair would round up on its own: 37.55 and 62.45 (37.6 + 62.5), 37.5 and 62.5 (38 + 63).
const DECIMAL = week([matchup(1, side(1, 0.3755), side(2, 0.6245))]);
const WHOLE = week([matchup(1, side(1, 0.375), side(2, 0.625))]);

describe("sidePct1", () => {
  it("the away side is 100 minus the home side at one decimal, for any win probability", () => {
    for (let k = 0; k <= 10_000; k++) {
      const m = matchup(1, side(1, k / 10_000), side(2, 1 - k / 10_000));
      expect(sidePct1(m, m.home) + sidePct1(m, m.away), `home ${k / 10_000}`).toBe(100);
    }
  });
});

describe("Thursday Night Fallout", () => {
  it("prints one-decimal win chances that add to 100, in the facts and the table", () => {
    const f: ThursdayFalloutFacts = { kind: "thursday_fallout", week: 4, tnf: { week: 4, games: [], players: [], teams: [], placeholder: false }, winProbs: DECIMAL };
    const plan = planThursday(f);
    const [m] = plan.facts.matchups as Array<{ home: { winPct: number }; away: { winPct: number } }>;
    expect([m.home.winPct, m.away.winPct]).toEqual([37.6, 62.4]);
    const table = plan.sections.find((s) => s.heading === "Where it stands")?.blocks.find((b) => b.type === "table");
    expect(table?.type === "table" && table.rows).toEqual([["Team 1", 37.6, "Team 2", 62.4]]);
  });
});

describe("the pre-kickoff odds in the league memory", () => {
  it("are exact (two decimals) and add to 100", async () => {
    vi.mocked(getWinProbabilities).mockResolvedValue(DECIMAL);
    const f: ThursdayFalloutFacts = { kind: "thursday_fallout", week: 4, tnf: { week: 4, games: [], players: [], teams: [], placeholder: false }, winProbs: DECIMAL };
    const mem = await issueMemory(f, fakeCtx());
    expect(getWinProbabilities).toHaveBeenCalledWith(4, expect.anything(), { pregame: true });
    // Exact (two decimals, adding to 100): the issues round when they print, from the home side.
    expect(mem.winPctBefore).toEqual({ 1: 37.55, 2: 62.45 });
  });
});

describe("pregame matchup lines", () => {
  it("quote whole win chances that add to 100, like the card beside them", () => {
    const [row] = pregameMatchupRows(WHOLE);
    const teams = (row.facts as { teams: Array<{ manager: string; winPct: number }> }).teams;
    expect(teams.map((t) => [t.manager, t.winPct])).toEqual([
      ["Manager 1", 38],
      ["Manager 2", 62],
    ]);
  });
});

describe("pre-kickoff odds are rounded once, when an issue prints them", () => {
  type Side = { winPct: number; winPctBefore?: number };

  it("the Sunday Preview leaves winPctBefore out when p = 0.3246 before kickoff and now (no swing, only rounding)", async () => {
    // Matchup 1 did not move; matchup 2 slid from 45.1 to 32.46, a real swing.
    const pregame = week([matchup(1, side(1, 0.3246), side(2, 0.6754)), matchup(2, side(3, 0.451), side(4, 0.549))]);
    const now = week([matchup(1, side(1, 0.3246), side(2, 0.6754)), matchup(2, side(3, 0.3246), side(4, 0.6754))]);
    vi.mocked(getWinProbabilities).mockResolvedValue(pregame);
    const f: SundayPreviewFacts = { kind: "sunday_preview", week: 4, winProbs: now, lineupAlerts: [] };
    const plan = planSundayPreview(f, await issueMemory(f, fakeCtx()));
    const m1 = plan.facts["m-1"] as { home: Side; away: Side };
    const m2 = plan.facts["m-2"] as { home: Side; away: Side };
    expect([m1.home.winPct, m1.away.winPct]).toEqual([32, 68]);
    expect(m1.home).not.toHaveProperty("winPctBefore");
    expect(m1.away).not.toHaveProperty("winPctBefore");
    expect([m2.home.winPctBefore, m2.away.winPctBefore]).toEqual([45, 55]);
  });

  it("Thursday Night Fallout and the Sunday Recap print the exact memory at one decimal from the home side, the pair adding to 100", () => {
    // The memory holds 37.25 and 62.75: each rounded on its own would print 37.3 and 62.8.
    const mem: PayloadMemory = { ...EMPTY_MEMORY, winPctBefore: { 1: 37.25, 2: 62.75 } };
    const thursday: ThursdayFalloutFacts = { kind: "thursday_fallout", week: 4, tnf: { week: 4, games: [], players: [], teams: [], placeholder: false }, winProbs: DECIMAL };
    const [t] = planThursday(thursday, mem).facts.matchups as Array<{ home: Side; away: Side }>;
    const recap: SundayRecapFacts = { kind: "sunday_recap", week: 4, winProbs: DECIMAL };
    const r = planSundayRecap(recap, mem).facts["m-1"] as { home: Side; away: Side };
    for (const m of [t, r]) {
      expect([m.home.winPctBefore, m.away.winPctBefore]).toEqual([37.3, 62.7]);
      expect(m.home.winPctBefore! + m.away.winPctBefore!).toBeCloseTo(100, 9);
    }
  });
});
