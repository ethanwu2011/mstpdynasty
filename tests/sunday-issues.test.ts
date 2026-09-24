/**
 * The Sunday Preview (Sunday morning) and the Sunday Recap (Monday morning): the planners only,
 * on hand-built win probabilities. No fixtures, no network.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_MEMORY, type PayloadMemory } from "@/lib/roast/memory-shape";
import { planSundayPreview, planSundayRecap, sidePct, type IssuePlan } from "@/lib/roast/plan";
import type { LineupAlertFact, StarterLine, SundayPreviewFacts, SundayRecapFacts, TeamRef, TeamWinProb, WinProb, WinProbWeek } from "@/lib/types";

const team = (rosterId: number, managerName: string, teamName = managerName): TeamRef => ({ rosterId, managerName, teamName, managerKey: managerName.toLowerCase() });
const side = (t: TeamRef, projected: number, winProb: number, over: Partial<TeamWinProb> = {}): TeamWinProb => ({ team: t, actual: 0, projected, mean: projected, sd: 20, winProb, starters: [], ...over });
const matchup = (id: number, home: TeamWinProb, away: TeamWinProb): WinProb => ({ week: 3, matchupId: id, home, away, isFinal: false });
const week = (matchups: WinProb[]): WinProbWeek => ({ week: 3, season: "2026", generatedAt: 0, basis: "live", matchups, placeholder: false });
const line = (playerId: string, name: string, position: string, projected: number, over: Partial<StarterLine> = {}): StarterLine => ({
  playerId,
  name,
  position,
  slot: position,
  nflTeam: "DAL",
  actual: 0,
  projected,
  fractionRemaining: 1,
  expected: projected,
  status: "pre",
  ...over,
});
const final = (playerId: string, name: string, position: string, projected: number, actual: number) => line(playerId, name, position, projected, { actual, fractionRemaining: 0, expected: actual, status: "final" });

const JUSTIN = team(1, "Justin", "Shough and Fhough");
const BRANDON = team(2, "Brandon");
const PETER = team(3, "Peter");
const ANISH = team(4, "Anish");

type Sides = { home: Record<string, unknown>; away: Record<string, unknown> };

/** Slot ids the sections print, in order. */
const printedSlots = (plan: IssuePlan) => plan.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === "slot" ? [b.slot] : []));

/** Every slot the writer fills (the dek is the headline, not a section) has a place in the sections, and nothing else does. */
function expectSlotsPrinted(plan: IssuePlan) {
  const printed = printedSlots(plan);
  expect(new Set(printed).size).toBe(printed.length);
  expect([...printed].sort()).toEqual(plan.slots.map((s) => s.id).filter((id) => id !== "dek").sort());
}

const brief = (plan: IssuePlan, id: string) => plan.slots.find((s) => s.id === id)?.brief ?? "";

describe("planSundayPreview", () => {
  const justin = side(JUSTIN, 161.14, 0.321, {
    starters: [line("1", "Ace", "QB", 22.4), line("2", "Deuce", "WR", 15.06), line("3", "Dud", "TE", 2.1), line("0", "Empty", "FLEX", 0)],
  });
  // Brandon's kicker played Thursday: 18.62 points already banked.
  const brandon = side(BRANDON, 183.08, 0.679, { actual: 18.62, starters: [final("4", "Boot", "K", 9, 18.62), line("5", "Bell", "RB", 17.3)] });
  const peter = side(PETER, 189.6, 0.77);
  const anish = side(ANISH, 155.8, 0.23);
  const facts = (lineupAlerts: LineupAlertFact[] = []): SundayPreviewFacts => ({ kind: "sunday_preview", week: 3, winProbs: week([matchup(1, justin, brandon), matchup(5, peter, anish)]), lineupAlerts });

  it("keys each matchup by m-<matchupId> with projections, win chances, stars and the weakest starter", () => {
    const plan = planSundayPreview(facts());
    expect(plan).toMatchObject({ kind: "sunday_preview", title: "Sunday Preview", week: 3, placeholder: false });
    expect(plan.facts.week).toBe(3);
    const m1 = plan.facts["m-1"] as Sides;
    expect(m1.home).toEqual({
      manager: "Justin",
      team: "Shough and Fhough",
      projected: 161.1,
      winPct: 32,
      stars: [
        { name: "Ace", pos: "QB", projected: 22.4 },
        { name: "Deuce", pos: "WR", projected: 15.1 },
      ],
      weakest: { name: "Dud", pos: "TE", projected: 2.1 },
    });
    // Boot already played Thursday (his 18.62 is banked), so the stars and weak link are among
    // the starters still to play.
    expect(m1.away).toMatchObject({ manager: "Brandon", projected: 183.1, winPct: 68, banked: 18.62, stars: [{ name: "Bell" }], weakest: { name: "Bell" } });
    expect((m1.away.stars as unknown[]).length).toBe(1);
    // No Thursday points, no "banked"; no starters, no stars or weakest.
    expect(m1.home).not.toHaveProperty("banked");
    expect(plan.facts["m-5"]).toEqual({ home: { manager: "Peter", team: "Peter", projected: 189.6, winPct: 77 }, away: { manager: "Anish", team: "Anish", projected: 155.8, winPct: 23 } });
    expect(plan.managers.sort()).toEqual(["Anish", "Brandon", "Justin", "Peter"]);
  });

  it("carries the pre-kickoff odds when they moved, whole and adding to 100 like winPct", () => {
    const mem: PayloadMemory = { ...EMPTY_MEMORY, winPctBefore: { 3: 75, 4: 25, 1: 32.1, 2: 67.9 } };
    const plan = planSundayPreview(facts(), mem);
    const m5 = plan.facts["m-5"] as Sides;
    expect(m5.home.winPctBefore).toBe(75);
    expect(m5.away.winPctBefore).toBe(25);
    // 32.1 before and 32 now is rounding, not a swing: left out.
    const m1 = plan.facts["m-1"] as Sides;
    expect(m1.home).not.toHaveProperty("winPctBefore");
    expect(m1.away).not.toHaveProperty("winPctBefore");
  });

  it("opens on the biggest underdog and keeps his matchup paragraph short", () => {
    const plan = planSundayPreview(facts());
    expect(brief(plan, "cold-open")).toMatch(/about Anish, the biggest underdog of week 3\./);
    expect(brief(plan, "m-5")).toMatch(/^1 or 2 sentences/);
    expect(brief(plan, "m-5")).toContain("Anish already got the cold open.");
    expect(brief(plan, "m-1")).toMatch(/^2 or 3 sentences/);
    expect(brief(plan, "m-1")).not.toContain("cold open");
    expect(plan.fallbackDek).toBe("Week 3: Anish is 23% to win.");
  });

  it("prints every slot: cold open, one per matchup, the table and the closer, with no lineup section when nobody has a hole", () => {
    const plan = planSundayPreview(facts());
    expect(plan.slots.map((s) => s.id)).toEqual(["dek", "cold-open", "m-1", "m-5", "closer"]);
    expect(plan.sections.map((s) => s.heading)).toEqual(["Week 3, Sunday", "The matchups", "Kickoff"]);
    expect(plan.sections[1].blocks.find((b) => b.type === "table")).toMatchObject({
      columns: ["Team", "Banked", "Proj", "Win %"],
      rows: [
        ["Shough and Fhough (Justin)", 0, "161.1", "32%"],
        ["Brandon", 18.62, "183.1", "68%"],
        ["Peter", 0, "189.6", "77%"],
        ["Anish", 0, "155.8", "23%"],
      ],
    });
    expect(plan.facts).not.toHaveProperty("lineupAlerts");
    expectSlotsPrinted(plan);
  });

  it("adds a Fix your lineup section for lineup holes", () => {
    const player = { playerId: "9", name: "Hurt Guy", position: "WR", nflTeam: "DAL", age: 26, value: null, overallRank: null };
    const alerts: LineupAlertFact[] = [
      { team: JUSTIN, player, slot: "WR", reason: "out", kickoff: null },
      { team: PETER, player: { playerId: "0", name: "Empty slot", position: "FLEX", nflTeam: null, age: null, value: null, overallRank: null }, slot: "FLEX", reason: "empty_slot", kickoff: null },
    ];
    const plan = planSundayPreview(facts(alerts));
    expect(plan.slots.map((s) => s.id)).toEqual(["dek", "cold-open", "m-1", "m-5", "lineup", "closer"]);
    expect(brief(plan, "lineup")).toContain("(Justin and Peter)");
    expect(plan.facts.lineupAlerts).toEqual([
      { manager: "Justin", team: "Shough and Fhough", player: "Hurt Guy", pos: "WR", slot: "WR", why: "out" },
      { manager: "Peter", team: "Peter", player: "Empty slot", pos: "FLEX", slot: "FLEX", why: "empty_slot" },
    ]);
    const lineup = plan.sections.find((s) => s.heading === "Fix your lineup");
    expect(lineup?.blocks.find((b) => b.type === "list")).toEqual({ type: "list", items: ["Shough and Fhough (Justin): Hurt Guy (WR) is ruled out", "Peter: FLEX slot is empty"] });
    expect(plan.sections.map((s) => s.heading)).toEqual(["Week 3, Sunday", "The matchups", "Fix your lineup", "Kickoff"]);
    expectSlotsPrinted(plan);
  });
});

describe("Sunday Preview win chances", () => {
  // Both sides would round up on their own: 37.5 and 62.5, 87.5 and 12.5.
  const plan = planSundayPreview({
    kind: "sunday_preview",
    week: 3,
    winProbs: week([matchup(1, side(JUSTIN, 150, 0.375), side(BRANDON, 160, 0.625)), matchup(5, side(PETER, 170, 0.875), side(ANISH, 120, 0.125))]),
    lineupAlerts: [],
  });

  it("add to 100 for each matchup, in the facts and the table", () => {
    const pct = (id: string) => {
      const m = plan.facts[id] as Sides;
      return [m.home.winPct, m.away.winPct];
    };
    expect(pct("m-1")).toEqual([38, 62]);
    expect(pct("m-5")).toEqual([88, 12]);
    expect(plan.sections[1].blocks.find((b) => b.type === "table")).toMatchObject({
      rows: [
        ["Shough and Fhough (Justin)", 0, "150.0", "38%"],
        ["Brandon", 0, "160.0", "62%"],
        ["Peter", 0, "170.0", "88%"],
        ["Anish", 0, "120.0", "12%"],
      ],
    });
  });

  it("the fallback paragraph and headline print the same numbers", () => {
    const fallback = plan.sections[1].blocks.flatMap((b) => (b.type === "slot" && b.slot === "m-5" ? b.fallback : []));
    expect(fallback).toEqual([{ type: "paragraph", text: "Peter 170 projected (88%), Anish 120 (12%)." }]);
    expect(plan.fallbackDek).toBe("Week 3: Anish is 12% to win.");
  });

  it("sidePct: the away side is 100 minus the home side, for any win probability", () => {
    for (let k = 0; k <= 1000; k++) {
      const m = matchup(1, side(JUSTIN, 150, k / 1000), side(BRANDON, 160, 1 - k / 1000));
      expect(sidePct(m, m.home) + sidePct(m, m.away), `home ${k / 1000}`).toBe(100);
    }
  });
});

describe("planSundayRecap", () => {
  // Justin: Ace carried, Deuce sank him, and he still has his running back on Monday night.
  const justin = side(JUSTIN, 161.14, 0.12, {
    actual: 88.4,
    mean: 101.34,
    starters: [final("1", "Ace", "QB", 22.4, 30.2), final("2", "Deuce", "WR", 15.06, 1.8), final("3", "Dud", "TE", 2.1, 4), line("6", "Monday Guy", "RB", 12.5), line("0", "Empty", "FLEX", 0)],
  });
  // Brandon: one starter played, so he is both the top and the worst: no worstStarter.
  const brandon = side(BRANDON, 183.08, 0.88, { actual: 120.5, mean: 120.5, starters: [final("4", "Boot", "K", 9, 18.62)] });
  // Peter was the 77% favourite and now trails, without the lowest score.
  const peter = side(PETER, 189.6, 0.4, { actual: 95, mean: 110 });
  const anish = side(ANISH, 155.8, 0.6, { actual: 101.25, mean: 115 });
  const facts: SundayRecapFacts = { kind: "sunday_recap", week: 3, winProbs: week([matchup(1, justin, brandon), matchup(5, peter, anish)]) };
  const before: PayloadMemory = { ...EMPTY_MEMORY, winPctBefore: { 1: 32.1, 2: 67.9, 3: 77, 4: 23 } };

  it("keys each matchup by m-<matchupId> with points, win chances, the starters who carried or sank him, and who is left", () => {
    const plan = planSundayRecap(facts, before);
    expect(plan).toMatchObject({ kind: "sunday_recap", title: "Sunday Recap", week: 3, placeholder: false });
    const m1 = plan.facts["m-1"] as Sides;
    expect(m1.home).toEqual({
      manager: "Justin",
      team: "Shough and Fhough",
      points: 88.4,
      mean: 101.3,
      winPct: 12,
      winPctBefore: 32.1,
      topStarter: { name: "Ace", pos: "QB", points: 30.2 },
      worstStarter: { name: "Deuce", pos: "WR", points: 1.8, projected: 15.1 },
      left: [{ name: "Monday Guy", pos: "RB", projected: 12.5 }],
    });
    expect(m1.away).toEqual({ manager: "Brandon", team: "Brandon", points: 120.5, mean: 120.5, winPct: 88, winPctBefore: 67.9, topStarter: { name: "Boot", pos: "K", points: 18.62 } });
    expect(plan.facts["m-5"]).toEqual({
      home: { manager: "Peter", team: "Peter", points: 95, mean: 110, winPct: 40, winPctBefore: 77 },
      away: { manager: "Anish", team: "Anish", points: 101.25, mean: 115, winPct: 60, winPctBefore: 23 },
    });
  });

  it("leaves winPctBefore out when the league memory does not have it", () => {
    const m1 = planSundayRecap(facts).facts["m-1"] as Sides;
    expect(m1.home).not.toHaveProperty("winPctBefore");
    expect(m1.away).not.toHaveProperty("winPctBefore");
  });

  it("opens on the biggest fall from the pre-kickoff odds, not the lowest score", () => {
    const plan = planSundayRecap(facts, before);
    expect(brief(plan, "cold-open")).toMatch(/about Peter, whose Sunday went worst/);
    expect(brief(plan, "m-5")).toMatch(/^1 or 2 sentences/);
    expect(brief(plan, "m-5")).toContain("Peter already got the cold open.");
    expect(brief(plan, "m-1")).toMatch(/^2 or 3 sentences/);
    expect(plan.fallbackDek).toBe("Peter has 95 after Sunday.");
    // Without the pre-kickoff odds nobody fell: the lowest score gets the cold open.
    expect(brief(planSundayRecap(facts), "cold-open")).toMatch(/about Justin, whose Sunday went worst/);
  });

  it("prints every slot: cold open, one per matchup with who is left, and the closer", () => {
    const plan = planSundayRecap(facts, before);
    expect(plan.slots.map((s) => s.id)).toEqual(["dek", "cold-open", "m-1", "m-5", "closer"]);
    expect(plan.sections.map((s) => s.heading)).toEqual(["Week 3, Sunday", "Where it stands", "Monday night"]);
    expect(plan.sections[1].blocks.find((b) => b.type === "table")).toMatchObject({
      columns: ["Team", "Points", "Left to play", "Win %"],
      rows: [
        ["Shough and Fhough (Justin)", 88.4, "Monday Guy", "12%"],
        ["Brandon", 120.5, "Done", "88%"],
        ["Peter", 95, "Done", "40%"],
        ["Anish", 101.25, "Done", "60%"],
      ],
    });
    expectSlotsPrinted(plan);
  });
});
