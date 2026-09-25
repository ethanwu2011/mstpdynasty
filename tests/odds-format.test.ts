import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { pctText } from "@/app/_lib/odds-board";
import { oddsOrder, tablePct } from "@/lib/roast/format";
import { isTransientError } from "@/lib/roast/llm";
import { pct1FromHome } from "@/lib/roast/plan";
import { oddsRows } from "@/lib/roast/surface-rows";
import { currentLines } from "@/lib/roast/surfaces";
import type { SimResult, SurfaceRow, TeamRef } from "@/lib/types";

const team = (id: number, name: string): TeamRef => ({ rosterId: id, teamName: name, managerName: name, managerKey: name.toLowerCase() });
const odds = (teams: Array<{ t: TeamRef; title: number; playoff: number; ew?: number }>): SimResult => ({
  season: "2026",
  asOfWeek: 4,
  runs: 10_000,
  seed: 1,
  generatedAt: 0,
  placeholder: false,
  teams: teams.map(({ t, title, playoff, ew }) => ({ team: t, wins: 2, losses: 2, ties: 0, pointsFor: 400, meanPoints: 120, sdPoints: 20, expectedWins: ew ?? 7, playoffPct: playoff, byePct: 10, titlePct: title, lastPlacePct: 5, firstPickPct: 4 })),
});

describe("odds as the tables print them", () => {
  it("prints the same digit as the board and never a certainty the sims did not produce", () => {
    for (let k = 1; k < 10_000; k++) {
      const v = k / 100;
      const shown = pctText(v);
      const n = tablePct(v);
      if (shown === "<0.1") expect(n, String(v)).toBe(0.1);
      else if (shown === ">99.9") expect(n, String(v)).toBe(99.9);
      else expect(n.toFixed(1), String(v)).toBe(shown);
    }
    expect(tablePct(0)).toBe(0);
    expect(tablePct(100)).toBe(100);
  });

  it("ranks odds rows in the board's order (title as shown, then playoffs as shown, then name)", () => {
    const bob = team(1, "Bob");
    const cal = team(2, "Cal");
    const rows = oddsRows(odds([{ t: bob, title: 0.34, playoff: 10.2, ew: 9 }, { t: cal, title: 0.26, playoff: 22.5, ew: 8 }]));
    expect([...rows].sort((a, b) => Number(a.facts.rank) - Number(b.facts.rank)).map((r) => r.managers[0])).toEqual(["Cal", "Bob"]);
    const board = [...odds([{ t: bob, title: 0.34, playoff: 10.2 }, { t: cal, title: 0.26, playoff: 22.5 }]).teams].sort(oddsOrder);
    expect(board.map((t) => t.team.managerName)).toEqual(["Cal", "Bob"]);
  });
});

describe("win chances of a game still being played", () => {
  it("never read 100 to 0 while it is live, and do once it is final", () => {
    expect([pct1FromHome(99.99, true), pct1FromHome(99.99, false)]).toEqual([99.9, 0.1]);
    expect([pct1FromHome(0.01, true), pct1FromHome(0.01, false)]).toEqual([0.1, 99.9]);
    expect([pct1FromHome(100, true, false), pct1FromHome(100, false, false)]).toEqual([100, 0]);
  });
});

describe("billing trouble is retried, not counted against the item", () => {
  const err = (status: number, message: string) => Anthropic.APIError.generate(status, { error: { type: "invalid_request_error", message } }, message, new Headers());
  it("a 402, or a 400 about credits or limits, is transient; an ordinary 400 is not", () => {
    expect(isTransientError(err(402, "payment required"))).toBe(true);
    expect(isTransientError(err(400, "Your credit balance is too low to access the Anthropic API."))).toBe(true);
    expect(isTransientError(err(400, "You have reached your specified workspace API usage limits."))).toBe(true);
    expect(isTransientError(err(400, "messages: at least one message is required"))).toBe(false);
  });
});

describe("ranks in a line must match exactly, however they are written", () => {
  const row = (facts: Record<string, unknown>): SurfaceRow => ({ id: "4", managers: ["Dan"], facts: { manager: "Dan", ...facts } });
  it('"No. 3" and "#3" are not kept by a 2.6 elsewhere in the row', () => {
    const rows = [row({ rank: 4, titlePct: 8.3, lastPct: 2.6, expectedWins: 7.4 })];
    expect(currentLines({ "4": "Dan sits No. 3 in the title race." }, rows)["4"]).toBeUndefined();
    expect(currentLines({ "4": "Dan sits #3 in the title race." }, rows)["4"]).toBeUndefined();
    expect(currentLines({ "4": "Dan sits No. 4 in the title race." }, rows)["4"]).toBe("Dan sits No. 4 in the title race.");
  });
});
