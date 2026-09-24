/**
 * A writer call refused by the day's dollar budget or the daily call cap is not the item's
 * fault: an instant post comes back as a placeholder (never saved, never counted as a failed
 * attempt, never written over a post), and stat-line rows stay unavailable (not failed), on the
 * retry too. The roast engine, the tick and the stat lines are real; the model is a fake that
 * reports a fixed token usage, so the spend is real too. No key, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/facts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/facts")>();
  return { ...mod, transactionFacts: vi.fn(), draftFacts: vi.fn(async () => Promise.reject(new Error("no draft in these tests"))) };
});
// The tick asks isRoastConfigured (an API key); here the fake client stands in for the key.
vi.mock("@/lib/roast", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/roast")>();
  return { ...mod, isRoastConfigured: vi.fn(() => true) };
});
vi.mock("@/lib/fantasycalc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/fantasycalc")>();
  return { ...mod, getFantasyCalc: vi.fn(async () => Promise.reject(new Error("offline"))) };
});

import { getRoast, saveRoast } from "@/lib/archive";
import { transactionFacts } from "@/lib/facts";
import { ROAST_VOICE, tickOutcomes } from "@/lib/jobs/tick";
import { getStoredSurfaceLines, MAX_WRITER_CALLS_PER_DAY, refreshSurfaceLines, roastItem, setRoastClient, surfaceKeys, CALL_SHARE } from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type { Roast, SurfaceRow, TeamRef, TradeFact } from "@/lib/types";
import { fakeCtx } from "./ops-helpers";

type Params = Parameters<RoastClient["beta"]["messages"]["create"]>[0];

/**
 * A fake writer whose every reply costs $0.004 at Sonnet prices (2,000 input tokens), which is
 * over both the item share (85%) and the lines share (40%) of a $0.0045 day: the first call of
 * the day goes through, anything after it is refused by the budget.
 */
function spendingClient(reply: string) {
  const calls: Params[] = [];
  const client: RoastClient = {
    beta: {
      messages: {
        async create(p: Params) {
          calls.push(p);
          return {
            id: `msg_${calls.length}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            stop_reason: "end_turn",
            stop_details: null,
            usage: { input_tokens: 2000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            content: [{ type: "text", text: reply, citations: null }],
          } as never;
        },
      },
    },
  };
  return { client, calls };
}
const TIGHT_BUDGET_USD = "0.0045";

const team = (id: number): TeamRef => ({ rosterId: id, teamName: `Team ${id}`, managerName: `Manager ${id}`, managerKey: `m${id}` });

function trade(id: string, createdAt: number): TradeFact {
  const player = (pid: string, name: string, value: number) => ({ playerId: pid, name, position: "WR", nflTeam: "DAL", age: 25, value, overallRank: 40 });
  return {
    kind: "trade",
    transactionId: id,
    week: 4,
    createdAt,
    winnerRosterId: 1,
    valueGap: 1830,
    sides: [
      { team: team(1), playersIn: [player("a", "Alpha Receiver", 6120)], playersOut: [player("b", "Beta Receiver", 4290)], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: 6120, valueOut: 4290, net: 1830, grade: "A" },
      { team: team(2), playersIn: [player("b", "Beta Receiver", 4290)], playersOut: [player("a", "Alpha Receiver", 6120)], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: 4290, valueOut: 6120, net: -1830, grade: "D" },
    ],
  };
}

/** Fails the post-check (9999 is not in FACTS), so the writer asks once more. */
const INVENTED = "@@roast\nManager 2 lost 9999 in value and thanked him for it.";

beforeEach(() => {
  store.resetStoreForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  setRoastClient(undefined);
  vi.unstubAllEnvs();
});

describe("roastItem when the writer is refused", () => {
  const ctx = fakeCtx();

  it("a retry refused by the dollar budget comes back as a placeholder, not a facts-only post", async () => {
    vi.stubEnv("WRITER_DAILY_BUDGET_USD", TIGHT_BUDGET_USD);
    const { client, calls } = spendingClient(INVENTED);
    setRoastClient(client);
    const r = await roastItem("trade", trade("t1", 0), ctx);
    expect(calls).toHaveLength(1);
    expect(r.source).toBe("placeholder");
  });

  it("a retry refused by the daily call cap comes back as a placeholder too", async () => {
    // Items stop at their share of the cap (CALL_SHARE.item), leaving the rest for the newsletter.
    await store.set(store.keys.rate(`writer-calls:${etDate(Date.now())}`), Math.floor(MAX_WRITER_CALLS_PER_DAY * CALL_SHARE.item) - 1);
    const { client, calls } = spendingClient(INVENTED);
    setRoastClient(client);
    const r = await roastItem("trade", trade("t1", 0), ctx);
    expect(calls).toHaveLength(1);
    expect(r.source).toBe("placeholder");
  });
});

describe("the tick when the budget runs out mid-item", () => {
  const ctx = fakeCtx();
  const indexKey = store.keys.snapshot(ctx.leagueId, "roast-index");

  async function tickWith(entry: Record<string, unknown>, stored: Roast) {
    const now = Date.now();
    vi.mocked(transactionFacts).mockResolvedValue({ sinceMs: 0, untilMs: now, trades: [trade("t1", now - 60_000)], waivers: [], placeholder: false });
    await saveRoast(stored);
    await store.set(indexKey, { "trade:t1": entry });
    vi.stubEnv("WRITER_DAILY_BUDGET_USD", TIGHT_BUDGET_USD);
    const { client, calls } = spendingClient(INVENTED);
    setRoastClient(client);
    const outcomes = await tickOutcomes(ctx, now);
    // Both the tick's checks passed; the item's first call spent the rest and its retry was refused.
    expect(calls).toHaveLength(1);
    expect(outcomes.find((o) => o.job === "roast_trades")).toEqual({ job: "roast_trades", status: "skipped", detail: "1 came back as placeholders (not saved)." });
  }

  it("saves nothing and does not count a failed attempt", async () => {
    const at = Date.now() - 2 * 3600_000;
    const entry = { s: "facts_only", t: at, w: true, n: 1, v: ROAST_VOICE };
    const stored: Roast = { id: "trade:t1", kind: "trade", leagueId: ctx.leagueId, rosterIds: [1, 2], text: "Facts only.", facts: trade("t1", 0), source: "facts_only", model: null, createdAt: at, usage: null };
    await tickWith(entry, stored);
    expect(await getRoast(ctx.leagueId, "trade:t1")).toEqual(stored);
    expect((await store.get<Record<string, unknown>>(indexKey))?.["trade:t1"]).toEqual(entry);
  });

  it("never replaces a written post (an older voice being rewritten) with a facts-only line", async () => {
    const at = Date.now() - 3600_000;
    const entry = { s: "llm", t: at, w: true, v: ROAST_VOICE - 1 };
    const stored: Roast = { id: "trade:t1", kind: "trade", leagueId: ctx.leagueId, rosterIds: [1, 2], text: "Manager 2 paid 1830 for the privilege.", facts: trade("t1", 0), source: "llm", model: "claude-sonnet-5", createdAt: at, usage: null };
    await tickWith(entry, stored);
    expect(await getRoast(ctx.leagueId, "trade:t1")).toEqual(stored);
    expect((await store.get<Record<string, unknown>>(indexKey))?.["trade:t1"]).toEqual(entry);
  });
});

describe("stat lines when the retry is refused", () => {
  const row = (id: string, manager: string, facts: Record<string, unknown>): SurfaceRow => ({ id, managers: [manager], facts: { manager, ...facts } });

  it("the rows the retry would have rewritten stay unavailable: no failed attempt is counted", async () => {
    vi.stubEnv("WRITER_DAILY_BUDGET_USD", TIGHT_BUDGET_USD);
    // Row 1 passes; row 2 quotes a number it does not have, so it is asked again.
    const { client, calls } = spendingClient(
      JSON.stringify({ r1: "Manager 1 is exactly where his decisions put him.", r2: "Manager 2 is 9999 points from relevance." }),
    );
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 4);
    const now = Date.now();
    const rows = [row("1", "Manager 1", { rank: 1, record: "4-0" }), row("2", "Manager 2", { rank: 2, record: "3-1" })];
    const r = await refreshSurfaceLines("standings", key, rows, ctx, { now });
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ status: "written", asked: 2, written: 1, failed: 0 });
    const stored = await getStoredSurfaceLines("standings", key, ctx);
    expect(stored?.lines).toEqual({ "1": "Manager 1 is exactly where his decisions put him.", "2": null });
    expect(stored?.failures?.["2"]).toMatchObject({ n: 0, at: now });
  });
});
