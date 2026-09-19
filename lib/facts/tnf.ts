/**
 * Thursday night facts: every rostered player in the week's Thursday game(s), his points
 * and projection, whether his manager started him, and per fantasy team the points already
 * banked from Thursday against what those starters were projected for.
 */
import { teamRef } from "@/lib/league";
import { isEligible, pointsFromStats } from "@/lib/scoring";
import { weekdayOfDate } from "@/lib/time";
import type { NflGame, RosterId, TnfFacts, TnfPlayerFact } from "@/lib/types";
import type { FactsLoader } from "./load";
import { playerAsset, positionsOf, r2 } from "./util";

/** Unrostered players only make the list when they scored at least this much. */
export const TNF_FREE_AGENT_MIN_POINTS = 15;

/** Games played before Friday: Thursday (plus the rare Wednesday opener). */
export function thursdayGames(schedule: NflGame[], week: number): NflGame[] {
  return schedule.filter((g) => g.week === week && g.date && [3, 4].includes(weekdayOfDate(g.date)));
}

export async function computeTnfFacts(week: number, loader: FactsLoader): Promise<TnfFacts> {
  const ctx = loader.ctx;
  const [schedule, matchups, players, stats, projections, snap] = await Promise.all([
    loader.schedule(),
    loader.matchups(week),
    loader.players(),
    loader.stats(week),
    loader.projections(week),
    loader.fantasyCalc(),
  ]);
  const games = thursdayGames(schedule, week);
  const nflTeams = new Set(games.flatMap((g) => [g.home, g.away]));
  const teamOf = (id: string) => stats?.[id]?.team ?? players[id]?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : null);
  const inTnf = (id: string) => {
    const t = teamOf(id);
    return t !== null && nflTeams.has(t);
  };
  const actual = (id: string, rosterPoints?: Record<string, number>) => {
    if (rosterPoints && id in rosterPoints) return r2(rosterPoints[id]);
    const row = stats?.[id];
    return row ? pointsFromStats(row.stats, ctx.scoring, row.position ?? players[id]?.pos ?? null) : 0;
  };
  const projected = (id: string) => {
    const row = projections?.[id];
    return row ? pointsFromStats(row.stats, ctx.scoring, row.position ?? players[id]?.pos ?? null) : null;
  };

  const out: TnfPlayerFact[] = [];
  const rostered = new Set<string>();
  const perTeam = new Map<RosterId, { banked: number; projected: number }>();
  for (const m of matchups) {
    const starters = new Set(m.starters.filter((id) => id !== "0"));
    const bucket = { banked: 0, projected: 0 };
    for (const id of m.players) {
      rostered.add(id);
      if (!inTnf(id)) continue;
      const points = actual(id, m.players_points);
      const proj = projected(id);
      const started = starters.has(id);
      if (started) {
        bucket.banked += points;
        bucket.projected += proj ?? 0;
      }
      out.push({ player: { ...playerAsset(players, id, snap), nflTeam: teamOf(id) }, points, projected: proj === null ? null : r2(proj), team: teamRef(ctx, m.roster_id), started });
    }
    perTeam.set(m.roster_id, bucket);
  }
  // Unrostered Thursday players who went off (the waiver wire's revenge).
  const startable = (positions: string[]) => ctx.starterSlots.some((slot) => isEligible(slot, positions));
  if (stats) {
    for (const [id, row] of Object.entries(stats)) {
      if (rostered.has(id) || !row.team || !nflTeams.has(row.team)) continue;
      // Only players the league can start (MSTP has no K or DEF slot, though its scoring has DEF keys).
      if (!startable(positionsOf(players, id, row.position))) continue;
      const points = pointsFromStats(row.stats, ctx.scoring, row.position ?? players[id]?.pos ?? null);
      if (points < TNF_FREE_AGENT_MIN_POINTS) continue;
      const proj = projected(id);
      out.push({ player: { ...playerAsset(players, id, snap), nflTeam: row.team }, points, projected: proj === null ? null : r2(proj), team: null, started: false });
    }
  }
  out.sort((a, b) => b.points - a.points || a.player.playerId.localeCompare(b.player.playerId));

  const teams = ctx.rosters.map((r) => {
    const b = perTeam.get(r.roster_id) ?? { banked: 0, projected: 0 };
    return { team: teamRef(ctx, r.roster_id), banked: r2(b.banked), projected: r2(b.projected), delta: r2(b.banked - b.projected) };
  });
  teams.sort((a, b) => b.delta - a.delta || a.team.rosterId - b.team.rosterId);
  return { week, games, players: out, teams, placeholder: false };
}
