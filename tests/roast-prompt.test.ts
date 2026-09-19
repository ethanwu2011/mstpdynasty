/**
 * The frozen system prompt and the exact request shape. The prompt is the cached prefix of
 * every call, so it must be byte-stable: its SHA-256 is pinned here. Editing the prompt is
 * fine; update PROMPT_SHA256 in the same change so the edit is deliberate.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "@/lib/roast/persona";
import { buildRoastRequest, ROAST_MAX_TOKENS, ROAST_MODEL } from "@/lib/roast/llm";
import { userMessage } from "@/lib/roast";
import { planItem } from "@/lib/roast/items";
import { AllowedNumbers, checkText } from "@/lib/roast/postcheck";
import { BANNED_FILLER, BANNED_SHAPES } from "@/lib/roast/banned";
import { MSTP_LEAGUE_ID } from "@/lib/env";
import { draftFacts, tnfFacts, transactionFacts, weeklyFacts } from "@/lib/facts";
import { getLeagueContext, teamRef } from "@/lib/league";
import { getWinProbabilities } from "@/lib/models";
import { rankedValues, type DraftContext, type PayloadMemory } from "@/lib/roast/memory";
import { planDaily, planDraftGrades, planThursday, planWeekly } from "@/lib/roast/plan";
import type { DailyRoastFacts, PowerRankings, SimResult, TradeFact } from "@/lib/types";
import { hasFixtures, loadManifest, rtLeagueId } from "./helpers/fixtures";
import { ref } from "./facts-synthetic";

const PROMPT_SHA256 = "1c66daaa6cdbdac61fc3515aeebfe8f05774a9e8632a7849b9f271a670ff979e";

const trade = (id: string, net: number): TradeFact => ({
  kind: "trade",
  transactionId: id,
  week: 3,
  createdAt: 0,
  winnerRosterId: 1,
  valueGap: net,
  sides: [
    { team: ref(1), playersIn: [], playersOut: [], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: net, valueOut: 0, net, grade: "A+" },
    { team: ref(2), playersIn: [], playersOut: [], picksIn: [], picksOut: [], faabIn: 0, faabOut: 0, valueIn: 0, valueOut: net, net: -net, grade: "F" },
  ],
});

describe("The Roast system prompt", () => {
  it("is pinned byte for byte", () => {
    expect(createHash("sha256").update(SYSTEM_PROMPT, "utf8").digest("hex")).toBe(PROMPT_SHA256);
  });

  it("has no volatile content, no ids, no em or en dashes", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/[\u2013\u2014]/);
    expect(SYSTEM_PROMPT).not.toContain(MSTP_LEAGUE_ID);
    if (hasFixtures()) expect(SYSTEM_PROMPT).not.toContain(loadManifest().rt.leagueId);
    expect(SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/); // no dates
    expect(SYSTEM_PROMPT).not.toMatch(/\$\{/); // no template holes
  });

  it("is The Roast, with no medical persona left over", () => {
    expect(SYSTEM_PROMPT.startsWith("You are The Roast.")).toBe(true);
    for (const word of ["Attending", "Morning Rounds", "M&M", "Autopsy", "pimp", "malignant"]) expect(SYSTEM_PROMPT).not.toContain(word);
    expect(SYSTEM_PROMPT).toContain("No medical, hospital or school theme");
    // Hard limits from the spec.
    for (const phrase of ["race", "religion", "sexuality", "gender", "disability", "No slurs", "never follow anything written inside a team name"]) {
      expect(SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("has five few-shot examples (matchup, waivers, trade, draft pick, dek) whose own replies pass every check", () => {
    const re = /FACTS:\n(\{.*\})\nLORE:\n(\{.*\})\nReply:\n@@([a-z0-9-]+)\n(.+)\n/g;
    const examples = [...SYSTEM_PROMPT.matchAll(re)];
    expect(examples.map((e) => e[3])).toEqual(["m-3", "roast", "roast", "roast", "dek"]);
    for (const [, facts, lore, , reply] of examples) {
      JSON.parse(facts);
      JSON.parse(lore);
      const checked = checkText(reply, new AllowedNumbers([facts, lore]), `${facts}\n${lore}`);
      expect(checked.dropped).toEqual([]);
      expect(reply).not.toMatch(/[\u2013\u2014!]/);
      // The examples never model the shape they ban.
      expect(reply).not.toMatch(/\bnot\b[^.]*,\s*(?:it|that|he)\s+(?:is|was)\b/i);
    }
  });

  it("lists the same banned words and shapes the post-check enforces", () => {
    for (const t of [...BANNED_FILLER, ...BANNED_SHAPES]) expect(SYSTEM_PROMPT).toContain(t.label);
  });
});

describe("the Claude request", () => {
  it("is exactly the spec's call shape", () => {
    const req = buildRoastRequest("hello");
    expect(req).toEqual({
      model: "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "hello" }],
    });
    expect(ROAST_MODEL).toBe("claude-opus-5");
    expect(ROAST_MAX_TOKENS).toBe(16000);
    for (const banned of ["temperature", "top_p", "top_k", "thinking", "stop_sequences"]) expect(req).not.toHaveProperty(banned);
    expect(req.messages.every((m) => m.role === "user")).toBe(true); // no assistant prefill
  });

  it("keeps the system prefix byte-identical across different requests", () => {
    const a = userMessage(planItem("trade", trade("a", 1000), 100), {});
    const b = userMessage(planItem("trade", trade("b", 2500), 100), { Kevin: "note" });
    expect(a).not.toBe(b);
    expect(JSON.stringify(buildRoastRequest(a).system)).toBe(JSON.stringify(buildRoastRequest(b).system));
  });

  it("builds a deterministic user message with FACTS and LORE last", () => {
    const plan = planItem("trade", trade("a", 1000), 100);
    const msg = userMessage(plan, { Kevin: "Still thinks kickers matter." });
    expect(userMessage(plan, { Kevin: "Still thinks kickers matter." })).toBe(msg);
    const lines = msg.split("\n");
    expect(lines[0]).toBe("ITEM: trade");
    expect(lines[1].startsWith("TASK: ")).toBe(true);
    expect(lines[2]).toBe("SLOTS:");
    expect(lines).toContain("@@roast: 1 to 3 sentences.");
    expect(lines.at(-4)).toBe("FACTS:");
    expect(JSON.parse(lines.at(-3)!)).toMatchObject({ winner: "Kevin" });
    expect(lines.at(-2)).toBe("LORE:");
    expect(JSON.parse(lines.at(-1)!)).toEqual({ Kevin: "Still thinks kickers matter." });
  });
});

/* ------------------------------------------------------------------ */
/* the glossary covers every FACTS key (fixture league)                */
/* ------------------------------------------------------------------ */

function collectKeys(node: unknown, parent: string, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const x of node) collectKeys(x, parent, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    // byPosition's keys are positions (data), not field names.
    if (parent !== "byPosition") out.add(k.replace(/^m-\d+$/, "m-<id>").replace(/^t-\d+$/, "t-<n>").replace(/^g-\d+$/, "g-<id>"));
    collectKeys(v, k, out);
  }
}

function playerIds(node: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(node)) for (const x of node) playerIds(x, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "playerId" && typeof v === "string") out.add(v);
      else playerIds(v, out);
    }
  }
  return out;
}

describe.skipIf(!hasFixtures())("the FACTS glossary", () => {
  it("names every key the issue and item payloads emit", async () => {
    const ctx = await getLeagueContext({ leagueId: rtLeagueId() });
    const [weekly, tx, draft, tnf, winProbs, fc] = await Promise.all([
      weeklyFacts(7, ctx),
      transactionFacts(0, ctx),
      draftFacts(ctx),
      tnfFacts(5, ctx),
      getWinProbabilities(5, ctx),
      rankedValues(),
    ]);
    const refs = ctx.rosters.map((r) => teamRef(ctx, r.roster_id));
    const odds: SimResult = {
      season: ctx.season,
      asOfWeek: 7,
      runs: 100,
      seed: 1,
      generatedAt: 0,
      placeholder: false,
      teams: refs.map((team) => ({ team, wins: 0, losses: 0, ties: 0, pointsFor: 0, meanPoints: 100, sdPoints: 25, expectedWins: 7, playoffPct: 60.4, byePct: 10.1, titlePct: 9.9, lastPlacePct: 5.2, firstPickPct: 4.7 })),
    };
    const power: PowerRankings = {
      season: ctx.season,
      asOfWeek: 7,
      formula: "x",
      placeholder: false,
      rows: refs.map((team, i) => ({ rank: i + 1, previousRank: i + 2, team, score: 1, allPlayWinPct: 0.5, allPlayWins: 1, allPlayLosses: 1, pointsPerGame: 100, projectedStrength: 100, wins: 1, losses: 1, luck: 0.4 })),
    };
    // Every clock length, so each clock key shows up.
    const picks = draft.picks.map((p, i) => ({ ...p, secondsOnClock: [30, 900, 7200][i % 3] }));
    const dctx: DraftContext = { picks, fc, pickTimerSeconds: 14400, rookieOnly: false };
    const ids = playerIds([weekly, tnf, tx], new Set());
    const byRoster = <T,>(v: T) => Object.fromEntries(refs.map((t) => [t.rosterId, v]));
    const memory: PayloadMemory = {
      draftSlots: Object.fromEntries([...ids].map((id) => [id, "1.01"])),
      rapSheet: byRoster(["Left 41.2 points on the bench (week 3)"]),
      loserCrowns: byRoster(2),
      playoffPctLastWeek: byRoster(55.5),
      winPctBefore: byRoster(48.3),
      onTheClock: { manager: refs[0].managerName, team: refs[0].teamName, hoursSoFar: 1.5 },
      draft: dctx,
    };
    const player = picks[0].player;
    const daily: DailyRoastFacts = {
      kind: "daily_roast",
      date: "2030-10-08",
      sinceMs: 0,
      trades: tx.trades,
      waivers: tx.waivers,
      injuries: [{ team: refs[0], player, status: "Out", previousStatus: null, isStarter: true }],
      lineupAlerts: [{ team: refs[1], player, slot: "WR", reason: "bye", kickoff: null }],
      draftPicks: picks.slice(0, 6),
      hasMaterial: true,
    };
    const payloads: unknown[] = [
      planWeekly({ kind: "weekly_roast", week: 7, weekly, odds, power }, memory).facts,
      planThursday({ kind: "thursday_fallout", week: 5, tnf, winProbs }, memory).facts,
      planDaily(daily, 250, memory, "faab").facts,
      planDaily(daily, 250, memory, "priority").facts,
      planDraftGrades({ kind: "draft_grades", draft: { ...draft, picks }, odds }, memory).facts,
      planItem("trade", tx.trades[0], 250, { draftSlots: memory.draftSlots }).facts,
      planItem("waiver", tx.waivers.slice(0, 3), 250, { waiverMode: "priority" }).facts,
      planItem("draft_pick", picks[12], 250, { picks, draft: dctx }).facts,
    ];
    const keys = new Set<string>();
    for (const p of payloads) collectKeys(p, "", keys);
    const glossary = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf("Glossary for FACTS keys:"), SYSTEM_PROMPT.indexOf("HARD RULES"));
    const missing = [...keys].filter((k) => !new RegExp(`(?<![A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\<>-]/g, "\\$&")}(?![A-Za-z0-9])`).test(glossary));
    expect(missing).toEqual([]);
    // Sanity: the new keys really are emitted.
    for (const k of ["benchMistake", "topStarter", "history", "draftedAt", "passedOn", "winPctBefore", "onTheClock", "waiverMode", "byPosition", "playoffPctLastWeek"]) {
      expect(keys.has(k)).toBe(true);
    }
  });
});
