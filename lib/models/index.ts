/**
 * Models public API. OWNER: models agent (lib/models/**, tests/models*).
 *
 * FOUNDATION STUB: every function returns correctly shaped placeholder data built from the
 * real league context (real team names, fake numbers) with `placeholder: true`. The
 * models agent replaces the bodies; the signatures are the contract in docs/CONTRACTS.md.
 */
import { listOddsSnapshots } from "@/lib/archive";
import { getLeagueContext, standingsFromRosters, teamRef } from "@/lib/league";
import { getMatchups } from "@/lib/sleeper";
import type {
  LeagueContext,
  OddsHistory,
  PowerRankings,
  SimOptions,
  SimResult,
  StarterLine,
  TeamWinProb,
  WinProb,
  WinProbWeek,
} from "@/lib/types";

/** Deterministic 0..1 noise so placeholders are stable across renders. */
function noise(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Pairs of roster ids for a week: Sleeper matchups when they exist, else 1v2, 3v4... */
async function pairings(ctx: LeagueContext, week: number): Promise<Array<[number, number, number]>> {
  if (week >= 1) {
    const ms = await getMatchups(ctx.leagueId, week).catch(() => []);
    const byId = new Map<number, number[]>();
    for (const m of ms) if (m.matchup_id !== null) byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m.roster_id]);
    const pairs = [...byId.entries()].filter(([, r]) => r.length === 2).map(([id, r]) => [r[0], r[1], id] as [number, number, number]);
    if (pairs.length) return pairs.sort((a, b) => a[2] - b[2]);
  }
  const ids = ctx.rosters.map((r) => r.roster_id);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < ids.length; i += 2) out.push([ids[i], ids[i + 1], i / 2 + 1]);
  return out;
}

function placeholderTeam(ctx: LeagueContext, rosterId: number, week: number): Omit<TeamWinProb, "winProb"> {
  const mean = Math.round((105 + 40 * noise(ctx.leagueId, rosterId, week)) * 100) / 100;
  const starters: StarterLine[] = ctx.starterSlots.map((slot, i) => {
    const projected = Math.round((6 + 14 * noise(rosterId, week, i)) * 100) / 100;
    return {
      playerId: `sample-${rosterId}-${i}`,
      name: `Sample ${slot} ${i + 1}`,
      position: slot === "FLEX" ? "WR" : slot,
      slot,
      nflTeam: null,
      actual: 0,
      projected,
      fractionRemaining: 1,
      expected: projected,
      status: "pre",
    };
  });
  return { team: teamRef(ctx, rosterId), actual: 0, projected: mean, mean, sd: 25, starters };
}

/** Win probability for every matchup in `week` (live when games are on, projections before). */
export async function getWinProbabilities(week: number, ctx?: LeagueContext): Promise<WinProbWeek> {
  const c = ctx ?? (await getLeagueContext());
  const matchups: WinProb[] = [];
  for (const [a, b, matchupId] of await pairings(c, week)) {
    const home = placeholderTeam(c, a, week);
    const away = placeholderTeam(c, b, week);
    const p = normalCdf((home.mean - away.mean) / Math.hypot(home.sd, away.sd));
    matchups.push({ week, matchupId, home: { ...home, winProb: p }, away: { ...away, winProb: 1 - p }, isFinal: false });
  }
  return { week, season: c.season, generatedAt: Date.now(), basis: "projections", matchups, placeholder: true };
}

/** Monte Carlo season odds (10,000 seeded runs by default). */
export async function runSeasonSim(opts: SimOptions = {}): Promise<SimResult> {
  const c = opts.ctx ?? (await getLeagueContext());
  const standings = standingsFromRosters(c);
  const n = standings.length || 1;
  const raw = standings.map((s) => ({ s, w: 0.2 + noise(c.leagueId, "sim", s.team.rosterId) }));
  const total = raw.reduce((acc, r) => acc + r.w, 0) || 1;
  const teams = raw.map(({ s, w }) => {
    const share = w / total;
    return {
      team: s.team,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      pointsFor: s.pointsFor,
      meanPoints: Math.round((105 + 40 * share * n * 0.5) * 100) / 100,
      sdPoints: 25,
      expectedWins: Math.round((4 + 6 * share * n * 0.5) * 10) / 10,
      playoffPct: Math.round(Math.min(99, 600 * share) * 10) / 10,
      byePct: Math.round(Math.min(95, 200 * share) * 10) / 10,
      titlePct: Math.round(100 * share * 10) / 10,
      lastPlacePct: Math.round((100 / n) * 10) / 10,
      firstPickPct: Math.round((100 / n) * 10) / 10,
    };
  });
  return {
    season: c.season,
    asOfWeek: Math.max(0, c.week - 1),
    runs: opts.runs ?? 10_000,
    seed: opts.seed ?? 1,
    generatedAt: Date.now(),
    teams: teams.sort((a, b) => b.titlePct - a.titlePct),
    placeholder: true,
  };
}

/** Power rankings: blend of all-play win %, points per game and projected strength. */
export async function getPowerRankings(ctx?: LeagueContext): Promise<PowerRankings> {
  const c = ctx ?? (await getLeagueContext());
  const rows = c.rosters
    .map((r) => {
      const x = noise(c.leagueId, "power", r.roster_id);
      return {
        rank: 0,
        previousRank: null,
        team: teamRef(c, r.roster_id),
        score: Math.round(x * 1000) / 10,
        allPlayWinPct: Math.round(x * 100) / 100,
        allPlayWins: 0,
        allPlayLosses: 0,
        pointsPerGame: Math.round((100 + 40 * x) * 100) / 100,
        projectedStrength: Math.round((110 + 30 * x) * 100) / 100,
        wins: r.settings.wins ?? 0,
        losses: r.settings.losses ?? 0,
        luck: 0,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((row, i) => ({ ...row, rank: i + 1 }));
  return {
    season: c.season,
    asOfWeek: Math.max(0, c.week - 1),
    formula: "Placeholder: the real formula sentence arrives with the models agent.",
    rows,
    placeholder: true,
  };
}

/** One odds snapshot per week, oldest first (from the store once runSeasonSim persists them). */
export async function getOddsHistory(ctx?: LeagueContext): Promise<OddsHistory> {
  const c = ctx ?? (await getLeagueContext());
  const stored = await listOddsSnapshots(c.leagueId, c.season).catch(() => []);
  if (stored.length) return { season: c.season, snapshots: stored, placeholder: false };
  const weeks = [1, 2, 3, 4];
  return {
    season: c.season,
    snapshots: weeks.map((week) => ({
      week,
      generatedAt: Date.now(),
      teams: c.rosters.map((r) => {
        const x = noise(c.leagueId, "odds", r.roster_id, week);
        return { rosterId: r.roster_id, playoffPct: Math.round(x * 1000) / 10, titlePct: Math.round(x * 200) / 10, byePct: Math.round(x * 400) / 10, lastPlacePct: Math.round((1 - x) * 200) / 10, expectedWins: Math.round(x * 140) / 10 };
      }),
    })),
    placeholder: true,
  };
}
