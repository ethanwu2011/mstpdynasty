/**
 * Round 3 engine surface (docs/CONTRACTS.md "Engine surface, round 3"): stat-surface lines,
 * trades in hindsight, draft odds, league recipients and the test email, plus the issue rename.
 * Synthetic data except the draft-odds block, which runs on the RT fixture league.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIssue, listIssues, saveIssue, upgradeIssue } from "@/lib/archive";
import { recipients, recipientSummary, sendIssue, sendTest, setEmailTransportForTests, unsubscribe } from "@/lib/email";
import { MSTP_LEAGUE_ID } from "@/lib/env";
import { computeTradeHindsight, nearestDate, rankWorstTrades, sampleEvenly, type ValuesSource } from "@/lib/facts/hindsight";
import { getLeagueContext } from "@/lib/league";
import { draftOdds } from "@/lib/models";
import { mergeRates } from "@/lib/models/data";
import {
  getSurfaceLines,
  ISSUE_TITLES,
  issueTitle,
  refreshSurfaceLines,
  rowHash,
  setRoastClient,
  surfaceKeys,
  surfaceLines,
} from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import * as store from "@/lib/store";
import type { FantasyCalcValues, Issue, StoredSurfaceLines, SurfaceRow, TeamRef, TradeFact, TradeSide } from "@/lib/types";
import { hasFixtures, rtLeagueId } from "./helpers/fixtures";
import { fakeCtx, fakeTransport, linkIn, makeIssue, type FakeTransport } from "./ops-helpers";

/** Placeholder addresses on the reserved example.com domain, built at run time. */
const addr = (name: string) => `${name}@example.com`;

beforeEach(() => {
  store.resetStoreForTests();
});

afterEach(() => {
  setRoastClient(undefined);
  setEmailTransportForTests(undefined);
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------ */
/* issue names                                                         */
/* ------------------------------------------------------------------ */

describe("issue names", () => {
  it("never announce the roast", () => {
    expect(ISSUE_TITLES).toEqual({ daily: "The Daily", thursday_fallout: "Thursday Night Fallout", weekly_recap: "Week N Recap", draft_grades: "Draft Grades" });
    expect(issueTitle("weekly_recap", 5)).toBe("Week 5 Recap");
    expect(issueTitle("daily", 5)).toBe("The Daily");
    for (const t of Object.values(ISSUE_TITLES)) expect(t).not.toMatch(/roast|burn|cooked/i);
  });

  it("legacy stored issues read as the new kind and title, under their old slug", async () => {
    const legacy = { ...makeIssue(), kind: "weekly_roast", title: "The Weekly Roast", slug: "2026-09-29-weekly-roast" } as unknown as Issue;
    expect(upgradeIssue(legacy)).toMatchObject({ kind: "weekly_recap", title: "Week 3 Recap", slug: "2026-09-29-weekly-roast" });
    await saveIssue({ ...legacy, status: "sent" });
    expect((await getIssue(MSTP_LEAGUE_ID, "2026-09-29-weekly-roast"))?.kind).toBe("weekly_recap");
    expect((await listIssues(MSTP_LEAGUE_ID))[0].title).toBe("Week 3 Recap");
    const daily = { ...makeIssue(), kind: "daily_roast", title: "The Daily Roast" } as unknown as Issue;
    expect(upgradeIssue(daily)).toMatchObject({ kind: "daily", title: "The Daily" });
  });
});

/* ------------------------------------------------------------------ */
/* stat-surface lines                                                  */
/* ------------------------------------------------------------------ */

const team = (rosterId: number): TeamRef => ({ rosterId, teamName: `Team ${rosterId}`, managerName: `Manager ${rosterId}`, managerKey: `m${rosterId}` });

const rows: SurfaceRow[] = [
  { id: "1", managers: ["Manager 1"], facts: { wins: 3, losses: 0, pointsFor: 401.2 } },
  { id: "2", managers: ["Manager 2"], facts: { wins: 0, losses: 3, pointsFor: 288.9 } },
];

/** A writer whose every call fails (an outage): lines stay absent. */
const fakeClient: RoastClient = {
  beta: {
    messages: {
      create: async () => {
        throw new Error("the API is down");
      },
    },
  },
};

describe("surface lines", () => {
  it("keys are plain strings per surface", () => {
    expect(surfaceKeys.standings("2026", 5)).toBe("2026:w5");
    expect(surfaceKeys.odds("2026", 0)).toBe("2026:w0");
    expect(surfaceKeys.trades()).toBe("all");
    expect(surfaceKeys.draft("1406497801021427712")).toBe("draft-1406497801021427712");
  });

  it("row hashes ignore key order and see every value", () => {
    const a: SurfaceRow = { id: "1", managers: ["A"], facts: { x: 1, y: { b: 2, a: 1 } } };
    const b: SurfaceRow = { id: "1", managers: ["A"], facts: { y: { a: 1, b: 2 }, x: 1 } };
    expect(rowHash(a)).toBe(rowHash(b));
    expect(rowHash(a)).not.toBe(rowHash({ ...a, facts: { x: 2, y: { a: 1, b: 2 } } }));
  });

  it("without a key every line is absent (null), never a canned joke, and nothing is stored", async () => {
    setRoastClient(null);
    expect(await surfaceLines("standings", rows)).toEqual({ "1": null, "2": null });
    const ctx = fakeCtx();
    const res = await refreshSurfaceLines("standings", surfaceKeys.standings("2026", 3), rows, ctx);
    expect(res).toMatchObject({ status: "skipped", asked: 0, lines: { "1": null, "2": null } });
    expect(await getSurfaceLines("standings", surfaceKeys.standings("2026", 3), ctx)).toEqual({});
  });

  it("a writer that keeps failing writes nothing, so nothing is faked", async () => {
    setRoastClient(fakeClient);
    expect(await surfaceLines("odds", rows)).toEqual({ "1": null, "2": null });
    const ctx = fakeCtx();
    const res = await refreshSurfaceLines("odds", surfaceKeys.odds("2026", 0), rows, ctx);
    expect(res.status).toBe("skipped");
    expect(res.asked).toBe(2);
  });

  it("pages read stored lines; unchanged rows are not re-sent, tables refresh at most daily", async () => {
    const ctx = fakeCtx();
    const key = surfaceKeys.standings("2026", 3);
    const record: StoredSurfaceLines = {
      surface: "standings",
      key,
      factsHash: "x",
      rowHashes: { "1": rowHash(rows[0]), "2": rowHash(rows[1]) },
      generatedAt: 1_000,
      model: "claude-opus-5",
      usage: null,
      lines: { "1": "Line one.", "2": "Line two." },
    };
    await store.set(store.keys.surfaceLines(ctx.leagueId, "standings", key), record);
    expect(await getSurfaceLines("standings", key, ctx)).toEqual({ "1": "Line one.", "2": "Line two." });

    setRoastClient(fakeClient);
    expect(await refreshSurfaceLines("standings", key, rows, ctx, { now: 2_000 })).toMatchObject({ status: "fresh", asked: 0 });
    const moved = [rows[0], { ...rows[1], facts: { ...rows[1].facts, losses: 4 } }];
    expect((await refreshSurfaceLines("standings", key, moved, ctx, { now: 2_000 })).status).toBe("throttled");
    const later = await refreshSurfaceLines("standings", key, moved, ctx, { now: 1_000 + 25 * 3600_000 });
    expect(later).toMatchObject({ status: "skipped", asked: 1 });
    // The stale line stays until a writer replaces it; nothing is dropped or invented.
    expect(later.lines).toEqual({ "1": "Line one.", "2": "Line two." });
  });
});

/* ------------------------------------------------------------------ */
/* trades in hindsight                                                 */
/* ------------------------------------------------------------------ */

const asset = (playerId: string, name: string) => ({ playerId, name, position: "WR", nflTeam: null, age: null, value: null, overallRank: null });

function side(rosterId: number, playersIn: string[], playersOut: string[], picksIn = 0, picksOut = 0): TradeSide {
  const pick = { season: "2027", round: 1, originalRosterId: rosterId, label: "2027 1st", value: null };
  return {
    team: team(rosterId),
    playersIn: playersIn.map((id) => asset(id, id.toUpperCase())),
    playersOut: playersOut.map((id) => asset(id, id.toUpperCase())),
    picksIn: Array.from({ length: picksIn }, () => pick),
    picksOut: Array.from({ length: picksOut }, () => pick),
    faabIn: 0,
    faabOut: 0,
    valueIn: 0,
    valueOut: 0,
    net: 0,
    grade: "B",
  };
}

/** Team 1 sends player a for player b plus a 2027 1st, on 2026-09-21 (ET noon). */
const TRADE: TradeFact = {
  kind: "trade",
  transactionId: "tx1",
  week: 3,
  createdAt: Date.UTC(2026, 8, 21, 16),
  sides: [side(1, ["b"], ["a"], 1, 0), side(2, ["a"], ["b"], 0, 1)],
  winnerRosterId: null,
  valueGap: 0,
};

const day = (date: string, a: number, b: number, pick = 3000): FantasyCalcValues => ({ date, values: { a, b }, picks: { "2027 1st (Mid)": pick } });

function source(days: FantasyCalcValues[], today: FantasyCalcValues | null): ValuesSource {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return { dates: days.map((d) => d.date), valuesOn: async (d) => byDate.get(d) ?? null, today };
}

describe("trades in hindsight", () => {
  it("nearest snapshot within the window, ties to the earlier day", () => {
    expect(nearestDate(["2026-09-18", "2026-09-20", "2026-09-22"], "2026-09-21")).toBe("2026-09-20");
    expect(nearestDate(["2026-09-30"], "2026-09-21")).toBeNull();
    expect(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
  });

  it("values each side at the time and today, with the change and a dot series", async () => {
    const days = [day("2026-09-21", 8000, 4000), day("2026-09-25", 6000, 5000), day("2026-10-01", 3000, 7000)];
    const [h] = await computeTradeHindsight([TRADE], source(days, days[2]), "2026");
    expect(h).toMatchObject({ date: "2026-09-21", thenDate: "2026-09-21", nowDate: "2026-10-01" });
    const [s1, s2] = h.sides;
    // Then: team 1 got b (4000) + a 1st (3000) = 7000 for a (8000). Now: 7000 + 3000 = 10000 for 3000.
    expect(s1).toMatchObject({ valueInThen: 7000, valueOutThen: 8000, netThen: -1000, valueInNow: 10000, valueOutNow: 3000, netNow: 7000, delta: 8000 });
    expect(s2).toMatchObject({ netThen: 1000, netNow: -7000, delta: -8000 });
    expect(s1.playersIn[0].value).toBe(7000);
    expect(s1.series.map((p) => p.date)).toEqual(["2026-09-21", "2026-09-25", "2026-10-01"]);
    expect(s2.series.map((p) => p.valueIn)).toEqual([8000, 6000, 3000]);
    expect(h).toMatchObject({ winnerNowRosterId: 1, loserNowRosterId: 2, valueLost: 7000, lostSinceTrade: 8000 });
  });

  it("a trade from before the first snapshot has no 'then', never a guessed one", async () => {
    const days = [day("2026-10-10", 3000, 7000)];
    const [h] = await computeTradeHindsight([TRADE], source(days, null), "2026");
    expect(h.thenDate).toBeNull();
    expect(h.sides[0]).toMatchObject({ valueInThen: null, netThen: null, gradeThen: null, delta: null, netNow: 7000 });
    expect(h.lostSinceTrade).toBeNull();
    expect(h.nowDate).toBe("2026-10-10");
  });

  it("the leaderboard ranks by value lost as of today and leaves even trades out", async () => {
    const even: TradeFact = { ...TRADE, transactionId: "tx2", sides: [side(3, ["c"], ["d"]), side(4, ["d"], ["c"])] };
    const today: FantasyCalcValues = { date: "2026-10-01", values: { a: 3000, b: 7000, c: 500, d: 500 }, picks: {} };
    const all = await computeTradeHindsight([TRADE, even], source([], today), "2026");
    const worst = rankWorstTrades(all, 5);
    expect(worst.map((t) => t.transactionId)).toEqual(["tx1"]);
    expect(worst[0].valueLost).toBe(4000); // no pick value today: 7000 in vs 3000 out for team 1
  });
});

/* ------------------------------------------------------------------ */
/* draft odds                                                          */
/* ------------------------------------------------------------------ */

describe("draft odds projections", () => {
  it("season projections per game first, weekly projections for everyone else", () => {
    const season = new Map([["a", { points: 18.2, position: "WR" }]]);
    const weekly = new Map([
      ["a", { points: 0, position: "WR" }],
      ["b", { points: 11.5, position: "RB" }],
    ]);
    expect(Object.fromEntries(mergeRates(season, weekly))).toEqual({ a: { points: 18.2, position: "WR" }, b: { points: 11.5, position: "RB" } });
  });
});

describe.skipIf(!hasFixtures())("draft odds on the RT fixture league", () => {
  it("10,000 seeded runs by default: playoff odds sum to 100 x playoff spots (600 here), title odds to 100", async () => {
    const real = await getLeagueContext({ leagueId: rtLeagueId() });
    const ctx = { ...real, phase: "drafting" as const };
    const d = await draftOdds(ctx, { fresh: true });
    expect(d.runs).toBe(10_000);
    const playoffTeams = Math.min(ctx.league.settings.playoff_teams ?? 6, ctx.rosters.length);
    expect(playoffTeams).toBe(6);
    const sum = (k: "playoffPct" | "titlePct" | "lastPlacePct") => d.teams.reduce((s, t) => s + t[k], 0);
    expect(Math.abs(sum("playoffPct") - 600)).toBeLessThan(0.1);
    expect(Math.abs(sum("titlePct") - 100)).toBeLessThan(0.1);
    expect(Math.abs(sum("lastPlacePct") - 100)).toBeLessThan(0.1);
    // Same seed, same odds.
    const again = await draftOdds(ctx, { seed: d.seed, fresh: true });
    expect(again.teams.map((t) => [t.team.rosterId, t.playoffPct, t.titlePct])).toEqual(d.teams.map((t) => [t.team.rosterId, t.playoffPct, t.titlePct]));
  });

  it("reads the reseed rule from the league settings", async () => {
    const real = await getLeagueContext({ leagueId: rtLeagueId() });
    const fixed = { ...real, phase: "drafting" as const, league: { ...real.league, settings: { ...real.league.settings, playoff_seed_type: 0 } } };
    const reseeded = { ...fixed, league: { ...fixed.league, settings: { ...fixed.league.settings, playoff_seed_type: 1 } } };
    const a = await draftOdds(fixed, { runs: 4000, seed: 11, fresh: true });
    const b = await draftOdds(reseeded, { runs: 4000, seed: 11, fresh: true });
    const titles = (d: typeof a) => Object.fromEntries(d.teams.map((t) => [t.team.rosterId, t.titlePct]));
    expect(titles(a)).not.toEqual(titles(b));
    // Playoff odds do not depend on the bracket; title odds still sum to 100.
    expect(Object.fromEntries(a.teams.map((t) => [t.team.rosterId, t.playoffPct]))).toEqual(Object.fromEntries(b.teams.map((t) => [t.team.rosterId, t.playoffPct])));
    expect(Math.abs(b.teams.reduce((s, t) => s + t.titlePct, 0) - 100)).toBeLessThan(0.1);
  });

  it("is unavailable for a finished season", async () => {
    const ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    const d = await draftOdds(ctx, { runs: 200, seed: 1 });
    expect(d).toMatchObject({ available: false, basis: null, teams: [] });
  });

  it("during a draft: playoff and title odds per team, summing like the sim, cached per pick count", async () => {
    const real = await getLeagueContext({ leagueId: rtLeagueId() });
    const ctx = { ...real, phase: "drafting" as const };
    const d = await draftOdds(ctx, { runs: 500, seed: 7 });
    expect(d.available).toBe(true);
    expect(d.basis).toBe("drafting");
    expect(d.teams).toHaveLength(ctx.rosters.length);
    expect(d.picksMade).toBeGreaterThan(0);
    const sum = (k: "playoffPct" | "titlePct") => d.teams.reduce((s, t) => s + t[k], 0);
    const playoffTeams = Math.min(ctx.league.settings.playoff_teams ?? 6, ctx.rosters.length);
    expect(sum("titlePct")).toBeCloseTo(100, 0);
    expect(sum("playoffPct")).toBeCloseTo(playoffTeams * 100, 0);
    expect(d.teams.every((t) => t.projectedRank >= 1 && t.playersDrafted >= 0)).toBe(true);
    const a = await draftOdds(ctx, { runs: 300 });
    const b = await draftOdds(ctx, { runs: 300 });
    expect(b.generatedAt).toBe(a.generatedAt);
  });
});

/* ------------------------------------------------------------------ */
/* recipients and the test email                                       */
/* ------------------------------------------------------------------ */

describe("league recipients", () => {
  let t: FakeTransport;
  beforeEach(() => {
    vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
    vi.stubEnv("COMMISSIONER_EMAIL", addr("commish"));
    vi.stubEnv("SITE_URL", "https://mstpdynasty.test");
    vi.stubEnv("LEAGUE_ID", "");
    vi.stubEnv("LEAGUE_EMAILS", ` ${addr("Ann")}, ${addr("bo")};${addr("ann")} not-an-address `);
    t = fakeTransport();
    setEmailTransportForTests(t);
  });

  it("come from LEAGUE_EMAILS: valid, unique, lowercased", async () => {
    expect(await recipients()).toEqual([addr("ann"), addr("bo")]);
    expect(await recipientSummary()).toEqual({ configured: true, count: 2, optedOut: 0 });
    vi.stubEnv("LEAGUE_EMAILS", "");
    expect(await recipientSummary()).toEqual({ configured: false, count: 0, optedOut: 0 });
  });

  it("a league send goes to them; an unsubscribe keeps that address out for good", async () => {
    const issue = makeIssue();
    await saveIssue(issue);
    expect(await sendIssue(issue, "auto")).toMatchObject({ status: "sent", recipients: 2 });
    const toBo = t.sent[0].messages.find((m) => m.to === addr("bo"))!;
    const token = linkIn(toBo.text, "/api/unsubscribe").searchParams.get("token")!;
    expect(await unsubscribe(token)).toEqual({ ok: true, status: "unsubscribed" });
    expect((await unsubscribe(token)).status).toBe("not_found");
    expect(await recipients()).toEqual([addr("ann")]);
    expect(await recipientSummary()).toEqual({ configured: true, count: 1, optedOut: 1 });
    // The opt-out is stored by HMAC ref, never by address.
    const optOutKeys = await store.list(store.keys.optOutPrefix(MSTP_LEAGUE_ID));
    expect(optOutKeys).toHaveLength(1);
    expect(optOutKeys[0]).not.toContain("bo");
  });

  it("sendTest goes to COMMISSIONER_EMAIL only, marked as a test, and marks nothing sent", async () => {
    const issue = makeIssue();
    await saveIssue(issue);
    const res = await sendTest();
    expect(res).toMatchObject({ status: "test_sent", recipients: 1 });
    expect(t.sent).toHaveLength(1);
    const [m] = t.sent[0].messages;
    expect(m.to).toBe(addr("commish"));
    expect(m.subject.startsWith("[Test] ")).toBe(true);
    expect(m.text).toContain("TEST COPY");
    expect(m.text).not.toContain("/api/admin/approve");
    expect((await getIssue(MSTP_LEAGUE_ID, issue.slug))?.status).toBe("draft");
  });

  it("sendTest reports what is missing instead of sending", async () => {
    expect((await sendTest()).status).toBe("skipped"); // nothing stored yet
    vi.stubEnv("COMMISSIONER_EMAIL", "");
    expect((await sendTest({ issue: makeIssue() })).status).toBe("not_configured");
    vi.stubEnv("COMMISSIONER_EMAIL", addr("commish"));
    expect((await sendTest({ issue: makeIssue({ leagueId: "some-dev-league" }) })).status).toBe("skipped");
    setEmailTransportForTests(null);
    expect((await sendTest({ issue: makeIssue() })).status).toBe("not_configured");
    expect(t.sent).toHaveLength(0);
  });
});
