/**
 * Jobs: nothing is built, roasted or emailed twice. The facts, roast and models modules are
 * mocked (other agents own them), so these tests pin down only the ops behaviour and run with
 * no fixtures and no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/facts", () => ({
  transactionFacts: vi.fn(),
  draftFacts: vi.fn(),
  weeklyFacts: vi.fn(),
  tnfFacts: vi.fn(),
  shameEntries: vi.fn(),
}));
vi.mock("@/lib/roast", () => ({
  isRoastConfigured: vi.fn(() => false),
  hasRoastClient: vi.fn(() => false),
  roastIssue: vi.fn(),
  roastItem: vi.fn(),
}));
vi.mock("@/lib/models", () => ({
  getWinProbabilities: vi.fn(),
  runSeasonSim: vi.fn(),
  getPowerRankings: vi.fn(),
  getOddsHistory: vi.fn(),
  backfillOddsHistory: vi.fn(async () => []),
}));
vi.mock("@/lib/sleeper", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/sleeper")>();
  return { ...mod, getPlayers: vi.fn(), getDraftPicks: vi.fn(), getSchedule: vi.fn(async () => []) };
});
vi.mock("@/lib/espn", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/espn")>();
  return { ...mod, getGameClocks: vi.fn(async () => []) };
});
vi.mock("@/lib/fantasycalc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/fantasycalc")>();
  return { ...mod, getFantasyCalc: vi.fn(async () => Promise.reject(new Error("offline"))) };
});

import { getIssue, listIssues, listRoasts } from "@/lib/archive";
import { setEmailTransportForTests } from "@/lib/email";
import { MSTP_LEAGUE_ID } from "@/lib/env";
import { draftFacts, tnfFacts, transactionFacts, weeklyFacts } from "@/lib/facts";
import { diffInjuries, lineupAlerts } from "@/lib/jobs/daily-facts";
import { listJobRuns, readDraftPickTimes, runDaily, runTick } from "@/lib/jobs";
import { backfillOddsHistory, getPowerRankings, getWinProbabilities, runSeasonSim } from "@/lib/models";
import { isRoastConfigured, roastIssue, roastItem } from "@/lib/roast";
import { ROAST_VOICE } from "@/lib/jobs/tick";
import { getDraftPicks, getPlayers } from "@/lib/sleeper";
import * as store from "@/lib/store";
import type {
  DailyFacts,
  DraftFacts,
  DraftPickFact,
  IssueFacts,
  IssueKind,
  LeagueContext,
  PlayersMap,
  Roast,
  RoastItemFact,
  RoastItemKind,
  SleeperDraftPick,
  TeamRef,
  TeamWeekFact,
  TradeFact,
  WaiverFact,
} from "@/lib/types";
import { addr, fakeCtx, fakeDraft, fakeSchedule, fakeTransport, makeIssue, type FakeTransport } from "./ops-helpers";

const schedule = fakeSchedule();
const TUE = new Date("2026-09-29T12:00:00Z");
const WED = new Date("2026-09-30T12:00:00Z");
const THU = new Date("2026-10-01T12:00:00Z");
const FRI = new Date("2026-10-02T12:00:00Z");

const team = (id: number): TeamRef => ({ rosterId: id, teamName: `Team ${id}`, managerName: `Manager ${id}`, managerKey: `m${id}` });

function trade(id: string, createdAt: number): TradeFact {
  const side = (r: number) => ({ team: team(r), playersIn: [], playersOut: [], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: 0, valueOut: 0, net: 0, grade: "C" as const });
  return { kind: "trade", transactionId: id, week: 4, createdAt, sides: [side(1), side(2)], winnerRosterId: null, valueGap: 0 };
}

function waiver(id: string, batchId: string, type: WaiverFact["type"], createdAt: number): WaiverFact {
  return { kind: "waiver", transactionId: id, type, week: 4, createdAt, team: team(1), added: [], dropped: [], bid: type === "waiver" ? 5 : null, isZeroBid: false, losingBids: [], overpayBy: null, notableDrop: false, batchId };
}

function pick(n: number): DraftPickFact {
  return {
    kind: "draft_pick",
    draftId: "draft-1",
    pickNo: n,
    round: Math.ceil(n / 4),
    pickInRound: ((n - 1) % 4) + 1,
    team: team(((n - 1) % 4) + 1),
    player: { playerId: `x${n}`, name: `Player ${n}`, position: "WR", nflTeam: "DAL", age: 24, value: null, overallRank: null },
    fcRank: null,
    fcPositionRank: null,
    reach: null,
    verdict: "unranked",
    pickedAt: null,
    positionRun: 1,
  };
}

function rawPick(n: number): SleeperDraftPick {
  return { draft_id: "draft-1", pick_no: n, round: Math.ceil(n / 4), draft_slot: ((n - 1) % 4) + 1, roster_id: ((n - 1) % 4) + 1, picked_by: "u1", player_id: `x${n}`, is_keeper: null, metadata: null };
}

function draftFactsWith(picks: DraftPickFact[], over: Partial<DraftFacts> = {}): DraftFacts {
  return { draftId: "draft-1", status: "complete", startTime: null, rounds: 34, teams: 4, picks, onTheClock: null, resumesAt: null, positionRuns: [], grades: null, placeholder: false, ...over };
}

function teamWeek(id: number, points: number): TeamWeekFact {
  return { team: team(id), points, projected: null, optimalPoints: points, benchPointsLeft: 0, opponentRosterId: null, result: null, allPlayWins: 0, allPlayLosses: 0, scoreRank: id, robbed: false, fraud: false, zeroStarters: [], streak: "" };
}

function players(): PlayersMap {
  const out: PlayersMap = {};
  for (const r of [1, 2, 3, 4]) {
    for (const s of ["a", "b"]) {
      const id = `p${r}${s}`;
      out[id] = { id, name: `Player ${id}`, pos: "QB", positions: ["QB", "RB"], team: "DAL", age: 25, years_exp: 3, injury_status: null, status: "Active" };
    }
  }
  return out;
}

let txNow: { trades: TradeFact[]; waivers: WaiverFact[]; placeholder: boolean };
let t: FakeTransport;

beforeEach(() => {
  store.resetStoreForTests();
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
  vi.stubEnv("COMMISSIONER_EMAIL", addr("commish"));
  vi.stubEnv("SITE_URL", "https://mstpdynasty.test");
  vi.stubEnv("NEWSLETTER_MODE", "");
  vi.stubEnv("LEAGUE_ID", "");
  setEmailTransportForTests(null);
  t = fakeTransport();

  txNow = { trades: [trade("t1", TUE.getTime() - 3600_000)], waivers: [], placeholder: false };
  vi.mocked(transactionFacts).mockImplementation(async (sinceMs) => ({ sinceMs, untilMs: Date.now(), ...txNow }));
  vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([]));
  vi.mocked(weeklyFacts).mockImplementation(async (week) => ({
    week,
    season: "2026",
    matchups: [],
    teams: [teamWeek(1, 120.5), teamWeek(2, 98.2)],
    highest: null,
    lowest: null,
    loserOfTheWeek: null,
    standings: [],
    placeholder: false,
  }));
  vi.mocked(tnfFacts).mockImplementation(async (week) => ({
    week,
    games: [],
    players: [{ player: pick(1).player, points: 21.4, projected: 14, team: team(1), started: true }],
    teams: [],
    placeholder: false,
  }));
  vi.mocked(getWinProbabilities).mockImplementation(async (week) => ({ week, season: "2026", generatedAt: 0, basis: "live", matchups: [], placeholder: false }));
  vi.mocked(runSeasonSim).mockResolvedValue({ season: "2026", asOfWeek: 3, runs: 10_000, seed: 1, generatedAt: 0, teams: [], placeholder: false });
  vi.mocked(getPowerRankings).mockResolvedValue({ season: "2026", asOfWeek: 3, formula: "Formula.", rows: [], placeholder: false });
  vi.mocked(roastIssue).mockImplementation(async (kind: IssueKind, facts: IssueFacts, ctx?: LeagueContext) => {
    const period = facts.kind === "daily" ? facts.date : "week" in facts ? `w${facts.week}` : "draft";
    return makeIssue({ kind, slug: `${period}-${kind.replace(/_/g, "-")}`, leagueId: ctx!.leagueId, title: kind, createdAt: Date.now() });
  });
  vi.mocked(roastItem).mockImplementation(
    async (kind: RoastItemKind, fact: RoastItemFact, ctx?: LeagueContext): Promise<Roast> => ({
      id: "set-by-roast-agent",
      kind,
      leagueId: ctx!.leagueId,
      rosterIds: [],
      text: "A roast.",
      facts: fact,
      source: "facts_only",
      model: null,
      createdAt: Date.now(),
      usage: null,
    }),
  );
  vi.mocked(getPlayers).mockResolvedValue(players());
  vi.mocked(getDraftPicks).mockResolvedValue([]);
});

afterEach(() => {
  setEmailTransportForTests(undefined);
  vi.unstubAllEnvs();
});

const outcome = (r: Awaited<ReturnType<typeof runDaily>>, job: string) => r.outcomes.find((o) => o.job === job);

describe("runDaily", () => {
  it("builds each issue once per period and never re-roasts on a rerun", async () => {
    const ctx = fakeCtx();
    const r1 = await runDaily(TUE, { ctx, schedule });
    expect(outcome(r1, "weekly_recap")).toMatchObject({ status: "ran", issueSlug: "w3-weekly-recap" });
    expect(outcome(r1, "daily")).toMatchObject({ status: "ran", issueSlug: "2026-09-29-daily" });
    expect(outcome(r1, "thursday_fallout")?.status).toBe("skipped");
    expect(outcome(r1, "draft_grades")?.status).toBe("skipped");
    expect(roastIssue).toHaveBeenCalledTimes(2);
    // Odds and power rankings are pinned to the recapped week, and missing snapshots get backfilled.
    expect(runSeasonSim).toHaveBeenCalledWith(expect.objectContaining({ persist: true, fromWeek: 4 }));
    expect(getPowerRankings).toHaveBeenCalledWith(ctx, { asOfWeek: 3 });
    expect(backfillOddsHistory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(weeklyFacts).mock.calls[0][0]).toBe(3);
    // review mode, no email configured: stored as drafts, not published
    expect((await listIssues(ctx.leagueId, { includeUnsent: true })).map((i) => i.status)).toEqual(["draft", "draft"]);
    expect(await listIssues(ctx.leagueId)).toHaveLength(0);

    const r2 = await runDaily(TUE, { ctx, schedule });
    expect(outcome(r2, "weekly_recap")).toMatchObject({ status: "skipped", detail: "Already done for this period." });
    expect(outcome(r2, "daily")).toMatchObject({ status: "skipped", detail: "Already done for this period." });
    expect(roastIssue).toHaveBeenCalledTimes(2);

    // Wednesday: nothing new, so The Daily stays quiet and sends nothing
    txNow = { trades: [], waivers: [], placeholder: false };
    const r3 = await runDaily(WED, { ctx, schedule });
    expect(outcome(r3, "daily")).toMatchObject({ status: "skipped", detail: "Quiet day: nothing happened, nothing sent." });
    expect((await runDaily(WED, { ctx, schedule })).outcomes.find((o) => o.job === "daily")?.detail).toBe("Already done for this period.");
    expect(roastIssue).toHaveBeenCalledTimes(2);

    // Thursday looks back to Wednesday's run, not a fixed 24 hours
    await runDaily(THU, { ctx, schedule });
    expect(vi.mocked(transactionFacts).mock.calls.at(-1)?.[0]).toBe(WED.getTime());

    expect((await listJobRuns(ctx.leagueId)).length).toBe(5);
  });

  it("never builds from placeholder facts, and retries once real facts arrive", async () => {
    const ctx = fakeCtx();
    txNow = { ...txNow, placeholder: true };
    const r1 = await runDaily(WED, { ctx, schedule });
    expect(outcome(r1, "daily")).toMatchObject({ status: "skipped", detail: "Facts are still placeholder data, so nothing was built." });
    expect(roastIssue).not.toHaveBeenCalled();
    txNow = { ...txNow, placeholder: false };
    expect(outcome(await runDaily(WED, { ctx, schedule }), "daily")?.status).toBe("ran");
  });

  it("emails each issue once: review copies, then nothing on a rerun", async () => {
    setEmailTransportForTests(t);
    const ctx = fakeCtx();
    const r1 = await runDaily(TUE, { ctx, schedule });
    expect(outcome(r1, "weekly_recap")?.detail).toContain("Review copy sent to the commissioner");
    expect(t.sent).toHaveLength(2);
    expect(t.sent.every((s) => s.messages[0].to === addr("commish"))).toBe(true);
    await runDaily(TUE, { ctx, schedule });
    expect(t.sent).toHaveLength(2);
  });

  it("auto mode: Friday sends Thursday Night Fallout and The Daily to the league list, once", async () => {
    vi.stubEnv("NEWSLETTER_MODE", "auto");
    vi.stubEnv("LEAGUE_EMAILS", addr("fan"));
    setEmailTransportForTests(t);
    const ctx = fakeCtx();
    const r1 = await runDaily(FRI, { ctx, schedule });
    expect(outcome(r1, "thursday_fallout")).toMatchObject({ status: "ran", issueSlug: "w4-thursday-fallout" });
    expect(outcome(r1, "daily")?.status).toBe("ran");
    expect(t.sent).toHaveLength(2);
    expect((await getIssue(ctx.leagueId, "w4-thursday-fallout"))?.status).toBe("sent");
    await runDaily(FRI, { ctx, schedule });
    expect(t.sent).toHaveLength(2);
  });

  it("a failed email is retried with the same issue (no second LLM call)", async () => {
    vi.stubEnv("NEWSLETTER_MODE", "auto");
    vi.stubEnv("LEAGUE_EMAILS", addr("fan"));
    setEmailTransportForTests(t);
    const ctx = fakeCtx();
    t.fail = true;
    expect(outcome(await runDaily(WED, { ctx, schedule }), "daily")?.status).toBe("error");
    t.fail = false;
    expect(outcome(await runDaily(WED, { ctx, schedule }), "daily")?.status).toBe("ran");
    expect(roastIssue).toHaveBeenCalledTimes(1);
    expect(t.sent).toHaveLength(1);
  });

  it("auto mode without email publishes on the site; a dev league is never emailed or published", async () => {
    vi.stubEnv("NEWSLETTER_MODE", "auto");
    const ctx = fakeCtx();
    await runDaily(WED, { ctx, schedule });
    expect((await listIssues(ctx.leagueId)).map((i) => i.status)).toEqual(["approved"]);

    setEmailTransportForTests(t);
    const dev = fakeCtx({ leagueId: "dev-league-1" });
    expect(dev.isDevLeague).toBe(true);
    const r = await runDaily(WED, { ctx: dev, schedule });
    expect(outcome(r, "daily")?.detail).toContain("Dev league");
    expect(t.sent).toHaveLength(0);
    expect((await listIssues(dev.leagueId, { includeUnsent: true })).map((i) => i.status)).toEqual(["draft"]);
  });

  it("builds Draft Grades once, the morning after the startup draft", async () => {
    const ctx = fakeCtx({ draft: fakeDraft({ status: "complete", last_picked: WED.getTime() - 6 * 3600_000 }) });
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([pick(1)], { grades: [] }));
    expect(outcome(await runDaily(THU, { ctx, schedule }), "draft_grades")).toMatchObject({ status: "skipped", detail: "Draft grades are not computed yet." });
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([pick(1)], { grades: [{ team: team(1), grade: "B", totalValue: 1, valueRank: 1, bestPick: null, worstPick: null }] }));
    expect(outcome(await runDaily(THU, { ctx, schedule }), "draft_grades")?.status).toBe("ran");
    expect(outcome(await runDaily(THU, { ctx, schedule }), "draft_grades")?.status).toBe("skipped");
    expect(vi.mocked(roastIssue).mock.calls.filter((c) => c[0] === "draft_grades")).toHaveLength(1);
  });

  it("holds a lock so overlapping runs do not both work", async () => {
    const ctx = fakeCtx();
    await store.lock(store.keys.lock(ctx.leagueId, "daily"), 600);
    const r = await runDaily(TUE, { ctx, schedule });
    expect(r.locked).toBe(true);
    expect(roastIssue).not.toHaveBeenCalled();
  });

  it("reports The Daily material through DailyFacts", async () => {
    const ctx = fakeCtx();
    await runDaily(TUE, { ctx, schedule });
    const facts = vi.mocked(roastIssue).mock.calls.find((c) => c[0] === "daily")?.[1] as DailyFacts;
    expect(facts).toMatchObject({ kind: "daily", date: "2026-09-29", hasMaterial: true });
    expect(facts.trades.map((x) => x.transactionId)).toEqual(["t1"]);
  });

  it("leaves plain cuts out of The Daily (a quiet day stays quiet)", async () => {
    const ctx = fakeCtx();
    const at = TUE.getTime() - 3600_000;
    const cut = waiver("cut", "fa-cut", "free_agent", at);
    const add = { ...waiver("add", "fa-add", "free_agent", at), added: [{ playerId: "p9", name: "Player 9", position: "WR", nflTeam: "DAL", age: 24, value: null, overallRank: null }] };
    const notable = { ...waiver("big", "fa-big", "free_agent", at), notableDrop: true };
    txNow = { trades: [], waivers: [cut, add, notable], placeholder: false };
    await runDaily(TUE, { ctx, schedule });
    const facts = vi.mocked(roastIssue).mock.calls.find((c) => c[0] === "daily")?.[1] as DailyFacts;
    expect(facts.waivers.map((w) => w.transactionId)).toEqual(["add", "big"]);

    vi.clearAllMocks();
    txNow = { trades: [], waivers: [cut], placeholder: false };
    const r = await runDaily(new Date(TUE.getTime() + 24 * 3600_000), { ctx, schedule });
    expect(outcome(r, "daily")).toMatchObject({ status: "skipped", detail: "Quiet day: nothing happened, nothing sent." });
  });
});

describe("runTick", () => {
  const liveCtx = (now: number) => fakeCtx({ phase: "drafting", draft: fakeDraft({ status: "drafting", last_picked: now - 30_000 }) });

  it("roasts new trades, waiver runs and picks once, under a 2-minute cooldown", async () => {
    const now = Date.now();
    const ctx = liveCtx(now);
    txNow = {
      trades: [trade("t1", now - 60_000)],
      waivers: [waiver("w1", "b1", "waiver", now - 7200_000), waiver("w2", "b1", "waiver", now - 7200_000), waiver("fa1", "fa-1", "free_agent", now - 600_000)],
      placeholder: false,
    };
    vi.mocked(getDraftPicks).mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8].map(rawPick));
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([1, 2, 3, 4, 5, 6, 7, 8].map(pick), { status: "drafting" }));

    const r1 = await runTick(new Date(now), { ctx });
    expect(r1.locked).toBe(false);
    expect(roastItem).toHaveBeenCalledTimes(6);
    expect(r1.outcomes).toEqual([
      { job: "roast_trades", status: "ran", detail: "Wrote up 1 trade." },
      { job: "roast_waivers", status: "ran", detail: "Wrote up 1 waiver run." },
      { job: "roast_picks", status: "ran", detail: "Wrote up 4 draft picks. 4 more next tick." },
    ]);
    const waiverCall = vi.mocked(roastItem).mock.calls.find((c) => c[0] === "waiver");
    expect(waiverCall?.[1]).toHaveLength(2); // one batch, the plain free-agent add is left alone
    const ids = (await listRoasts(ctx.leagueId)).map((r) => r.id).sort();
    expect(ids).toEqual(["pick:draft-1:005", "pick:draft-1:006", "pick:draft-1:007", "pick:draft-1:008", "trade:t1", "waiver:b1"]);
    expect(await readDraftPickTimes(ctx.leagueId, "draft-1")).toEqual({ 8: now - 30_000 });

    // within the cooldown: nothing happens
    const r2 = await runTick(new Date(now + 1000), { ctx });
    expect(r2).toMatchObject({ locked: true, outcomes: [] });
    expect(roastItem).toHaveBeenCalledTimes(6);

    // after the cooldown: the backlog drains, then nothing is roasted twice
    await store.unlock(store.keys.lock(ctx.leagueId, "tick"));
    await runTick(new Date(now + 130_000), { ctx });
    expect(roastItem).toHaveBeenCalledTimes(10);
    await store.unlock(store.keys.lock(ctx.leagueId, "tick"));
    const r4 = await runTick(new Date(now + 260_000), { ctx });
    expect(roastItem).toHaveBeenCalledTimes(10);
    expect(r4.outcomes.map((o) => o.detail)).toEqual(["No new trades.", "No new waiver runs.", "No new draft picks."]);
    expect(await listRoasts(ctx.leagueId)).toHaveLength(10);
  });

  it("overlapping runs: an in-flight run blocks a second one, and a claimed item is never roasted twice", async () => {
    const now = Date.now();
    const ctx = liveCtx(now);
    txNow = { trades: [trade("t1", now - 60_000), trade("t2", now - 50_000)], waivers: [], placeholder: false };
    vi.mocked(getDraftPicks).mockResolvedValue([]);
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([], { status: "drafting" }));

    // A slow run still holds the in-flight lock after the 2-minute cooldown expired.
    await store.lock(store.keys.lock(ctx.leagueId, "tick-run"), 300);
    expect(await runTick(new Date(now), { ctx })).toMatchObject({ locked: true, outcomes: [] });
    expect(roastItem).not.toHaveBeenCalled();
    await store.unlock(store.keys.lock(ctx.leagueId, "tick-run"));

    // Another run is writing t1 right now: this run skips it and roasts only t2.
    await store.lock(store.keys.lock(ctx.leagueId, "roast:trade:t1"), 300);
    const r = await runTick(new Date(now), { ctx, ignoreCooldown: true });
    expect(vi.mocked(roastItem).mock.calls.map((c) => (c[1] as TradeFact).transactionId)).toEqual(["t2"]);
    expect(r.outcomes[0].detail).toBe("Wrote up 1 trade. 1 already being written by another run.");
  });

  it("merges the roast index with entries another run wrote meanwhile", async () => {
    const now = Date.now();
    const ctx = liveCtx(now);
    txNow = { trades: [trade("t1", now - 60_000)], waivers: [], placeholder: false };
    vi.mocked(getDraftPicks).mockResolvedValue([]);
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([], { status: "drafting" }));
    const indexKey = store.keys.snapshot(ctx.leagueId, "roast-index");
    const base = vi.mocked(roastItem).getMockImplementation()!;
    vi.mocked(roastItem).mockImplementation(async (...args) => {
      // Another tick finishes while this one is still writing.
      await store.set(indexKey, { "trade:other": { s: "llm", t: now } });
      return base(...args);
    });
    await runTick(new Date(now), { ctx, ignoreCooldown: true });
    expect(Object.keys((await store.get<Record<string, unknown>>(indexKey)) ?? {}).sort()).toEqual(["trade:other", "trade:t1"]);
  });

  it("a voice bump rewrites every item: old-voice posts, and one more try for items the writer gave up on", async () => {
    const now = Date.now();
    const ctx = liveCtx(now);
    vi.mocked(isRoastConfigured).mockReturnValue(true);
    txNow = { trades: ["old", "gaveup", "gaveup-new", "current"].map((id) => trade(id, now - 60_000)), waivers: [], placeholder: false };
    vi.mocked(getDraftPicks).mockResolvedValue([]);
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([], { status: "drafting" }));
    await store.set(store.keys.snapshot(ctx.leagueId, "roast-index"), {
      "trade:old": { s: "llm", t: now - 1000, w: true, v: ROAST_VOICE - 1 },
      "trade:gaveup": { s: "facts_only", t: now - 7200_000, w: true, n: 3, v: ROAST_VOICE - 1 },
      "trade:gaveup-new": { s: "facts_only", t: now - 7200_000, w: true, n: 4, v: ROAST_VOICE },
      "trade:current": { s: "llm", t: now - 1000, w: true, v: ROAST_VOICE },
    });
    try {
      await runTick(new Date(now), { ctx, ignoreCooldown: true });
    } finally {
      vi.mocked(isRoastConfigured).mockReturnValue(false);
    }
    expect(vi.mocked(roastItem).mock.calls.map((c) => (c[1] as TradeFact).transactionId).sort()).toEqual(["gaveup", "old"]);
  });

  it("takes the cooldown lock before loading the league", async () => {
    await store.lock(store.keys.lock(MSTP_LEAGUE_ID, "tick"), 120);
    const r = await runTick(new Date());
    expect(r).toMatchObject({ locked: true, outcomes: [] });
    expect(transactionFacts).not.toHaveBeenCalled();
  });

  it("leaves picks alone once the draft ended more than a week ago", async () => {
    const now = Date.now();
    const ctx = fakeCtx({ draft: fakeDraft({ status: "complete", last_picked: now - 8 * 24 * 3600_000 }) });
    vi.mocked(getDraftPicks).mockResolvedValue([1, 2].map(rawPick));
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([1, 2].map(pick), { status: "complete" }));
    const r = await runTick(new Date(now), { ctx, ignoreCooldown: true });
    expect(r.outcomes.find((o) => o.job === "roast_picks")).toEqual({ job: "roast_picks", status: "skipped", detail: "The draft ended more than a week ago." });
    expect(vi.mocked(roastItem).mock.calls.some((c) => c[0] === "draft_pick")).toBe(false);
    expect(draftFacts).not.toHaveBeenCalled();
  });

  it("never saves placeholder roasts or roasts placeholder facts", async () => {
    const now = Date.now();
    const ctx = liveCtx(now);
    vi.mocked(roastItem).mockImplementation(async (kind, fact, c) => ({
      id: "x", kind, leagueId: c!.leagueId, rosterIds: [], text: "Placeholder.", facts: fact, source: "placeholder", model: null, createdAt: now, usage: null,
    }));
    const r = await runTick(new Date(now), { ctx, ignoreCooldown: true });
    expect(r.outcomes[0].detail).toBe("1 came back as placeholders (not saved).");
    expect(await listRoasts(ctx.leagueId)).toHaveLength(0);

    vi.clearAllMocks();
    txNow = { ...txNow, placeholder: true };
    vi.mocked(draftFacts).mockResolvedValue(draftFactsWith([pick(1)], { placeholder: true }));
    const r2 = await runTick(new Date(now), { ctx, ignoreCooldown: true });
    expect(roastItem).not.toHaveBeenCalled();
    expect(r2.outcomes.every((o) => o.status === "skipped")).toBe(true);
  });
});

describe("daily facts helpers", () => {
  it("injuries: first run is a baseline; later only new serious statuses of starters or top players", () => {
    const ctx = fakeCtx();
    const p = players();
    const base = diffInjuries(ctx, p, null, null);
    expect(base.injuries).toEqual([]);
    p.p2a = { ...p.p2a, injury_status: "Out" }; // starter
    p.p3b = { ...p.p3b, injury_status: "IR" }; // bench, unranked: not news
    p.p4a = { ...p.p4a, injury_status: "Questionable" }; // too noisy
    const next = diffInjuries(ctx, p, null, base.snapshot);
    expect(next.injuries.map((i) => [i.player.playerId, i.status, i.previousStatus, i.isStarter])).toEqual([["p2a", "Out", null, true]]);
    expect(diffInjuries(ctx, p, null, next.snapshot).injuries).toEqual([]);
  });

  it("lineup alerts fire the day before or of the game, never after kickoff", () => {
    const ctx = fakeCtx();
    const p = players();
    p.p2a = { ...p.p2a, injury_status: "Out" };
    const sat = lineupAlerts(ctx, p, null, schedule, 4, "2026-10-03", {}, new Set());
    expect(sat.alerts.filter((a) => a.reason === "out").map((a) => a.player.playerId)).toEqual(["p2a"]);
    expect(sat.alerts.filter((a) => a.reason === "empty_slot")).toHaveLength(4);
    expect(lineupAlerts(ctx, p, null, schedule, 4, "2026-09-30", {}, new Set()).alerts).toHaveLength(0);
    const started = lineupAlerts(ctx, p, null, schedule, 4, "2026-10-04", { DAL: { kickoff: 0, started: true } }, new Set());
    expect(started.alerts.some((a) => a.reason === "out")).toBe(false);
    expect(lineupAlerts(ctx, p, null, schedule, 4, "2026-10-04", {}, new Set(sat.ids)).alerts).toHaveLength(0);
  });
});
