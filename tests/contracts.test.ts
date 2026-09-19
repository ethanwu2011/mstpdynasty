/**
 * Contract smoke test: every public function in docs/CONTRACTS.md runs against the RT fixture
 * league and returns the documented shape. Stubs pass it today; real implementations must keep
 * passing it. Shape only: behaviour is tested in each owner's own test files.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { draftOdds, getOddsHistory, getPowerRankings, getWinProbabilities, runSeasonSim } from "@/lib/models";
import { draftFacts, shameEntries, tnfFacts, tradeHindsight, transactionFacts, weeklyFacts, worstTrades } from "@/lib/facts";
import { getSurfaceLines, isRoastConfigured, roastIssue, roastItem, surfaceKeys, surfaceLines } from "@/lib/roast";
import { recipientSummary, sendIssue, sendTest } from "@/lib/email";
import { refreshLines, sendTestEmail } from "@/lib/jobs";
import type { LeagueContext } from "@/lib/types";
import { hasFixtures, rtLeagueId } from "./helpers/fixtures";

describe.skipIf(!hasFixtures())("public contracts on the RT fixture league", () => {
  let ctx: LeagueContext;
  beforeAll(async () => {
    ctx = await getLeagueContext({ leagueId: rtLeagueId() });
  });

  it("models", async () => {
    const wp = await getWinProbabilities(5, ctx);
    expect(wp.week).toBe(5);
    expect(typeof wp.placeholder).toBe("boolean");
    for (const m of wp.matchups) {
      expect(m.home.winProb + m.away.winProb).toBeCloseTo(1, 6);
      expect(m.home.team.rosterId).not.toBe(m.away.team.rosterId);
    }
    const sim = await runSeasonSim({ ctx, runs: 500, seed: 7 });
    expect(sim.teams).toHaveLength(ctx.rosters.length);
    const power = await getPowerRankings(ctx);
    expect(power.rows.map((r) => r.rank)).toEqual(ctx.rosters.map((_, i) => i + 1));
    expect(power.formula.length).toBeGreaterThan(0);
    const hist = await getOddsHistory(ctx);
    expect(Array.isArray(hist.snapshots)).toBe(true);
  });

  it("facts", async () => {
    const wk = await weeklyFacts(5, ctx);
    expect(wk.week).toBe(5);
    expect(wk.teams).toHaveLength(ctx.rosters.length);
    const tx = await transactionFacts(0, ctx);
    expect(Array.isArray(tx.trades) && Array.isArray(tx.waivers)).toBe(true);
    const draft = await draftFacts(ctx);
    expect(draft.picks.length).toBeGreaterThan(0);
    expect(draft.picks.every((p) => p.kind === "draft_pick")).toBe(true);
    const tnf = await tnfFacts(5, ctx);
    expect(tnf.week).toBe(5);
    const shame = await shameEntries(ctx);
    expect(Array.isArray(shame.entries)).toBe(true);
  });

  it("roast works with no API key (facts only)", async () => {
    expect(isRoastConfigured()).toBe(false);
    const draft = await draftFacts(ctx);
    const roast = await roastItem("draft_pick", draft.picks[0], ctx);
    expect(roast.id.startsWith("pick:")).toBe(true);
    expect(roast.text.length).toBeGreaterThan(0);
    const weekly = await weeklyFacts(5, ctx);
    const issue = await roastIssue("weekly_recap", {
      kind: "weekly_recap",
      week: 5,
      weekly,
      odds: await runSeasonSim({ ctx, runs: 200, seed: 1 }),
      power: await getPowerRankings(ctx),
    }, ctx);
    expect(issue.kind).toBe("weekly_recap");
    expect(issue.factsOnly).toBe(true);
    expect(issue.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("round 3 engine surface", async () => {
    const board = await tradeHindsight(ctx);
    expect(Array.isArray(board.trades)).toBe(true);
    expect(board.placeholder).toBe(false);
    for (const t of board.trades) {
      expect(t.sides.length).toBeGreaterThanOrEqual(2);
      for (const s of t.sides) expect(Array.isArray(s.series)).toBe(true);
    }
    const worst = await worstTrades(3, ctx);
    expect(worst.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < worst.length; i++) expect(worst[i - 1].valueLost).toBeGreaterThanOrEqual(worst[i].valueLost);
    const odds = await draftOdds(ctx, { runs: 200, seed: 1 });
    expect(typeof odds.available).toBe("boolean");
    expect(Array.isArray(odds.teams)).toBe(true);
    const lines = await surfaceLines("standings", [{ id: "1", managers: [], facts: { wins: 1 } }], ctx);
    expect(lines).toEqual({ "1": null });
    expect(await getSurfaceLines("standings", surfaceKeys.standings(ctx.season, 5), ctx)).toEqual({});
    expect(await recipientSummary(ctx.leagueId)).toMatchObject({ configured: false, count: 0 });
    // No writer: the jobs build nothing and write nothing.
    expect(await refreshLines(ctx, { scope: "all" })).toMatchObject({ job: "lines", status: "skipped" });
  });

  it("email reports not configured with no keys", async () => {
    const weekly = await weeklyFacts(5, ctx);
    const issue = await roastIssue("weekly_recap", {
      kind: "weekly_recap",
      week: 5,
      weekly,
      odds: await runSeasonSim({ ctx, runs: 200, seed: 1 }),
      power: await getPowerRankings(ctx),
    }, ctx);
    const sent = await sendIssue(issue, "review");
    expect(sent.status).toBe("not_configured");
    expect((await sendTest({ issue })).status).toBe("not_configured");
    const test = await sendTestEmail(new Date(), { ctx });
    // A dev league is never emailed; with no keys it is not even tried.
    expect(["not_configured", "skipped"]).toContain(test.status);
    expect(test.recipients).toBe(0);
  });
});
