import { describe, expect, it } from "vitest";
import { lastCompletedWeek } from "@/lib/facts/weekly";
import { dropPreStartWeeks } from "@/lib/league";
import type { LeagueContext, SleeperLeague, SleeperRoster } from "@/lib/types";

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
});
