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
