import { describe, expect, it } from "vitest";
import { clockClaimsIn, streakClaims } from "@/lib/roast/postcheck";

describe("post-check false positives seen in production", () => {
  it("does not read an ordinal round or position count as time on the clock", () => {
    expect(clockClaimsIn("Alex, Navid and Carlos spent the end of the second round handing receivers back and forth.")).toEqual([]);
    expect(clockClaimsIn("He used his second pick on a tight end.")).toEqual([]);
    expect(clockClaimsIn("Anish took a second receiver at 4.06.")).toEqual([]);
  });
  it("still catches real clock-duration claims", () => {
    expect(clockClaimsIn("Justin took 12 minutes to make the obvious pick.")).not.toEqual([]);
    expect(clockClaimsIn("Carlos spent three hours on that.")).not.toEqual([]);
    expect(clockClaimsIn("He sat on the clock for two hours.")).not.toEqual([]);
  });
  it("treats a run of one position as a run, not a win or loss streak", () => {
    expect(streakClaims("Malik Nabers was the fifth straight receiver off the board.")).toEqual([]);
    expect(streakClaims("That made it three consecutive quarterbacks.")).toEqual([]);
  });
  it("still sees real streak claims", () => {
    expect(streakClaims("Wes has lost four straight.")).toEqual([4]);
    expect(streakClaims("That was his third straight loss.")).toEqual([3]);
  });
});
