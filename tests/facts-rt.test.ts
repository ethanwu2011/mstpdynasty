/**
 * Facts engine on the RT fixture league (a completed season), checked against numbers Sleeper
 * computed itself and against independent re-derivations from the raw payloads. No fixture
 * values are written into this file (the repo is public): every expectation is derived at
 * test time.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { draftFacts, shameEntries, standingsAsOf, tnfFacts, transactionFacts, weeklyFacts } from "@/lib/facts";
import { rosterForPick } from "@/lib/facts/draft";
import { isEligible } from "@/lib/scoring";
import {
  byeTeams,
  getDraftPicks,
  getDraftTradedPicks,
  getMatchups,
  getPlayers,
  getSchedule,
  getTransactions,
  rosterPointsFor,
  rosterPotentialPoints,
} from "@/lib/sleeper";
import { weekdayOfDate } from "@/lib/time";
import type { LeagueContext, PlayersMap, WeeklyFacts } from "@/lib/types";
import { hasFixtures, rtLeagueId } from "./helpers/fixtures";

const close = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

describe.skipIf(!hasFixtures())("facts on the RT fixture league", () => {
  let ctx: LeagueContext;
  let players: PlayersMap;
  const weeks = new Map<number, WeeklyFacts>();

  beforeAll(async () => {
    ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    players = await getPlayers();
    for (let w = 1; w <= ctx.lastRegularSeasonWeek; w++) weeks.set(w, await weeklyFacts(w, ctx));
  }, 120_000);

  it("scores match Sleeper, optimal >= actual, bench = optimal - actual", async () => {
    for (const [w, wk] of weeks) {
      expect(wk.placeholder).toBe(false);
      const raw = await getMatchups(ctx.leagueId, w);
      for (const t of wk.teams) {
        const m = raw.find((x) => x.roster_id === t.team.rosterId)!;
        expect(close(t.points, m.custom_points ?? m.points)).toBe(true);
        const started = m.starters_points.reduce((s, p) => s + p, 0);
        expect(t.optimalPoints + 0.011).toBeGreaterThanOrEqual(t.points);
        expect(close(t.benchPointsLeft, Math.max(0, t.optimalPoints - started), 0.02)).toBe(true);
      }
    }
  });

  it("season sum of optimal lineups reproduces Sleeper's own max points (ppts)", () => {
    let exact = 0;
    for (const r of ctx.rosters) {
      let sum = 0;
      for (const wk of weeks.values()) sum += wk.teams.find((t) => t.team.rosterId === r.roster_id)?.optimalPoints ?? 0;
      const ppts = rosterPotentialPoints(r);
      // Sleeper also counts a player added after his game already happened; allow 1%.
      expect(Math.abs(sum - ppts) / ppts).toBeLessThan(0.01);
      if (Math.abs(sum - ppts) < 0.05) exact++;
    }
    expect(exact / ctx.rosters.length).toBeGreaterThanOrEqual(0.7);
  });

  it("records, points for and streaks through the regular season equal Sleeper's", async () => {
    const standings = await standingsAsOf(ctx.lastRegularSeasonWeek, ctx);
    for (const r of ctx.rosters) {
      const row = standings.find((s) => s.team.rosterId === r.roster_id)!;
      expect([row.wins, row.losses, row.ties]).toEqual([r.settings.wins, r.settings.losses, r.settings.ties]);
      expect(close(row.pointsFor, rosterPointsFor(r), 0.05)).toBe(true);
      if (r.metadata?.streak) expect(row.streak).toBe(r.metadata.streak);
      if (r.metadata?.record) {
        const seq = [...weeks.values()].map((wk) => wk.teams.find((t) => t.team.rosterId === r.roster_id)?.result ?? "");
        expect(seq.join("")).toBe(r.metadata.record);
      }
    }
    // Sorted by wins then points for.
    for (let i = 1; i < standings.length; i++) {
      const a = standings[i - 1];
      const b = standings[i];
      expect(a.wins + a.ties / 2 > b.wins + b.ties / 2 || (a.wins === b.wins && a.pointsFor >= b.pointsFor)).toBe(true);
    }
  });

  it("weekly standings carry last week's rank (null in week 1)", async () => {
    expect(weeks.get(1)!.standings.every((s) => s.previousRank === null)).toBe(true);
    for (let w = 2; w <= ctx.lastRegularSeasonWeek; w++) {
      const before = await standingsAsOf(w - 1, ctx);
      for (const s of weeks.get(w)!.standings) {
        expect(s.previousRank).toBe(before.find((b) => b.team.rosterId === s.team.rosterId)!.rank);
      }
    }
  });

  it("all-play, score ranks, robbed and fraud are consistent", () => {
    for (const wk of weeks.values()) {
      const n = wk.teams.length;
      const wins = wk.teams.reduce((s, t) => s + t.allPlayWins, 0);
      const losses = wk.teams.reduce((s, t) => s + t.allPlayLosses, 0);
      expect(wins).toBe(losses);
      for (const t of wk.teams) {
        expect(t.allPlayWins).toBe(wk.teams.filter((o) => o.points < t.points).length);
        expect(t.scoreRank).toBe(1 + wk.teams.filter((o) => o.points > t.points).length);
        expect(t.robbed).toBe(t.result === "L" && t.scoreRank <= 3);
        expect(t.fraud).toBe(t.result === "W" && t.scoreRank > n - 3);
      }
      expect(wk.highest?.points).toBe(Math.max(...wk.teams.map((t) => t.points)));
      expect(wk.lowest?.points).toBe(Math.min(...wk.teams.map((t) => t.points)));
      if (wk.loserOfTheWeek) {
        expect(wk.loserOfTheWeek.result).toBe("L");
        const losers = wk.teams.filter((t) => t.result === "L").map((t) => t.points);
        expect(wk.loserOfTheWeek.points).toBe(Math.min(...losers));
      }
    }
  });

  it("the flip swap is real and is the biggest single swap (brute force)", async () => {
    let flips = 0;
    for (const [w, wk] of weeks) {
      const raw = await getMatchups(ctx.leagueId, w);
      for (const m of wk.matchups) {
        const loser = m.winnerRosterId === m.home.team.rosterId ? m.away : m.winnerRosterId === m.away.team.rosterId ? m.home : null;
        if (!loser) {
          expect(m.flipSwap).toBeNull();
          continue;
        }
        const rm = raw.find((x) => x.roster_id === loser.team.rosterId)!;
        // Independent brute force over (bench player, starting slot) pairs.
        let best = 0;
        ctx.starterSlots.forEach((slot, i) => {
          const starterPts = rm.starters[i] === "0" ? 0 : rm.starters_points[i];
          for (const id of rm.players) {
            if (rm.starters.includes(id)) continue;
            if (!isEligible(slot, players[id]?.positions ?? [])) continue;
            best = Math.max(best, (rm.players_points[id] ?? 0) - starterPts);
          }
        });
        if (best > m.margin + 1e-9) {
          flips++;
          expect(m.flipSwap).not.toBeNull();
          const s = m.flipSwap!;
          expect(close(s.gain, best)).toBe(true);
          expect(s.gain).toBeGreaterThan(m.margin);
          expect(rm.starters).not.toContain(s.benchPlayer.playerId);
          expect(close(s.benchPlayer.points, rm.players_points[s.benchPlayer.playerId])).toBe(true);
          expect(close(s.gain, s.benchPlayer.points - s.starter.points)).toBe(true);
          expect(isEligible(s.slot, players[s.benchPlayer.playerId]?.positions ?? [])).toBe(true);
        } else {
          expect(m.flipSwap).toBeNull();
        }
      }
    }
    expect(flips).toBeGreaterThan(0);
  });

  it("zero-point starters really scored nothing, and byes are byes", async () => {
    const schedule = await getSchedule(ctx.season);
    let seen = 0;
    for (const [w, wk] of weeks) {
      const raw = await getMatchups(ctx.leagueId, w);
      const byes = new Set(byeTeams(schedule, w));
      for (const t of wk.teams) {
        const m = raw.find((x) => x.roster_id === t.team.rosterId)!;
        for (const z of t.zeroStarters) {
          seen++;
          const i = m.starters.indexOf(z.playerId);
          if (z.reason === "empty_slot") expect(z.playerId).toBe("0");
          else expect(m.starters_points[i]).toBeLessThanOrEqual(0);
          if (z.reason === "bye") expect(byes.has(players[z.playerId]?.team ?? "")).toBe(true);
        }
        // Every starter at exactly 0 is listed.
        const zeros = m.starters.filter((id, i) => id === "0" || m.starters_points[i] === 0).length;
        expect(t.zeroStarters.length).toBe(zeros);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("every trade and waiver claim appears once; values add up; losing bids match the raw failed claims", async () => {
    const tx = await transactionFacts(0, ctx);
    expect(tx.placeholder).toBe(false);
    const raw = (await Promise.all(Array.from({ length: ctx.lastWeek + 1 }, (_, i) => getTransactions(ctx.leagueId, i + 1)))).flat();
    const rawTrades = raw.filter((t) => t.type === "trade" && t.status === "complete");
    expect(tx.trades.map((t) => t.transactionId).sort()).toEqual(rawTrades.map((t) => t.transaction_id).sort());
    for (const t of tx.trades) {
      for (const s of t.sides) {
        const sum = [...s.playersIn, ...s.picksIn].reduce((a, x) => a + (x.value ?? 0), 0);
        expect(Math.abs(s.valueIn - sum)).toBeLessThanOrEqual(1);
        expect(s.net).toBe(s.valueIn - s.valueOut);
      }
      expect(t.sides.reduce((a, s) => a + s.net, 0)).toBe(0);
    }
    const rawClaims = raw.filter((t) => (t.type === "waiver" || t.type === "free_agent") && t.status === "complete" && (t.adds || t.drops));
    expect(tx.waivers.length).toBe(rawClaims.length);
    let contested = 0;
    for (const w of tx.waivers.filter((x) => x.type === "waiver")) {
      const addId = w.added[0]?.playerId;
      const src = rawClaims.find((r) => r.transaction_id === w.transactionId)!;
      const failed = raw.filter(
        (f) =>
          f.type === "waiver" &&
          f.status === "failed" &&
          f.status_updated === src.status_updated &&
          f.roster_ids[0] !== w.team.rosterId &&
          addId !== undefined &&
          Object.keys(f.adds ?? {}).includes(addId),
      );
      expect(w.losingBids.length).toBe(new Set(failed.map((f) => f.roster_ids[0])).size);
      expect(w.bid).toBe(src.settings?.waiver_bid ?? 0);
      if (failed.length) contested++;
      const outbid = failed.filter((f) => /claimed by another/i.test(f.metadata?.notes ?? ""));
      if (outbid.length) expect(w.overpayBy).toBe(Math.max(0, (w.bid ?? 0) - Math.max(...outbid.map((f) => f.settings?.waiver_bid ?? 0))));
      else expect(w.overpayBy).toBeNull();
      expect(w.isZeroBid).toBe(w.bid === 0);
    }
    expect(contested).toBeGreaterThan(0);
    // A window only returns what happened inside it.
    const mid = tx.waivers[Math.floor(tx.waivers.length / 2)].createdAt;
    const later = await transactionFacts(mid, ctx);
    expect(later.waivers.every((w) => w.createdAt > mid)).toBe(true);
  });

  it("draft: every pick is who Sleeper says, reach = rank - pick, grades cover every team", async () => {
    const d = await draftFacts(ctx);
    const draft = ctx.draft!;
    const raw = await getDraftPicks(draft.draft_id);
    const traded = await getDraftTradedPicks(draft.draft_id);
    expect(d.placeholder).toBe(false);
    expect(d.picks.length).toBe(raw.length);
    for (const p of d.picks) {
      const r = raw.find((x) => x.pick_no === p.pickNo)!;
      expect(p.team.rosterId).toBe(r.roster_id);
      expect(rosterForPick(draft, p.pickNo, traded)).toBe(r.roster_id);
      if (p.fcRank !== null) expect(p.reach).toBe(p.fcRank - p.pickNo);
      else expect(p.verdict).toBe("unranked");
    }
    // Rookie draft: ranks are within the class, so the top pick's rank is small.
    expect(Math.min(...d.picks.filter((p) => p.fcRank !== null).map((p) => p.fcRank!))).toBe(1);
    expect(d.grades?.length).toBe(ctx.rosters.length);
    const totals = d.grades!.map((g) => g.totalValue);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(d.onTheClock).toBeNull();
  });

  it("thursday: only Thursday games, banked = started points", async () => {
    const week = 5;
    const tnf = await tnfFacts(week, ctx);
    expect(tnf.games.length).toBeGreaterThan(0);
    for (const g of tnf.games) expect([3, 4]).toContain(weekdayOfDate(g.date));
    const teams = new Set(tnf.games.flatMap((g) => [g.home, g.away]));
    for (const p of tnf.players) expect(teams.has(p.player.nflTeam ?? "")).toBe(true);
    for (const t of tnf.teams) {
      const banked = tnf.players.filter((p) => p.team?.rosterId === t.team.rosterId && p.started).reduce((s, p) => s + p.points, 0);
      expect(close(t.banked, banked)).toBe(true);
      expect(close(t.delta, t.banked - t.projected)).toBe(true);
    }
    expect(tnf.players.filter((p) => p.team === null).every((p) => p.points >= 15)).toBe(true);
    // Free agents are only listed at positions the league can start (RT has a K slot, no DEF).
    const w9 = await tnfFacts(9, ctx);
    const fa = w9.players.filter((p) => p.team === null);
    expect(fa.every((p) => p.player.position !== "DEF")).toBe(true);
  });

  it("wall of shame: grouped, worst first, unique ids, top bench entry is the season max", async () => {
    const board = await shameEntries(ctx);
    expect(board.placeholder).toBe(false);
    const ids = board.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const bench = board.entries.filter((e) => e.kind === "bench_points");
    let max = 0;
    for (let w = 1; w <= ctx.lastWeek; w++) {
      const wk = w <= ctx.lastRegularSeasonWeek ? weeks.get(w)! : await weeklyFacts(w, ctx);
      for (const t of wk.teams) max = Math.max(max, t.benchPointsLeft);
    }
    expect(bench[0].amount).toBe(max);
    for (const kind of new Set(board.entries.map((e) => e.kind))) {
      const amounts = board.entries.filter((e) => e.kind === kind).map((e) => e.amount);
      expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    }
    for (const e of board.entries) expect(e.headline).not.toMatch(/[\u2013\u2014]/);
  });
});
