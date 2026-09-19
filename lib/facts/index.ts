/**
 * Facts engine public API. OWNER: roast agent (lib/facts/**, lib/roast/**, config/roast-notes.ts,
 * tests/facts*, tests/roast*).
 *
 * FOUNDATION STUB: correctly shaped placeholder data from the real league context (real team
 * names, fake numbers), `placeholder: true`. draftFacts() already returns the real draft
 * status and any real picks (without FantasyCalc grading). Code computes every fact; the LLM
 * never does.
 */
import { getLeagueContext, standingsFromRosters, teamRef } from "@/lib/league";
import { getDraftPicks, playerInfo } from "@/lib/sleeper";
import type {
  DraftFacts,
  DraftPickFact,
  LeagueContext,
  MatchupFact,
  PlayerAsset,
  ShameBoard,
  TeamWeekFact,
  TnfFacts,
  TransactionFacts,
  WeeklyFacts,
} from "@/lib/types";

function noise(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function sampleAsset(i: number, position = "WR"): PlayerAsset {
  return { playerId: `sample-${i}`, name: `Sample Player ${i}`, position, nflTeam: null, age: 24, value: 2000 + i * 100, overallRank: 50 + i };
}

/** Weekly recap facts for a completed (or in-progress) week. */
export async function weeklyFacts(week: number, ctx?: LeagueContext): Promise<WeeklyFacts> {
  const c = ctx ?? (await getLeagueContext());
  const teams: TeamWeekFact[] = c.rosters.map((r) => {
    const points = r2(95 + 60 * noise(c.leagueId, week, r.roster_id));
    const optimal = r2(points + 25 * noise("opt", week, r.roster_id));
    return {
      team: teamRef(c, r.roster_id),
      points,
      projected: r2(115 + 10 * noise("proj", r.roster_id)),
      optimalPoints: optimal,
      benchPointsLeft: r2(optimal - points),
      opponentRosterId: null,
      result: null,
      allPlayWins: 0,
      allPlayLosses: 0,
      scoreRank: 0,
      robbed: false,
      fraud: false,
      zeroStarters: [],
      streak: "",
    };
  });
  const ranked = [...teams].sort((a, b) => b.points - a.points);
  ranked.forEach((t, i) => {
    t.scoreRank = i + 1;
    t.allPlayWins = teams.length - 1 - i;
    t.allPlayLosses = i;
  });
  const matchups: MatchupFact[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const home = teams[i];
    const away = teams[i + 1];
    home.opponentRosterId = away.team.rosterId;
    away.opponentRosterId = home.team.rosterId;
    home.result = home.points >= away.points ? "W" : "L";
    away.result = home.result === "W" ? "L" : "W";
    home.robbed = home.result === "L" && home.scoreRank <= 3;
    away.robbed = away.result === "L" && away.scoreRank <= 3;
    home.fraud = home.result === "W" && home.scoreRank > teams.length - 3;
    away.fraud = away.result === "W" && away.scoreRank > teams.length - 3;
    matchups.push({
      matchupId: i / 2 + 1,
      home,
      away,
      margin: r2(Math.abs(home.points - away.points)),
      winnerRosterId: home.result === "W" ? home.team.rosterId : away.team.rosterId,
      flipSwap: null,
    });
  }
  return {
    week,
    season: c.season,
    matchups,
    teams,
    highest: ranked[0] ?? null,
    lowest: ranked[ranked.length - 1] ?? null,
    loserOfTheWeek: ranked[ranked.length - 1] ?? null,
    standings: standingsFromRosters(c),
    placeholder: true,
  };
}

/** Trades and waiver/free-agent moves processed after `sinceMs`. */
export async function transactionFacts(sinceMs: number, ctx?: LeagueContext): Promise<TransactionFacts> {
  const c = ctx ?? (await getLeagueContext());
  const [a, b] = c.rosters.map((r) => teamRef(c, r.roster_id));
  if (!a || !b) return { sinceMs, untilMs: Date.now(), trades: [], waivers: [], placeholder: true };
  const now = Date.now();
  return {
    sinceMs,
    untilMs: now,
    trades: [
      {
        kind: "trade",
        transactionId: "sample-trade-1",
        week: Math.max(1, c.week),
        createdAt: now,
        winnerRosterId: a.rosterId,
        valueGap: 1800,
        sides: [
          { team: a, playersIn: [sampleAsset(1, "RB")], playersOut: [sampleAsset(2, "WR")], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: 4100, valueOut: 2300, net: 1800, grade: "A" },
          { team: b, playersIn: [sampleAsset(2, "WR")], playersOut: [sampleAsset(1, "RB")], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: 2300, valueOut: 4100, net: -1800, grade: "D" },
        ],
      },
    ],
    waivers: [
      {
        kind: "waiver",
        transactionId: "sample-waiver-1",
        type: "waiver",
        week: Math.max(1, c.week),
        createdAt: now,
        team: b,
        added: [sampleAsset(3, "TE")],
        dropped: [sampleAsset(4, "RB")],
        bid: 0,
        isZeroBid: true,
        losingBids: [{ team: a, bid: 0 }],
        overpayBy: 0,
        notableDrop: false,
        batchId: "sample-batch-1",
      },
    ],
    placeholder: true,
  };
}

/** Startup draft facts: every pick with FantasyCalc reach/steal, runs, and grades once complete. */
export async function draftFacts(ctx?: LeagueContext): Promise<DraftFacts> {
  const c = ctx ?? (await getLeagueContext());
  const draft = c.draft;
  const rounds = draft?.settings.rounds ?? 0;
  const teams = draft?.settings.teams ?? c.rosters.length;
  const picks: DraftPickFact[] = [];
  if (draft) {
    const raw = await getDraftPicks(draft.draft_id).catch(() => []);
    for (const p of raw) {
      const name = [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(" ") || `Player ${p.player_id}`;
      const info = playerInfo({}, p.player_id, { name, position: p.metadata?.position ?? null, team: p.metadata?.team ?? null });
      picks.push({
        kind: "draft_pick",
        draftId: draft.draft_id,
        pickNo: p.pick_no,
        round: p.round,
        pickInRound: ((p.pick_no - 1) % Math.max(1, teams)) + 1,
        team: teamRef(c, p.roster_id),
        player: { playerId: info.id, name: info.name, position: info.pos, nflTeam: info.team, age: null, value: null, overallRank: null },
        fcRank: null,
        fcPositionRank: null,
        reach: null,
        verdict: "unranked",
        secondsOnClock: null,
        pickedAt: null,
        positionRun: 1,
      });
    }
  }
  return {
    draftId: draft?.draft_id ?? "",
    status: draft?.status ?? "pre_draft",
    startTime: draft?.start_time ?? null,
    rounds,
    teams,
    picks,
    onTheClock: null,
    positionRuns: [],
    grades: null,
    placeholder: true,
  };
}

/** Thursday night game: who got cooked or carried. */
export async function tnfFacts(week: number, ctx?: LeagueContext): Promise<TnfFacts> {
  const c = ctx ?? (await getLeagueContext());
  return {
    week,
    games: [],
    players: [],
    teams: c.rosters.map((r) => {
      const banked = r2(20 * noise("tnf", week, r.roster_id));
      const projected = r2(15 * noise("tnfp", week, r.roster_id));
      return { team: teamRef(c, r.roster_id), banked, projected, delta: r2(banked - projected) };
    }),
    placeholder: true,
  };
}

/** Wall of Shame, all time. */
export async function shameEntries(ctx?: LeagueContext): Promise<ShameBoard> {
  const c = ctx ?? (await getLeagueContext());
  const [a, b] = c.rosters.map((r) => teamRef(c, r.roster_id));
  if (!a || !b) return { entries: [], placeholder: true };
  return {
    entries: [
      { id: "sample:bench", kind: "bench_points", team: a, season: c.season, week: 1, amount: 41.2, unit: "pts", headline: "Left 41.2 points on the bench", detail: null, refId: null, occurredAt: null },
      { id: "sample:zero", kind: "zero_starter", team: b, season: c.season, week: 1, amount: 0, unit: "pts", headline: "Started a player on bye", detail: null, refId: null, occurredAt: null },
      { id: "sample:trade", kind: "bad_trade", team: b, season: c.season, week: 2, amount: 1800, unit: "value", headline: "Lost 1,800 value in one trade", detail: null, refId: "sample-trade-1", occurredAt: null },
    ],
    placeholder: true,
  };
}
