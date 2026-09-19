/**
 * Synthetic league data for the ops tests. No fixtures and no network, so these tests run in
 * a fresh clone of the public repo. Team names are made up.
 */
import { MSTP_LEAGUE_ID } from "@/lib/env";
import type { EmailMessage, EmailTransport } from "@/lib/email/transport";
import type { Issue, LeagueContext, Manager, NflGame, SleeperDraft, SleeperLeague, SleeperRoster } from "@/lib/types";

/**
 * A placeholder address on the reserved example.com domain, built at run time: no email
 * address is ever written into a tracked file, a test included (docs/CONTRACTS.md).
 */
export const addr = (name: string) => [name, "example.com"].join("@");

export function fakeDraft(over: Partial<SleeperDraft> = {}): SleeperDraft {
  return {
    draft_id: "draft-1",
    league_id: MSTP_LEAGUE_ID,
    season: "2026",
    season_type: "regular",
    type: "snake",
    status: "complete",
    start_time: Date.UTC(2026, 7, 1),
    last_picked: Date.UTC(2026, 7, 5),
    created: Date.UTC(2026, 6, 1),
    draft_order: null,
    slot_to_roster_id: null,
    settings: { rounds: 34, teams: 4 },
    metadata: null,
    ...over,
  };
}

export function fakeCtx(over: Partial<LeagueContext> = {}): LeagueContext {
  const leagueId = over.leagueId ?? MSTP_LEAGUE_ID;
  const rosters: SleeperRoster[] = [1, 2, 3, 4].map((id) => ({
    roster_id: id,
    owner_id: `u${id}`,
    co_owners: null,
    league_id: leagueId,
    players: [`p${id}a`, `p${id}b`],
    starters: [`p${id}a`, "0"],
    reserve: [],
    taxi: [],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
    metadata: null,
  }));
  const managers: Manager[] = rosters.map((r) => ({
    rosterId: r.roster_id,
    userId: r.owner_id,
    key: `m${r.roster_id}`,
    name: `Manager ${r.roster_id}`,
    username: null,
    teamName: `Team ${r.roster_id}`,
    avatarUrl: null,
    isCommissioner: r.roster_id === 1,
    matched: false,
  }));
  const league: SleeperLeague = {
    league_id: leagueId,
    name: "Test League",
    season: "2026",
    season_type: "regular",
    status: "in_season",
    sport: "nfl",
    total_rosters: 4,
    roster_positions: ["QB", "RB", "BN", "BN"],
    scoring_settings: { rec: 1 },
    settings: { playoff_week_start: 15, playoff_teams: 6 },
    draft_id: "draft-1",
    previous_league_id: null,
    avatar: null,
    metadata: null,
  };
  return {
    leagueId,
    league,
    users: [],
    rosters,
    managers,
    state: { week: 4, display_week: 4, season: "2026", previous_season: "2025", league_season: "2026", season_type: "regular", season_start_date: null, leg: 4 },
    draft: fakeDraft(),
    phase: "in_season",
    season: "2026",
    week: 4,
    playoffWeekStart: 15,
    lastRegularSeasonWeek: 14,
    lastWeek: 17,
    scoring: { rec: 1 },
    rosterPositions: league.roster_positions,
    starterSlots: ["QB", "RB"],
    isFixture: true,
    isDevLeague: leagueId !== MSTP_LEAGUE_ID,
    loadedAt: 0,
    ...over,
  };
}

/** A 2026-like schedule: each week has a Thursday game, a Sunday slate and a Monday game. */
export function fakeSchedule(): NflGame[] {
  const weeks: Array<[number, string, string, string]> = [
    [2, "2026-09-17", "2026-09-20", "2026-09-21"],
    [3, "2026-09-24", "2026-09-27", "2026-09-28"],
    [4, "2026-10-01", "2026-10-04", "2026-10-05"],
    [5, "2026-10-08", "2026-10-11", "2026-10-12"],
    [16, "2026-12-24", "2026-12-27", "2026-12-28"],
    [17, "2026-12-31", "2027-01-03", "2027-01-04"],
    [18, "2027-01-09", "2027-01-10", "2027-01-10"],
  ];
  const games: NflGame[] = [];
  for (const [week, thu, sun, mon] of weeks) {
    games.push({ gameId: `${week}-thu`, week, date: thu, home: "KC", away: "BUF", status: "pre_game" });
    games.push({ gameId: `${week}-sun1`, week, date: sun, home: "DAL", away: "NYG", status: "pre_game" });
    games.push({ gameId: `${week}-sun2`, week, date: sun, home: "PHI", away: "WAS", status: "pre_game" });
    games.push({ gameId: `${week}-mon`, week, date: mon, home: "SF", away: "SEA", status: "pre_game" });
  }
  return games;
}

export function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: `${MSTP_LEAGUE_ID}:2026-09-29:weekly_recap`,
    slug: "2026-09-29-weekly-recap",
    kind: "weekly_recap",
    leagueId: MSTP_LEAGUE_ID,
    season: "2026",
    week: 3,
    date: "2026-09-29",
    title: "Week 3 Recap",
    dek: "Week 3, reviewed.",
    sections: [{ heading: "Scores", blocks: [{ type: "paragraph", text: "Team 1 beat Team 2." }] }],
    factsOnly: true,
    note: null,
    status: "draft",
    createdAt: Date.now(),
    sentAt: null,
    recipientCount: null,
    model: null,
    usage: null,
    imageUrl: null,
    placeholder: false,
    ...over,
  };
}

export interface FakeTransport extends EmailTransport {
  sent: Array<{ messages: EmailMessage[]; idempotencyKey?: string }>;
  fail: boolean;
  /** The error message a failing send throws. */
  failWith?: string;
}

export function fakeTransport(): FakeTransport {
  const t: FakeTransport = {
    name: "fake",
    sent: [],
    fail: false,
    async send(messages, opts) {
      if (t.fail) throw new Error(t.failWith ?? "smtp on fire");
      t.sent.push({ messages, idempotencyKey: opts?.idempotencyKey });
      return { ids: messages.map((_, i) => `msg-${t.sent.length}-${i}`) };
    },
  };
  return t;
}

/** The first URL in a plain-text email that contains `path`. */
export function linkIn(text: string, path: string): URL {
  const hit = text.split(/\s+/).find((w) => w.includes(path));
  if (!hit) throw new Error(`no ${path} link in email`);
  return new URL(hit);
}
