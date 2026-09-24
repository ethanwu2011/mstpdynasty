import { beforeEach, describe, expect, it, vi } from "vitest";

// The facts below read Sleeper through these: every week's matchups are hand-built here.
vi.mock("@/lib/sleeper", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/sleeper")>();
  return {
    ...mod,
    getMatchups: vi.fn(async () => []),
    getPlayers: vi.fn(async () => ({})),
    getWeekStats: vi.fn(async () => null),
    getWeekProjections: vi.fn(async () => null),
    getSchedule: vi.fn(async () => []),
    getTransactions: vi.fn(async () => []),
  };
});
vi.mock("@/lib/fantasycalc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/fantasycalc")>();
  return { ...mod, getFantasyCalc: vi.fn(async () => Promise.reject(new Error("offline"))), getFantasyCalcOn: vi.fn(async () => null) };
});

import { loserOfTheWeekCounts, shameEntries, standingsAsOf } from "@/lib/facts";
import { lastCompletedWeek } from "@/lib/facts/weekly";
import { dropPreStartWeeks } from "@/lib/league";
import { getMatchups } from "@/lib/sleeper";
import * as store from "@/lib/store";
import type { LeagueContext, SleeperLeague, SleeperMatchup, SleeperRoster } from "@/lib/types";
import { fakeCtx, SLOTS } from "./facts-synthetic";

const league = (start: number, scored: number) => ({ settings: { start_week: start, last_scored_leg: scored } }) as unknown as SleeperLeague;
const roster = (id: number, wins: number, losses: number, ties: number) =>
  ({ roster_id: id, settings: { wins, losses, ties, fpts: 0 } }) as unknown as SleeperRoster;

describe("weeks before the league's start_week", () => {
  it("drops the 0-0 ties Sleeper scored for a week the league never played", () => {
    // What Sleeper returned on Sep 24 2026: start_week 3, last_scored_leg 2, every team 0-0-1.
    const out = dropPreStartWeeks(league(3, 2), [roster(1, 0, 0, 1), roster(2, 0, 0, 1)]);
    expect(out.league.settings.last_scored_leg).toBe(0);
    expect(out.rosters.map((r) => [r.settings.wins, r.settings.losses, r.settings.ties])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("keeps real weeks and real ties once the season is under way", () => {
    const out = dropPreStartWeeks(league(3, 4), [roster(1, 2, 0, 1), roster(2, 1, 1, 0)]);
    expect(out.league.settings.last_scored_leg).toBe(4);
    // Two real weeks (3 and 4) plus the phantom week-2 tie: the phantom goes, the rest stays.
    expect(out.rosters.map((r) => [r.settings.wins, r.settings.losses, r.settings.ties])).toEqual([
      [2, 0, 0],
      [1, 1, 0],
    ]);
  });

  it("leaves a league that starts in week 1 alone", () => {
    const l = league(1, 2);
    const rs = [roster(1, 1, 0, 1)];
    expect(dropPreStartWeeks(l, rs)).toEqual({ league: l, rosters: rs });
  });

  it("never calls a pre-start week the last completed week", () => {
    const ctx = (scored: number, week: number) =>
      ({ league: league(3, scored), phase: "in_season", week, lastWeek: 17 }) as unknown as LeagueContext;
    expect(lastCompletedWeek(ctx(0, 3))).toBe(0);
    expect(lastCompletedWeek(ctx(2, 3))).toBe(0);
    expect(lastCompletedWeek(ctx(3, 4))).toBe(3);
  });

  it("counts only regular-season weeks once the playoffs are scored", () => {
    // Start week 3, playoffs from week 15, every week through the final (17) scored: Sleeper's
    // roster records hold 12 regular-season games (weeks 3 to 14) plus the phantom week-2 tie.
    const done = { settings: { start_week: 3, last_scored_leg: 17, playoff_week_start: 15 } } as unknown as SleeperLeague;
    const out = dropPreStartWeeks(done, [roster(1, 7, 5, 1), roster(2, 6, 5, 2)]);
    expect(out.rosters.map((r) => [r.settings.wins, r.settings.losses, r.settings.ties])).toEqual([
      [7, 5, 0],
      [6, 5, 1],
    ]);
  });
});

describe("facts start at the league's start_week", () => {
  // Start week 3, week 3 final. Week 1 is what Sleeper returns before a league starts (every
  // slot "0", nothing scored); week 2 is a week Sleeper scored anyway. Neither is a league week.
  const ctx = (): LeagueContext => fakeCtx({ settings: { start_week: 3, last_scored_leg: 3 } });
  const pairs: Array<[number, number]> = [
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
  ];
  const empty = (rosterId: number, matchupId: number): SleeperMatchup => ({
    roster_id: rosterId,
    matchup_id: matchupId,
    points: 0,
    custom_points: null,
    starters: SLOTS.map(() => "0"),
    starters_points: SLOTS.map(() => 0),
    players: [],
    players_points: {},
  });
  /** A full lineup scoring `points` (every starter scores), with `emptySlot` left as "0". */
  const scored = (rosterId: number, matchupId: number, points: number, emptySlot = -1): SleeperMatchup => {
    const starters = SLOTS.map((_, i) => (i === emptySlot ? "0" : `r${rosterId}s${i}`));
    const real = starters.filter((id) => id !== "0");
    const each: number[] = SLOTS.map((_, i) => (i === emptySlot ? 0 : 10));
    const last = starters.lastIndexOf(real[real.length - 1]);
    each[last] = points - 10 * (real.length - 1);
    return {
      roster_id: rosterId,
      matchup_id: matchupId,
      points,
      custom_points: null,
      starters,
      starters_points: each,
      players: real,
      players_points: Object.fromEntries(real.map((id) => [id, each[starters.indexOf(id)]])),
    };
  };
  const weeks: Record<number, SleeperMatchup[]> = {
    1: pairs.map(([r, m]) => empty(r, m)),
    // Loser of the Week would be Wes (roster 4) on 70.
    2: [scored(1, 1, 100), scored(2, 1, 90), scored(3, 2, 80), scored(4, 2, 70)],
    // The real week: Kevin (roster 1) loses on 95 with an empty FLEX.
    3: [scored(1, 1, 95, SLOTS.indexOf("FLEX")), scored(2, 1, 110), scored(3, 2, 130), scored(4, 2, 120)],
  };

  beforeEach(() => {
    store.resetStoreForTests();
    vi.mocked(getMatchups).mockImplementation(async (_league, week) => weeks[week] ?? []);
  });

  it("the Wall of Shame never lists the empty lineups Sleeper returns before the start week", async () => {
    const board = await shameEntries(ctx());
    expect(board.entries.map((e) => [e.kind, e.week, e.team.rosterId, e.detail])).toEqual([["lineup_negligence", 3, 1, "Week 3, FLEX"]]);
  });

  it("Loser of the Week counts only league weeks", async () => {
    expect(await loserOfTheWeekCounts(3, ctx())).toEqual({ 1: 1 });
  });

  it("standings count only league weeks, even one Sleeper scored before the start", async () => {
    const rows = await standingsAsOf(3, ctx());
    expect(rows.map((r) => [r.team.rosterId, `${r.wins}-${r.losses}-${r.ties}`, r.pointsFor])).toEqual([
      [3, "1-0-0", 130],
      [2, "1-0-0", 110],
      [4, "0-1-0", 120],
      [1, "0-1-0", 95],
    ]);
  });
});
