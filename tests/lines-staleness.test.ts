/**
 * When a stored stat line counts as stale, and how soon it is rewritten: digits inside string
 * facts ("5-2") count as the row's numbers, odds and power lines are rewritten within 2 hours,
 * team pages within an hour (10 minutes once the line went false), and the standings table has
 * no "last week" before the league's first week. The model is a scripted fake: no key, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/facts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/facts")>();
  return {
    ...mod,
    standingsAsOf: vi.fn(),
    draftFacts: vi.fn(async () => ({ placeholder: true, picks: [] })),
    shameEntries: vi.fn(async () => ({ entries: [], placeholder: false })),
    tradeHindsight: vi.fn(async () => ({ trades: [], placeholder: false })),
    transactionFacts: vi.fn(async () => ({ trades: [], waivers: [], placeholder: false })),
    weeklyFacts: vi.fn(async () => ({ matchups: [], placeholder: true })),
  };
});
vi.mock("@/lib/models", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/models")>();
  return {
    ...mod,
    draftOddsBasis: vi.fn(async () => null),
    draftOdds: vi.fn(async () => ({ available: false, placeholder: true })),
    runSeasonSim: vi.fn(async () => ({ placeholder: true, asOfWeek: 0, teams: [] })),
    getPowerRankings: vi.fn(async () => ({ placeholder: true, asOfWeek: 0, rows: [] })),
    getWinProbabilities: vi.fn(async () => ({ placeholder: true, matchups: [] })),
  };
});
vi.mock("@/lib/sleeper", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/sleeper")>();
  return { ...mod, getPlayers: vi.fn(async () => ({})), getDraftPicks: vi.fn(async () => []) };
});
vi.mock("@/lib/fantasycalc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/fantasycalc")>();
  return { ...mod, getFantasyCalc: vi.fn(async () => Promise.reject(new Error("offline"))) };
});

import { standingsAsOf } from "@/lib/facts";
import { refreshLines } from "@/lib/jobs/lines";
import { currentLines, draftOddsRows, oddsRows, powerRows, refreshSurfaceLines, rowHash, setRoastClient, surfaceKeys } from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import * as store from "@/lib/store";
import type { DraftOdds, LeagueContext, PowerRankings, PowerRow, RoastSurface, SimResult, SimTeamOdds, StandingRow, StoredSurfaceLines, SurfaceRow, TeamRef } from "@/lib/types";
import { fakeCtx } from "./ops-helpers";

type Params = Parameters<RoastClient["beta"]["messages"]["create"]>[0];

interface Request {
  surface: string;
  slots: Map<string, string[]>;
  facts: Record<string, Record<string, unknown>>;
}

/** A fake model that gives every slot a line naming its manager, with no numbers. */
function scripted() {
  const calls: Request[] = [];
  const client: RoastClient = {
    beta: {
      messages: {
        async create(p: Params) {
          const content = String(p.messages[0].content);
          const lines = content.split("\n");
          const slots = new Map<string, string[]>();
          for (const l of lines) {
            const m = /^@@(r\d+): (.*)$/.exec(l);
            if (m) slots.set(m[1], m[2].split(" vs "));
          }
          const facts = JSON.parse(lines[lines.indexOf("FACTS:") + 1]) as Request["facts"];
          calls.push({ surface: lines[0], slots, facts });
          const text = JSON.stringify(Object.fromEntries([...slots].map(([slot, names]) => [slot, `${names[0]} is exactly where his decisions put him.`])));
          return {
            id: `msg_${calls.length}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            stop_reason: "end_turn",
            stop_details: null,
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
            content: [{ type: "text", text, citations: null }],
          } as never;
        },
      },
    },
  };
  return { client, calls };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_000_000_000;

const row = (id: string, manager: string, facts: Record<string, unknown>): SurfaceRow => ({ id, managers: [manager], facts: { manager, ...facts } });

/** A line already stored for `rows` at T0, written from facts that have since changed. */
async function seed(ctx: LeagueContext, surface: RoastSurface, key: string, lines: Record<string, string>) {
  const record: StoredSurfaceLines = {
    surface,
    key,
    factsHash: "old",
    rowHashes: Object.fromEntries(Object.keys(lines).map((id) => [id, "old"])),
    rowAt: Object.fromEntries(Object.keys(lines).map((id) => [id, T0])),
    failures: {},
    generatedAt: T0,
    model: "claude-sonnet-5",
    usage: null,
    lines,
  };
  await store.set(store.keys.surfaceLines(ctx.leagueId, surface, key), record);
}

beforeEach(() => {
  store.resetStoreForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  setRoastClient(undefined);
});

describe("currentLines reads the digits inside string facts", () => {
  const rows = [row("1", "Carlos", { rank: 1, record: "5-2", pointsFor: 812.4 })];

  it("keeps a line that quotes the row's record", () => {
    expect(currentLines({ "1": "Carlos is 5-2 and already measuring the trophy." }, rows)["1"]).toBe("Carlos is 5-2 and already measuring the trophy.");
  });

  it("still hides a line quoting a record the row no longer has", () => {
    expect(currentLines({ "1": "Carlos is 6-1 and already measuring the trophy." }, rows)["1"]).toBeUndefined();
  });
});

describe("how soon a stored line is rewritten", () => {
  it("a standings line quoting the record is still true: it waits the day instead of being rewritten within the half hour", async () => {
    const { client, calls } = scripted();
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 5);
    await seed(ctx, "standings", key, { "1": "Manager 1 is 4-1 and first." });
    // Points against moved, the record did not: the line still reads true.
    const rows = [row("1", "Manager 1", { rank: 1, record: "4-1", pointsAgainst: 512.6 })];
    const r = await refreshSurfaceLines("standings", key, rows, ctx, { now: T0 + 31 * MIN });
    expect(r).toMatchObject({ status: "throttled", asked: 0 });
    expect(r.lines["1"]).toBe("Manager 1 is 4-1 and first.");
    expect(calls).toHaveLength(0);
  });

  const cases: Array<{ surface: RoastSurface; key: string; waits: number; rewrites: number }> = [
    { surface: "odds", key: surfaceKeys.odds("2026", 4), waits: 2 * HOUR - MIN, rewrites: 2 * HOUR + MIN },
    { surface: "power", key: surfaceKeys.power("2026", 4), waits: 2 * HOUR - MIN, rewrites: 2 * HOUR + MIN },
    { surface: "team", key: surfaceKeys.team("2026"), waits: HOUR - MIN, rewrites: HOUR + MIN },
  ];
  for (const c of cases) {
    it(`a ${c.surface} line that is still true is rewritten after ${c.rewrites / MIN - 1} minutes, not 6 hours`, async () => {
      const { client, calls } = scripted();
      setRoastClient(client);
      const ctx = fakeCtx();
      await seed(ctx, c.surface, c.key, { "1": "Manager 1 is exactly where his decisions put him." });
      const rows = [row("1", "Manager 1", { rank: 2, moved: 1 })];
      expect(await refreshSurfaceLines(c.surface, c.key, rows, ctx, { now: T0 + c.waits })).toMatchObject({ status: "throttled", asked: 0 });
      expect(await refreshSurfaceLines(c.surface, c.key, rows, ctx, { now: T0 + c.rewrites })).toMatchObject({ status: "written", asked: 1, written: 1 });
      expect(calls).toHaveLength(1);
    });
  }

  it("a team line that went false is rewritten after 10 minutes, not 30", async () => {
    const { client, calls } = scripted();
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.team("2026");
    await seed(ctx, "team", key, { "1": "Manager 1 has a roster worth 5400 and nothing to show for it." });
    // The roster's value moved: the page hides the line, so it is rewritten soon.
    const rows = [row("1", "Manager 1", { totalValue: 7100, valueRank: 2 })];
    expect(await refreshSurfaceLines("team", key, rows, ctx, { now: T0 + 9 * MIN })).toMatchObject({ status: "throttled", asked: 0 });
    expect(await refreshSurfaceLines("team", key, rows, ctx, { now: T0 + 11 * MIN })).toMatchObject({ status: "written", asked: 1, written: 1 });
    expect(calls).toHaveLength(1);
  });
});

describe("the standings job before the league's second week", () => {
  const team = (id: number): TeamRef => ({ rosterId: id, teamName: `Team ${id}`, managerName: `Manager ${id}`, managerKey: `m${id}` });
  const table = (played: boolean): StandingRow[] =>
    [1, 2, 3, 4].map((id, i) => ({
      rank: i + 1,
      team: team(id),
      wins: played && id % 2 ? 1 : 0,
      losses: played && !(id % 2) ? 1 : 0,
      ties: 0,
      pointsFor: played ? 100 + id : 0,
      pointsAgainst: played ? 90 : 0,
      streak: played ? (id % 2 ? "1W" : "1L") : "",
    }));
  /** Start week 3, `scored` the last final week. Standings through a pre-start week are all 0-0. */
  const leagueCtx = (scored: number) => {
    const base = fakeCtx();
    return fakeCtx({ league: { ...base.league, settings: { ...base.league.settings, start_week: 3, last_scored_leg: scored } } });
  };
  const standingsFacts = (calls: Request[]) => Object.values(calls.find((c) => c.surface === "LINES: standings")?.facts ?? {});

  beforeEach(() => {
    vi.mocked(standingsAsOf).mockImplementation(async (week) => table(week >= 3));
  });

  it("week 3 (the first league week) gets no last-week rank from the empty pre-start table", async () => {
    const { client, calls } = scripted();
    setRoastClient(client);
    const ctx = leagueCtx(3);
    await refreshLines(ctx, { scope: "all", now: T0 });
    expect(vi.mocked(standingsAsOf).mock.calls.map((c) => c[0])).not.toContain(2);
    const facts = standingsFacts(calls);
    expect(facts).toHaveLength(4);
    for (const f of facts) expect(f).not.toHaveProperty("lastWeekRank");
  });

  it("week 4 compares with week 3", async () => {
    const { client, calls } = scripted();
    setRoastClient(client);
    const ctx = leagueCtx(4);
    await refreshLines(ctx, { scope: "all", now: T0 });
    expect(vi.mocked(standingsAsOf).mock.calls.map((c) => c[0])).toContain(3);
    const facts = standingsFacts(calls);
    expect(facts).toHaveLength(4);
    expect(facts.map((f) => f.lastWeekRank)).toEqual([1, 2, 3, 4]);
  });
});

describe("odds and power rows hash on the numbers a line quotes", () => {
  const team1: TeamRef = { rosterId: 1, teamName: "Team 1", managerName: "Manager 1", managerKey: "m1" };
  const sim = (over: Partial<SimTeamOdds> = {}): SimResult => ({
    season: "2026",
    asOfWeek: 4,
    runs: 10_000,
    seed: 1,
    generatedAt: 0,
    placeholder: false,
    teams: [{ team: team1, wins: 3, losses: 1, ties: 0, pointsFor: 480, meanPoints: 120, sdPoints: 20, expectedWins: 8.04, playoffPct: 55.2, byePct: 12.4, titlePct: 4.61, lastPlacePct: 3.2, firstPickPct: 1, ...over }],
  });
  const power = (over: Partial<PowerRow> = {}): PowerRankings => ({
    season: "2026",
    asOfWeek: 4,
    formula: "Half all-play, half points per game.",
    placeholder: false,
    rows: [{ rank: 2, previousRank: 3, team: team1, score: 0.6, allPlayWinPct: 0.6, allPlayWins: 24, allPlayLosses: 16, pointsPerGame: 121.35, projectedStrength: 145.12, wins: 3, losses: 1, luck: 0.4, ...over }],
  });
  const oddsHash = (over: Partial<SimTeamOdds> = {}) => rowHash(oddsRows(sim(over))[0]);
  const powerHash = (over: Partial<PowerRow> = {}) => rowHash(powerRows(power(over))[0]);

  it("odds: a sim rerun on fresh projections keeps the hash; a quoted number moving changes it", () => {
    expect(oddsHash({ expectedWins: 8.31, playoffPct: 55.4, byePct: 11.6, titlePct: 4.64 })).toBe(oddsHash());
    expect(oddsHash({ playoffPct: 58.1 })).not.toBe(oddsHash());
    // As coarse as the line check (whole points): 4.61 to 4.82 is drift, 4.61 to 6.2 is news.
    expect(oddsHash({ titlePct: 4.82 })).toBe(oddsHash());
    expect(oddsHash({ titlePct: 6.2 })).not.toBe(oddsHash());
    expect(oddsHash({ expectedWins: 8.61 })).not.toBe(oddsHash());
  });

  it("power: the projection drifting within the point keeps the hash; the rank or the projection's point moving changes it", () => {
    expect(powerHash({ projectedStrength: 145.38 })).toBe(powerHash());
    expect(powerHash({ projectedStrength: 146.2 })).not.toBe(powerHash());
    expect(powerHash({ rank: 1 })).not.toBe(powerHash());
    expect(powerHash({ pointsPerGame: 124.1 })).not.toBe(powerHash());
  });

  it("odds facts keep the table's one decimal: 99.7 stays 99.7, never a certain 100", () => {
    const row = oddsRows(sim({ playoffPct: 99.7, byePct: 42.4, titlePct: 23.46, lastPlacePct: 0.3 }))[0];
    expect(row.facts).toMatchObject({ playoffPct: 99.7, byePct: 42.4, titlePct: 23.5, lastPct: 0.3, expectedWins: 8 });
  });

  it("odds: the hash ignores a +0.3 point drift but changes on a whole-point move, and a 0 / 0.01 flicker is not news", () => {
    expect(oddsHash({ titlePct: 3.4 })).toBe(oddsHash({ titlePct: 3.1 }));
    expect(oddsHash({ playoffPct: 55.4 })).toBe(oddsHash({ playoffPct: 55.1 }));
    expect(oddsHash({ titlePct: 4.2 })).not.toBe(oddsHash({ titlePct: 3.1 }));
    expect(oddsHash({ playoffPct: 56.2 })).not.toBe(oddsHash({ playoffPct: 55.1 }));
    // 1 title in 10,000 sims one run and none the next: the same line still reads true, no rewrite.
    expect(oddsHash({ lastPlacePct: 0.01 })).toBe(oddsHash({ lastPlacePct: 0 }));
    expect(oddsHash({ playoffPct: 99.96 })).toBe(oddsHash({ playoffPct: 100 }));
  });

  it("odds facts never call a sure thing the sims did not produce: above 0 is at least 0.1, short of 100 at most 99.9", () => {
    const f = (over: Partial<SimTeamOdds>) => oddsRows(sim(over))[0].facts;
    expect(f({ titlePct: 0.03, playoffPct: 99.96, lastPlacePct: 0 })).toMatchObject({ titlePct: 0.1, playoffPct: 99.9, lastPct: 0 });
    expect(f({ playoffPct: 100 })).toMatchObject({ playoffPct: 100 });
  });

  it("draft odds never round 99.5 to 99.9 into a certain 100", () => {
    const odds = (playoffPct: number): DraftOdds => ({
      season: "2026",
      available: true,
      basis: "drafting",
      draftId: "draft-1",
      picksMade: 40,
      totalPicks: 136,
      runs: 10_000,
      seed: 1,
      generatedAt: 0,
      placeholder: false,
      teams: [{ team: team1, playersDrafted: 10, projectedPoints: 131.2, projectedRank: 1, playoffPct, titlePct: 41.6, byePct: 80.2, lastPlacePct: 0.2, expectedWins: 11.2 }],
    });
    expect(draftOddsRows(odds(99.7))[0].facts).toMatchObject({ playoffPct: 99.7, titlePct: 42, lastPct: 0.2 });
    expect(draftOddsRows(odds(99.5))[0].facts).toMatchObject({ playoffPct: 99.5 });
    expect(draftOddsRows(odds(100))[0].facts).toMatchObject({ playoffPct: 100 });
    expect(draftOddsRows(odds(99.4))[0].facts).toMatchObject({ playoffPct: 99 });
  });

  it("an odds line is not rewritten when only the projections drifted", async () => {
    const { client, calls } = scripted();
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.odds("2026", 4);
    expect(await refreshSurfaceLines("odds", key, oddsRows(sim()), ctx, { now: T0 })).toMatchObject({ status: "written", written: 1 });
    // Three hours on (past the two-hour rewrite window), the sim reran on fresh projections.
    const drift = oddsRows(sim({ expectedWins: 8.31, playoffPct: 55.4, byePct: 11.6 }));
    expect(await refreshSurfaceLines("odds", key, drift, ctx, { now: T0 + 3 * HOUR })).toMatchObject({ status: "fresh", asked: 0 });
    expect(calls).toHaveLength(1);
  });
});
