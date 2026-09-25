import { describe, expect, it } from "vitest";
import { currentLines } from "@/lib/roast";
import type { SurfaceRow } from "@/lib/types";

const row = (id: string, manager: string, facts: Record<string, unknown>): SurfaceRow =>
  ({ id, managers: [manager], facts: { manager, ...facts } }) as unknown as SurfaceRow;

describe("currentLines hides lines whose numbers went stale", () => {
  const rows = [
    row("1", "Carlos", { playoffPct: 47.7, titlePct: 6.1, lastPlacePct: 15.2 }),
    row("2", "Brandon", { playoffPct: 60.3, titlePct: 11.0, lastPlacePct: 7.9 }),
  ];
  it("keeps a line whose numbers still match", () => {
    const out = currentLines({ "1": "Carlos sits at 47.7% for the playoffs and still thinks he drafted well." }, rows);
    expect(out["1"]).toBeTruthy();
  });
  it("drops a line quoting old odds for its own manager", () => {
    const out = currentLines({ "1": "Carlos is propped up to 51% playoff odds and knows it." }, rows);
    expect(out["1"]).toBeUndefined();
  });
  it("keeps a comparison with another named manager's current number", () => {
    const out = currentLines({ "1": "Carlos is 15.2% to finish last while Brandon sits at 11% to win it all." }, rows);
    expect(out["1"]).toBeTruthy();
  });
});

describe("currentLines tolerates small drift", () => {
  const rows = [row("1", "Justin", { playoffPct: 65.8, titlePct: 11.7, lastPlacePct: 4.1, projectedPoints: 183.8, projRank: 2 })];
  it("keeps 66% and 12% when the row says 65.8 and 11.7", () => {
    expect(currentLines({ "1": "Justin reaches the playoffs 66% of the time and wins it 12%." }, rows)["1"]).toBeTruthy();
  });
  it("keeps a line that drifted a point or two", () => {
    expect(currentLines({ "1": "Justin is 64% to make it and still acts like it is 100% his." }, [row("1", "Justin", { playoffPct: 65.8, titlePct: 100 })])["1"]).toBeTruthy();
  });
  it("hides a line whose rank is wrong now", () => {
    expect(currentLines({ "1": "Justin has the 3rd-best lineup and a 12% title shot." }, rows)["1"]).toBeUndefined();
  });
});

describe("currentLines reads numbers the way lines write them", () => {
  it("reads a comma number whole: 5,400 is 5400, not 5 and 400", () => {
    const rows = [row("1", "Carlos", { totalValue: 5400, valueRank: 3 })];
    expect(currentLines({ "1": "Carlos has a roster worth 5,400 and a trophy case worth nothing." }, rows)["1"]).toBeTruthy();
    expect(currentLines({ "1": "Carlos has a roster worth 6,400 and a trophy case worth nothing." }, rows)["1"]).toBeUndefined();
  });

  it("reads comma numbers inside string facts whole too", () => {
    const rows = [row("1", "Carlos", { deal: "gave up 6,120 in value for 4,290" })];
    expect(currentLines({ "1": "Carlos gave away 6120 in value and called it a win." }, rows)["1"]).toBeTruthy();
    expect(currentLines({ "1": "Carlos gave away 6,120 in value and called it a win." }, rows)["1"]).toBeTruthy();
  });

  it("keeps a whole number that rounds a decimal fact (612 for 612.34), and still hides one that does not", () => {
    const rows = [row("1", "Carlos", { pointsFor: 612.34, rank: 4 })];
    expect(currentLines({ "1": "Carlos has scored 612 points and has nothing to show for it." }, rows)["1"]).toBeTruthy();
    expect(currentLines({ "1": "Carlos has scored 611 points and has nothing to show for it." }, rows)["1"]).toBeUndefined();
  });
});

describe("currentLines rounds only amounts of 10 and up, never a rank", () => {
  const rows = [row("1", "Carlos", { luck: 2.6, pointsPerGame: 10.4, pointsFor: 612.34 })];

  it('"3rd" is not kept by a 2.6 luck value, while "612" for 612.34 is', () => {
    expect(currentLines({ "1": "Carlos is 3rd in luck and still complains about it." }, rows)["1"]).toBeUndefined();
    expect(currentLines({ "1": "Carlos has scored 612 points and has nothing to show for it." }, rows)["1"]).toBeTruthy();
  });

  it("an ordinal of 10 or more is not a rounded amount either (10th is not 10.4)", () => {
    expect(currentLines({ "1": "Carlos is 10th and acting like a contender." }, rows)["1"]).toBeUndefined();
  });

  it("a line may round a small amount the way the post-check lets it (3 wins of luck for 2.6), but never an ordinal", () => {
    expect(currentLines({ "1": "Carlos has 3 wins of pure luck." }, rows)["1"]).toBe("Carlos has 3 wins of pure luck.");
    expect(currentLines({ "1": "Carlos sits 3rd and knows it." }, rows)["1"]).toBeUndefined();
  });
});

describe("negative facts", () => {
  const rows = [row("1", "Dan", { rank: 8, record: "1-5", luck: -2.6 })];
  it("a line quoting bad luck without its sign, or with it, is still true", () => {
    expect(currentLines({ "1": "Dan is 1-5 with 2.6 wins of bad luck and still blames the schedule." }, rows)["1"]).toBeTruthy();
    expect(currentLines({ "1": "Dan has a luck score of -2.6 and a 1-5 record to match." }, rows)["1"]).toBeTruthy();
  });
});
