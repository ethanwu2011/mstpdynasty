import type { LeagueContext, SeasonPhase } from "@/lib/types";

const PHASES: readonly SeasonPhase[] = ["pre_draft", "drafting", "in_season", "offseason", "complete"];

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The phase a page should render. In development only, `?phase=drafting` (or any SeasonPhase)
 * previews another phase's layout on the current data, e.g. the RT fixture league's finished
 * draft as if it were live. Production always uses ctx.phase.
 */
export async function pagePhase(ctx: LeagueContext, searchParams?: SearchParams): Promise<SeasonPhase> {
  if (process.env.NODE_ENV !== "development" || !searchParams) return ctx.phase;
  const raw = (await searchParams).phase;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PHASES.includes(value as SeasonPhase) ? (value as SeasonPhase) : ctx.phase;
}

/** Run a data call; on any failure return the fallback so one bad source never breaks a page. */
export async function safe<T>(work: Promise<T> | (() => Promise<T>), fallback: T, what = "data"): Promise<T> {
  try {
    return await (typeof work === "function" ? work() : work);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error(`[ui] ${what} failed:`, err);
    return fallback;
  }
}
