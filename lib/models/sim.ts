/**
 * Pure season simulator: remaining regular-season weeks, standings (record, then points for),
 * then the playoff bracket (fixed or reseeded), `runs` times with a seeded RNG.
 *
 * Bracket: rounds = ceil(log2(playoffTeams)), the top (2^rounds - playoffTeams) seeds get a
 * round-one bye. Fixed brackets use the standard order (1 v 8, 4 v 5, 2 v 7, 3 v 6, byes for
 * missing seeds), which is exactly Sleeper's 6-team bracket: 3v6 and 4v5 in round one, then
 * 1 v winner(4/5) and 2 v winner(3/6). Reseeded brackets pair the best remaining seed with the
 * worst every round. Sleeper also plays 3rd- and 5th-place games (the 5th-place game in round
 * two, Week 16 for a Week 15 start); they decide no title and are not simulated.
 *
 * The 1.01 (next year's first rookie pick) goes to the team with the lowest Max PF (points its
 * best possible lineup would have scored all season) among the teams that miss the playoffs, and
 * then to whoever holds that team's first-round pick. Max PF is the team's Max PF so far plus,
 * every simulated week, its simulated score and the points its best lineup has added on top of
 * its score per game so far.
 */
import type { RosterId } from "@/lib/types";
import { createRng } from "./math";

export interface SimTeamInput {
  rosterId: RosterId;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Max PF so far (Sleeper's "ppts": the best possible lineup's points). Default: pointsFor. */
  maxPointsFor?: number;
  /** Points the best lineup adds over the actual score per game so far (Max PF - PF per game). Default 0. */
  maxGap?: number;
  /** Weekly score distribution. */
  mean: number;
  sd: number;
}

export interface SimInput {
  teams: SimTeamInput[];
  /** Remaining regular-season weeks, each a list of head-to-head roster id pairs. */
  weeks: Array<Array<[RosterId, RosterId]>>;
  playoffTeams: number;
  reseed: boolean;
  /** Decided playoff games per round (0-based): "lowId-highId" -> winner. */
  known?: Array<Map<string, RosterId>>;
  /** Original roster -> roster holding its next first-round pick. */
  firstPickHolder?: Map<RosterId, RosterId>;
  runs: number;
  seed: number;
}

export interface SimCounts {
  runs: number;
  rosterIds: RosterId[];
  playoff: number[];
  bye: number[];
  title: number[];
  last: number[];
  /** Holder of the 1.01: lowest Max PF among the teams that missed the playoffs. */
  firstPick: number[];
  /** Sum over runs of final regular-season wins (ties count half). */
  winsSum: number[];
}

/** Standard bracket order for a power-of-two size: [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function simulateSeason(input: SimInput): SimCounts {
  const n = input.teams.length;
  const ids = input.teams.map((t) => t.rosterId);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const means = input.teams.map((t) => t.mean);
  const sds = input.teams.map((t) => t.sd);
  const baseWins = input.teams.map((t) => t.wins + t.ties / 2);
  const basePf = input.teams.map((t) => t.pointsFor);
  const baseMax = input.teams.map((t) => Math.max(t.maxPointsFor ?? t.pointsFor, t.pointsFor));
  const gaps = input.teams.map((t) => Math.max(0, t.maxGap ?? 0));
  const weeks = input.weeks.map((pairs) =>
    pairs
      .map(([a, b]) => [idx.get(a), idx.get(b)] as const)
      .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined),
  );
  const holder = ids.map((id) => idx.get(input.firstPickHolder?.get(id) ?? id) ?? idx.get(id)!);

  const P = Math.max(0, Math.min(input.playoffTeams, n));
  const rounds = P <= 1 ? 0 : Math.ceil(Math.log2(P));
  const size = 2 ** rounds;
  const byes = size - P;
  const order = bracketOrder(size);
  const known = input.known ?? [];

  const counts: SimCounts = {
    runs: input.runs,
    rosterIds: ids,
    playoff: new Array(n).fill(0),
    bye: new Array(n).fill(0),
    title: new Array(n).fill(0),
    last: new Array(n).fill(0),
    firstPick: new Array(n).fill(0),
    winsSum: new Array(n).fill(0),
  };
  if (n === 0) return counts;

  const rng = createRng(input.seed);
  const wins = new Float64Array(n);
  const pf = new Float64Array(n);
  const maxPf = new Float64Array(n);
  const standing: number[] = ids.map((_, i) => i);
  const seedOf = new Int32Array(n);
  const score = (i: number) => means[i] + sds[i] * rng.normal();

  const play = (x: number, y: number, round: number): number => {
    const decided = known[round]?.get(ids[x] < ids[y] ? `${ids[x]}-${ids[y]}` : `${ids[y]}-${ids[x]}`);
    if (decided !== undefined) {
      const w = idx.get(decided);
      if (w === x || w === y) return w;
    }
    const sx = score(x);
    const sy = score(y);
    if (sx !== sy) return sx > sy ? x : y;
    return seedOf[x] < seedOf[y] ? x : y;
  };

  for (let run = 0; run < input.runs; run++) {
    for (let i = 0; i < n; i++) {
      wins[i] = baseWins[i];
      pf[i] = basePf[i];
      maxPf[i] = baseMax[i];
    }
    for (const pairs of weeks) {
      for (const [a, b] of pairs) {
        const sa = score(a);
        const sb = score(b);
        pf[a] += sa;
        pf[b] += sb;
        maxPf[a] += sa + gaps[a];
        maxPf[b] += sb + gaps[b];
        if (sa > sb) wins[a] += 1;
        else if (sb > sa) wins[b] += 1;
        else {
          wins[a] += 0.5;
          wins[b] += 0.5;
        }
      }
    }
    standing.sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x] || ids[x] - ids[y]);
    for (let r = 0; r < n; r++) {
      const i = standing[r];
      seedOf[i] = r + 1;
      counts.winsSum[i] += wins[i];
    }
    const lastIdx = standing[n - 1];
    counts.last[lastIdx]++;
    // The 1.01: lowest Max PF among the teams outside the playoff field (everyone when no team
    // misses). A tie goes to the team that finished lower.
    const outside = P > 0 && P < n ? standing.slice(P) : standing;
    let worst = outside[0];
    for (const i of outside) if (maxPf[i] <= maxPf[worst]) worst = i;
    counts.firstPick[holder[worst]]++;
    if (P === 0) continue;
    for (let s = 0; s < P; s++) counts.playoff[standing[s]]++;
    for (let s = 0; s < byes; s++) counts.bye[standing[s]]++;

    let champion: number;
    if (rounds === 0) {
      champion = standing[0];
    } else if (!input.reseed) {
      let slots = order.map((s) => (s <= P ? standing[s - 1] : -1));
      for (let r = 0; r < rounds; r++) {
        const next: number[] = [];
        for (let k = 0; k < slots.length; k += 2) {
          const x = slots[k];
          const y = slots[k + 1];
          next.push(x < 0 ? y : y < 0 ? x : play(x, y, r));
        }
        slots = next;
      }
      champion = slots[0];
    } else {
      let alive = standing.slice(0, P);
      for (let r = 0; r < rounds; r++) {
        const sitting = r === 0 ? alive.slice(0, byes) : [];
        const field = r === 0 ? alive.slice(byes) : alive;
        const winners: number[] = [];
        for (let k = 0; k < field.length / 2; k++) winners.push(play(field[k], field[field.length - 1 - k], r));
        alive = [...sitting, ...winners].sort((x, y) => seedOf[x] - seedOf[y]);
      }
      champion = alive[0];
    }
    counts.title[champion]++;
  }
  return counts;
}
