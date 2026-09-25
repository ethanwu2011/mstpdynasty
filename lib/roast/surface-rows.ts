/**
 * Rows for the stat-surface lines: one SurfaceRow per table row, built from facts and model
 * output by code. Pure (no I/O), so every surface is unit tested with hand-built data.
 *
 * Row ids follow RoastSurface in lib/types.ts (the pages look lines up by them). Each row's
 * facts carry `manager` and `team` so the post-check can bind every number to its owner, and
 * use the glossary keys in persona.ts (tests/roast-prompt.test.ts checks that). Numbers are
 * rounded the way the tables show them, so a line never quotes a figure the page does not.
 */
import type {
  DraftOdds,
  DraftPickFact,
  PowerRankings,
  ShameEntry,
  ShameKind,
  SimResult,
  StandingRow,
  SurfaceRow,
  TeamRef,
  TradeHindsight,
  TradeHindsightSide,
  WeeklyFacts,
  WinProbWeek,
} from "@/lib/types";
import { r1, r2, who } from "./format";
import type { DraftContext } from "./memory-shape";
import { assetPayload, matchupPayload, pickPayload, sidePct } from "./plan";

const record = (w: number, l: number, t = 0) => (t ? `${w}-${l}-${t}` : `${w}-${l}`);
const rowOf = (team: TeamRef, facts: Record<string, unknown>, hashKey?: string): SurfaceRow => ({
  id: String(team.rosterId),
  managers: [team.managerName],
  facts: { ...who(team), ...facts },
  ...(hashKey !== undefined ? { hashKey } : {}),
});

/* ------------------------------------------------------------------ */
/* standings                                                           */
/* ------------------------------------------------------------------ */

/** One row per team (id = rosterId). `lastWeek` gives each team's rank a week earlier. */
export function standingsRows(rows: StandingRow[], lastWeek: StandingRow[] | null = null): SurfaceRow[] {
  const prev = new Map((lastWeek ?? []).map((r) => [r.team.rosterId, r.rank]));
  return rows.map((r) => {
    const lastWeekRank = prev.get(r.team.rosterId) ?? r.previousRank ?? null;
    return rowOf(r.team, {
      rank: r.rank,
      record: record(r.wins, r.losses, r.ties),
      pointsFor: r2(r.pointsFor),
      pointsForRank: 1 + rows.filter((x) => x.pointsFor > r.pointsFor).length,
      pointsAgainst: r2(r.pointsAgainst),
      ...(r.streak ? { streak: r.streak } : {}),
      ...(lastWeekRank !== null ? { lastWeekRank } : {}),
      leagueSize: rows.length,
    });
  });
}

/* ------------------------------------------------------------------ */
/* odds                                                                */
/* ------------------------------------------------------------------ */

/** In-season odds (id = rosterId), in the sim's order (title odds, then playoff odds). */
/** Percent the way it is stable enough to quote: whole numbers from 10 up, one decimal below. */
/**
 * A percentage as the odds table prints it: one decimal, and never a certainty the sims did not
 * produce (a value above 0 is at least 0.1, one below 100 at most 99.9, as the table's "<0.1" and
 * ">99.9" say).
 */
const tablePct = (n: number) => (n <= 0 || n >= 100 ? Math.round(n) : Math.min(99.9, Math.max(0.1, r1(n))));
const stablePct = (n: number) => (n >= 10 && n < 99.5 ? Math.round(n) : tablePct(n));
/** As coarse as the line check tolerates (whole points), from the value the facts carry, for hashing only. */
const hashPct = (n: number) => Math.round(n);

/**
 * Season odds (id = rosterId). The sim reruns on fresh projections all week, so the row hashes
 * only its stable numbers: the line is rewritten when a quoted number really moves, not on every
 * projection update (which would spend the lines budget all week).
 */
export function oddsRows(sim: SimResult): SurfaceRow[] {
  return sim.teams.map((t, i) => {
    // The facts at the precision the odds table prints, so a line never quotes a number the page
    // does not (99.7 stays 99.7, never a certain 100).
    const facts = {
      rank: i + 1,
      playoffPct: tablePct(t.playoffPct),
      titlePct: tablePct(t.titlePct),
      byePct: tablePct(t.byePct),
      lastPct: tablePct(t.lastPlacePct),
      expectedWins: r1(t.expectedWins),
      record: record(t.wins, t.losses, t.ties),
      asOf: sim.asOfWeek > 0 ? `week ${sim.asOfWeek}` : "before the season",
    };
    const hash = [facts.rank, facts.record, facts.asOf, hashPct(facts.playoffPct), hashPct(facts.titlePct), hashPct(facts.byePct), hashPct(facts.lastPct), Math.round(facts.expectedWins)];
    return rowOf(t.team, facts, JSON.stringify(hash));
  });
}

/**
 * "If the season started today" odds (id = rosterId; stored under surfaceKeys.odds(season, 0)).
 * The line is rewritten only when a team's rounded headline numbers move, not on every pick, so
 * the facts hold only what the hash covers: numbers that move with every pick (projected points,
 * players drafted, the pick count) would otherwise sit stale in a line nobody rewrites.
 */
export function draftOddsRows(d: DraftOdds): SurfaceRow[] {
  if (!d.available) return [];
  return d.teams.map((t, i) => {
    const playoffPct = stablePct(t.playoffPct);
    const titlePct = stablePct(t.titlePct);
    const lastPct = stablePct(t.lastPlacePct);
    return rowOf(
      t.team,
      { rank: i + 1, playoffPct, titlePct, lastPct, projectedRank: t.projectedRank },
      JSON.stringify([d.basis, i + 1, playoffPct, titlePct, lastPct, t.projectedRank]),
    );
  });
}

/* ------------------------------------------------------------------ */
/* power rankings                                                      */
/* ------------------------------------------------------------------ */

/** Power rankings (id = rosterId). Hashed on everything but the projection, which moves all week, rounded. */
export function powerRows(p: PowerRankings): SurfaceRow[] {
  return p.rows.map((r) => {
    const facts = {
      rank: r.rank,
      ...(r.previousRank !== null ? { lastWeekRank: r.previousRank } : {}),
      record: record(r.wins, r.losses),
      pointsPerGame: r1(r.pointsPerGame),
      allPlay: record(r.allPlayWins, r.allPlayLosses),
      projected: r1(r.projectedStrength),
      luck: r1(r.luck),
      asOf: `week ${p.asOfWeek}`,
    };
    const { projected, ...stable } = facts;
    return rowOf(r.team, facts, JSON.stringify([stable, Math.round(projected)]));
  });
}

/* ------------------------------------------------------------------ */
/* matchups                                                            */
/* ------------------------------------------------------------------ */

/** A finished week (id = matchupId): the matchup facts the recap uses. */
export function finalMatchupRows(w: WeeklyFacts, draftSlots: Record<string, string> = {}): SurfaceRow[] {
  return w.matchups.map((m) => ({
    id: String(m.matchupId),
    managers: [m.home.team.managerName, m.away.team.managerName],
    facts: { week: w.week, ...matchupPayload(m, draftSlots) },
  }));
}

/** A week before kickoff (id = matchupId): projections and pre-game win odds only. */
export function pregameMatchupRows(wp: WinProbWeek): SurfaceRow[] {
  return wp.matchups.map((m) => ({
    id: String(m.matchupId),
    managers: [m.home.team.managerName, m.away.team.managerName],
    facts: {
      week: wp.week,
      asOf: "before kickoff",
      // Whole percentages that add to 100, the way the card beside the line prints them.
      teams: [m.home, m.away].map((t) => ({ ...who(t.team), projected: r1(t.projected), winPct: sidePct(m, t) })),
    },
  }));
}

/* ------------------------------------------------------------------ */
/* team pages                                                          */
/* ------------------------------------------------------------------ */

export interface TeamPageInput {
  team: TeamRef;
  /** Every player on the roster (or drafted so far), with today's FantasyCalc value (null = unranked). */
  players: Array<{ name: string; position: string; age: number | null; value: number | null; nflTeam?: string | null }>;
  /** Standings, once games exist. */
  record?: string | null;
  rank?: number | null;
}

/** How many of a team's most valuable players the line sees. */
export const TOP_PLAYERS = 3;

export function teamRows(teams: TeamPageInput[]): SurfaceRow[] {
  const total = (t: TeamPageInput) => t.players.reduce((s, p) => s + (p.value ?? 0), 0);
  const totals = teams.map(total);
  return teams
    .filter((t) => t.players.length > 0)
    .map((t) => {
      const value = total(t);
      const ages = t.players.map((p) => p.age).filter((a): a is number => typeof a === "number");
      const top = [...t.players]
        .filter((p) => p.value !== null)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.name.localeCompare(b.name))
        .slice(0, TOP_PLAYERS);
      return rowOf(t.team, {
        rosterSize: t.players.length,
        totalValue: Math.round(value),
        valueRank: 1 + totals.filter((v) => v > value).length,
        unrankedCount: t.players.filter((p) => p.value === null).length,
        ...(ages.length ? { avgAge: r1(ages.reduce((s, a) => s + a, 0) / ages.length) } : {}),
        topPlayers: top.map((p) => assetPayload(p)),
        ...(t.record ? { record: t.record } : {}),
        ...(t.rank ? { rank: t.rank } : {}),
        leagueSize: teams.length,
      });
    });
}

/* ------------------------------------------------------------------ */
/* trades                                                              */
/* ------------------------------------------------------------------ */

function hindsightSide(s: TradeHindsightSide) {
  return {
    ...who(s.team),
    got: s.playersIn.map((p) => assetPayload(p)),
    gotPicks: s.picksIn.map((p) => ({ label: p.label, value: p.value })),
    gave: s.playersOut.map((p) => assetPayload(p)),
    gavePicks: s.picksOut.map((p) => ({ label: p.label, value: p.value })),
    ...(s.faabIn || s.faabOut ? { faabIn: s.faabIn, faabOut: s.faabOut } : {}),
    then: s.valueInThen === null || s.valueOutThen === null ? null : { valueIn: s.valueInThen, valueOut: s.valueOutThen, net: s.netThen, grade: s.gradeThen },
    now: { valueIn: s.valueInNow, valueOut: s.valueOutNow, net: s.netNow, grade: s.gradeNow },
  };
}

/** Every trade in hindsight (id = transactionId), newest first as given. */
export function tradeRows(trades: TradeHindsight[]): SurfaceRow[] {
  return trades.map((t) => {
    const winner = t.sides.find((s) => s.team.rosterId === t.winnerNowRosterId);
    const loser = t.sides.find((s) => s.team.rosterId === t.loserNowRosterId);
    return {
      id: t.transactionId,
      managers: t.sides.map((s) => s.team.managerName),
      facts: {
        week: t.week,
        date: t.date,
        sides: t.sides.map(hindsightSide),
        winner: winner ? winner.team.managerName : "nobody (fair by value today)",
        ...(loser && t.valueLost > 0 ? { loser: loser.team.managerName, valueLost: t.valueLost } : {}),
        ...(loser && t.lostSinceTrade !== null ? { lostSinceTrade: t.lostSinceTrade } : {}),
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Wall of Shame                                                       */
/* ------------------------------------------------------------------ */

export const SHAME_LISTS: Record<ShameKind, string> = {
  bench_points: "points left on the bench",
  zero_starter: "starters who scored zero",
  bad_trade: "worst trades",
  zero_bid_lost: "$0 bids that lost",
  overpay: "biggest FAAB overpays",
  lineup_negligence: "lineup negligence",
  draft_reach: "draft reaches",
};

export function shameRows(entries: ShameEntry[]): SurfaceRow[] {
  return entries.map((e) => ({
    id: e.id,
    managers: [e.team.managerName],
    facts: {
      ...who(e.team),
      entry: SHAME_LISTS[e.kind],
      headline: e.headline,
      ...(e.detail ? { detail: e.detail } : {}),
      ...(e.week !== null ? { week: e.week } : {}),
    },
  }));
}

/* ------------------------------------------------------------------ */
/* draft picks                                                         */
/* ------------------------------------------------------------------ */

/**
 * One row per pick (id = String(pickNo)), newest first so a capped refresh writes the latest
 * picks first. Hashed on who took whom only: the live FantasyCalc rank in the facts moves every
 * day, and a pick's line is written once.
 */
export function draftRows(picks: DraftPickFact[], draft: DraftContext | null = null): SurfaceRow[] {
  return [...picks]
    .sort((a, b) => b.pickNo - a.pickNo)
    .map((p) => ({
      id: String(p.pickNo),
      managers: [p.team.managerName],
      facts: pickPayload(p, draft),
      hashKey: `${p.draftId}:${p.pickNo}:${p.player.playerId}:${p.team.rosterId}`,
    }));
}
