/**
 * One FantasyCalc rank per pick: the rank frozen when the tick first saw it (or the one its
 * write-up states), so the card heading, receipt, board chip, strip and the write-up agree after
 * FantasyCalc moves. Also: team names never repeat the first name, one odds order everywhere,
 * and the issue jobs skip a period the old job keys already finished.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cardData } from "@/app/draft/_board/card";
import type { BoardCell } from "@/app/draft/_board/model";
import { oddsOrder } from "@/app/_lib/odds-board";
import { pickStat, pickVerdict } from "@/app/_lib/roast-view";
import { roastIds, saveRoast } from "@/lib/archive";
import { buildDraftPicks, DRAFT_PICK_RANKS, parsePickRanks, withFrozenRank } from "@/lib/facts/draft";
import { freezeDraftPickRanks } from "@/lib/jobs/draft-seen";
import { legacyJobKey, runIssueJob } from "@/lib/jobs/issues";
import { markDone } from "@/lib/jobs/once";
import { managerAndTeam, teamSubtitle } from "@/lib/names";
import { pickFactsOnly } from "@/lib/roast/items";
import * as store from "@/lib/store";
import type { DraftPickFact, FantasyCalcSnapshot, FantasyCalcValue, PlayersMap, SleeperDraft, TeamRef } from "@/lib/types";
import { fakeCtx } from "./facts-synthetic";

beforeEach(() => {
  store.resetStoreForTests();
});

function fc(id: string, name: string, position: string, overallRank: number, positionRank: number): FantasyCalcValue {
  return { sleeperId: id, name, position, team: null, age: 25, value: 5000 - overallRank * 10, overallRank, positionRank, redraftValue: 0, trend30Day: 0 };
}

function snapshot(date: string, ranks: Record<string, [number, number]>): FantasyCalcSnapshot {
  const vals = [fc("p1", "Tet McMillan", "WR", ...ranks.p1), fc("p2", "Ron Talley", "RB", ...ranks.p2)];
  return { fetchedAt: 0, date, bySleeperId: Object.fromEntries(vals.map((v) => [v.sleeperId, v])), picks: [] };
}

const PLAYERS: PlayersMap = Object.fromEntries(
  [
    ["p1", "Tet McMillan", "WR"],
    ["p2", "Ron Talley", "RB"],
  ].map(([id, name, pos]) => [id, { id, name, pos, positions: [pos], team: "CAR", age: 23, years_exp: 1, injury_status: null, status: "Active" }]),
);

const DRAFT = {
  draft_id: "d1",
  season: "2030",
  type: "linear",
  status: "drafting",
  start_time: 0,
  settings: { teams: 4, rounds: 8, player_type: 0 },
  slot_to_roster_id: null,
} as unknown as SleeperDraft;

// Pick 31 (8.03) took McMillan, FantasyCalc 38th on the day: a reach of 7. The next day he is 39th.
const PICKS = [{ draft_id: "d1", pick_no: 31, round: 8, draft_slot: 3, roster_id: 1, picked_by: "u1", player_id: "p1", is_keeper: null, metadata: { position: "WR" } }];
const DAY1 = snapshot("2030-09-18", { p1: [38, 12], p2: [60, 20] });
const DAY2 = snapshot("2030-09-19", { p1: [39, 13], p2: [61, 21] });

function picksOn(snap: FantasyCalcSnapshot, ranks?: ReturnType<typeof parsePickRanks>): DraftPickFact[] {
  return buildDraftPicks({ ctx: fakeCtx(), draft: DRAFT, picks: PICKS, traded: [], players: PLAYERS, snap, seen: new Map(), ranks });
}

function cell(p: DraftPickFact, text: string): BoardCell {
  const c: BoardCell = {
    pickNo: p.pickNo,
    round: p.round,
    pickInRound: p.pickInRound,
    slot: p.pickInRound,
    label: `${p.round}.${String(p.pickInRound).padStart(2, "0")}`,
    columnRosterId: p.team.rosterId,
    ownerRosterId: p.team.rosterId,
    ownerName: p.team.managerName,
    columnName: p.team.managerName,
    traded: false,
    state: "made",
    pick: p,
    roast: { id: roastIds.pick("d1", p.pickNo), kind: "draft_pick", leagueId: "test-league", rosterIds: [p.team.rosterId], text, facts: p, source: "facts_only", model: null, createdAt: 0, usage: null },
    latest: false,
  };
  return c;
}

describe("a pick keeps the FantasyCalc rank it was first seen with", () => {
  it("the card agrees with its own write-up after FantasyCalc moves", async () => {
    const ctx = fakeCtx();
    // Day 1: the tick sees the pick, freezes its ranks and writes it up.
    const [day1] = picksOn(DAY1);
    expect(day1).toMatchObject({ fcRank: 38, fcPositionRank: 12, reach: 7, verdict: "reach" });
    const frozen = await freezeDraftPickRanks(ctx.leagueId, "d1", [day1]);
    const writeUp = pickFactsOnly(withFrozenRank(day1, frozen.get(31)));
    expect(writeUp).toContain("FantasyCalc rank 38, a reach of 7 spots.");

    // Day 2: today's snapshot says 39th, but the pick still reads 38th everywhere.
    expect(picksOn(DAY2)[0]).toMatchObject({ fcRank: 39, reach: 8 }); // what an unfrozen read would say
    const stored = parsePickRanks(await store.get(store.keys.snapshot(ctx.leagueId, DRAFT_PICK_RANKS)), "d1");
    const [day2] = picksOn(DAY2, stored);
    expect(day2).toMatchObject({ fcRank: 38, fcPositionRank: 12, reach: 7, verdict: "reach" });

    const card = cardData(cell(day2, writeUp), false)!;
    expect(card.stat).toBe("Reached 7 spots");
    expect(card.receipt).toContainEqual({ label: "FC rank", value: "38th" });
    expect(card.receipt).toContainEqual({ label: "Position rank", value: "WR12" });
    expect(card.receipt).toContainEqual({ label: "Vs FantasyCalc", value: pickVerdict(day2) });
    expect(pickVerdict(day2)).toBe("Reach, 7");
    expect(pickStat(day2)).toBe("Reached 7 spots");
    expect(card.text).toContain("FantasyCalc rank 38, a reach of 7 spots.");
  });

  it("a pick already written up freezes the ranks its write-up states, and a frozen rank never changes", async () => {
    const ctx = fakeCtx();
    const [day1] = picksOn(DAY1);
    // Written on day 1, before this code froze anything: the text says 38th.
    await saveRoast({ id: roastIds.pick("d1", 31), kind: "draft_pick", leagueId: ctx.leagueId, rosterIds: [1], text: pickFactsOnly(day1), facts: day1, source: "facts_only", model: null, createdAt: 0, usage: null });
    // The first freeze runs on day 2, with today's 39th in hand.
    const [day2live] = picksOn(DAY2);
    expect((await freezeDraftPickRanks(ctx.leagueId, "d1", [day2live])).get(31)).toEqual({ fcRank: 38, fcPositionRank: 12 });
    // A later freeze with yet another rank changes nothing.
    const moved = { ...day2live, fcRank: 45, fcPositionRank: 15 };
    expect((await freezeDraftPickRanks(ctx.leagueId, "d1", [moved])).get(31)).toEqual({ fcRank: 38, fcPositionRank: 12 });
  });

  it("an unranked pick stays unranked, and malformed stored values are ignored", () => {
    const [p] = picksOn(DAY1);
    expect(withFrozenRank(p, { fcRank: null, fcPositionRank: null })).toMatchObject({ fcRank: null, reach: null, verdict: "unranked" });
    expect(parsePickRanks({ d1: { "31": "x", nope: { fcRank: 4 }, "32": { fcRank: 40, fcPositionRank: -1 } } }, "d1")).toEqual(new Map([[32, { fcRank: 40, fcPositionRank: null }]]));
    expect(parsePickRanks(null, "d1").size).toBe(0);
  });
});

describe("team names never repeat the first name", () => {
  it("shows a team name only when the team has its own", () => {
    expect(teamSubtitle("Carlos", "Carlos")).toBeNull();
    expect(teamSubtitle("carlos ", "Carlos")).toBeNull();
    expect(teamSubtitle("", "Carlos")).toBeNull();
    expect(teamSubtitle("Pot Roast", "Carlos")).toBe("Pot Roast");
    expect(managerAndTeam("Ethan", "Ethan")).toBe("Ethan");
    expect(managerAndTeam("Ethan", "Kicker Club", ": ")).toBe("Ethan: Kicker Club");
  });
});

describe("one odds order", () => {
  const t = (name: string, rosterId: number): TeamRef => ({ rosterId, teamName: name, managerName: name, managerKey: name.toLowerCase() });
  it("title as shown, then playoffs as shown, then the unrounded numbers", () => {
    const rows = [
      { team: t("Devante", 1), titlePct: 8.24, playoffPct: 54.8 },
      { team: t("Ethan", 2), titlePct: 8.16, playoffPct: 55.6 },
      { team: t("Alex", 3), titlePct: 15.7, playoffPct: 73.2 },
    ];
    expect([...rows].sort(oddsOrder).map((r) => r.team.managerName)).toEqual(["Alex", "Ethan", "Devante"]);
  });
});

describe("the issue rename does not resend a finished period", () => {
  it("maps the new job keys to the old ones", () => {
    expect(legacyJobKey("daily:2026-09-19")).toBe("daily_roast:2026-09-19");
    expect(legacyJobKey("weekly_recap:2026:3")).toBe("weekly_roast:2026:3");
    expect(legacyJobKey("thursday_fallout:2026:3")).toBeNull();
    expect(legacyJobKey("draft_grades:d1")).toBeNull();
  });

  it("skips a Week N Recap the old weekly_roast job already finished", async () => {
    const ctx = fakeCtx();
    await markDone(ctx.leagueId, "weekly_roast:2030:3", { at: 1, slug: "2030-09-29-weekly-roast" });
    const out = await runIssueJob({ job: "weekly_recap", key: "weekly_recap:2030:3", week: 3 }, ctx, Date.UTC(2030, 8, 29, 12), []);
    expect(out).toMatchObject({ job: "weekly_recap", status: "skipped" });
    expect(out.detail).toContain("before the issue rename");
  });
});
