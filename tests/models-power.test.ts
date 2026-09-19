/**
 * Power rankings: ranks, the formula sentence, all-play and luck bookkeeping, and the
 * no-games / no-rosters states.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { getPowerRankings } from "@/lib/models";
import { POWER_FORMULA_EMPTY, POWER_FORMULA_GAMES, POWER_FORMULA_PROJECTED, computePower } from "@/lib/models/power";
import type { LeagueContext } from "@/lib/types";
import { hasFixtures, loadManifest, rtLeagueId } from "./helpers/fixtures";

describe("power formula", () => {
  it("is one plain sentence with no em dash", () => {
    for (const f of [POWER_FORMULA_GAMES, POWER_FORMULA_PROJECTED, POWER_FORMULA_EMPTY]) {
      expect(f).not.toMatch(/\u2014|\u2013/);
      expect(f.trim().endsWith(".")).toBe(true);
      expect(f.split(". ").length).toBe(1);
    }
  });

  it("all-play: the week's top score goes n-1 and 0, luck sums to zero", () => {
    const weeks = [
      new Map([[1, 150], [2, 120], [3, 90], [4, 60]]),
      new Map([[1, 80], [2, 130], [3, 100], [4, 100]]),
    ];
    const records = new Map([
      [1, { wins: 1, losses: 1, ties: 0 }],
      [2, { wins: 1, losses: 1, ties: 0 }],
      [3, { wins: 1, losses: 1, ties: 0 }],
      [4, { wins: 1, losses: 1, ties: 0 }],
    ]);
    const { rows, formula } = computePower({ rosterIds: [1, 2, 3, 4], weeks, records, strength: new Map([[1, 100], [2, 110], [3, 90], [4, 95]]) });
    expect(formula).toBe(POWER_FORMULA_GAMES);
    const r = new Map(rows.map((x) => [x.rosterId, x]));
    expect([r.get(1)!.allPlayWins, r.get(1)!.allPlayLosses]).toEqual([3, 3]);
    expect([r.get(2)!.allPlayWins, r.get(2)!.allPlayLosses]).toEqual([5, 1]);
    expect([r.get(3)!.allPlayWins, r.get(3)!.allPlayLosses]).toEqual([2.5, 3.5]);
    expect(rows.reduce((s, x) => s + x.luck, 0)).toBeCloseTo(0, 6);
    expect(rows[0].rosterId).toBe(2);
    expect(rows[0].score).toBe(100);
  });
});

describe.skipIf(!hasFixtures())("power rankings on the RT season", () => {
  let ctx: LeagueContext;
  beforeAll(async () => {
    ctx = await getLeagueContext({ leagueId: rtLeagueId() });
  });

  it("ranks every team, uses the whole regular season, and keeps luck honest", async () => {
    const p = await getPowerRankings(ctx);
    expect(p.placeholder).toBe(false);
    expect(p.asOfWeek).toBe(ctx.lastRegularSeasonWeek);
    expect(p.formula).toBe(POWER_FORMULA_GAMES);
    expect(p.rows.map((r) => r.rank)).toEqual(ctx.rosters.map((_, i) => i + 1));
    const scores = p.rows.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const n = ctx.rosters.length;
    for (const r of p.rows) {
      const roster = ctx.rosters.find((x) => x.roster_id === r.team.rosterId)!;
      expect([r.wins, r.losses]).toEqual([roster.settings.wins, roster.settings.losses]);
      expect(r.allPlayWins + r.allPlayLosses).toBeCloseTo(ctx.lastRegularSeasonWeek * (n - 1), 6);
      expect(r.projectedStrength).toBeGreaterThan(0);
      expect(r.previousRank).not.toBeNull();
    }
    expect(p.rows.reduce((s, r) => s + r.luck, 0)).toBeCloseTo(0, 1);
  });

  it("before any games it is projected strength only", async () => {
    const p = await getPowerRankings(ctx, { asOfWeek: 0 });
    expect(p.asOfWeek).toBe(0);
    expect(p.formula).toBe(POWER_FORMULA_PROJECTED);
    expect(p.rows[0].score).toBe(100);
    expect(p.rows[p.rows.length - 1].score).toBe(0);
    for (const r of p.rows) {
      expect(r.previousRank).toBeNull();
      expect(r.allPlayWins + r.allPlayLosses).toBe(0);
    }
  });
});

describe.skipIf(!hasFixtures())("power rankings before the draft (MSTP fixture)", () => {
  it("everyone tied at zero with a formula that says so", async () => {
    const ctx = await getLeagueContext({ leagueId: loadManifest().mstp.leagueId });
    const p = await getPowerRankings(ctx);
    expect(p.formula).toBe(POWER_FORMULA_EMPTY);
    expect(p.rows.map((r) => r.rank)).toEqual(ctx.rosters.map((_, i) => i + 1));
    for (const r of p.rows) expect(r.score).toBe(0);
  });
});
