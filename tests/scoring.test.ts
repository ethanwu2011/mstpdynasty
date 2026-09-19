/**
 * Recompute every player's points from fixture stat lines with lib/scoring.ts and compare
 * with Sleeper's own players_points (tolerance 0.01), for every week of:
 *   - the dev fixture league (2025), checked against its own scoring_settings
 *   - the scoring-check league (2025): MSTP's slots and headline scoring (full PPR, +0.5 TE
 *     reception, 6-pt pass TD), checked against its own scoring_settings
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeague, getMatchups, getPlayers, getWeekStats } from "@/lib/sleeper";
import { isEligible, optimalLineup, pointsFromStats, starterSlots } from "@/lib/scoring";
import type { PlayersMap, SleeperLeague } from "@/lib/types";
import { hasFixtures, loadManifest } from "./helpers/fixtures";

const TOLERANCE = 0.01;

interface Mismatch {
  week: number;
  playerId: string;
  sleeper: number;
  ours: number;
  starter: boolean;
}

async function compareLeague(league: SleeperLeague, weeks: number[], players: PlayersMap, stripTeBonus = false) {
  const mismatches: Mismatch[] = [];
  let checked = 0;
  let startersChecked = 0;
  for (const week of weeks) {
    const [matchups, stats] = await Promise.all([getMatchups(league.league_id, week), getWeekStats(league.season, week)]);
    for (const m of matchups) {
      for (const [playerId, sleeperPts] of Object.entries(m.players_points)) {
        const row = stats[playerId];
        const position = row?.position ?? players[playerId]?.pos ?? null;
        let line = row?.stats;
        if (stripTeBonus && line && "bonus_rec_te" in line) {
          line = { ...line };
          delete line.bonus_rec_te;
        }
        const ours = pointsFromStats(line, league.scoring_settings, position);
        const starter = m.starters.includes(playerId);
        checked++;
        if (starter) startersChecked++;
        if (Math.abs(ours - sleeperPts) > TOLERANCE) mismatches.push({ week, playerId, sleeper: sleeperPts, ours, starter });
      }
    }
  }
  return { mismatches, checked, startersChecked };
}

describe.skipIf(!hasFixtures())("league scoring matches Sleeper", () => {
  let players: PlayersMap;
  beforeAll(async () => {
    players = await getPlayers();
  });

  it("dev fixture league: every player, every week 1-17", async () => {
    const manifest = loadManifest();
    const league = await getLeague(manifest.rt.leagueId);
    const { mismatches, checked, startersChecked } = await compareLeague(league, manifest.weeks.matchups, players);
    expect(startersChecked).toBeGreaterThan(1800);
    expect(checked).toBeGreaterThan(startersChecked);
    expect(mismatches).toEqual([]);
  });

  it("scoring-check league (MSTP-style scoring with TE bonus): every player, every week 1-17", async () => {
    const manifest = loadManifest();
    expect(manifest.scoringCheck.length).toBeGreaterThan(0);
    for (const { leagueId } of manifest.scoringCheck) {
      const league = await getLeague(leagueId);
      expect(league.scoring_settings.bonus_rec_te).toBeGreaterThan(0);
      const { mismatches, startersChecked } = await compareLeague(league, manifest.weeks.matchups, players);
      expect(startersChecked).toBeGreaterThan(1800);
      expect(mismatches).toEqual([]);
    }
  });

  it("derives the TE bonus from position when the stat line lacks bonus_rec_te", async () => {
    const manifest = loadManifest();
    for (const { leagueId } of manifest.scoringCheck) {
      const league = await getLeague(leagueId);
      const { mismatches } = await compareLeague(league, manifest.weeks.matchups, players, true);
      expect(mismatches).toEqual([]);
    }
  });
});

describe("pointsFromStats", () => {
  const scoring = { rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5, pass_yd: 0.04, pass_td: 6, pass_int: -1, fum_lost: -2, rec_2pt: 2 };

  it("dot product of scoring settings and stats, rounded to 2 decimals", () => {
    expect(pointsFromStats({ pass_yd: 301, pass_td: 2, pass_int: 1 }, scoring, "QB")).toBe(23.04);
    expect(pointsFromStats({ rec: 5, rec_yd: 48, rec_2pt: 1, fum_lost: 1 }, scoring, "WR")).toBe(9.8);
  });

  it("TE bonus: uses bonus_rec_te when present, derives it from rec for TEs otherwise", () => {
    expect(pointsFromStats({ rec: 4, rec_yd: 40, bonus_rec_te: 4 }, scoring, "TE")).toBe(10);
    expect(pointsFromStats({ rec: 4, rec_yd: 40 }, scoring, "TE")).toBe(10);
    expect(pointsFromStats({ rec: 4, rec_yd: 40 }, scoring, "WR")).toBe(8);
  });

  it("empty or missing lines score 0", () => {
    expect(pointsFromStats(undefined, scoring)).toBe(0);
    expect(pointsFromStats({}, scoring)).toBe(0);
  });
});

describe("slots and optimal lineup", () => {
  const mstpPositions = ["QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX", "BN", "BN", "IR", "TAXI"];

  it("starter slots drop BN / IR / TAXI", () => {
    expect(starterSlots(mstpPositions)).toEqual(["QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "FLEX"]);
  });

  it("eligibility", () => {
    expect(isEligible("FLEX", ["TE"])).toBe(true);
    expect(isEligible("FLEX", ["QB"])).toBe(false);
    expect(isEligible("SUPER_FLEX", "QB")).toBe(true);
    expect(isEligible("QB", ["QB", "TE"])).toBe(true);
    expect(isEligible("BN", ["QB"])).toBe(false);
  });

  it("finds the best lineup, fills flex with the best leftovers, leaves impossible slots empty", () => {
    const slots = ["QB", "RB", "WR", "TE", "FLEX"];
    const cands = [
      { playerId: "rb1", positions: ["RB"], points: 20 },
      { playerId: "rb2", positions: ["RB"], points: 15 },
      { playerId: "wr1", positions: ["WR"], points: 12 },
      { playerId: "te1", positions: ["TE"], points: 9 },
      { playerId: "te2", positions: ["TE"], points: 14 },
      { playerId: "k1", positions: ["K"], points: 30 },
    ];
    const best = optimalLineup(slots, cands);
    expect(best.slots.map((s) => s.playerId)).toEqual([null, "rb1", "wr1", "te2", "rb2"]);
    expect(best.total).toBe(61);
  });

  it("handles a two-position player where greedy would fail", () => {
    // Greedy "best player into the first eligible slot" puts the QB/TE into QB and leaves TE empty.
    const best = optimalLineup(["QB", "TE"], [
      { playerId: "hybrid", positions: ["QB", "TE"], points: 18 },
      { playerId: "qb", positions: ["QB"], points: 16 },
    ]);
    expect(best.total).toBe(34);
    expect(best.slots).toEqual([
      { slot: "QB", playerId: "qb", points: 16 },
      { slot: "TE", playerId: "hybrid", points: 18 },
    ]);
  });
});
