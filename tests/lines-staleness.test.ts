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
import { currentLines, refreshSurfaceLines, setRoastClient, surfaceKeys } from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import * as store from "@/lib/store";
import type { LeagueContext, RoastSurface, StandingRow, StoredSurfaceLines, SurfaceRow, TeamRef } from "@/lib/types";
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
