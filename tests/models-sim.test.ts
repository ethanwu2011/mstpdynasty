/**
 * Season simulator: sums, determinism, speed, bracket structure, and a backtest from the RT
 * Week 8 standings against who actually made the playoffs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { getOddsHistory, prepareSeasonSim, runSeasonSim } from "@/lib/models";
import { loadMatchupsByWeek, range, recordsFromMatchups, roundRobinPairs, strengthRosters } from "@/lib/models/data";
import { bracketOrder, simulateSeason, type SimInput } from "@/lib/models/sim";
import { getTradedPicks, getWinnersBracket, rosterPointsFor } from "@/lib/sleeper";
import type { LeagueContext, SimResult } from "@/lib/types";
import { hasFixtures, loadManifest, rtLeagueId } from "./helpers/fixtures";

function sums(r: SimResult) {
  const s = (k: "playoffPct" | "titlePct" | "byePct" | "lastPlacePct" | "firstPickPct" | "expectedWins") =>
    r.teams.reduce((acc, t) => acc + t[k], 0);
  return { playoff: s("playoffPct"), title: s("titlePct"), bye: s("byePct"), last: s("lastPlacePct"), firstPick: s("firstPickPct"), wins: s("expectedWins") };
}

function expectSums(r: SimResult, playoffTeams = 6, byes = 2) {
  const x = sums(r);
  expect(x.playoff).toBeCloseTo(100 * playoffTeams, 6);
  expect(x.title).toBeCloseTo(100, 6);
  expect(x.bye).toBeCloseTo(100 * byes, 6);
  expect(x.last).toBeCloseTo(100, 6);
  expect(x.firstPick).toBeCloseTo(100, 6);
  for (const t of r.teams) {
    for (const v of [t.playoffPct, t.titlePct, t.byePct, t.lastPlacePct, t.firstPickPct]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(t.titlePct).toBeLessThanOrEqual(t.playoffPct);
    expect(t.byePct).toBeLessThanOrEqual(t.playoffPct);
  }
}

describe("bracket", () => {
  it("standard order places byes like Sleeper's 6-team bracket", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
  });

  // Six playoff teams seeded 1..6 by record, rosters 7..10 miss. Known results make the
  // outcome depend only on who meets whom, so fixed and reseeded brackets must differ.
  const base = (reseed: boolean): SimInput => ({
    teams: Array.from({ length: 10 }, (_, i) => ({ rosterId: i + 1, wins: 20 - i, losses: i, ties: 0, pointsFor: 1000, mean: 100, sd: 20 })),
    weeks: [],
    playoffTeams: 6,
    reseed,
    known: [
      new Map([["3-6", 6], ["4-5", 4]]),
      new Map([["1-4", 4], ["2-6", 2], ["1-6", 6], ["2-4", 2]]),
      new Map([["2-4", 4], ["2-6", 2], ["4-6", 6], ["1-2", 1]]),
    ],
    runs: 50,
    seed: 1,
  });

  it("fixed bracket: 1 meets the 4/5 winner, 2 meets the 3/6 winner", () => {
    const c = simulateSeason(base(false));
    expect(c.title[3]).toBe(50); // roster 4: beats 5, beats 1, beats 2
    expect(c.bye[0]).toBe(50);
    expect(c.bye[1]).toBe(50);
  });

  it("reseeded bracket: 1 meets the lowest seed left", () => {
    const c = simulateSeason(base(true));
    expect(c.title[1]).toBe(50); // roster 2: 1 loses to 6, 2 beats 4, then 2 beats 6
  });

  it("round robin covers every team once per week and every opponent over n - 1 weeks", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const met = new Set<string>();
    for (let r = 0; r < 9; r++) {
      const pairs = roundRobinPairs(ids, r);
      expect(new Set(pairs.flat()).size).toBe(10);
      for (const [a, b] of pairs) met.add(`${a}-${b}`);
    }
    expect(met.size).toBe(45);
  });
});

describe.skipIf(!hasFixtures())("season simulator on the RT season", () => {
  let ctx: LeagueContext;
  beforeAll(async () => {
    ctx = await getLeagueContext({ leagueId: rtLeagueId() });
  });

  it("records rebuilt from matchups equal Sleeper's final regular-season records", async () => {
    const weeks = range(1, ctx.lastRegularSeasonWeek);
    const recs = recordsFromMatchups(ctx.rosters.map((r) => r.roster_id), await loadMatchupsByWeek(ctx, weeks), weeks);
    for (const r of ctx.rosters) {
      const x = recs.get(r.roster_id)!;
      expect([x.wins, x.losses, x.ties]).toEqual([r.settings.wins, r.settings.losses, r.settings.ties]);
      expect(Math.abs(x.pointsFor - rosterPointsFor(r))).toBeLessThan(0.02);
    }
  });

  it("sums: playoff 600, title 100, bye 200 (mid-season, preseason, complete)", async () => {
    for (const fromWeek of [9, 1, undefined]) {
      const r = await runSeasonSim({ ctx, fromWeek, seed: 11 });
      expect(r.runs).toBe(10_000);
      expect(r.placeholder).toBe(false);
      expectSums(r);
    }
  });

  it("same seed, same result; another seed, a different one", async () => {
    const strip = (r: SimResult) => ({ ...r, generatedAt: 0 });
    const a = await runSeasonSim({ ctx, fromWeek: 9, seed: 123 });
    const b = await runSeasonSim({ ctx, fromWeek: 9, seed: 123 });
    const c = await runSeasonSim({ ctx, fromWeek: 9, seed: 124 });
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(c));
    // The default seed is derived from league + week, so reruns match too.
    const d = await runSeasonSim({ ctx, fromWeek: 9 });
    const e = await runSeasonSim({ ctx, fromWeek: 9 });
    expect(strip(d)).toEqual(strip(e));
  });

  it("10,000 runs in under 2 s (full season from week 1, data loading included)", async () => {
    const t0 = performance.now();
    const r = await runSeasonSim({ ctx, fromWeek: 1, seed: 5 });
    const total = performance.now() - t0;
    const prep = await prepareSeasonSim(ctx, 1);
    const t1 = performance.now();
    simulateSeason({ ...prep.input, runs: 10_000, seed: 5 });
    const simOnly = performance.now() - t1;
    console.log(`10k sims: ${simOnly.toFixed(0)} ms simulating, ${total.toFixed(0)} ms end to end (${prep.input.weeks.length} weeks left)`);
    expect(r.runs).toBe(10_000);
    expect(prep.input.weeks).toHaveLength(14);
    expect(total).toBeLessThan(2000);
    expect(simOnly).toBeLessThan(2000);
  });

  it("a complete season is certain: the real champion at 100%, the real playoff field at 100%", async () => {
    const r = await runSeasonSim({ ctx, seed: 3 });
    const bracket = await getWinnersBracket(ctx.leagueId);
    const champion = bracket.find((m) => m.p === 1)!.w!;
    const field = new Set(bracket.filter((m) => m.r === 1 || m.r === 2).flatMap((m) => [m.t1, m.t2]).filter((x): x is number => x !== null));
    expect(field.size).toBe(6);
    for (const t of r.teams) {
      expect(t.titlePct).toBe(t.team.rosterId === champion ? 100 : 0);
      expect(t.playoffPct).toBe(field.has(t.team.rosterId) ? 100 : 0);
    }
  });

  it("the 1.01 odds follow traded firsts to the team that holds the pick", async () => {
    const r = await runSeasonSim({ ctx, fromWeek: 9, seed: 9 });
    const next = String(Number(ctx.season) + 1);
    const holder = new Map(ctx.rosters.map((x) => [x.roster_id, x.roster_id]));
    for (const p of await getTradedPicks(ctx.leagueId)) if (p.season === next && p.round === 1) holder.set(p.roster_id, p.owner_id);
    expect([...holder].some(([o, h]) => o !== h)).toBe(true);
    for (const t of r.teams) {
      const expected = r.teams.filter((o) => holder.get(o.team.rosterId) === t.team.rosterId).reduce((s, o) => s + o.lastPlacePct, 0);
      expect(t.firstPickPct).toBeCloseTo(expected, 6);
    }
  });

  it("backtest: odds from the Week 8 standings vs who actually made the playoffs", async () => {
    const r = await runSeasonSim({ ctx, fromWeek: 9 });
    const bracket = await getWinnersBracket(ctx.leagueId);
    const actual = new Set(bracket.filter((m) => m.r === 1 || m.r === 2).flatMap((m) => [m.t1, m.t2]).filter((x): x is number => x !== null));
    const byOdds = [...r.teams].sort((a, b) => b.playoffPct - a.playoffPct);
    const top6 = byOdds.slice(0, 6).map((t) => t.team.rosterId);
    const hitsOdds = top6.filter((id) => actual.has(id)).length;
    const brier = r.teams.reduce((s, t) => s + (t.playoffPct / 100 - (actual.has(t.team.rosterId) ? 1 : 0)) ** 2, 0) / r.teams.length;

    // Naive baseline: the Week 8 standings (record, then points for).
    const standings = [...r.teams].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor);
    const top6Standings = new Set(standings.slice(0, 6).map((t) => t.team.rosterId));
    const hitsStandings = [...top6Standings].filter((id) => actual.has(id)).length;
    // Standings as 0/1 guesses (in the top 6 = 100%), scored the same way.
    const brierStandings = r.teams.reduce((s, t) => s + ((top6Standings.has(t.team.rosterId) ? 1 : 0) - (actual.has(t.team.rosterId) ? 1 : 0)) ** 2, 0) / r.teams.length;

    console.log(`RT backtest from Week 8: sim top 6 by playoff odds hit ${hitsOdds}/6, Week 8 standings top 6 hit ${hitsStandings}/6, Brier ${brier.toFixed(3)} vs ${brierStandings.toFixed(3)} for the standings as 0/1 guesses and 0.240 for a flat 60%`);
    console.table(
      byOdds.map((t) => ({
        roster: t.team.rosterId,
        week8: `${t.wins}-${t.losses}`,
        playoffPct: t.playoffPct,
        titlePct: t.titlePct,
        madePlayoffs: actual.has(t.team.rosterId),
      })),
    );
    expect(r.asOfWeek).toBe(8);
    expect(sums(r).wins).toBeCloseTo(70, 6); // 14 weeks x 5 games
    expect(hitsOdds).toBeGreaterThanOrEqual(4);
    expect(hitsOdds).toBeGreaterThanOrEqual(hitsStandings);
    expect(brier).toBeLessThan(0.12);
    expect(brier).toBeLessThan(brierStandings);
    for (const t of r.teams) if (actual.has(t.team.rosterId)) expect(t.playoffPct).toBeGreaterThan(25);
  });

  it("odds history backfills one snapshot per week on fixture data", async () => {
    const h = await getOddsHistory(ctx, { runs: 1000 });
    expect(h.placeholder).toBe(false);
    expect(h.snapshots.map((s) => s.week)).toEqual(range(0, ctx.lastWeek));
    for (const s of h.snapshots) {
      expect(s.teams).toHaveLength(ctx.rosters.length);
      expect(s.teams.reduce((acc, t) => acc + t.playoffPct, 0)).toBeCloseTo(600, 6);
    }
  });

  it("during a startup draft the picks so far become the rosters", async () => {
    const drafting: LeagueContext = { ...ctx, phase: "drafting", rosters: ctx.rosters.map((r) => ({ ...r, players: [], starters: [], reserve: [], taxi: [] })) };
    const rosters = await strengthRosters(drafting, 99);
    const total = [...rosters.values()].reduce((s, ps) => s + ps.length, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasFixtures())("season simulator before the draft (MSTP fixture)", () => {
  it("runs with no rosters and no schedule: equal teams, valid sums", async () => {
    const ctx = await getLeagueContext({ leagueId: loadManifest().mstp.leagueId });
    const r = await runSeasonSim({ ctx, seed: 2 });
    expect(r.asOfWeek).toBe(0);
    expectSums(r);
    for (const t of r.teams) {
      expect(t.meanPoints).toBe(r.teams[0].meanPoints);
      expect(t.playoffPct).toBeGreaterThan(50);
      expect(t.playoffPct).toBeLessThan(70);
    }
  });
});
