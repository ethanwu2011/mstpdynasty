/**
 * Facts engine, hand-checked on hand-built inputs (no network, no fixtures). Every expected
 * number below was worked out by hand in the comments.
 */
import { describe, expect, it } from "vitest";
import { bestSwap, benchPointsLeft, flipSwapFor, swapCandidates, teamOptimal, zeroStarterReason, type TeamWeekInput } from "@/lib/facts/lineup";
import { draftGrade, ordinal, tradeGrade } from "@/lib/facts/util";
import { approxPickValue, buildTrade, buildWaivers, type LosingBidFact, type TransactionEnv } from "@/lib/facts/transactions";
import { autopausedMs, buildDraftPicks, clockSeconds, parsePickSeen, positionRunLengths, positionRuns, rosterForPick, slotForPick, verdictFor } from "@/lib/facts/draft";
import { streakOf, weekResults } from "@/lib/facts/weekly";
import { assembleShame, transactionShame } from "@/lib/facts/shame";
import type { FantasyCalcSnapshot, FantasyCalcValue, PlayersMap, SleeperDraft, SleeperMatchup } from "@/lib/types";
import { fakeCtx, tx } from "./facts-synthetic";

/* ------------------------------------------------------------------ */
/* lineup                                                              */
/* ------------------------------------------------------------------ */

const POS: Record<string, string[]> = {
  q1: ["QB"],
  q2: ["QB"],
  r1: ["RB"],
  r2: ["RB"],
  r3: ["RB"],
  w1: ["WR"],
  w2: ["WR"],
  w3: ["WR"],
  t1: ["TE"],
  t2: ["TE"],
};
const PTS: Record<string, number> = { q1: 20, q2: 25, r1: 10, r2: 18, r3: 7, w1: 12, w2: 3, w3: 15, t1: 6, t2: 9 };

function team(starters: string[]): TeamWeekInput {
  return {
    slots: ["QB", "RB", "WR", "WR", "TE", "FLEX"],
    starters,
    startersPoints: starters.map((id) => (id === "0" ? 0 : PTS[id])),
    players: Object.keys(PTS),
    playersPoints: PTS,
    positionsOf: (id) => POS[id] ?? [],
  };
}

describe("lineup math (hand-checked)", () => {
  // Started q1 20, r1 10, w1 12, w2 3, t1 6, FLEX r3 7 = 58.
  // Best: q2 25, r2 18, w3 15 + w1 12, t2 9, FLEX r1 10 = 89. Left on the bench: 31.
  const input = team(["q1", "r1", "w1", "w2", "t1", "r3"]);

  it("optimal lineup and bench points left", () => {
    const opt = teamOptimal(input);
    expect(opt.total).toBe(89);
    expect(benchPointsLeft(input, opt)).toBe(31);
  });

  it("best single swap is w3 (15) for w2 (3) at WR, +12", () => {
    const best = bestSwap(input)!;
    expect(best).toMatchObject({ benchId: "w3", starterId: "w2", slot: "WR", slotIndex: 3, gain: 12 });
    // r2 (18) into the FLEX for r3 (7) is next, +11.
    expect(swapCandidates(input)[1]).toMatchObject({ benchId: "r2", starterId: "r3", slot: "FLEX", gain: 11 });
  });

  it("never puts a player in a slot he cannot fill", () => {
    const bad = swapCandidates(input).filter((c) => c.benchId === "t2" && c.slot === "WR");
    expect(bad).toEqual([]);
    expect(swapCandidates(input).find((c) => c.benchId === "t2" && c.slot === "FLEX")?.gain).toBe(2);
  });

  it("flip swap needs a gain strictly larger than the margin", () => {
    expect(flipSwapFor(input, 11.5)?.benchId).toBe("w3");
    expect(flipSwapFor(input, 12)).toBeNull();
    expect(flipSwapFor(input, 30)).toBeNull();
  });

  it("an empty slot counts as zero for the swap", () => {
    const withHole = team(["q1", "r1", "w1", "w2", "0", "r3"]);
    expect(swapCandidates(withHole).find((c) => c.slot === "TE")).toMatchObject({ benchId: "t2", starterId: "0", gain: 9 });
    // TE slot filled by t2 (9) in the optimum: 89 again; started 52, so 37 left.
    expect(benchPointsLeft(withHole)).toBe(37);
  });

  it("zero-point starter reasons", () => {
    const base = { nflTeam: "KC", byeTeams: new Set(["KC"]), played: false, gameFinal: true, injuryStatus: null, points: 0 };
    expect(zeroStarterReason({ ...base, playerId: "0" })).toBe("empty_slot");
    expect(zeroStarterReason({ ...base, playerId: "x" })).toBe("bye");
    expect(zeroStarterReason({ ...base, playerId: "x", byeTeams: new Set(), injuryStatus: "Out", gameFinal: false })).toBe("out");
    expect(zeroStarterReason({ ...base, playerId: "x", byeTeams: new Set(), injuryStatus: "IR" })).toBe("ir");
    expect(zeroStarterReason({ ...base, playerId: "x", byeTeams: new Set() })).toBe("inactive");
    expect(zeroStarterReason({ ...base, playerId: "x", byeTeams: new Set(), played: true })).toBe("played_zero");
    expect(zeroStarterReason({ ...base, playerId: "x", byeTeams: new Set(), played: true, points: -1.2 })).toBeNull();
    expect(zeroStarterReason({ ...base, playerId: "x", byeTeams: new Set(), played: null, gameFinal: false })).toBeNull();
    expect(zeroStarterReason({ ...base, playerId: "x", points: 5 })).toBeNull();
  });
});

describe("results and streaks", () => {
  const m = (roster_id: number, matchup_id: number | null, points: number, custom: number | null = null): SleeperMatchup => ({
    roster_id,
    matchup_id,
    points,
    custom_points: custom,
    starters: [],
    starters_points: [],
    players: [],
    players_points: {},
  });

  it("pairs by matchup id, honors commissioner overrides, handles ties and byes", () => {
    const res = weekResults([m(1, 1, 100), m(2, 1, 90, 110), m(3, 2, 80), m(4, 2, 80), m(5, null, 50)]);
    expect(res.get(1)).toMatchObject({ result: "L", opponentRosterId: 2, opponentPoints: 110 });
    expect(res.get(2)).toMatchObject({ result: "W", points: 110 });
    expect(res.get(3)?.result).toBe("T");
    expect(res.get(5)).toMatchObject({ result: null, opponentRosterId: null });
  });

  it("streaks", () => {
    expect(streakOf([])).toBe("");
    expect(streakOf(["W", "L", "L", "L"])).toBe("3L");
    expect(streakOf(["L", "W"])).toBe("1W");
  });
});

/* ------------------------------------------------------------------ */
/* grades                                                              */
/* ------------------------------------------------------------------ */

describe("letter grades", () => {
  it("trade grades are symmetric around a fair band", () => {
    expect(tradeGrade(100, 100)).toBe("B");
    expect(tradeGrade(104, 100)).toBe("B"); // share 0.038, inside the 5% band
    expect(tradeGrade(106, 100)).toBe("B+"); // 6/106 = 0.057
    expect(tradeGrade(100, 106)).toBe("B-");
    expect(tradeGrade(130, 100)).toBe("A"); // 30/130 = 0.23
    expect(tradeGrade(100, 130)).toBe("C-");
    expect(tradeGrade(200, 100)).toBe("A+");
    expect(tradeGrade(100, 200)).toBe("F"); // exactly half the value gone
    expect(tradeGrade(0, 0)).toBe("B");
  });

  it("draft grades against the league mean", () => {
    expect(draftGrade(115, 100)).toBe("A+");
    expect(draftGrade(100, 100)).toBe("B");
    expect(draftGrade(80, 100)).toBe("D");
    expect(draftGrade(79, 100)).toBe("F");
  });

  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

/* ------------------------------------------------------------------ */
/* transactions                                                        */
/* ------------------------------------------------------------------ */

function fc(id: string, name: string, position: string, value: number, overallRank: number): FantasyCalcValue {
  return { sleeperId: id, name, position, team: null, age: 25, value, overallRank, positionRank: 1, redraftValue: 0, trend30Day: 0 };
}

const SNAP: FantasyCalcSnapshot = (() => {
  const vals = [
    fc("p1", "Marquise Oakes", "WR", 6000, 10),
    fc("p2", "Ron Talley", "RB", 3000, 40),
    fc("p3", "Deshawn Ruiz", "WR", 100, 390),
    fc("p4", "Colt Easley", "TE", 2000, 90),
    fc("FP_2031_1", "2031 1st", "PICK", 2000, 60),
    fc("FP_2031_2", "2031 2nd", "PICK", 900, 150),
  ];
  return { fetchedAt: 0, date: "2030-10-01", bySleeperId: Object.fromEntries(vals.map((v) => [v.sleeperId, v])), picks: vals.filter((v) => v.position === "PICK") };
})();

const PLAYERS: PlayersMap = Object.fromEntries(
  [
    ["p1", "Marquise Oakes", "WR"],
    ["p2", "Ron Talley", "RB"],
    ["p3", "Deshawn Ruiz", "WR"],
    ["p4", "Colt Easley", "TE"],
    ["p5", "Jalen Crane", "RB"],
    ["p6", "Case Whitfield", "QB"],
    ["p7", "Tre Holloway", "WR"],
  ].map(([id, name, pos]) => [id, { id, name, pos, positions: [pos], team: "KC", age: 25, years_exp: 3, injury_status: null, status: "Active" }]),
);

function env(faab = true): TransactionEnv {
  return { ctx: fakeCtx({ settings: { waiver_type: faab ? 2 : 0 } }), players: PLAYERS, snapFor: () => SNAP, faab };
}

describe("trades (hand-checked)", () => {
  // Kevin (1) gets Oakes 6000 + Rory's 2031 1st 2000 = 8000 and $5 FAAB goes out; Rory (2) gets Talley 3000.
  const t = buildTrade(
    tx({
      transaction_id: "t1",
      type: "trade",
      roster_ids: [2, 1],
      adds: { p1: 1, p2: 2 },
      drops: { p1: 2, p2: 1 },
      draft_picks: [{ season: "2031", round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 }],
      waiver_budget: [{ sender: 1, receiver: 2, amount: 5 }],
    }),
    env(),
  );

  it("values, nets and grades", () => {
    const [kevin, rory] = t.sides;
    expect(kevin.team.managerName).toBe("Kevin");
    expect(kevin).toMatchObject({ valueIn: 8000, valueOut: 3000, net: 5000, grade: "A+", faabOut: 5, faabIn: 0 });
    expect(rory).toMatchObject({ valueIn: 3000, valueOut: 8000, net: -5000, grade: "F", faabIn: 5 });
    expect(kevin.picksIn[0]).toMatchObject({ label: "2031 1st (via Rory's Army)", value: 2000, originalRosterId: 2 });
    expect(rory.picksOut).toHaveLength(1);
    expect(t.winnerRosterId).toBe(1);
    expect(t.valueGap).toBe(5000);
  });

  it("a fair trade has no winner", () => {
    // Talley (3000) for a 2031 1st + 2nd (2000 + 900 = 2900): share 100/3000 = 0.033, inside the band.
    const fair2 = buildTrade(
      tx({
        transaction_id: "t3",
        type: "trade",
        roster_ids: [1, 2],
        adds: { p2: 1 },
        drops: { p2: 2 },
        draft_picks: [
          { season: "2031", round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
          { season: "2031", round: 2, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
        ],
      }),
      env(),
    );
    expect(fair2.winnerRosterId).toBeNull();
    expect(fair2.sides.map((s) => s.grade)).toEqual(["B", "B"]);
  });

  it("values a pick FantasyCalc no longer lists like the nearest listed season", () => {
    expect(approxPickValue(SNAP, "2031", 1)).toBe(2000);
    expect(approxPickValue(SNAP, "2029", 2)).toBe(900);
    expect(approxPickValue(SNAP, "2031", 3)).toBeNull();
  });
});

describe("waivers (hand-checked)", () => {
  const run = 5_000;
  const txs = [
    tx({ transaction_id: "w1", type: "waiver", roster_ids: [3], adds: { p3: 3 }, drops: { p4: 3 }, settings: { waiver_bid: 38 }, status_updated: run }),
    tx({ transaction_id: "f1", type: "waiver", status: "failed", roster_ids: [4], adds: { p3: 4 }, settings: { waiver_bid: 4 }, status_updated: run, metadata: { notes: "This player was claimed by another owner." } }),
    tx({ transaction_id: "f2", type: "waiver", status: "failed", roster_ids: [2], adds: { p3: 2 }, settings: { waiver_bid: 50 }, status_updated: run, metadata: { notes: "Unfortunately, your roster will have too many players after this transaction." } }),
    tx({ transaction_id: "w2", type: "waiver", roster_ids: [1], adds: { p5: 1 }, settings: { waiver_bid: 1 }, status_updated: run }),
    tx({ transaction_id: "f3", type: "waiver", status: "failed", roster_ids: [4], adds: { p5: 4 }, settings: { waiver_bid: 0 }, status_updated: run, metadata: { notes: "This player was claimed by another owner." } }),
    tx({ transaction_id: "f4", type: "waiver", status: "failed", roster_ids: [2], adds: { p5: 2 }, settings: { waiver_bid: 7 }, status_updated: 9_999, metadata: { notes: "This player was claimed by another owner." } }),
    tx({ transaction_id: "fa1", type: "free_agent", roster_ids: [2], adds: { p6: 2 }, status_updated: 6_000 }),
    tx({ transaction_id: "w3", type: "waiver", roster_ids: [4], adds: { p7: 4 }, settings: { waiver_bid: 0 }, status_updated: run }),
  ];
  const facts = buildWaivers(txs, env());
  const byId = (id: string) => facts.find((w) => w.transactionId === id)!;

  it("keeps only completed moves, in time order", () => {
    expect(facts.map((w) => w.transactionId).sort()).toEqual(["fa1", "w1", "w2", "w3"]);
  });

  it("losing bids from the same run, with why they failed; overpay ignores roster-full bids", () => {
    const w1 = byId("w1");
    expect(w1.bid).toBe(38);
    expect((w1.losingBids as LosingBidFact[]).map((l) => [l.team.managerName, l.bid, l.reason])).toEqual([
      ["Rory", 50, "roster_full"],
      ["Wes", 4, "outbid"],
    ]);
    expect(w1.overpayBy).toBe(34);
    expect(w1.notableDrop).toBe(true);
    expect(w1.batchId).toBe("w-5000");
  });

  it("$0 bids: the losing one and the uncontested winning one", () => {
    const w2 = byId("w2");
    expect(w2.losingBids.map((l) => [l.team.managerName, l.bid])).toEqual([["Wes", 0]]); // f4 was another run
    expect(w2.overpayBy).toBe(1);
    const w3 = byId("w3");
    expect(w3).toMatchObject({ bid: 0, isZeroBid: true, overpayBy: null, losingBids: [] });
  });

  it("free agents have no bid and their own batch", () => {
    expect(byId("fa1")).toMatchObject({ type: "free_agent", bid: null, isZeroBid: false, batchId: "fa-fa1" });
  });

  it("without FAAB, bids are not facts", () => {
    const noFaab = buildWaivers(txs, env(false));
    expect(noFaab.find((w) => w.transactionId === "w3")).toMatchObject({ bid: null, isZeroBid: false, overpayBy: null });
  });

  it("shame: the $0 bid that lost, the $34 overpay, the trade that lost 5000", () => {
    const trade = buildTrade(
      tx({ transaction_id: "t1", type: "trade", roster_ids: [1, 2], adds: { p1: 1, p2: 2 }, drops: { p1: 2, p2: 1 }, draft_picks: [{ season: "2031", round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 }] }),
      env(),
    );
    const board = assembleShame(transactionShame("2030", { sinceMs: 0, untilMs: 1e13, trades: [trade], waivers: facts, placeholder: false }, 100));
    const heads = board.entries.map((e) => `${e.kind}|${e.team.managerName}|${e.headline}`);
    expect(heads).toEqual([
      "bad_trade|Rory|Lost 5,000 in FantasyCalc value in one trade",
      "zero_bid_lost|Wes|Bid $0 on Jalen Crane and lost to a $1 bid",
      "overpay|Priya|Paid $38 for Deshawn Ruiz when the next bid was $4",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* draft                                                               */
/* ------------------------------------------------------------------ */

describe("draft math (hand-checked)", () => {
  it("snake with a 3rd-round reversal", () => {
    const s = (n: number) => slotForPick(n, 10, "snake", 3).slot;
    expect([1, 10, 11, 20, 21, 30, 31, 40, 41].map(s)).toEqual([1, 10, 10, 1, 10, 1, 1, 10, 10]);
    expect(slotForPick(21, 10, "snake", 0).slot).toBe(1);
    expect(slotForPick(11, 10, "linear").slot).toBe(1);
    expect(slotForPick(34, 10, "snake", 3)).toEqual({ round: 4, pickInRound: 4, slot: 4 });
  });

  it("follows traded picks", () => {
    const draft = { season: "2030", type: "snake", settings: { teams: 10, rounds: 3, reversal_round: 3 }, slot_to_roster_id: { "1": 10, "10": 1 } } as unknown as SleeperDraft;
    const traded = [{ season: "2030", round: 2, roster_id: 10, owner_id: 3, previous_owner_id: 10 }];
    expect(rosterForPick(draft, 1, traded)).toBe(10);
    expect(rosterForPick(draft, 20, traded)).toBe(3); // round 2, slot 1 belongs to roster 10, traded to 3
    expect(rosterForPick(draft, 21, traded)).toBe(1); // round 3 reverses again: slot 10
  });

  it("position runs", () => {
    const pos = ["RB", "RB", "WR", "QB", "QB", "QB", "TE"];
    expect(positionRunLengths(pos)).toEqual([2, 2, 1, 3, 3, 3, 1]);
    expect(positionRuns(pos.map((position, i) => ({ pickNo: i + 1, position })))).toEqual([{ position: "QB", startPick: 4, length: 3 }]);
  });

  it("reads the tick's first-seen times ({ draftId: { pickNo: ms } }, or flat)", () => {
    expect([...parsePickSeen({ d1: { "3": 300, "4": 400 }, d2: { "1": 9 } }, "d1")]).toEqual([
      [3, 300],
      [4, 400],
    ]);
    expect([...parsePickSeen({ "7": 700, "8": { pickedAt: 800 } }, "d1")]).toEqual([
      [7, 700],
      [8, 800],
    ]);
    expect(parsePickSeen(null, "d1").size).toBe(0);
  });

  it("time on the clock skips the overnight autopause (UTC minutes, window may wrap midnight)", () => {
    const H = 3600_000;
    // MSTP: 180-840 UTC = 11 PM to 10 AM EDT.
    const mstp = { rounds: 34, teams: 10, autopause_enabled: 1, autopause_start_time: 180, autopause_end_time: 840 };
    const day = Date.UTC(2026, 8, 19);
    // Picked 10:30 PM EDT (02:30 UTC), next pick 10:30 AM EDT (14:30 UTC): 30 min before the pause, 30 after.
    expect(autopausedMs(day + 2.5 * H, day + 14.5 * H, mstp)).toBe(11 * H);
    expect(clockSeconds(day + 2.5 * H, day + 14.5 * H, mstp)).toBe(3600);
    // No pause enabled: wall time.
    expect(clockSeconds(day + 2.5 * H, day + 14.5 * H, { ...mstp, autopause_enabled: 0 })).toBe(12 * 3600);
    // A window that wraps midnight UTC (22:00 to 06:00), across two nights.
    const wrap = { rounds: 1, teams: 2, autopause_enabled: 1, autopause_start_time: 22 * 60, autopause_end_time: 6 * 60 };
    expect(autopausedMs(day + 20 * H, day + 24 * H + 23 * H, wrap)).toBe(8 * H + 1 * H);
    expect(clockSeconds(null, day, mstp)).toBeNull();
    expect(clockSeconds(day + H, day, mstp)).toBeNull();
  });

  it("reach thresholds scale with the pick", () => {
    expect(verdictFor(10, 2)).toBe("fair");
    expect(verdictFor(10, 3)).toBe("reach");
    expect(verdictFor(10, -3)).toBe("steal");
    expect(verdictFor(100, 15)).toBe("fair");
    expect(verdictFor(100, 20)).toBe("reach");
    expect(verdictFor(5, null)).toBe("unranked");
  });

  it("reach is positive when a player goes before his FantasyCalc rank", () => {
    const ctx = fakeCtx();
    const draft = { draft_id: "d1", season: "2030", type: "linear", status: "drafting", start_time: 0, settings: { teams: 4, rounds: 1, player_type: 0 }, slot_to_roster_id: null } as unknown as SleeperDraft;
    const picks = [
      { draft_id: "d1", pick_no: 1, round: 1, draft_slot: 1, roster_id: 1, picked_by: "u1", player_id: "p2", is_keeper: null, metadata: { position: "RB" } },
      { draft_id: "d1", pick_no: 2, round: 1, draft_slot: 2, roster_id: 2, picked_by: "u2", player_id: "p4", is_keeper: null, metadata: { position: "TE" } },
    ];
    const facts = buildDraftPicks({ ctx, draft, picks, traded: [], players: PLAYERS, snap: SNAP, seen: new Map([[1, 60_000], [2, 3_660_000]]) });
    // Talley is FantasyCalc #40 taken 1st: reach +39. Easley #90 at 2: reach +88.
    expect(facts[0]).toMatchObject({ fcRank: 40, reach: 39, verdict: "reach", secondsOnClock: 60, pickedAt: 60_000 });
    expect(facts[1]).toMatchObject({ fcRank: 90, reach: 88, secondsOnClock: 3600 });
  });
});
