/** Reading the stored one-liners for a stat surface. Pages only ever read; the jobs write. */
import { getSurfaceLines } from "@/lib/roast";
import type { LeagueContext, RoastSurface, SurfaceLineMap } from "@/lib/types";
import { safe } from "./phase";

/** A surface's stored one-liners, or none. A store read only: a render never waits on the writer. */
export function surfaceLinesFor(ctx: LeagueContext, surface: RoastSurface, key: string): Promise<SurfaceLineMap> {
  return safe(getSurfaceLines(surface, key, ctx), {} as SurfaceLineMap, `${surface} lines`);
}
