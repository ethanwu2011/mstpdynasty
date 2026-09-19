/**
 * ESPN scoreboard, used ONLY for live game status, period and clock (fraction of each
 * NFL game remaining). Undocumented, so parsed defensively.
 */
import { z } from "zod";
import { fetchJson } from "./http";
import type { NflGameClock } from "./types";

export const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** Live scores need to be fresh. */
export const ESPN_REVALIDATE = 30;

const QUARTER_SECONDS = 15 * 60;
const GAME_SECONDS = 4 * QUARTER_SECONDS;

/** ESPN -> Sleeper team abbreviations (only WSH differs today). */
const TEAM_FIX: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
export const toSleeperTeam = (abbr: string) => TEAM_FIX[abbr] ?? abbr;

export function espnScoreboardUrl(opts: { season?: string | number; week?: number; seasonType?: number } = {}): string {
  const params = new URLSearchParams();
  if (opts.season !== undefined) params.set("dates", String(opts.season));
  if (opts.week !== undefined) params.set("week", String(opts.week));
  if (opts.week !== undefined || opts.seasonType !== undefined) params.set("seasontype", String(opts.seasonType ?? 2));
  const q = params.toString();
  return q ? `${ESPN_SCOREBOARD}?${q}` : ESPN_SCOREBOARD;
}

const CompetitorSchema = z.looseObject({
  homeAway: z.string(),
  score: z.union([z.string(), z.number()]).optional().nullable(),
  team: z.looseObject({ abbreviation: z.string() }),
});

const StatusSchema = z.looseObject({
  clock: z.number().optional().nullable(),
  period: z.number().optional().nullable(),
  type: z.looseObject({
    state: z.string(),
    name: z.string().optional().nullable(),
    completed: z.boolean().optional().nullable(),
    shortDetail: z.string().optional().nullable(),
    detail: z.string().optional().nullable(),
  }),
});

const EventSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  date: z.string(),
  week: z.looseObject({ number: z.number() }).optional().nullable(),
  status: StatusSchema,
  competitions: z.array(z.looseObject({ competitors: z.array(CompetitorSchema) })).min(1),
});

/** Fraction of regulation remaining: 1 before kickoff, 0 when final or in overtime. */
export function fractionRemaining(state: "pre" | "in" | "post", period: number, clockSeconds: number): number {
  if (state === "pre") return 1;
  if (state === "post") return 0;
  if (period > 4) return 0;
  const p = Math.max(1, period);
  const remaining = (4 - p) * QUARTER_SECONDS + Math.max(0, Math.min(QUARTER_SECONDS, clockSeconds));
  return Math.max(0, Math.min(1, remaining / GAME_SECONDS));
}

export function parseScoreboard(payload: unknown): NflGameClock[] {
  const events = (payload as { events?: unknown[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: NflGameClock[] = [];
  for (const raw of events) {
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    const comps = e.competitions[0].competitors;
    const home = comps.find((c) => c.homeAway === "home");
    const away = comps.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const stateRaw = e.status.type.state;
    const state: NflGameClock["state"] = stateRaw === "in" || stateRaw === "post" ? stateRaw : "pre";
    const period = e.status.period ?? 0;
    const clockSeconds = e.status.clock ?? 0;
    out.push({
      espnId: e.id,
      week: e.week?.number ?? null,
      home: toSleeperTeam(home.team.abbreviation),
      away: toSleeperTeam(away.team.abbreviation),
      kickoff: Date.parse(e.date),
      state,
      period,
      clockSeconds,
      fractionRemaining: fractionRemaining(state, period, clockSeconds),
      homeScore: Number(home.score ?? 0) || 0,
      awayScore: Number(away.score ?? 0) || 0,
      detail: e.status.type.shortDetail ?? e.status.type.detail ?? "",
    });
  }
  return out.sort((a, b) => a.kickoff - b.kickoff);
}

/**
 * Game clocks for a week. No args = ESPN's current week.
 * Pass `season` for past seasons (fixtures cover 2025 weeks 1-17).
 */
export async function getGameClocks(opts: { season?: string | number; week?: number } = {}): Promise<NflGameClock[]> {
  const payload = await fetchJson(espnScoreboardUrl(opts), { revalidate: ESPN_REVALIDATE, tags: ["espn"] });
  return parseScoreboard(payload);
}

/** Sleeper team abbreviation -> fraction of that team's game remaining. Teams not playing are absent. */
export function fractionRemainingByTeam(clocks: NflGameClock[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of clocks) {
    out[g.home] = g.fractionRemaining;
    out[g.away] = g.fractionRemaining;
  }
  return out;
}
