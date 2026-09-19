/**
 * Hand-built league contexts and transactions for facts / roast tests. Everything here is
 * fictional (no fixture data), so the hand-checked expectations can live in the repo.
 */
import type {
  LeagueContext,
  Manager,
  SleeperLeague,
  SleeperRoster,
  SleeperTransaction,
  TeamRef,
} from "@/lib/types";

export const FAKE_TEAMS = [
  { rosterId: 1, manager: "Kevin", team: "Kevin's Kitchen" },
  { rosterId: 2, manager: "Rory", team: "Rory's Army" },
  { rosterId: 3, manager: "Priya", team: "Waiver Wire Priya" },
  { rosterId: 4, manager: "Wes", team: "Wes Side Story" },
] as const;

export const SLOTS = ["QB", "RB", "WR", "WR", "TE", "FLEX"];

export function fakeCtx(overrides: { settings?: Record<string, number>; slots?: string[] } = {}): LeagueContext {
  const slots = overrides.slots ?? SLOTS;
  const league: SleeperLeague = {
    league_id: "test-league",
    name: "Test League",
    season: "2030",
    season_type: "regular",
    status: "in_season",
    sport: "nfl",
    total_rosters: FAKE_TEAMS.length,
    roster_positions: [...slots, "BN", "BN", "BN"],
    scoring_settings: { rec: 1, rec_yd: 0.1, rush_yd: 0.1, pass_yd: 0.04, pass_td: 6, rec_td: 6, rush_td: 6 },
    settings: { waiver_type: 2, waiver_budget: 100, playoff_week_start: 15, playoff_teams: 2, ...(overrides.settings ?? {}) },
    draft_id: null,
    previous_league_id: null,
    avatar: null,
    metadata: null,
  };
  const rosters: SleeperRoster[] = FAKE_TEAMS.map((t) => ({
    roster_id: t.rosterId,
    owner_id: `u${t.rosterId}`,
    co_owners: null,
    league_id: league.league_id,
    players: [],
    starters: [],
    reserve: [],
    taxi: [],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
    metadata: null,
  }));
  const managers: Manager[] = FAKE_TEAMS.map((t) => ({
    rosterId: t.rosterId,
    userId: `u${t.rosterId}`,
    key: t.manager.toLowerCase(),
    name: t.manager,
    username: t.manager,
    teamName: t.team,
    avatarUrl: null,
    isCommissioner: false,
    matched: true,
  }));
  return {
    leagueId: league.league_id,
    league,
    users: [],
    rosters,
    managers,
    state: { week: 5, display_week: 5, season: "2030", previous_season: "2029", league_season: "2030", season_type: "regular", season_start_date: null, leg: 5 },
    draft: null,
    phase: "in_season",
    season: "2030",
    week: 5,
    playoffWeekStart: 15,
    lastRegularSeasonWeek: 14,
    lastWeek: 16,
    scoring: league.scoring_settings,
    rosterPositions: league.roster_positions,
    starterSlots: slots,
    isFixture: false,
    isDevLeague: true,
    loadedAt: 0,
  };
}

export function ref(rosterId: number): TeamRef {
  const t = FAKE_TEAMS.find((x) => x.rosterId === rosterId)!;
  return { rosterId, teamName: t.team, managerName: t.manager, managerKey: t.manager.toLowerCase() };
}

export function tx(partial: Partial<SleeperTransaction> & Pick<SleeperTransaction, "transaction_id" | "type">): SleeperTransaction {
  return {
    status: "complete",
    leg: 3,
    created: 1_000,
    status_updated: 2_000,
    creator: "u1",
    roster_ids: [],
    consenter_ids: null,
    adds: null,
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    settings: null,
    metadata: null,
    ...partial,
  };
}
