/**
 * Contract smoke test: every public function in docs/CONTRACTS.md runs against the RT fixture
 * league and returns the documented shape. Stubs pass it today; real implementations must keep
 * passing it. Shape only: behaviour is tested in each owner's own test files.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getLeagueContext } from "@/lib/league";
import { getOddsHistory, getPowerRankings, getWinProbabilities, runSeasonSim } from "@/lib/models";
import { draftFacts, shameEntries, tnfFacts, transactionFacts, weeklyFacts } from "@/lib/facts";
import { isRoastConfigured, roastIssue, roastItem } from "@/lib/roast";
import { sendIssue, subscribe } from "@/lib/email";
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
    const issue = await roastIssue("weekly_roast", {
      kind: "weekly_roast",
      week: 5,
      weekly,
      odds: await runSeasonSim({ ctx, runs: 200, seed: 1 }),
      power: await getPowerRankings(ctx),
    }, ctx);
    expect(issue.kind).toBe("weekly_roast");
    expect(issue.factsOnly).toBe(true);
    expect(issue.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("email reports not configured with no keys", async () => {
    const weekly = await weeklyFacts(5, ctx);
    const issue = await roastIssue("weekly_roast", {
      kind: "weekly_roast",
      week: 5,
      weekly,
      odds: await runSeasonSim({ ctx, runs: 200, seed: 1 }),
      power: await getPowerRankings(ctx),
    }, ctx);
    const sent = await sendIssue(issue, "review");
    expect(sent.status).toBe("not_configured");
    const sub = await subscribe({ email: "someone@example.com", managerKey: "ethan" });
    expect(typeof sub.ok).toBe("boolean");
  });
});
