/**
 * Shared test helpers for fixture-backed tests. vitest.config.ts sets DATA_SOURCE=fixtures,
 * so every lib/sleeper.ts, lib/fantasycalc.ts and lib/espn.ts call replays fixtures/.
 * Run `npm run fixtures` once before `npm test`.
 */
import { existsSync, readFileSync } from "node:fs";
import { fixturesDir } from "@/lib/http";

export interface FixtureManifest {
  fetchedAt: string;
  rt: { leagueId: string; name: string; season: string; draftIds: string[] };
  scoringCheck: Array<{ leagueId: string; season: string }>;
  mstp: { leagueId: string; name: string; season: string; draftId: string | null; currentWeek: number };
  weeks: { matchups: number[]; transactions: number[]; stats: number[]; projections: number[] };
  nflState: { season: string; week: number };
}

const manifestPath = () => `${fixturesDir()}/manifest.json`;

export function hasFixtures(): boolean {
  return existsSync(manifestPath());
}

export function loadManifest(): FixtureManifest {
  if (!hasFixtures()) throw new Error("fixtures/manifest.json missing: run `npm run fixtures`");
  return JSON.parse(readFileSync(manifestPath(), "utf8")) as FixtureManifest;
}

/** Dev fixture league (completed 2025 season) league id. */
export function rtLeagueId(): string {
  return loadManifest().rt.leagueId;
}

/** Point LEAGUE_ID at the RT league for code that calls getLeagueContext() with no args. */
export function useRtLeague(): string {
  const id = rtLeagueId();
  process.env.LEAGUE_ID = id;
  return id;
}
