/**
 * Live win probability on the RT fixture season (2025, complete) plus synthetic game clocks.
 *
 *   - every RT matchup, weeks 1-17: exactly 0 / 1 once final and equal to the actual winner
 *   - pre-game hit rate of the projected favorite over the regular season, with a calibration
 *     table and Brier score (printed; floors asserted)
 *   - live mode with synthetic ESPN clocks: sd shrinks with the game clock, the leader converges
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { getWinProbabilities } from "@/lib/models";
import { OT_FRACTION, VARIANCE_COEF } from "@/lib/models/constants";
import { normalCdf } from "@/lib/models/math";
import { buildWinProbWeek, winProbability } from "@/lib/models/winprob";
import { loadMatchupsByWeek, range, safeMatchups, safePlayers, scoredProjections, uncoveredSlotAverages } from "@/lib/models/data";
import type { LeagueContext, NflGameClock, WinProbWeek } from "@/lib/types";
import { hasFixtures, rtLeagueId } from "./helpers/fixtures";

describe("win probability math", () => {
  it("normal CDF is accurate and symmetric", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
    for (const z of [0.3, 1.1, 2.7]) expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 7);
  });

  it("is exact when final and never fake-certain while live", () => {
    expect(winProbability({ actual: 101, mean: 101 }, { actual: 100, mean: 100 }, 0, 0, true)).toBe(1);
    expect(winProbability({ actual: 99, mean: 99 }, { actual: 100, mean: 100 }, 0, 0, true)).toBe(0);
    expect(winProbability({ actual: 100, mean: 100 }, { actual: 100, mean: 100 }, 0, 0, true)).toBe(0.5);
    const live = winProbability({ actual: 150, mean: 190 }, { actual: 20, mean: 40 }, 1, 1, false);
    expect(live).toBeLessThan(1);
    expect(live).toBeGreaterThan(0.999);
    // Not final but no variance left (a live starter projected for 0): still never 0 or 1.
    const flat = winProbability({ actual: 90, mean: 90 }, { actual: 80, mean: 80 }, 0, 0, false);
    expect(flat).toBeGreaterThan(0.999);
    expect(flat).toBeLessThan(1);
  });
});

describe.skipIf(!hasFixtures())("win probability on the RT season", () => {
  let ctx: LeagueContext;
  const finals = new Map<number, WinProbWeek>();

  beforeAll(async () => {
    ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    for (let w = 1; w <= 17; w++) finals.set(w, await getWinProbabilities(w, ctx));
  });

  it("is exactly 0 or 1 when every game is final and matches the actual winner on every matchup", () => {
    let checked = 0;
    for (let w = 1; w <= 17; w++) {
      const wp = finals.get(w)!;
      expect(wp.placeholder).toBe(false);
      expect(wp.basis).toBe("final");
      for (const m of wp.matchups) {
        expect(m.isFinal).toBe(true);
        const expected = m.home.actual > m.away.actual ? 1 : m.home.actual < m.away.actual ? 0 : 0.5;
        expect(m.home.winProb).toBe(expected);
        expect(m.away.winProb).toBe(1 - expected);
        expect(m.home.sd).toBe(0);
        // Team actual is Sleeper's own score; the starters add up to it.
        const starterSum = m.home.starters.reduce((s, x) => s + x.actual, 0);
        expect(Math.abs(starterSum - m.home.actual)).toBeLessThan(0.02);
        checked++;
      }
    }
    // 14 regular weeks x 5 + playoff weeks (4 + 5 + 2 games with matchup ids)
    expect(checked).toBe(81);
  });

  it("maps every starter to his NFL game through ESPN (no bye-week starter ever scores)", () => {
    let starters = 0;
    for (const wp of finals.values()) {
      for (const m of wp.matchups) {
        for (const s of [...m.home.starters, ...m.away.starters]) {
          starters++;
          if (s.status === "bye") expect(s.actual).toBe(0);
          expect(s.fractionRemaining).toBe(0);
        }
      }
    }
    expect(starters).toBeGreaterThan(1500);
  });

  it("pre-game: projected favorite hit rate and calibration over the regular season", async () => {
    const rows: Array<{ p: number; won: number }> = [];
    let kickerProjected = 0;
    for (let w = 1; w <= ctx.lastRegularSeasonWeek; w++) {
      const pre = await getWinProbabilities(w, ctx, { pregame: true });
      expect(pre.basis).toBe("projections");
      for (const m of pre.matchups) {
        expect(m.isFinal).toBe(false);
        expect(m.home.winProb + m.away.winProb).toBeCloseTo(1, 6);
        const fin = finals.get(w)!.matchups.find((x) => x.matchupId === m.matchupId)!;
        rows.push({ p: m.home.winProb, won: fin.home.winProb });
        if (w >= 2) for (const s of [...m.home.starters, ...m.away.starters]) if (s.slot === "K" && s.projected > 0) kickerProjected++;
      }
    }
    expect(rows).toHaveLength(70);
    // Kickers have no Sleeper projection: the league's own K average fills in from week 2.
    expect(kickerProjected).toBeGreaterThan(100);

    const decided = rows.filter((r) => r.p !== 0.5);
    const hits = decided.filter((r) => (r.p > 0.5) === (r.won === 1)).length;
    const hitRate = hits / decided.length;
    const brier = rows.reduce((s, r) => s + (r.p - r.won) ** 2, 0) / rows.length;

    // Calibration of the favorite's probability.
    const fav = rows.map((r) => (r.p >= 0.5 ? r : { p: 1 - r.p, won: 1 - r.won }));
    const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
    const table = edges.slice(0, -1).map((lo, i) => {
      const bin = fav.filter((r) => r.p >= lo && r.p < edges[i + 1]);
      const n = bin.length;
      return {
        bin: `${Math.round(lo * 100)}-${Math.min(100, Math.round(edges[i + 1] * 100))}%`,
        n,
        predicted: n ? +(bin.reduce((s, r) => s + r.p, 0) / n).toFixed(3) : null,
        actual: n ? +(bin.reduce((s, r) => s + r.won, 0) / n).toFixed(3) : null,
      };
    });
    console.log(`RT pre-game favorite hit rate: ${hits}/${decided.length} = ${(hitRate * 100).toFixed(1)}%, Brier ${brier.toFixed(4)} (coin flip 0.25)`);
    console.table(table);

    expect(hitRate).toBeGreaterThan(0.55);
    expect(brier).toBeLessThan(0.25);
    // Loose calibration: the favorite's average predicted and actual win rates agree within 10 points.
    const pAvg = fav.reduce((s, r) => s + r.p, 0) / fav.length;
    const wAvg = fav.reduce((s, r) => s + r.won, 0) / fav.length;
    expect(Math.abs(pAvg - wAvg)).toBeLessThan(0.1);
  });

  describe("live mode with synthetic ESPN clocks", () => {
    const week = 5;
    async function inputs(fraction: number, state: NflGameClock["state"]) {
      const prior = range(1, week - 1);
      const [matchups, players, projections, priorMatchups] = await Promise.all([
        safeMatchups(ctx, week),
        safePlayers(),
        scoredProjections(ctx, week),
        loadMatchupsByWeek(ctx, prior),
      ]);
      const fallbacks = uncoveredSlotAverages(ctx, priorMatchups, prior);
      const teams = new Set<string>();
      for (const r of projections.values()) if (r.team) teams.add(r.team);
      const clocks: NflGameClock[] = [...teams].map((t, i) => ({
        espnId: String(i),
        week,
        home: t,
        away: `ZZ${i}`,
        kickoff: 0,
        state,
        period: state === "pre" ? 0 : 3,
        clockSeconds: 0,
        fractionRemaining: fraction,
        homeScore: 0,
        awayScore: 0,
        detail: "",
      }));
      return { ctx, week, matchups, players, projections, clocks, fallbacks, timing: "current" as const };
    }

    it("all games final through clocks gives the actual winner; all pre gives the pre-game view", async () => {
      const done = buildWinProbWeek(await inputs(0, "post"));
      expect(done.basis).toBe("final");
      for (const m of done.matchups) {
        const fin = finals.get(week)!.matchups.find((x) => x.matchupId === m.matchupId)!;
        expect(m.home.winProb).toBe(fin.home.winProb);
      }
      const base = await inputs(1, "pre");
      const unplayed = base.matchups.map((m) => ({ ...m, points: 0, custom_points: null, starters_points: m.starters_points.map(() => 0) }));
      const pre = buildWinProbWeek({ ...base, matchups: unplayed });
      const pregame = await getWinProbabilities(week, ctx, { pregame: true });
      expect(pre.basis).toBe("projections");
      for (const m of pre.matchups) {
        const g = pregame.matchups.find((x) => x.matchupId === m.matchupId)!;
        expect(m.home.winProb).toBeCloseTo(g.home.winProb, 4);
      }
    });

    it("halftime: sd shrinks by sqrt(1/2) and mean = actual + half the projection", async () => {
      const half = buildWinProbWeek(await inputs(0.5, "in"));
      expect(half.basis).toBe("live");
      for (const m of half.matchups) {
        expect(m.isFinal).toBe(false);
        for (const t of [m.home, m.away]) {
          const live = t.starters.filter((s) => s.status === "live");
          const projected = live.reduce((s, x) => s + x.projected, 0);
          const variance = live.reduce((s, x) => s + (VARIANCE_COEF * x.projected) ** 2 * 0.5, 0);
          expect(t.mean).toBeCloseTo(t.actual + projected * 0.5, 1);
          expect(t.sd).toBeCloseTo(Math.sqrt(variance), 1);
        }
        expect(m.home.winProb).toBeGreaterThan(0);
        expect(m.home.winProb).toBeLessThan(1);
      }
    });

    it("the leader converges to a win as the clock runs out", async () => {
      // Actual points are held at the final score, so the team ahead is the eventual winner.
      const leaderProb = async (f: number) =>
        buildWinProbWeek(await inputs(f, "in")).matchups.map((m) => ({
          margin: Math.abs(m.home.actual - m.away.actual),
          p: m.home.actual >= m.away.actual ? m.home.winProb : m.away.winProb,
        }));
      const early = await leaderProb(0.75);
      const late = await leaderProb(0.05);
      const last = await leaderProb(0.01);
      const avg = (xs: Array<{ p: number }>) => xs.reduce((s, x) => s + x.p, 0) / xs.length;
      expect(avg(late)).toBeGreaterThan(avg(early));
      for (const x of last) if (x.margin >= 10) expect(x.p).toBeGreaterThan(0.95);
    });

    it("overtime is not final: a game in period 5 keeps its starters live and the odds off 0 and 1", async () => {
      const inp = await inputs(0, "post");
      const done = buildWinProbWeek(inp);
      expect(done.basis).toBe("final");
      const otTeam = done.matchups.flatMap((m) => [...m.home.starters, ...m.away.starters]).find((s) => s.nflTeam && s.projected > 0)!.nflTeam!;
      // ESPN in overtime: state "in", period 5, and fractionRemaining() gives 0 for any period above 4.
      const clocks = inp.clocks.map((c) => (c.home === otTeam ? { ...c, state: "in" as const, period: 5, clockSeconds: 300, fractionRemaining: 0 } : c));
      const ot = buildWinProbWeek({ ...inp, clocks });
      expect(ot.basis).toBe("live");
      const touched = ot.matchups.filter((m) => [...m.home.starters, ...m.away.starters].some((s) => s.nflTeam === otTeam));
      expect(touched.length).toBeGreaterThan(0);
      for (const m of ot.matchups) {
        if (!touched.includes(m)) {
          expect(m.isFinal).toBe(true);
          continue;
        }
        expect(m.isFinal).toBe(false);
        expect(m.home.winProb).toBeGreaterThan(0);
        expect(m.home.winProb).toBeLessThan(1);
        for (const s of [...m.home.starters, ...m.away.starters].filter((x) => x.nflTeam === otTeam)) {
          expect(s.status).toBe("live");
          expect(s.fractionRemaining).toBeCloseTo(OT_FRACTION, 4);
        }
      }
    });

    it("a team with no game on the board is a bye: fraction 0, no projection", async () => {
      const inp = await inputs(0.5, "in");
      const oneTeam = inp.clocks[0].home;
      const wp = buildWinProbWeek({ ...inp, clocks: inp.clocks.filter((c) => c.home !== oneTeam) });
      const byes = wp.matchups.flatMap((m) => [...m.home.starters, ...m.away.starters]).filter((s) => s.nflTeam === oneTeam);
      for (const s of byes) {
        expect(s.fractionRemaining).toBe(0);
        if (s.actual === 0) {
          expect(s.status).toBe("bye");
          expect(s.projected).toBe(0);
        }
      }
    });
  });
});
