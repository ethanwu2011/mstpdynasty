/**
 * Typed Sleeper client.
 *
 * v1 (documented): league, users, rosters, matchups, transactions, traded picks, brackets,
 * drafts, draft, draft picks, draft traded picks, NFL state, players, user leagues.
 * Undocumented (parsed defensively with zod): weekly stats, weekly projections, schedule.
 *
 * Caching:
 *   - Small payloads go through the Next data cache with the per-endpoint REVALIDATE values.
 *   - Stats, projections and players are too big for the Next data cache (2 MB cap), so they
 *     are fetched with no-store, trimmed, and cached in an in-process memo plus the KV store.
 *   - In fixture mode (DATA_SOURCE=fixtures) everything reads from fixtures/ and the KV
 *     caches are bypassed.
 */
import { z } from "zod";
import { fetchJson, isFixtureMode } from "./http";
import * as store from "./store";
import type {
  NflGame,
  NflState,
  PlayerInfo,
  PlayersMap,
  SleeperBracketMatch,
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperTradedPick,
  SleeperTransaction,
  SleeperUser,
  StatLine,
  WeekStats,
} from "./types";

export const SLEEPER_API = "https://api.sleeper.app";
const V1 = `${SLEEPER_API}/v1`;

/** Positions this league can roster. Stats/projections/players are trimmed to these. */
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
const FANTASY_POSITION_SET = new Set<string>(FANTASY_POSITIONS);
export const PROJECTION_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/** Next data cache lifetimes, seconds. */
export const REVALIDATE = {
  league: 120,
  users: 600,
  rosters: 60,
  matchups: 60,
  transactions: 120,
  tradedPicks: 600,
  brackets: 600,
  drafts: 600,
  draft: 60,
  draftPicks: 30,
  state: 300,
  userLeagues: 3600,
  schedule: 6 * 3600,
} as const;

/** KV / memo lifetimes for the big trimmed payloads, seconds. */
export const TRIMMED_TTL = {
  statsLive: 60,
  statsPast: 24 * 3600,
  projectionsLive: 3600,
  projectionsPast: 7 * 24 * 3600,
  /** /players/nfl is fetched at most once per this window. */
  players: 24 * 3600,
} as const;

/** Every URL the app uses. The fixture script uses the same builders. */
export const sleeperUrl = {
  league: (leagueId: string) => `${V1}/league/${leagueId}`,
  users: (leagueId: string) => `${V1}/league/${leagueId}/users`,
  rosters: (leagueId: string) => `${V1}/league/${leagueId}/rosters`,
  matchups: (leagueId: string, week: number) => `${V1}/league/${leagueId}/matchups/${week}`,
  transactions: (leagueId: string, week: number) => `${V1}/league/${leagueId}/transactions/${week}`,
  tradedPicks: (leagueId: string) => `${V1}/league/${leagueId}/traded_picks`,
  winnersBracket: (leagueId: string) => `${V1}/league/${leagueId}/winners_bracket`,
  losersBracket: (leagueId: string) => `${V1}/league/${leagueId}/losers_bracket`,
  drafts: (leagueId: string) => `${V1}/league/${leagueId}/drafts`,
  draft: (draftId: string) => `${V1}/draft/${draftId}`,
  draftPicks: (draftId: string) => `${V1}/draft/${draftId}/picks`,
  draftTradedPicks: (draftId: string) => `${V1}/draft/${draftId}/traded_picks`,
  state: () => `${V1}/state/nfl`,
  players: () => `${V1}/players/nfl`,
  user: (userIdOrName: string) => `${V1}/user/${userIdOrName}`,
  userLeagues: (userId: string, season: string | number) => `${V1}/user/${userId}/leagues/nfl/${season}`,
  stats: (season: string | number, week: number) => `${SLEEPER_API}/stats/nfl/${season}/${week}?season_type=regular`,
  projections: (season: string | number, week: number) =>
    `${SLEEPER_API}/projections/nfl/${season}/${week}?season_type=regular&${PROJECTION_POSITIONS.map((p) => `position[]=${p}`).join("&")}`,
  schedule: (season: string | number) => `${SLEEPER_API}/schedule/nfl/regular/${season}`,
};

const tag = (...parts: Array<string | number>) => ["sleeper", ...parts.map(String)];

/* ------------------------------------------------------------------ */
/* small parse helpers for v1                                          */
/* ------------------------------------------------------------------ */

function asArray<T>(value: unknown, what: string): T[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Sleeper ${what}: expected an array, got ${typeof value}`);
  return value as T[];
}

function asObject<T>(value: unknown, what: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Sleeper ${what}: expected an object`);
  return value as T;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------------------ */
/* v1 endpoints                                                        */
/* ------------------------------------------------------------------ */

export async function getLeague(leagueId: string): Promise<SleeperLeague> {
  const raw = asObject<SleeperLeague>(
    await fetchJson(sleeperUrl.league(leagueId), { revalidate: REVALIDATE.league, tags: tag("league", leagueId) }),
    "league",
  );
  return {
    ...raw,
    roster_positions: raw.roster_positions ?? [],
    scoring_settings: raw.scoring_settings ?? {},
    settings: raw.settings ?? {},
    draft_id: raw.draft_id ?? null,
    previous_league_id: raw.previous_league_id && raw.previous_league_id !== "0" ? raw.previous_league_id : null,
    avatar: raw.avatar ?? null,
    metadata: raw.metadata ?? null,
  };
}

export async function getUsers(leagueId: string): Promise<SleeperUser[]> {
  const raw = asArray<SleeperUser>(
    await fetchJson(sleeperUrl.users(leagueId), { revalidate: REVALIDATE.users, tags: tag("users", leagueId) }),
    "users",
  );
  return raw.map((u) => ({ ...u, avatar: u.avatar ?? null, metadata: u.metadata ?? null }));
}

export async function getRosters(leagueId: string): Promise<SleeperRoster[]> {
  const raw = asArray<Partial<SleeperRoster> & { roster_id: number }>(
    await fetchJson(sleeperUrl.rosters(leagueId), { revalidate: REVALIDATE.rosters, tags: tag("rosters", leagueId) }),
    "rosters",
  );
  return raw
    .map((r) => ({
      roster_id: r.roster_id,
      owner_id: r.owner_id ?? null,
      co_owners: r.co_owners ?? null,
      league_id: r.league_id ?? leagueId,
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      settings: { wins: 0, losses: 0, ties: 0, fpts: 0, ...(r.settings ?? {}) },
      metadata: r.metadata ?? null,
    }))
    .sort((a, b) => a.roster_id - b.roster_id);
}

/** Total points for from roster settings (Sleeper splits integer and decimal parts). */
export function rosterPointsFor(r: SleeperRoster): number {
  return round2(num(r.settings.fpts) + num(r.settings.fpts_decimal) / 100);
}

export function rosterPointsAgainst(r: SleeperRoster): number {
  return round2(num(r.settings.fpts_against) + num(r.settings.fpts_against_decimal) / 100);
}

/** Max possible points ("ppts") Sleeper computed for the roster. */
export function rosterPotentialPoints(r: SleeperRoster): number {
  return round2(num(r.settings.ppts) + num(r.settings.ppts_decimal) / 100);
}

export async function getMatchups(
  leagueId: string,
  week: number,
  opts: { revalidate?: number } = {},
): Promise<SleeperMatchup[]> {
  const raw = asArray<Partial<SleeperMatchup> & { roster_id: number }>(
    await fetchJson(sleeperUrl.matchups(leagueId, week), {
      revalidate: opts.revalidate ?? REVALIDATE.matchups,
      tags: tag("matchups", leagueId, week),
    }),
    "matchups",
  );
  return raw
    .map((m) => ({
      roster_id: m.roster_id,
      matchup_id: m.matchup_id ?? null,
      points: num(m.points),
      custom_points: m.custom_points ?? null,
      starters: m.starters ?? [],
      starters_points: (m.starters_points ?? []).map((p) => num(p)),
      players: m.players ?? [],
      players_points: m.players_points ?? {},
    }))
    .sort((a, b) => a.roster_id - b.roster_id);
}

export async function getTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]> {
  const raw = asArray<Partial<SleeperTransaction> & { transaction_id: string }>(
    await fetchJson(sleeperUrl.transactions(leagueId, week), {
      revalidate: REVALIDATE.transactions,
      tags: tag("transactions", leagueId, week),
    }),
    "transactions",
  );
  return raw
    .map((t) => ({
      transaction_id: t.transaction_id,
      type: (t.type ?? "free_agent") as SleeperTransaction["type"],
      status: t.status ?? "complete",
      leg: num(t.leg, week),
      created: num(t.created),
      status_updated: num(t.status_updated, num(t.created)),
      creator: t.creator ?? "",
      roster_ids: t.roster_ids ?? [],
      consenter_ids: t.consenter_ids ?? null,
      adds: t.adds ?? null,
      drops: t.drops ?? null,
      draft_picks: t.draft_picks ?? [],
      waiver_budget: t.waiver_budget ?? [],
      settings: t.settings ?? null,
      metadata: t.metadata ?? null,
    }))
    .sort((a, b) => a.status_updated - b.status_updated || a.created - b.created);
}

export async function getTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return asArray<SleeperTradedPick>(
    await fetchJson(sleeperUrl.tradedPicks(leagueId), { revalidate: REVALIDATE.tradedPicks, tags: tag("traded_picks", leagueId) }),
    "traded_picks",
  );
}

export async function getWinnersBracket(leagueId: string): Promise<SleeperBracketMatch[]> {
  return asArray<SleeperBracketMatch>(
    await fetchJson(sleeperUrl.winnersBracket(leagueId), { revalidate: REVALIDATE.brackets, tags: tag("bracket", leagueId) }),
    "winners_bracket",
  );
}

export async function getLosersBracket(leagueId: string): Promise<SleeperBracketMatch[]> {
  return asArray<SleeperBracketMatch>(
    await fetchJson(sleeperUrl.losersBracket(leagueId), { revalidate: REVALIDATE.brackets, tags: tag("bracket", leagueId) }),
    "losers_bracket",
  );
}

function normalizeDraft(d: Partial<SleeperDraft> & { draft_id: string }): SleeperDraft {
  return {
    draft_id: String(d.draft_id),
    league_id: d.league_id ?? "",
    season: d.season ?? "",
    season_type: d.season_type ?? "regular",
    type: d.type ?? "snake",
    status: (d.status ?? "pre_draft") as SleeperDraft["status"],
    start_time: d.start_time ?? null,
    last_picked: d.last_picked ?? null,
    created: num(d.created),
    draft_order: d.draft_order ?? null,
    slot_to_roster_id: d.slot_to_roster_id ?? null,
    settings: { rounds: 0, teams: 0, ...(d.settings ?? {}) },
    metadata: d.metadata ?? null,
  };
}

export async function getDrafts(leagueId: string): Promise<SleeperDraft[]> {
  const raw = asArray<Partial<SleeperDraft> & { draft_id: string }>(
    await fetchJson(sleeperUrl.drafts(leagueId), { revalidate: REVALIDATE.drafts, tags: tag("drafts", leagueId) }),
    "drafts",
  );
  return raw.map(normalizeDraft);
}

export async function getDraft(draftId: string): Promise<SleeperDraft | null> {
  const raw = await fetchJson(sleeperUrl.draft(draftId), { revalidate: REVALIDATE.draft, tags: tag("draft", draftId) });
  if (!raw || typeof raw !== "object") return null;
  return normalizeDraft(raw as SleeperDraft);
}

export async function getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  const raw = asArray<SleeperDraftPick>(
    await fetchJson(sleeperUrl.draftPicks(draftId), { revalidate: REVALIDATE.draftPicks, tags: tag("draft_picks", draftId) }),
    "draft picks",
  );
  return raw
    .map((p) => ({ ...p, draft_id: String(p.draft_id), is_keeper: p.is_keeper ?? null, metadata: p.metadata ?? null }))
    .sort((a, b) => a.pick_no - b.pick_no);
}

export async function getDraftTradedPicks(draftId: string): Promise<SleeperTradedPick[]> {
  return asArray<SleeperTradedPick>(
    await fetchJson(sleeperUrl.draftTradedPicks(draftId), { revalidate: REVALIDATE.drafts, tags: tag("draft_traded_picks", draftId) }),
    "draft traded picks",
  );
}

export async function getNflState(): Promise<NflState> {
  const raw = asObject<Partial<NflState>>(
    await fetchJson(sleeperUrl.state(), { revalidate: REVALIDATE.state, tags: tag("state") }),
    "state",
  );
  return {
    week: num(raw.week),
    display_week: num(raw.display_week, num(raw.week)),
    season: String(raw.season ?? ""),
    previous_season: String(raw.previous_season ?? ""),
    league_season: String(raw.league_season ?? raw.season ?? ""),
    season_type: raw.season_type ?? "regular",
    season_start_date: raw.season_start_date ?? null,
    leg: num(raw.leg, num(raw.week)),
  };
}

export async function getUserLeagues(userId: string, season: string | number): Promise<SleeperLeague[]> {
  return asArray<SleeperLeague>(
    await fetchJson(sleeperUrl.userLeagues(userId, season), { revalidate: REVALIDATE.userLeagues }),
    "user leagues",
  );
}

/* ------------------------------------------------------------------ */
/* memo + KV cache for the big payloads                                */
/* ------------------------------------------------------------------ */

const memo = new Map<string, { exp: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

interface Cached<T> {
  fetchedAt: number;
  value: T;
}

/**
 * Cache `load()` under `key` for ttlSeconds: in-process memo first, then the KV store
 * (skipped in fixture mode). Concurrent callers share one in-flight load.
 */
async function cachedTrimmed<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.exp > now) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const run = (async () => {
    if (!isFixtureMode()) {
      try {
        const stored = await store.get<Cached<T>>(key);
        if (stored && now - stored.fetchedAt < ttlSeconds * 1000) {
          memo.set(key, { exp: stored.fetchedAt + ttlSeconds * 1000, value: stored.value });
          return stored.value;
        }
      } catch {
        // store unavailable: fall through to a fresh load
      }
    }
    const value = await load();
    memo.set(key, { exp: Date.now() + ttlSeconds * 1000, value });
    if (!isFixtureMode()) {
      try {
        await store.set<Cached<T>>(key, { fetchedAt: Date.now(), value }, { ttlSeconds: Math.max(ttlSeconds * 4, 3600) });
      } catch {
        // caching is best effort
      }
    }
    return value;
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/** Drop the in-process memo (tests). */
export function clearSleeperMemo(): void {
  memo.clear();
  inflight.clear();
  playersMemo = null;
}

/* ------------------------------------------------------------------ */
/* undocumented: stats + projections                                   */
/* ------------------------------------------------------------------ */

const StatRowSchema = z.looseObject({
  player_id: z.union([z.string(), z.number()]).transform(String),
  week: z.union([z.number(), z.string()]).optional().nullable(),
  season: z.union([z.string(), z.number()]).optional().nullable(),
  team: z.string().optional().nullable(),
  opponent: z.string().optional().nullable(),
  game_id: z.union([z.string(), z.number()]).optional().nullable(),
  date: z.string().optional().nullable(),
  stats: z.record(z.string(), z.unknown()).optional().nullable(),
  player: z
    .looseObject({
      position: z.string().optional().nullable(),
      fantasy_positions: z.array(z.string()).optional().nullable(),
    })
    .optional()
    .nullable(),
});

function cleanStatLine(raw: Record<string, unknown> | null | undefined): StatLine {
  const out: StatLine = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export interface ParseReport {
  rows: number;
  kept: number;
  rejected: number;
}

/**
 * Parse a /stats or /projections payload into a playerId -> line map.
 * Handles the current array format and the older object-keyed-by-player format.
 * Rows outside FANTASY_POSITIONS are dropped (rows with an unknown position are kept).
 */
export function parseWeekStats(payload: unknown, season: string, week: number, report?: ParseReport): WeekStats {
  const out: WeekStats = {};
  let rows: unknown[];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === "object") {
    rows = Object.entries(payload as Record<string, unknown>).map(([player_id, v]) =>
      v && typeof v === "object" && "stats" in (v as object) ? { player_id, ...(v as object) } : { player_id, stats: v },
    );
  } else if (payload === null || payload === undefined) rows = [];
  else throw new Error(`Sleeper stats ${season}/${week}: unexpected payload type ${typeof payload}`);

  let rejected = 0;
  for (const row of rows) {
    const parsed = StatRowSchema.safeParse(row);
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const r = parsed.data;
    const position = r.player?.position ?? null;
    const fpos = r.player?.fantasy_positions ?? [];
    const relevant =
      position === null ? true : FANTASY_POSITION_SET.has(position) || fpos.some((p) => FANTASY_POSITION_SET.has(p));
    if (!relevant) continue;
    out[r.player_id] = {
      playerId: r.player_id,
      week: r.week !== undefined && r.week !== null ? Number(r.week) : week,
      season: r.season !== undefined && r.season !== null ? String(r.season) : season,
      position,
      team: r.team ?? null,
      opponent: r.opponent ?? null,
      gameId: r.game_id !== undefined && r.game_id !== null ? String(r.game_id) : null,
      date: r.date ?? null,
      stats: cleanStatLine(r.stats),
    };
  }
  if (report) {
    report.rows = rows.length;
    report.kept = Object.keys(out).length;
    report.rejected = rejected;
  }
  return out;
}

async function isPastWeek(season: string, week: number): Promise<boolean> {
  try {
    const state = await getNflState();
    if (Number(season) < Number(state.season)) return true;
    if (season === state.season) return week < state.week;
    return false;
  } catch {
    return false;
  }
}

/** Actual stat lines for a week (regular season). Current week refreshes every 60 s. */
export async function getWeekStats(season: string | number, week: number): Promise<WeekStats> {
  const s = String(season);
  const ttl = (await isPastWeek(s, week)) ? TRIMMED_TTL.statsPast : TRIMMED_TTL.statsLive;
  return cachedTrimmed(store.keys.stats(s, week), ttl, async () =>
    parseWeekStats(await fetchJson(sleeperUrl.stats(s, week), { noStore: true }), s, week),
  );
}

/** Projected stat lines for a week (QB/RB/WR/TE only, per the spec's query). */
export async function getWeekProjections(season: string | number, week: number): Promise<WeekStats> {
  const s = String(season);
  const ttl = (await isPastWeek(s, week)) ? TRIMMED_TTL.projectionsPast : TRIMMED_TTL.projectionsLive;
  return cachedTrimmed(store.keys.projections(s, week), ttl, async () =>
    parseWeekStats(await fetchJson(sleeperUrl.projections(s, week), { noStore: true }), s, week),
  );
}

/* ------------------------------------------------------------------ */
/* undocumented: schedule                                              */
/* ------------------------------------------------------------------ */

const GameSchema = z.looseObject({
  game_id: z.union([z.string(), z.number()]).transform(String),
  week: z.union([z.number(), z.string()]).transform(Number),
  date: z.string().optional().nullable(),
  home: z.string(),
  away: z.string(),
  status: z.string().optional().nullable(),
});

export function parseSchedule(payload: unknown): NflGame[] {
  if (!Array.isArray(payload)) {
    if (payload === null || payload === undefined) return [];
    throw new Error("Sleeper schedule: expected an array");
  }
  const games: NflGame[] = [];
  for (const row of payload) {
    const parsed = GameSchema.safeParse(row);
    if (!parsed.success) continue;
    const g = parsed.data;
    games.push({ gameId: g.game_id, week: g.week, date: g.date ?? "", home: g.home, away: g.away, status: g.status ?? "pre_game" });
  }
  return games.sort((a, b) => a.week - b.week || a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));
}

export async function getSchedule(season: string | number): Promise<NflGame[]> {
  return parseSchedule(await fetchJson(sleeperUrl.schedule(season), { revalidate: REVALIDATE.schedule, tags: tag("schedule", season) }));
}

/** NFL teams on bye in a week (teams with no game in the schedule for that week). */
export function byeTeams(schedule: NflGame[], week: number): string[] {
  const all = new Set<string>();
  const playing = new Set<string>();
  for (const g of schedule) {
    all.add(g.home);
    all.add(g.away);
    if (g.week === week) {
      playing.add(g.home);
      playing.add(g.away);
    }
  }
  return [...all].filter((t) => !playing.has(t)).sort();
}

/* ------------------------------------------------------------------ */
/* players                                                             */
/* ------------------------------------------------------------------ */

interface RawPlayer {
  player_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  age?: number | null;
  years_exp?: number | null;
  injury_status?: string | null;
  status?: string | null;
}

/** Trim the 14 MB /players/nfl payload to fantasy-relevant players and fields. */
export function trimPlayers(raw: unknown): PlayersMap {
  const src = asObject<Record<string, RawPlayer>>(raw, "players");
  const out: PlayersMap = {};
  for (const [id, p] of Object.entries(src)) {
    if (!p || typeof p !== "object") continue;
    const positions = (p.fantasy_positions ?? (p.position ? [p.position] : [])).filter(Boolean) as string[];
    const pos = p.position ?? positions[0] ?? "";
    if (!FANTASY_POSITION_SET.has(pos) && !positions.some((x) => FANTASY_POSITION_SET.has(x))) continue;
    const name = (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || id).trim();
    out[id] = {
      id,
      name,
      pos,
      positions: positions.length ? positions : [pos],
      team: p.team ?? null,
      age: typeof p.age === "number" ? p.age : null,
      years_exp: typeof p.years_exp === "number" ? p.years_exp : null,
      injury_status: p.injury_status || null,
      status: p.status ?? null,
    };
  }
  return out;
}

interface StoredPlayers {
  fetchedAt: number;
  players: PlayersMap;
}

let playersMemo: { exp: number; players: PlayersMap } | null = null;

/**
 * Trimmed players map. Hits /players/nfl at most once per 24 h (per the spec): the
 * trimmed map lives in the KV store; if another instance holds the refresh lock we
 * serve the stale copy.
 */
export async function getPlayers(): Promise<PlayersMap> {
  const now = Date.now();
  if (playersMemo && playersMemo.exp > now) return playersMemo.players;

  if (isFixtureMode()) {
    const players = trimPlayers(await fetchJson(sleeperUrl.players()));
    playersMemo = { exp: now + 3600_000, players };
    return players;
  }

  const key = store.keys.players();
  let stored: StoredPlayers | null = null;
  try {
    stored = await store.get<StoredPlayers>(key);
  } catch {
    stored = null;
  }
  const fresh = stored && now - stored.fetchedAt < TRIMMED_TTL.players * 1000;
  if (stored && fresh) {
    playersMemo = { exp: Math.min(now + 3600_000, stored.fetchedAt + TRIMMED_TTL.players * 1000), players: stored.players };
    return stored.players;
  }

  let gotLock = true;
  try {
    gotLock = await store.lock("global:lock:players-refresh", 300);
  } catch {
    gotLock = true;
  }
  if (!gotLock && stored) {
    playersMemo = { exp: now + 300_000, players: stored.players };
    return stored.players;
  }

  try {
    const players = trimPlayers(await fetchJson(sleeperUrl.players(), { noStore: true, timeoutMs: 60_000 }));
    try {
      await store.set<StoredPlayers>(key, { fetchedAt: Date.now(), players });
    } catch {
      // best effort
    }
    playersMemo = { exp: now + 3600_000, players };
    return players;
  } catch (err) {
    if (stored) {
      playersMemo = { exp: now + 300_000, players: stored.players };
      return stored.players;
    }
    throw err;
  } finally {
    try {
      await store.unlock("global:lock:players-refresh");
    } catch {
      // ignore
    }
  }
}

/**
 * Look up a player, with fallbacks: team defenses ("KC") and unknown ids still get a
 * usable record. `hint` (e.g. draft pick metadata or a stat row) fills gaps.
 */
export function playerInfo(
  players: PlayersMap,
  id: string,
  hint?: { name?: string; position?: string | null; team?: string | null },
): PlayerInfo {
  const known = players[id];
  if (known) return known;
  const isDef = /^[A-Z]{2,3}$/.test(id);
  const pos = hint?.position ?? (isDef ? "DEF" : "");
  return {
    id,
    name: hint?.name ?? (isDef ? `${id} D/ST` : `Player ${id}`),
    pos,
    positions: pos ? [pos] : [],
    team: hint?.team ?? (isDef ? id : null),
    age: null,
    years_exp: null,
    injury_status: null,
    status: null,
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}


