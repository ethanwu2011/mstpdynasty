/**
 * The roast engine end to end with a fake Claude client (there is no API key in tests):
 * facts-only fallbacks for no key / refusal / API error / empty or failing output, the
 * post-check dropping invented numbers and theme words, item retries, lore loading, and the
 * exact request that goes out.
 */
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { draftFacts, tnfFacts, transactionFacts, weeklyFacts } from "@/lib/facts";
import { buildRoastRequest, FACTS_ONLY_NOTE, isRoastConfigured, issueMemory, planIssue, roastIssue, roastItem, setRoastClient, userMessage } from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import { planItem } from "@/lib/roast/items";
import { AllowedNumbers, numbersIn } from "@/lib/roast/postcheck";
import { saveRoast } from "@/lib/archive";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type {
  DailyRoastFacts,
  DraftPickFact,
  Issue,
  LeagueContext,
  PowerRankings,
  SimResult,
  TradeFact,
  WaiverFact,
  WeeklyFacts,
  WeeklyRoastFacts,
  WinProbWeek,
} from "@/lib/types";
import { hasFixtures, rtLeagueId } from "./helpers/fixtures";
import { fakeCtx, ref } from "./facts-synthetic";

type Params = Parameters<RoastClient["beta"]["messages"]["create"]>[0];

interface FakeReply {
  text?: string;
  stop?: string;
  throws?: unknown;
  /** Throw if the engine reads content (refusals must be caught before content is read). */
  contentTrap?: boolean;
}

function fakeClient(replies: FakeReply[]) {
  const calls: Params[] = [];
  const client: RoastClient = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          const r = replies[Math.min(calls.length - 1, replies.length - 1)];
          if (r.throws) throw r.throws;
          const msg: Record<string, unknown> = {
            id: `msg_${calls.length}`,
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            stop_reason: r.stop ?? "end_turn",
            stop_details: r.stop === "refusal" ? { type: "refusal", category: "cyber", explanation: null } : null,
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
          };
          if (r.contentTrap) {
            Object.defineProperty(msg, "content", {
              get() {
                throw new Error("content read before checking stop_reason");
              },
            });
          } else {
            msg.content = [{ type: "thinking", thinking: "", signature: "x" }, ...(r.text ? [{ type: "text", text: r.text, citations: null }] : [])];
          }
          return msg as never;
        },
      },
    },
  };
  return { client, calls };
}

afterEach(() => {
  setRoastClient(undefined);
  delete process.env.ROAST_NOTES;
});

const NOW = Date.UTC(2030, 9, 8, 13, 0);

function allText(issue: Issue): string {
  return issue.sections
    .flatMap((s) => [
      s.heading,
      ...s.blocks.flatMap((b) =>
        b.type === "list" ? b.items : b.type === "table" ? [...b.columns, ...b.rows.flat().map(String), b.caption ?? ""] : [b.text],
      ),
    ])
    .join("\n");
}

function oddsFor(ctx: LeagueContext): SimResult {
  return {
    season: ctx.season,
    asOfWeek: 7,
    runs: 1000,
    seed: 1,
    generatedAt: 0,
    placeholder: false,
    teams: ctx.rosters.map((r, i) => ({
      team: { rosterId: r.roster_id, teamName: `Team ${r.roster_id}`, managerName: `M${r.roster_id}`, managerKey: `m${r.roster_id}` },
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      meanPoints: 100,
      sdPoints: 25,
      expectedWins: 7,
      playoffPct: 90 - i * 10,
      byePct: 10,
      titlePct: 10,
      lastPlacePct: i * 2,
      firstPickPct: 1,
    })),
  };
}

const POWER: PowerRankings = { season: "x", asOfWeek: 7, formula: "Half all-play, half points per game.", rows: [], placeholder: false };

/* ------------------------------------------------------------------ */
/* issues on the RT fixture                                            */
/* ------------------------------------------------------------------ */

describe.skipIf(!hasFixtures())("roastIssue", () => {
  let ctx: LeagueContext;
  let weekly: WeeklyFacts;
  let facts: WeeklyRoastFacts;

  beforeAll(async () => {
    ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    weekly = await weeklyFacts(7, ctx);
    facts = { kind: "weekly_roast", week: 7, weekly, odds: oddsFor(ctx), power: POWER };
  });

  /** A reply that uses only real numbers from the plan's FACTS. */
  function goodReply(): string {
    const plan = planIssue(facts, ctx);
    const parts = ["@@dek", "Week 7 was a group project nobody did."];
    for (const s of plan.slots.filter((x) => x.id !== "dek")) {
      const m = weekly.matchups.find((x) => `m-${x.matchupId}` === s.id);
      const line = m
        ? `${m.home.team.managerName} and ${m.away.team.managerName} were separated by ${m.margin}. Nobody looked good.`
        : `${weekly.highest?.team.managerName} scored ${weekly.highest?.points}. Everyone else took notes.`;
      parts.push(`@@${s.id}`, line);
    }
    return parts.join("\n");
  }

  it("with no key: facts only, the contract note, every table present", async () => {
    expect(isRoastConfigured()).toBe(false);
    const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
    expect(issue).toMatchObject({ kind: "weekly_roast", factsOnly: true, note: FACTS_ONLY_NOTE, status: "draft", model: null, usage: null, week: 7, title: "The Weekly Roast" });
    expect(issue.slug).toBe(`${etDate(NOW)}-weekly-roast`);
    expect(issue.slug).toMatch(/^[a-z0-9-]+$/);
    const headings = issue.sections.map((s) => s.heading);
    for (const h of ["Week 7", "Loser of the Week", "The matchups", "Points left on the bench", "Standings", "Season odds"]) expect(headings).toContain(h);
    const bench = issue.sections.find((s) => s.heading === "Points left on the bench")!.blocks[0];
    expect(bench.type === "table" && bench.rows.length).toBe(ctx.rosters.length);
    const text = allText(issue);
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).not.toMatch(/Attending|autopsy|M&M/i);
  });

  it("with a good reply: prose in the slots, dek from the model, usage logged, exact request", async () => {
    const { client, calls } = fakeClient([{ text: goodReply() }]);
    setRoastClient(client);
    const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
    expect(calls).toHaveLength(1);
    // The request carries the league memory (rap sheets, crowns, draft slots) in FACTS.
    const plan = planIssue(facts, ctx, await issueMemory(facts, ctx, NOW));
    expect(calls[0]).toEqual(buildRoastRequest(userMessage(plan, {})));
    expect(issue).toMatchObject({ factsOnly: false, note: null, model: "claude-opus-5", dek: "Week 7 was a group project nobody did.", dekSource: "model" });
    expect(issue.usage).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 2000, cacheCreationInputTokens: 0 });
    const m = weekly.matchups[0];
    const matchups = issue.sections.find((s) => s.heading === "The matchups")!;
    expect(matchups.blocks).toContainEqual({ type: "paragraph", text: `${m.home.team.managerName} and ${m.away.team.managerName} were separated by ${m.margin}. Nobody looked good.` });
  });

  it("drops invented numbers and theme words, keeps the rest", async () => {
    const bad = goodReply().replace("Nobody looked good.", "Nobody looked good. A real lineup scores 987.65. This belongs in a hospital.");
    const { client } = fakeClient([{ text: bad }]);
    setRoastClient(client);
    const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
    expect(issue.factsOnly).toBe(false);
    const text = allText(issue);
    expect(text).not.toContain("987.65");
    expect(text).not.toContain("hospital");
    expect(text).toContain("Nobody looked good.");
  });

  it("every number the engine printed from the model is in FACTS", async () => {
    const { client } = fakeClient([{ text: goodReply() }]);
    setRoastClient(client);
    const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
    const allowed = new AllowedNumbers([JSON.stringify(planIssue(facts, ctx).facts)]);
    const paragraphsFromModel = issue.sections.flatMap((s) => s.blocks).filter((b) => b.type === "paragraph" && /Nobody looked good|took notes/.test(b.text));
    expect(paragraphsFromModel.length).toBeGreaterThan(0);
    for (const p of paragraphsFromModel) if (p.type === "paragraph") for (const n of numbersIn(p.text)) expect(allowed.has(n)).toBe(true);
  });

  it("falls back to facts only when most sentences fail the check", async () => {
    const reply = planIssue(facts, ctx)
      .slots.map((s) => `@@${s.id}\nThey scored 999.99. It was 123.45 of pain.`)
      .join("\n");
    const { client } = fakeClient([{ text: reply }]);
    setRoastClient(client);
    const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
    expect(issue).toMatchObject({ factsOnly: true, note: FACTS_ONLY_NOTE, model: "claude-opus-5" });
    expect(allText(issue)).not.toContain("999.99");
  });

  it("refusal: facts only, and content is never read", async () => {
    const { client } = fakeClient([{ stop: "refusal", contentTrap: true }]);
    setRoastClient(client);
    const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
    expect(issue).toMatchObject({ factsOnly: true, note: FACTS_ONLY_NOTE });
  });

  it("API errors and empty replies: facts only, never throws", async () => {
    for (const reply of [
      { throws: new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()) },
      { throws: new Anthropic.APIConnectionError({ message: "down" }) },
      { throws: new Error("boom") },
      { text: "" },
    ] satisfies FakeReply[]) {
      const { client } = fakeClient([reply]);
      setRoastClient(client);
      const issue = await roastIssue("weekly_roast", facts, ctx, { now: NOW });
      expect(issue).toMatchObject({ factsOnly: true, note: FACTS_ONLY_NOTE });
      expect(issue.sections.length).toBeGreaterThan(3);
    }
  });

  it("Thursday Night Fallout, The Daily Roast and Draft Grades render facts only", async () => {
    const winProbs: WinProbWeek = { week: 5, season: ctx.season, generatedAt: 0, basis: "projections", matchups: [], placeholder: false };
    const tnf = await roastIssue("thursday_fallout", { kind: "thursday_fallout", week: 5, tnf: await tnfFacts(5, ctx), winProbs }, ctx, { now: NOW });
    expect(tnf.title).toBe("Thursday Night Fallout");
    expect(tnf.sections.map((s) => s.heading)).toContain("Banked");
    const quiet: DailyRoastFacts = { kind: "daily_roast", date: etDate(NOW), sinceMs: NOW, trades: [], waivers: [], injuries: [], lineupAlerts: [], draftPicks: [], hasMaterial: false };
    const daily = await roastIssue("daily_roast", quiet, ctx, { now: NOW });
    expect(daily.title).toBe("The Daily Roast");
    const tx = await transactionFacts(0, ctx);
    const busy = await roastIssue("daily_roast", { ...quiet, sinceMs: 0, trades: tx.trades, waivers: tx.waivers.slice(0, 12), hasMaterial: true }, ctx, { now: NOW });
    expect(busy.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(["Trades", "Waivers"]));
    const draft = await roastIssue("draft_grades", { kind: "draft_grades", draft: await draftFacts(ctx), odds: oddsFor(ctx) }, ctx, { now: NOW });
    expect(draft.title).toBe("Draft Grades");
    expect(draft.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(["Grades", "Team by team"]));
    for (const issue of [tnf, daily, busy, draft]) {
      expect(issue.factsOnly).toBe(true);
      expect(allText(issue)).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* item roasts (hand-built, fictional league)                          */
/* ------------------------------------------------------------------ */

const TRADE: TradeFact = {
  kind: "trade",
  transactionId: "tx9",
  week: 3,
  createdAt: 0,
  winnerRosterId: 1,
  valueGap: 1830,
  sides: [
    {
      team: ref(1),
      playersIn: [{ playerId: "p1", name: "Marquise Oakes", position: "WR", nflTeam: "KC", age: 24, value: 6120, overallRank: 12 }],
      playersOut: [{ playerId: "p2", name: "Ron Talley", position: "RB", nflTeam: "KC", age: 29, value: 2890, overallRank: 60 }],
      picksIn: [],
      picksOut: [{ season: "2031", round: 2, originalRosterId: 1, label: "2031 2nd (via Kevin's Kitchen)", value: 1400 }],
      faabIn: 0,
      faabOut: 0,
      valueIn: 6120,
      valueOut: 4290,
      net: 1830,
      grade: "A",
    },
    {
      team: ref(2),
      playersIn: [{ playerId: "p2", name: "Ron Talley", position: "RB", nflTeam: "KC", age: 29, value: 2890, overallRank: 60 }],
      playersOut: [{ playerId: "p1", name: "Marquise Oakes", position: "WR", nflTeam: "KC", age: 24, value: 6120, overallRank: 12 }],
      picksIn: [{ season: "2031", round: 2, originalRosterId: 1, label: "2031 2nd (via Kevin's Kitchen)", value: 1400 }],
      picksOut: [],
      faabIn: 0,
      faabOut: 0,
      valueIn: 4290,
      valueOut: 6120,
      net: -1830,
      grade: "D",
    },
  ],
};

const WAIVER: WaiverFact = {
  kind: "waiver",
  transactionId: "w1",
  type: "waiver",
  week: 3,
  createdAt: 0,
  team: ref(3),
  added: [{ playerId: "p3", name: "Deshawn Ruiz", position: "WR", nflTeam: "KC", age: 23, value: null, overallRank: null }],
  dropped: [],
  bid: 38,
  isZeroBid: false,
  losingBids: [{ team: ref(4), bid: 4 }],
  overpayBy: 34,
  notableDrop: false,
  batchId: "w-5000",
};

function pick(pickNo: number, rosterId: number, name: string, position: string, fcRank: number | null): DraftPickFact {
  const reach = fcRank === null ? null : fcRank - pickNo;
  return {
    kind: "draft_pick",
    draftId: "d1",
    pickNo,
    round: Math.ceil(pickNo / 4),
    pickInRound: ((pickNo - 1) % 4) + 1,
    team: ref(rosterId),
    player: { playerId: `x${pickNo}`, name, position, nflTeam: "KC", age: 25, value: 1000, overallRank: fcRank },
    fcRank,
    fcPositionRank: null,
    reach,
    verdict: reach === null ? "unranked" : reach >= 3 ? "reach" : reach <= -3 ? "steal" : "fair",
    secondsOnClock: 7200,
    pickedAt: 0,
    positionRun: 1,
  };
}

describe("roastItem", () => {
  const ctx = fakeCtx();

  it("no key: a deterministic facts-only line", async () => {
    const r = await roastItem("trade", TRADE, ctx, { now: 5 });
    expect(r).toMatchObject({ id: "trade:tx9", kind: "trade", source: "facts_only", model: null, rosterIds: [1, 2], createdAt: 5 });
    expect(r.text).toBe("Kevin gets 6,120 in FantasyCalc value and gives 4,290 (A); Rory gets 4,290 in FantasyCalc value and gives 6,120 (D). Kevin wins it by 1,830.");
  });

  it("a clean roast is kept as written", async () => {
    const { client, calls } = fakeClient([{ text: "@@roast\nRory turned a 24-year-old into a 29-year-old and a coupon. He lost 1830 in value. Kevin says thanks." }]);
    setRoastClient(client);
    const r = await roastItem("trade", TRADE, ctx);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ source: "llm", model: "claude-opus-5" });
    expect(r.text).toBe("Rory turned a 24-year-old into a 29-year-old and a coupon. He lost 1830 in value. Kevin says thanks.");
  });

  it("more than three sentences is retried, never cut off mid-joke", async () => {
    const long = "@@roast\nRory turned a 24-year-old into a 29-year-old and a coupon. He lost 1830 in value. Kevin says thanks. Kevin says thanks again.";
    const { client, calls } = fakeClient([{ text: long }, { text: "@@roast\nRory lost 1830 in value. Kevin says thanks." }]);
    setRoastClient(client);
    const r = await roastItem("trade", TRADE, ctx);
    expect(calls).toHaveLength(2);
    expect(String(calls[1].messages[0].content)).toContain("It also ran 4 sentences; the limit is 3.");
    expect(r).toMatchObject({ source: "llm", text: "Rory lost 1830 in value. Kevin says thanks." });

    const { client: c2 } = fakeClient([{ text: long }]);
    setRoastClient(c2);
    expect((await roastItem("trade", TRADE, ctx)).source).toBe("facts_only");
  });

  it("one failed sentence rejects the whole roast (the punchline never loses its setup)", async () => {
    const { client, calls } = fakeClient([{ text: "@@roast\nRory lost 1830 in value. Worse, it cost him 4321. So much for analytics." }, { text: "@@roast\nRory lost 1830 in value." }]);
    setRoastClient(client);
    const r = await roastItem("trade", TRADE, ctx);
    expect(calls).toHaveLength(2);
    expect(r.text).toBe("Rory lost 1830 in value.");
  });

  it("sees the roasts already published, after FACTS and LORE", async () => {
    await saveRoast({ id: "trade:old", kind: "trade", leagueId: ctx.leagueId, rosterIds: [1], text: "Kevin robbed a bank with a phone call.", facts: TRADE, source: "llm", model: "m", createdAt: 1, usage: null });
    await saveRoast({ id: "trade:plain", kind: "trade", leagueId: ctx.leagueId, rosterIds: [1], text: "Facts only line.", facts: TRADE, source: "facts_only", model: null, createdAt: 2, usage: null });
    const { client, calls } = fakeClient([{ text: "@@roast\nRory lost 1830 in value." }]);
    setRoastClient(client);
    await roastItem("trade", TRADE, ctx);
    const lines = String(calls[0].messages[0].content).split("\n");
    const at = lines.indexOf("RECENT (already published, do not reuse these comparisons or shapes):");
    expect(at).toBeGreaterThan(lines.indexOf("LORE:"));
    expect(lines.slice(at + 1)).toEqual(["- Kevin robbed a bank with a phone call."]);
    for (const id of ["trade:old", "trade:plain"]) await store.del(store.keys.roast(ctx.leagueId, id));
  });

  it("retries once when the numbers fail, then gives up to facts only", async () => {
    const { client, calls } = fakeClient([{ text: "@@roast\nRory lost 9999 in value." }, { text: "@@roast\nRory lost 8888." }]);
    setRoastClient(client);
    const r = await roastItem("trade", TRADE, ctx);
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toContain("NOTE: your last draft broke the rules with: 9999 (not in FACTS)");
    expect(calls[1].system).toEqual(calls[0].system);
    expect(r.source).toBe("facts_only");
    expect(r.usage?.inputTokens).toBe(200);
  });

  it("uses the retry when it passes", async () => {
    const { client, calls } = fakeClient([{ text: "Rory lost 9999." }, { text: "Rory lost 1830 in value on a deal nobody forced him to make." }]);
    setRoastClient(client);
    const r = await roastItem("trade", TRADE, ctx);
    expect(calls).toHaveLength(2);
    expect(r).toMatchObject({ source: "llm", text: "Rory lost 1830 in value on a deal nobody forced him to make." });
  });

  it("refusal and errors fall back to facts only", async () => {
    for (const reply of [{ stop: "refusal", contentTrap: true }, { throws: new Error("boom") }] satisfies FakeReply[]) {
      const { client } = fakeClient([reply]);
      setRoastClient(client);
      const r = await roastItem("trade", TRADE, ctx);
      expect(r.source).toBe("facts_only");
    }
  });

  it("waiver batches roast as one item", async () => {
    const zero: WaiverFact = { ...WAIVER, transactionId: "w2", team: ref(1), bid: 1, losingBids: [{ team: ref(4), bid: 0 }], overpayBy: 1, added: [{ ...WAIVER.added[0], playerId: "p5", name: "Jalen Crane" }] };
    const r = await roastItem("waiver", [WAIVER, zero], ctx);
    expect(r).toMatchObject({ id: "waiver:w-5000", kind: "waiver", rosterIds: [3, 1] });
    expect(r.text).toContain("Waiver Wire Priya (Priya) added Deshawn Ruiz for $38 (also bid: Wes $4).");
    const plan = planItem("waiver", [WAIVER, zero], 100);
    expect(plan.facts).toMatchObject({ faabBudget: 100, claims: [{ manager: "Priya", bid: 38, overpayBy: 34 }, { manager: "Kevin", bid: 1 }] });
  });

  it("draft picks carry their earlier picks and time on the clock into FACTS", async () => {
    const picks = [pick(1, 1, "Case Whitfield", "QB", 3), pick(2, 2, "Tre Holloway", "WR", 1), pick(5, 1, "Colt Easley", "TE", 20)];
    const { client, calls } = fakeClient([{ text: "@@roast\nKevin took Colt Easley at 2.01 with a fcRank of 20. Two hours on the clock for that." }]);
    setRoastClient(client);
    const r = await roastItem("draft_pick", picks[2], ctx, { draftPicks: picks });
    expect(r.id).toBe("pick:d1:005");
    const content = String(calls[0].messages[0].content);
    const facts = JSON.parse(content.split("\n").at(-3)!);
    expect(facts).toMatchObject({ pick: "2.01", reach: 15, verdict: "reach", hoursOnClock: 2, earlierPicks: [{ pick: "1.01", player: "Case Whitfield" }] });
    expect(r.source).toBe("llm");
  });

  it("lore comes from the store and env (env wins), only for managers in the item", async () => {
    await store.set(store.keys.roastNotes(), { Kevin: "Store note for Kevin.", Rory: "Store note for Rory.", Wes: "Wes is not in this trade." });
    process.env.ROAST_NOTES = JSON.stringify({ Rory: "Env note for Rory." });
    const { client, calls } = fakeClient([{ text: "@@roast\nRory lost 1830." }]);
    setRoastClient(client);
    await roastItem("trade", TRADE, ctx);
    const lore = JSON.parse(String(calls[0].messages[0].content).split("\n").at(-1)!);
    expect(lore).toEqual({ Kevin: "Store note for Kevin.", Rory: "Env note for Rory." });
    await store.del(store.keys.roastNotes());
  });
});
