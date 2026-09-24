/**
 * League context: league, users, rosters, managers (mapped via config/managers.ts), NFL
 * state, draft, and the season phase. Every page and job starts here.
 *
 * Dev overrides:
 *   LEAGUE_ID=<id>             use another league (e.g. the RT fixture league)
 *   LEAGUE_WEEK_OVERRIDE=<n>   pretend the league is in season at week n (UI work on old data)
 */
import { cache } from "react";
import { MANAGERS, managerByUsername } from "@/config/managers";
import { isDevLeague, leagueId as defaultLeagueId } from "./env";
import { isFixtureMode } from "./http";
import { starterSlots } from "./scoring";
import { getDraft, getLeague, getNflState, getRosters, getUsers, rosterPointsAgainst, rosterPointsFor } from "./sleeper";
import type {
  LeagueContext,
  Manager,
  NflState,
  SeasonPhase,
  SleeperDraft,
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
  StandingRow,
  TeamRef,
} from "./types";

/** Number of playoff rounds for a bracket size (6 teams -> 3 rounds, with byes). */
export function playoffRounds(playoffTeams: number): number {
  return playoffTeams <= 1 ? 0 : Math.ceil(Math.log2(playoffTeams));
}

export function seasonWeeks(league: SleeperLeague): { playoffWeekStart: number; lastRegularSeasonWeek: number; lastWeek: number } {
  const playoffWeekStart = league.settings.playoff_week_start || 15;
  const rounds = playoffRounds(league.settings.playoff_teams ?? 6);
  // playoff_round_type 0 = one week per round; other values are multi-week rounds.
  const weeksPerRound = league.settings.playoff_round_type === 0 || league.settings.playoff_round_type === undefined ? 1 : 2;
  return {
    playoffWeekStart,
    lastRegularSeasonWeek: playoffWeekStart - 1,
    lastWeek: playoffWeekStart - 1 + rounds * weeksPerRound,
  };
}

/**
 * Phase from league status, draft status and NFL state.
 *   pre_draft  league (or its draft) has not started drafting
 *   drafting   draft live or paused
 *   in_season  drafted and the league's weeks are being played
 *   offseason  drafted but outside the league's weeks (before week 1, after the last week, or a stale season)
 *   complete   Sleeper marked the league complete
 */
export function computePhase(league: SleeperLeague, draft: SleeperDraft | null, state: NflState, lastWeek: number): SeasonPhase {
  if (league.status === "complete") return "complete";
  if (draft && (draft.status === "drafting" || draft.status === "paused")) return "drafting";
  if (league.status === "drafting") return "drafting";
  if (league.status === "pre_draft" && (!draft || draft.status === "pre_draft")) return "pre_draft";
  // in_season (or pre_draft whose draft completed but the league status has not caught up)
  if (state.season !== league.season) return "offseason";
  if (state.season_type === "off" || state.season_type === "pre") return "offseason";
  if (state.season_type === "post") return "offseason";
  if (state.week < 1 || state.week > lastWeek) return "offseason";
  return "in_season";
}

function currentWeek(league: SleeperLeague, state: NflState, phase: SeasonPhase, lastWeek: number): number {
  const lastScored = league.settings.last_scored_leg ?? 0;
  if (phase === "complete") return lastScored || lastWeek;
  if (state.season !== league.season) return lastScored;
  if (state.season_type === "regular") return Math.min(Math.max(state.week, 0), lastWeek);
  if (state.season_type === "post") return lastWeek;
  return 0;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildManagers(rosters: SleeperRoster[], users: SleeperUser[]): Manager[] {
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  return rosters.map((r) => {
    const user = r.owner_id ? usersById.get(r.owner_id) : undefined;
    if (!user) {
      return {
        rosterId: r.roster_id,
        userId: null,
        key: `roster-${r.roster_id}`,
        name: "Vacant",
        username: null,
        teamName: `Roster ${r.roster_id}`,
        avatarUrl: null,
        isCommissioner: false,
        matched: false,
      };
    }
    const cfg = managerByUsername(user.display_name ?? "");
    // No custom Sleeper team name: use the manager's first name, never "Team <username>".
    const teamName = user.metadata?.team_name?.trim() || cfg?.firstName || user.display_name || `Roster ${r.roster_id}`;
    const avatarUrl =
      user.metadata?.avatar || (user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null);
    return {
      rosterId: r.roster_id,
      userId: user.user_id,
      key: cfg?.key ?? (slug(user.display_name ?? "") || `roster-${r.roster_id}`),
      name: cfg?.firstName ?? user.display_name ?? `Roster ${r.roster_id}`,
      username: user.display_name ?? null,
      teamName,
      avatarUrl,
      // Sleeper's is_owner marks the league commissioner (in any league, including dev leagues).
      isCommissioner: Boolean(user.is_owner),
      matched: Boolean(cfg),
    };
  });
}

/** The league's first week (Sleeper settings.start_week, default 1). */
export function leagueStartWeek(league: SleeperLeague): number {
  const s = league.settings.start_week;
  return typeof s === "number" && s >= 1 ? s : 1;
}

/**
 * Sleeper scores the weeks before a league's start_week anyway: this league's startup draft ran
 * into week 2 and came out of it with a 0-0 tie for every team and last_scored_leg 2. Those
 * weeks were never league weeks, so drop them here, once, and no page shows a "Week 2" nobody
 * played or a 0-0-1 record.
 */
export function dropPreStartWeeks(league: SleeperLeague, rosters: SleeperRoster[]): { league: SleeperLeague; rosters: SleeperRoster[] } {
  const start = leagueStartWeek(league);
  if (start <= 1) return { league, rosters };
  const scored = league.settings.last_scored_leg ?? 0;
  const realWeeks = Math.max(0, scored - start + 1);
  const cleanLeague = scored > 0 && scored < start ? { ...league, settings: { ...league.settings, last_scored_leg: 0 } } : league;
  const cleanRosters = rosters.map((r) => {
    const st = r.settings;
    const ties = st.ties ?? 0;
    // Pre-start weeks are empty rosters scoring 0-0, so the extra games are all ties.
    const extra = (st.wins ?? 0) + (st.losses ?? 0) + ties - realWeeks;
    return extra > 0 && ties > 0 ? { ...r, settings: { ...st, ties: Math.max(0, ties - extra) } } : r;
  });
  return { league: cleanLeague, rosters: cleanRosters };
}

async function loadLeagueContext(leagueId: string): Promise<LeagueContext> {
  const [rawLeague, users, rawRosters, state] = await Promise.all([
    getLeague(leagueId),
    getUsers(leagueId),
    getRosters(leagueId),
    getNflState(),
  ]);
  const { league, rosters } = dropPreStartWeeks(rawLeague, rawRosters);
  const draft = league.draft_id ? await getDraft(league.draft_id).catch(() => null) : null;
  const weeks = seasonWeeks(league);

  let phase = computePhase(league, draft, state, weeks.lastWeek);
  let week = currentWeek(league, state, phase, weeks.lastWeek);
  const override = Number(process.env.LEAGUE_WEEK_OVERRIDE);
  if (Number.isInteger(override) && override > 0) {
    phase = "in_season";
    week = Math.min(override, weeks.lastWeek);
  }

  return {
    leagueId,
    league,
    users,
    rosters,
    managers: buildManagers(rosters, users),
    state,
    draft,
    phase,
    season: league.season,
    week,
    ...weeks,
    scoring: league.scoring_settings,
    rosterPositions: league.roster_positions,
    starterSlots: starterSlots(league.roster_positions),
    isFixture: isFixtureMode(),
    isDevLeague: isDevLeague(leagueId),
    loadedAt: Date.now(),
  };
}

/** Deduped per request in React Server Components. */
const cachedContext = cache(loadLeagueContext);

export async function getLeagueContext(opts: { leagueId?: string } = {}): Promise<LeagueContext> {
  return cachedContext(opts.leagueId ?? defaultLeagueId());
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function managerFor(ctx: LeagueContext, rosterId: number): Manager {
  const m = ctx.managers.find((x) => x.rosterId === rosterId);
  if (m) return m;
  return {
    rosterId,
    userId: null,
    key: `roster-${rosterId}`,
    name: "Unknown",
    username: null,
    teamName: `Roster ${rosterId}`,
    avatarUrl: null,
    isCommissioner: false,
    matched: false,
  };
}

export function teamRef(ctx: LeagueContext, rosterId: number): TeamRef {
  const m = managerFor(ctx, rosterId);
  return { rosterId, teamName: m.teamName, managerName: m.name, managerKey: m.key };
}

export function rosterFor(ctx: LeagueContext, rosterId: number): SleeperRoster | undefined {
  return ctx.rosters.find((r) => r.roster_id === rosterId);
}

export function rosterIdForUser(ctx: LeagueContext, userId: string): number | null {
  return ctx.rosters.find((r) => r.owner_id === userId || r.co_owners?.includes(userId))?.roster_id ?? null;
}

/** Managers from config/managers.ts that are not in this league yet (e.g. not joined). */
export function unmatchedConfiguredManagers(ctx: LeagueContext) {
  const matched = new Set(ctx.managers.filter((m) => m.matched).map((m) => m.key));
  return MANAGERS.filter((m) => !matched.has(m.key));
}

/**
 * Standings from Sleeper's roster records: wins (ties count half), then points for, then
 * points against (fewer ranks higher), then roster id.
 * Regular season only (Sleeper stops counting W/L in the playoffs).
 */
export function standingsFromRosters(ctx: LeagueContext): StandingRow[] {
  const rows = ctx.rosters.map((r) => ({
    team: teamRef(ctx, r.roster_id),
    wins: r.settings.wins ?? 0,
    losses: r.settings.losses ?? 0,
    ties: r.settings.ties ?? 0,
    pointsFor: rosterPointsFor(r),
    pointsAgainst: rosterPointsAgainst(r),
    streak: r.metadata?.streak ?? "",
  }));
  rows.sort(
    (a, b) =>
      b.wins + b.ties / 2 - (a.wins + a.ties / 2) ||
      b.pointsFor - a.pointsFor ||
      a.pointsAgainst - b.pointsAgainst ||
      a.team.rosterId - b.team.rosterId,
  );
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
