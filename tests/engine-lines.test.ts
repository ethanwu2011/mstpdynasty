/**
 * The stat-surface one-liners: the batched writer (one call per batch, the same frozen prompt
 * and post-check as everything else, one retry for failed rows), the refresh policy (new rows at
 * once, changed rows at most daily, failures back off), and the jobs that keep every table
 * current. The model is a scripted fake: no key, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { runTick } from "@/lib/jobs";
import { refreshLines, tickLines } from "@/lib/jobs/lines";
import {
  checkLine,
  draftRows,
  getSurfaceLines,
  hasRoastClient,
  isRoastConfigured,
  linesMessage,
  MAX_WRITER_CALLS_PER_DAY,
  MAX_ROW_ATTEMPTS,
  MAX_ROWS_PER_CALL,
  parseLinesReply,
  refreshSurfaceLines,
  ROW_RETRY_AFTER_MS,
  setRoastClient,
  standingsRows,
  surfaceKeys,
  surfaceLines,
} from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import { SYSTEM_PROMPT } from "@/lib/roast/persona";
import { lineSources } from "@/lib/roast/surfaces";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type { DraftPickFact, StandingRow, StoredSurfaceLines, SurfaceRow, TeamRef } from "@/lib/types";
import { hasFixtures, rtLeagueId } from "./helpers/fixtures";
import { fakeCtx } from "./ops-helpers";

type Params = Parameters<RoastClient["beta"]["messages"]["create"]>[0];

interface Request {
  content: string;
  /** slot id -> the manager names on its SLOTS line. */
  slots: Map<string, string[]>;
  facts: Record<string, Record<string, unknown>>;
}

function parseRequest(p: Params): Request {
  const content = String(p.messages[0].content);
  const lines = content.split("\n");
  const slots = new Map<string, string[]>();
  for (const l of lines) {
    const m = /^@@(r\d+): (.*)$/.exec(l);
    if (m) slots.set(m[1], m[2].split(" vs "));
  }
  const facts = JSON.parse(lines[lines.indexOf("FACTS:") + 1]) as Request["facts"];
  return { content, slots, facts };
}

/** A fake model: `answer` gets each request and returns the reply text (or "REFUSE"). */
function scripted(answer: (req: Request, call: number) => string) {
  const calls: Request[] = [];
  const params: Params[] = [];
  const client: RoastClient = {
    beta: {
      messages: {
        async create(p) {
          params.push(p);
          const req = parseRequest(p);
          calls.push(req);
          const text = answer(req, calls.length);
          const refuse = text === "REFUSE";
          return {
            id: `msg_${calls.length}`,
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            stop_reason: refuse ? "refusal" : "end_turn",
            stop_details: refuse ? { type: "refusal", category: null, explanation: null } : null,
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
            content: refuse ? [] : [{ type: "text", text, citations: null }],
          } as never;
        },
      },
    },
  };
  return { client, calls, params };
}

/** A valid line for every slot: names the manager, no numbers. */
const fine = (req: Request) => JSON.stringify(Object.fromEntries([...req.slots].map(([slot, names]) => [slot, `${names[0]} is exactly where his decisions put him.`])));

const team = (id: number): TeamRef => ({ rosterId: id, teamName: `Team ${id}`, managerName: `Manager ${id}`, managerKey: `m${id}` });
const standing = (id: number, rank: number, wins: number, pf: number): StandingRow => ({
  rank,
  team: team(id),
  wins,
  losses: 5 - wins,
  ties: 0,
  pointsFor: pf,
  pointsAgainst: 500,
  streak: wins > 2 ? "2W" : "2L",
});
const table = () => standingsRows([standing(1, 1, 4, 601.4), standing(2, 2, 3, 577.9), standing(3, 3, 1, 612.3)]);

beforeEach(() => {
  store.resetStoreForTests();
});

afterEach(() => {
  setRoastClient(undefined);
});

describe("the batched writer", () => {
  it("one call per batch, one line per row, through the frozen prompt; stored where pages read it", async () => {
    const { client, calls, params } = scripted(fine);
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 5);
    const res = await refreshSurfaceLines("standings", key, table(), ctx, { now: 1_000 });
    expect(res).toMatchObject({ status: "written", asked: 3, written: 3, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(params[0].model).toBe("claude-sonnet-5");
    expect(params[0].system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(calls[0].content.startsWith("LINES: standings\nTASK: ")).toBe(true);
    expect(calls[0].content).not.toMatch(/roast/i);
    expect([...calls[0].slots.keys()]).toEqual(["r1", "r2", "r3"]);
    expect(calls[0].facts.r3).toMatchObject({ manager: "Manager 3", rank: 3, record: "1-4", pointsFor: 612.3, pointsForRank: 1 });

    const lines = await getSurfaceLines("standings", key, ctx);
    expect(lines).toEqual({ "1": "Manager 1 is exactly where his decisions put him.", "2": "Manager 2 is exactly where his decisions put him.", "3": "Manager 3 is exactly where his decisions put him." });
    // Nothing changed: no second call.
    expect(await refreshSurfaceLines("standings", key, table(), ctx, { now: 2_000 })).toMatchObject({ status: "fresh", asked: 0 });
    expect(calls).toHaveLength(1);
  });

  it("every line passes the post-check; the failures get one retry, in one call, for just those rows", async () => {
    const { client, calls } = scripted((req, n) => {
      if (n === 1) {
        return JSON.stringify({
          r1: "Manager 1 is first on the 3rd most points, which is a lease, not a deed.",
          r2: "Manager 2 lost by 999 and blamed the schedule.",
          r3: "Manager 3 got roasted by his own lineup.",
        });
      }
      if (n === 2) {
        // The retry: r2 is fixed, r3 comes back as two sentences.
        expect([...req.slots.keys()]).toEqual(["r2", "r3"]);
        expect(req.content).toContain("NOTE: your last lines for these slots broke the rules");
        return JSON.stringify({ r2: "Manager 2 is 3-2 and somehow proud of it.", r3: "Manager 3 has 612.3 points. He is 1-4." });
      }
      // Later refreshes ask for row 3 alone, and it keeps failing.
      return JSON.stringify(Object.fromEntries([...req.slots.keys()].map((slot) => [slot, "Manager 3 has 612.3 points. He is 1-4."])));
    });
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 5);
    const res = await refreshSurfaceLines("standings", key, table(), ctx, { now: 1_000 });
    expect(calls).toHaveLength(2);
    expect(res).toMatchObject({ status: "written", asked: 3, written: 2, failed: 1 });
    expect(res.lines["3"]).toBeNull();
    expect(res.lines["2"]).toBe("Manager 2 is 3-2 and somehow proud of it.");

    // The failed row backs off, then is given up on after MAX_ROW_ATTEMPTS refreshes.
    expect(await refreshSurfaceLines("standings", key, table(), ctx, { now: 1_000 + 60_000 })).toMatchObject({ status: "throttled", asked: 0 });
    expect(calls).toHaveLength(2);
    let now = 1_000;
    for (let i = 1; i < MAX_ROW_ATTEMPTS; i++) {
      now += ROW_RETRY_AFTER_MS + 1;
      await refreshSurfaceLines("standings", key, table(), ctx, { now });
    }
    const before = calls.length;
    expect(before).toBeGreaterThan(2);
    now += ROW_RETRY_AFTER_MS + 1;
    expect(await refreshSurfaceLines("standings", key, table(), ctx, { now })).toMatchObject({ status: "throttled", asked: 0 });
    expect(calls).toHaveLength(before);
    const stored = await store.get<StoredSurfaceLines>(store.keys.surfaceLines(ctx.leagueId, "standings", key));
    expect(stored?.failures?.["3"]?.n).toBe(MAX_ROW_ATTEMPTS);
    // Once its facts change, the row is asked again.
    const moved = standingsRows([standing(1, 1, 4, 601.4), standing(2, 2, 3, 577.9), standing(3, 3, 2, 650.1)]);
    expect((await refreshSurfaceLines("standings", key, moved, ctx, { now: now + 1 })).asked).toBe(1);
  });

  it("a refusal or an API error leaves every line absent, never a canned one", async () => {
    setRoastClient(scripted(() => "REFUSE").client);
    expect(await surfaceLines("standings", table())).toEqual({ "1": null, "2": null, "3": null });
    const ctx = fakeCtx();
    const res = await refreshSurfaceLines("standings", surfaceKeys.standings("2026", 5), table(), ctx);
    expect(res.status).toBe("skipped");
    expect(await getSurfaceLines("standings", surfaceKeys.standings("2026", 5), ctx)).toEqual({});
  });

  it("an outage backs off but never counts against a row; the lines come once the writer is back", async () => {
    const down: RoastClient = {
      beta: {
        messages: {
          create: async () => {
            throw new Error("overloaded");
          },
        },
      },
    };
    setRoastClient(down);
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 5);
    let now = 0;
    for (let i = 0; i < MAX_ROW_ATTEMPTS + 2; i++) {
      now += ROW_RETRY_AFTER_MS + 1;
      expect((await refreshSurfaceLines("standings", key, table(), ctx, { now })).status).toBe("skipped");
      // Inside the back-off window nothing is asked.
      expect((await refreshSurfaceLines("standings", key, table(), ctx, { now: now + 1000 })).status).toBe("throttled");
    }
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    expect(await refreshSurfaceLines("standings", key, table(), ctx, { now: now + ROW_RETRY_AFTER_MS + 1 })).toMatchObject({ status: "written", written: 3 });
    expect(calls).toHaveLength(1);
  });

  it(`batches ${MAX_ROWS_PER_CALL} rows per call, and a capped refresh leaves the rest for the next run`, async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const rows: SurfaceRow[] = Array.from({ length: MAX_ROWS_PER_CALL + 5 }, (_, i) => ({ id: `e${i}`, managers: [`Manager ${i}`], facts: { manager: `Manager ${i}`, headline: "Left points on the bench" } }));
    const ctx = fakeCtx();
    const capped = await refreshSurfaceLines("shame", surfaceKeys.shame("2026"), rows, ctx, { maxRows: 10 });
    expect(capped).toMatchObject({ status: "written", written: 10, pending: MAX_ROWS_PER_CALL - 5 });
    expect(calls).toHaveLength(1);
    const rest = await refreshSurfaceLines("shame", surfaceKeys.shame("2026"), rows, ctx);
    expect(rest).toMatchObject({ status: "written", written: MAX_ROWS_PER_CALL - 5 });
    expect(calls).toHaveLength(2);
    expect(Object.values(await getSurfaceLines("shame", surfaceKeys.shame("2026"), ctx))).toHaveLength(MAX_ROWS_PER_CALL + 5);
  });

  it("new rows go out at once; a row that already has a line is rewritten at most once a day", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.trades();
    const row = (id: string, net: number): SurfaceRow => ({ id, managers: ["Manager 1"], facts: { manager: "Manager 1", net } });
    await refreshSurfaceLines("trades", key, [row("t1", 100)], ctx, { now: 0 });
    // A new trade a minute later: written at once, and only it.
    const r2 = await refreshSurfaceLines("trades", key, [row("t1", 100), row("t2", 50)], ctx, { now: 60_000 });
    expect(r2).toMatchObject({ status: "written", asked: 1 });
    expect([...calls[1].slots.keys()]).toEqual(["r1"]);
    expect(calls[1].facts.r1).toMatchObject({ net: 50 });
    // t1's value moves the same day: throttled, and its old line stays up.
    const r3 = await refreshSurfaceLines("trades", key, [row("t1", -400), row("t2", 50)], ctx, { now: 120_000 });
    expect(r3.status).toBe("throttled");
    expect(r3.lines.t1).toBe("Manager 1 is exactly where his decisions put him.");
    // A day later it is rewritten.
    expect(await refreshSurfaceLines("trades", key, [row("t1", -400), row("t2", 50)], ctx, { now: 24 * 3600_000 + 1 })).toMatchObject({ status: "written", asked: 1 });
  });

  it("a throttled row keeps the hash its line was written from: facts that change back cost no call", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.trades();
    const row = (id: string, net: number): SurfaceRow => ({ id, managers: ["Manager 1"], facts: { manager: "Manager 1", net } });
    await refreshSurfaceLines("trades", key, [row("t1", 100)], ctx, { now: 0 });
    // t1 moves (throttled) while a new trade gets written: the store is rewritten under t1.
    expect(await refreshSurfaceLines("trades", key, [row("t1", -400), row("t2", 50)], ctx, { now: 60_000 })).toMatchObject({ status: "written", asked: 1 });
    // t1 moves back to what its line was written from: nothing to ask, even after the window.
    const back = await refreshSurfaceLines("trades", key, [row("t1", 100), row("t2", 50)], ctx, { now: 2 * 24 * 3600_000 });
    expect(back.status).toBe("fresh");
    expect(calls).toHaveLength(2);
  });

  it("the writer refuses past the daily cap of calls, across instances (store-backed)", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    await store.set(store.keys.rate(`writer-calls:${etDate(Date.now())}`), MAX_WRITER_CALLS_PER_DAY);
    const res = await refreshSurfaceLines("standings", surfaceKeys.standings("2026", 5), table(), fakeCtx());
    expect(res.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("on Vercel without the shared store the writer stays off: no model call at all", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    await store.set("warm", 1); // keep this test's memory store; only the env says "file on Vercel"
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("STORE_BACKEND", "file");
    try {
      expect(hasRoastClient()).toBe(false);
      expect(isRoastConfigured()).toBe(false);
      expect((await refreshSurfaceLines("standings", surfaceKeys.standings("2026", 5), table(), fakeCtx())).status).toBe("skipped");
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a run that finds work takes the surface's claim first; a busy surface is left to the other run", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 5);
    let claims = 0;
    const busy = await refreshSurfaceLines("standings", key, table(), ctx, { claim: async () => (claims++, null) });
    expect(busy).toMatchObject({ status: "busy", asked: 0, pending: 3 });
    expect(calls).toHaveLength(0);
    let released = 0;
    const free = async () => (claims++, async () => void released++);
    expect(await refreshSurfaceLines("standings", key, table(), ctx, { claim: free })).toMatchObject({ status: "written", written: 3 });
    expect(released).toBe(1);
    // Nothing to write: the claim is not even asked for.
    expect(await refreshSurfaceLines("standings", key, table(), ctx, { claim: free })).toMatchObject({ status: "fresh" });
    expect(claims).toBe(2);
  });

  it("a pick's line is written once: its live FantasyCalc rank moving does not rewrite it", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const ctx = fakeCtx();
    const pick = (fcRank: number): DraftPickFact => ({
      kind: "draft_pick",
      draftId: "d1",
      pickNo: 7,
      round: 1,
      pickInRound: 7,
      team: team(2),
      player: { playerId: "p9", name: "Otis Grange", position: "RB", nflTeam: "DAL", age: 30, value: 1210, overallRank: fcRank },
      fcRank,
      fcPositionRank: 12,
      reach: fcRank - 7,
      verdict: "reach",
      pickedAt: null,
      positionRun: 1,
    });
    await refreshSurfaceLines("draft", surfaceKeys.draft("d1"), draftRows([pick(61)]), ctx);
    const again = await refreshSurfaceLines("draft", surfaceKeys.draft("d1"), draftRows([pick(58)]), ctx, { now: Date.now() + 3 * 24 * 3600_000 });
    expect(again.status).toBe("fresh");
    expect(calls).toHaveLength(1);
  });
});

describe("line checks", () => {
  const rows = table();
  const { allowed, exempt } = lineSources(rows, {});

  it("one sentence, names the row's manager, short, plain", () => {
    expect(checkLine("Manager 3 has the most points in the league and a 1-4 record to hold them.", rows[2], allowed, exempt)).toMatchObject({ reasons: [] });
    expect(checkLine("Manager 3 has 612.3 points. He is 1-4.", rows[2], allowed, exempt).reasons.join()).toMatch(/2 sentences/);
    expect(checkLine("He has the most points in the league.", rows[2], allowed, exempt).reasons.join()).toMatch(/never names Manager 3/);
    expect(checkLine(`Manager 3 ${"keeps losing ".repeat(20)}anyway.`, rows[2], allowed, exempt).reasons.join()).toMatch(/words/);
    expect(checkLine("Manager 3 is 1-4!", rows[2], allowed, exempt).line).toBe("Manager 3 is 1-4.");
    expect(checkLine("", rows[2], allowed, exempt).reasons).toEqual(["the line was missing"]);
  });

  it("any row's number is fair next to its owner, never next to the wrong manager", () => {
    expect(checkLine("Manager 3 has outscored first-place Manager 1 612.3 to 601.4 and is 1-4 anyway.", rows[2], allowed, exempt).reasons).toEqual([]);
    expect(checkLine("Manager 3 has scored 577.9 points.", rows[2], allowed, exempt).reasons.join()).toMatch(/577\.9 next to the wrong name/);
    expect(checkLine("Manager 3 has scored 700 points.", rows[2], allowed, exempt).reasons.join()).toMatch(/700 \(not in FACTS\)/);
  });

  it("never announces itself: the newsletter's joke-announcing words are out unless a team is named that", () => {
    // The same list the newsletter's post-check uses (ANNOUNCE_TERMS in lib/roast/banned.ts).
    for (const bad of ["Manager 3 got roasted by his own lineup.", "Manager 3 is a savage at 1-4.", "Sick burn, Manager 3 is 1-4.", "Manager 3 is 1-4, no offense."]) {
      expect(checkLine(bad, rows[2], allowed, exempt).reasons.join()).toMatch(/banned/);
    }
    const roast: SurfaceRow = { id: "9", managers: ["Kevin"], facts: { manager: "Kevin", team: "Pot Roast" } };
    const b = lineSources([roast], {});
    expect(checkLine("Kevin named his team Pot Roast and then played like it.", roast, b.allowed, b.exempt).reasons).toEqual([]);
  });

  it("slurs and the medical or school theme are out on a line exactly as in an issue", () => {
    expect(checkLine("Manager 3 is 1-4 and needs a doctor.", rows[2], allowed, exempt).reasons.join()).toMatch(/banned/);
    expect(checkLine("Manager 3 is 1-4, a report card nobody signs.", rows[2], allowed, exempt).reasons.join()).toMatch(/banned/);
  });

  it("slot ids never count as numbers a line may state", () => {
    // 24 rows, so slots r1..r24 exist; managers with no digits in their names.
    const name = (i: number) => `Coach${String.fromCharCode(65 + i)}`;
    const many: SurfaceRow[] = Array.from({ length: 24 }, (_, i) => ({ id: String(i), managers: [name(i)], facts: { manager: name(i), rank: 1 } }));
    const src = lineSources(many, {});
    expect(checkLine(`${name(3)} scored 22 points and called it a week.`, many[3], src.allowed, src.exempt).reasons.join()).toMatch(/22 \(not in FACTS\)/);
  });

  it("reads a JSON reply in a code fence, and the @@ slot format as a fallback", () => {
    expect([...parseLinesReply('```json\n{"r1":"A.","R2":"B."}\n```')]).toEqual([["r1", "A."], ["r2", "B."]]);
    expect([...parseLinesReply("@@r1\nA line.\n@@r2\nAnother.")]).toEqual([["r1", "A line."], ["r2", "Another."]]);
  });

  it("the request names each row's managers and carries only facts", () => {
    const msg = linesMessage("odds", rows, { "Manager 1": "Still thinks kickers matter." }, { context: "Draft is live." });
    expect(msg.split("\n").slice(0, 3)).toEqual([
      "LINES: season odds",
      "TASK: One line per team on its season odds. The playoff and title odds are the headline. Draft is live. Each slot is one row of a table printed on the site: its SLOTS line names the manager the row is about, and FACTS holds that row's facts under the same slot id. Write each line in the same voice as an ITEM, cut to one sentence of at most 30 words about that row's manager, by first name: the row's number, then the worst reading of it. At most one epic clause. Another row's manager and number are fair for contrast. No two lines on one table share a shape or a punchline.",
      "SLOTS:",
    ]);
    expect(msg).toContain("@@r2: Manager 2");
    expect(msg.split("\n").at(-1)).toBe('{"Manager 1":"Still thinks kickers matter."}');
  });
});

describe.skipIf(!hasFixtures())("the jobs keep every table's lines current (RT fixture league)", () => {
  it("one batch per surface, the same keys the pages read, nothing asked twice", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    const first = await refreshLines(ctx, { scope: "all" });
    expect(first).toMatchObject({ job: "lines", status: "ran" });
    expect(first.detail).not.toMatch(/roast/i);
    const surfaces = calls.map((c) => c.content.split("\n")[0]);
    for (const s of ["LINES: standings", "LINES: season odds", "LINES: power rankings", "LINES: matchups", "LINES: team pages", "LINES: Wall of Shame", "LINES: draft picks"]) {
      expect(surfaces).toContain(s);
    }
    const standings = await getSurfaceLines("standings", surfaceKeys.standings(ctx.season, 17), ctx);
    expect(Object.keys(standings).sort()).toEqual(ctx.rosters.map((r) => String(r.roster_id)).sort());
    const team = await getSurfaceLines("team", surfaceKeys.team(ctx.season), ctx);
    expect(Object.keys(team)).toHaveLength(ctx.rosters.length);
    expect(Object.keys(await getSurfaceLines("draft", surfaceKeys.draft(ctx.draft!.draft_id), ctx)).length).toBeGreaterThan(0);

    // The Wall of Shame holds more rows than one run asks for: the rest go out next run.
    expect(first.detail).toMatch(/shame: wrote 80 lines, \d+ next run/);
    const second = await refreshLines(ctx, { scope: "all" });
    expect(second.detail).toMatch(/^shame: wrote \d+ lines\.$/);
    const asked = calls.length;
    const third = await refreshLines(ctx, { scope: "all" });
    expect(third).toMatchObject({ status: "skipped", detail: "Every line is up to date." });
    expect(calls).toHaveLength(asked);
  });

  it("the tick sweeps the tables at most hourly and does the instant surfaces every run", async () => {
    const { client } = scripted(fine);
    setRoastClient(client);
    const ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    await tickLines(ctx, Date.now(), Date.now() + 60_000);
    expect(await store.lock(store.keys.lock(ctx.leagueId, "lines-sweep"), 10)).toBe(false);
    expect(Object.keys(await getSurfaceLines("shame", surfaceKeys.shame(ctx.season), ctx)).length).toBeGreaterThan(0);
  });

  it("on Vercel without the shared store, a tick makes no model call (write-ups, lines, anything)", async () => {
    const { client, calls } = scripted(fine);
    setRoastClient(client);
    const ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    await store.set("warm", 1); // keep this test's memory store; only the env says "file on Vercel"
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("STORE_BACKEND", "file");
    try {
      await runTick(new Date(), { ctx, ignoreCooldown: true });
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("without the writer nothing is built or stored", async () => {
    setRoastClient(null);
    const ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    expect(await refreshLines(ctx, { scope: "all" })).toMatchObject({ status: "skipped" });
    expect(await store.list(store.keys.surfacePrefix(ctx.leagueId))).toEqual([]);
  });
});
