import { describe, expect, it } from "vitest";
import { weekRoute } from "@/app/scores/_parts/week";

describe("/scores/[week]", () => {
  it("sends a week before the league's start week to the current scoreboard (it was never played)", () => {
    // This league: start_week 3. Sleeper still returns weeks 1 and 2, every team 0-0 with nobody started.
    expect(weekRoute("1", 3, 17)).toEqual({ kind: "before_start" });
    expect(weekRoute("2", 3, 17)).toEqual({ kind: "before_start" });
    expect(weekRoute("3", 3, 17)).toEqual({ kind: "week", week: 3 });
    expect(weekRoute("17", 3, 17)).toEqual({ kind: "week", week: 17 });
  });

  it("anything else is not found", () => {
    for (const raw of ["0", "18", "abc", "3a", "100"]) expect(weekRoute(raw, 3, 17)).toEqual({ kind: "not_found" });
  });
});
