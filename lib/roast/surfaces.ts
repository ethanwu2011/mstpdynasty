/**
 * One mean line per row on every stat surface (standings, odds, power rankings, matchups, team
 * pages, trades, the Wall of Shame, draft picks).
 *
 *   writer   surfaceLines(surface, rows): the rows go to the writer in batches (one call per
 *            MAX_ROWS_PER_CALL rows) through the same callRoastModel path, the same frozen system
 *            prompt (persona.ts, unchanged: a LINES request is one more request shape, explained
 *            in its own user message with LINES_GLOSSARY for the keys only rows carry) and the
 *            same post-check as every issue and item. The reply uses the persona's @@slot format
 *            (a JSON object, slot id -> line, is accepted too). A line survives only if it is one
 *            sentence, names the row's manager by first name, and passes every check (each
 *            number in FACTS and next to the right name, exact claims such as a pick's reach or a
 *            player's age, no slurs, theme or joke-announcing words). Failed rows get one retry in
 *            one call. Without an API key (or on any failure) a row's line is null: absent, never
 *            a canned joke.
 *   refresh  refreshSurfaceLines(surface, key, rows): run by the tick and the daily job, never by
 *            a page. Hashes each row's facts and only sends rows that changed or never got a
 *            line. New rows go out at once; a row that already has a line is rewritten at most
 *            once per SURFACE_MAX_AGE_MS; a row that keeps failing backs off. The merged map is
 *            stored under keys.surfaceLines(league, surface, key).
 *   read     getSurfaceLines(surface, key): what pages call. A store read only, so a render
 *            never waits on the model.
 *
 * Row ids and keys are the contract between the writer and the pages: see RoastSurface in
 * lib/types.ts for row ids and `surfaceKeys` below for keys. The rows themselves are built from
 * facts by lib/roast/surface-rows.ts (pure) and refreshed by lib/jobs/lines.ts.
 */
import "server-only";
import { createHash } from "node:crypto";
import { leagueId as envLeagueId } from "@/lib/env";
import * as store from "@/lib/store";
import type { LeagueContext, RoastSurface, RoastUsage, StoredSurfaceLines, SurfaceLineMap, SurfaceRow, SurfaceRowFailure } from "@/lib/types";
import { addUsage, callRoastModel, hasRoastClient, type RoastRequestOptions } from "./llm";
import { loadRoastNotes, notesFor } from "./notes";
import { AllowedNumbers, checkText, cuckChairIn, describeDrops, parseSlots, type Dropped } from "./postcheck";

export const SURFACES: readonly RoastSurface[] = ["standings", "odds", "power", "matchups", "team", "trades", "shame", "draft"];

/**
 * Store keys per surface. A page builds the same key from what it renders:
 *   standings  surfaceKeys.standings(ctx.season, lastCompletedWeek(ctx))      rows by rosterId
 *   odds       surfaceKeys.odds(ctx.season, sim.asOfWeek)  (draft odds: asOfWeek 0)
 *   power      surfaceKeys.power(ctx.season, power.asOfWeek)
 *   matchups   surfaceKeys.matchups(ctx.season, week)                          rows by matchupId
 *   team       surfaceKeys.team(ctx.season)                                    rows by rosterId
 *   trades     surfaceKeys.trades()                                            rows by transactionId
 *   shame      surfaceKeys.shame(ctx.season)                                   rows by ShameEntry.id
 *   draft      surfaceKeys.draft(draftId)                                      rows by String(pickNo)
 */
export const surfaceKeys = {
  standings: (season: string, week: number) => `${season}:w${week}`,
  odds: (season: string, asOfWeek: number) => `${season}:w${asOfWeek}`,
  power: (season: string, asOfWeek: number) => `${season}:w${asOfWeek}`,
  matchups: (season: string, week: number) => `${season}:w${week}`,
  team: (season: string) => season,
  trades: () => "all",
  shame: (season: string) => season,
  draft: (draftId: string) => `draft-${draftId}`,
} as const satisfies Record<RoastSurface, (...args: never[]) => string>;

const DAY_MS = 24 * 3600_000;

/**
 * How often a row that already has a line may be rewritten when its facts change. A row with
 * no line (a new trade, a new pick, a new week's table) is written at once on every surface.
 * Pick rows hash only who took whom (see draftRows), so they are written once.
 */
export const SURFACE_MAX_AGE_MS: Record<RoastSurface, number> = {
  standings: DAY_MS,
  odds: DAY_MS,
  power: DAY_MS,
  matchups: DAY_MS,
  team: DAY_MS,
  shame: DAY_MS,
  trades: DAY_MS,
  draft: DAY_MS,
};

/**
 * Cuck-chair lines per table (the persona's once-per-issue rule, applied to a table): one
 * allowance shared by every batch and every refresh of a surface key, counting the lines
 * already stored on it.
 */
export const CUCK_CHAIR_PER_TABLE = 1;

/** Rows per model call (the draft surface can hold 340 rows): small enough to finish well inside LINES_REQUEST. */
export const MAX_ROWS_PER_CALL = 25;
/** A line is one sentence of at most this many words (the prompt says 30; a little slack). */
export const MAX_LINE_WORDS = 36;
export const MAX_LINE_CHARS = 260;
/** A row whose line failed the checks waits this long before it is asked again... */
export const ROW_RETRY_AFTER_MS = 30 * 60_000;
/** ...and is given up on (until its facts change) after this many failed refreshes. */
export const MAX_ROW_ATTEMPTS = 3;
/**
 * Per call: one batch of short lines. With the jobs' 150-second start deadline, a call that
 * times out and is retried once still ends inside the routes' 300-second limit.
 */
export const LINES_REQUEST: RoastRequestOptions = { timeout: 70_000, maxRetries: 1 };

/** What each table's lines are about (the TASK line of a LINES request). */
const SURFACE_TASKS: Record<RoastSurface, string> = {
  standings: "One line per team in the standings: its record, points and streak against where it sits.",
  odds: "One line per team on its season odds. The playoff and title odds are the headline.",
  power: "One line per team in the power rankings: where it ranks against its record, points per game and luck.",
  matchups: "One line per matchup: the result, or before kickoff the projection and who is walking into it.",
  team: "One line per team page: what the roster is worth, who it leans on, and how old it is.",
  trades: "One line per trade, judged in hindsight: value at the time against value now, and who is losing it.",
  shame: "One line per Wall of Shame entry, stated like a permanent record.",
  draft: "One line per draft pick: the reach or steal, who he passed on, or what the pick says about the manager.",
};

const SURFACE_LABELS: Record<RoastSurface, string> = {
  standings: "standings",
  odds: "season odds",
  power: "power rankings",
  matchups: "matchups",
  team: "team pages",
  trades: "trades",
  shame: "Wall of Shame",
  draft: "draft picks",
};

/* ------------------------------------------------------------------ */
/* hashing                                                             */
/* ------------------------------------------------------------------ */

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;

/**
 * Stable hash of one row (key order does not matter). A row with a `hashKey` hashes that
 * instead of its facts, so facts that drift daily (a pick's live FantasyCalc rank) do not get
 * a line rewritten.
 */
export function rowHash(row: SurfaceRow): string {
  const body = row.hashKey !== undefined ? ["k", row.hashKey] : canon(row.facts);
  return createHash("sha256").update(JSON.stringify([row.id, row.managers, body])).digest("base64url").slice(0, 16);
}

/** Hash of a whole batch (row order does not matter). */
export function surfaceFactsHash(rows: SurfaceRow[]): string {
  const hashes = rows.map((r) => `${r.id}=${rowHash(r)}`).sort();
  return createHash("sha256").update(hashes.join("\n")).digest("base64url").slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* the request                                                         */
/* ------------------------------------------------------------------ */

/**
 * The FACTS keys only stat-table rows carry, glossed in every LINES request (the persona's own
 * glossary covers the rest; tests/roast-prompt.test.ts checks the two together cover every key).
 * Deterministic text: it never holds league data.
 */
export const LINES_GLOSSARY = [
  "- r<n>: the facts for one row of the table, under the slot id of its line.",
  "- asOf: when the table stands, like week 5 or before kickoff.",
  "- pointsForRank: rank of pointsFor, 1 is the most. pointsPerGame: points per game played. expectedWins: average final win total across the simulated seasons.",
  "- projectedRank: where his best lineup ranks by projected weekly points, 1 is the best.",
  "- rosterSize: players on his roster. topPlayers: his most valuable players by FantasyCalc.",
  "- then, now: one side of a trade valued at the time of the trade and today, each with valueIn, valueOut, net and grade. then is null when no value that old is stored. valueLost: what the losing side has given away as of today. lostSinceTrade: how much of valueLost piled up after the trade.",
  "- entry: which Wall of Shame list a row is on. headline, detail: that entry as code wrote it (not a newsletter headline).",
].join("\n");

/** What a LINES request adds to the TASK: what a row is, and the one-sentence shape of a line. */
const LINES_RULES =
  "Each slot is one row of a table printed on the site: its SLOTS line names the manager the row is about, and FACTS holds that row's facts under the same slot id. Write each line in the same voice as an ITEM, cut to one sentence of at most 30 words about that row's manager, by first name: the row's number, then the worst reading of it. At most one epic clause. Another row's manager and number are fair for contrast. No two lines on one table share a shape or a punchline.";

/** Slot ids the model sees: r1..rN in row order (row ids can hold characters slot ids cannot). */
export const slotIdOf = (i: number) => `r${i + 1}`;

export interface LinesPromptOptions {
  /** One extra sentence of context for the TASK (for example "a season that started today"). */
  context?: string;
}

interface Slotted {
  slot: string;
  row: SurfaceRow;
}

const slotted = (rows: SurfaceRow[]): Slotted[] => rows.map((row, i) => ({ slot: slotIdOf(i), row }));

/** The FACTS object of a LINES request: slot id -> that row's facts. */
export function linesFacts(rows: SurfaceRow[]): Record<string, Record<string, unknown>> {
  return factsOf(slotted(rows));
}

function factsOf(entries: Slotted[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(entries.map((e) => [e.slot, e.row.facts]));
}

function buildMessage(surface: RoastSurface, entries: Slotted[], lore: Record<string, string>, opts: LinesPromptOptions): string {
  const task = [SURFACE_TASKS[surface], opts.context?.trim(), LINES_RULES].filter(Boolean).join(" ");
  return [
    `LINES: ${SURFACE_LABELS[surface]}`,
    `TASK: ${task}`,
    "SLOTS:",
    ...entries.map((e) => `@@${e.slot}: ${e.row.managers.join(" vs ") || "the row"}`),
    "KEYS (only table rows use these):",
    LINES_GLOSSARY,
    "FACTS:",
    JSON.stringify(factsOf(entries)),
    "LORE:",
    JSON.stringify(lore),
  ].join("\n");
}

/** The user message for one batch. Deterministic for the same rows and lore. */
export function linesMessage(surface: RoastSurface, rows: SurfaceRow[], lore: Record<string, string>, opts: LinesPromptOptions = {}): string {
  return buildMessage(surface, slotted(rows), lore, opts);
}

/**
 * The reply: "@@slot" sections, the persona's format. A JSON object (slot id -> line), with or
 * without a code fence around it, is read too.
 */
export function parseLinesReply(reply: string): Map<string, string> {
  const out = new Map<string, string>();
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) out.set(k.trim().toLowerCase(), v.trim());
        }
        if (out.size) return out;
      }
    } catch {
      // not JSON: try the slot format
    }
  }
  return parseSlots(reply);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `text` names one of `names` (whole word, any case). */
export function namesAny(text: string, names: string[]): boolean {
  const t = text.replace(/’/g, "'");
  return names.some((n) => n.trim().length > 0 && new RegExp(`(?<![A-Za-z0-9])${esc(n.trim())}(?![A-Za-z0-9])`, "i").test(t));
}

/**
 * What a batch's lines are checked against: every row's facts and the lore. Numbers from any
 * row are fair (a line may hold one manager's number against another's); the name binding check
 * keeps each number next to its owner. Built per row, never from the slot-keyed object, so the
 * slot ids (r1, r2...) never count as numbers a line may state.
 */
export function lineSources(rows: SurfaceRow[], lore: Record<string, string>): { allowed: AllowedNumbers; exempt: string } {
  const sources = [...rows.map((r) => JSON.stringify(r.facts)), JSON.stringify(lore)];
  return { allowed: new AllowedNumbers(sources), exempt: sources.join("\n") };
}

export interface LineCheck {
  line: string | null;
  /** Why it failed, for the log and the retry note (empty when it passed). */
  reasons: string[];
  dropped: Dropped[];
}

/**
 * The checks one line must pass (numbers and words as everywhere, plus one sentence, short, named).
 * `cuck` is the table's cuck-chair allowance (CUCK_CHAIR_PER_TABLE), shared by every line on it;
 * a line that fails gives back what it took.
 */
export function checkLine(raw: string | undefined, row: SurfaceRow, allowed: AllowedNumbers, exempt: string, cuck: { left: number } = { left: CUCK_CHAIR_PER_TABLE }): LineCheck {
  if (!raw || !raw.trim()) return { line: null, reasons: ["the line was missing"], dropped: [] };
  const before = cuck.left;
  const checked = checkText(raw.replace(/\s*\n+\s*/g, " "), allowed, exempt, { cuck });
  const reasons = describeDrops(checked.dropped);
  if (checked.sentences !== 1) reasons.push(`it ran ${checked.sentences} sentences; a line is one`);
  const text = checked.text.replace(/!/g, ".").trim();
  if (text && words(text) > MAX_LINE_WORDS) reasons.push(`it ran ${words(text)} words; the limit is 30`);
  if (text.length > MAX_LINE_CHARS) reasons.push("it was too long");
  if (text && row.managers.length && !namesAny(text, row.managers)) reasons.push(`it never names ${row.managers.join(" or ")}`);
  if (!reasons.length && text) return { line: text, reasons: [], dropped: [] };
  cuck.left = before;
  return { line: null, reasons: reasons.length ? reasons : ["nothing survived the checks"], dropped: checked.dropped };
}

interface WriteResult {
  /** rowId -> line for rows that passed; rows asked but failed are in `failed`. */
  lines: Record<string, string>;
  /** Rows whose lines failed the checks (or were refused): they count toward MAX_ROW_ATTEMPTS. */
  failed: string[];
  /** Rows whose call never got an answer (API error, timeout): they back off but do not count. */
  unavailable: string[];
  /** Rows never asked (the deadline passed first). */
  skipped: string[];
  model: string | null;
  usage: RoastUsage | null;
}

export interface WriteOptions extends LinesPromptOptions {
  /** Do not start another call after this time (epoch ms). */
  deadline?: number;
  /** The table's cuck-chair allowance, shared by every batch (default CUCK_CHAIR_PER_TABLE for the whole call). */
  cuck?: { left: number };
}

function retryNote(problems: Array<{ slot: string; reasons: string[] }>): string {
  const what = problems
    .slice(0, 12)
    .map((p) => `${p.slot}: ${p.reasons.slice(0, 3).join("; ")}`)
    .join(". ");
  return `\nNOTE: your last lines for these slots broke the rules (${what}). Write them again: one sentence each, the row's manager by name, only numbers that appear in FACTS next to the name they belong to, none of the banned words or shapes.`;
}

/** One batch (at most MAX_ROWS_PER_CALL rows): a call, the checks, one retry for the rows that failed. */
async function writeChunk(surface: RoastSurface, rows: SurfaceRow[], notes: Record<string, string>, opts: WriteOptions, cuck: { left: number }): Promise<WriteResult> {
  const lore = notesFor(
    notes,
    rows.flatMap((r) => r.managers),
  );
  const { allowed, exempt } = lineSources(rows, lore);
  const out: WriteResult = { lines: {}, failed: [], unavailable: [], skipped: [], model: null, usage: null };

  let pending = slotted(rows);
  let note = "";
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    if (attempt > 0 && opts.deadline !== undefined && Date.now() > opts.deadline) break;
    // The retry asks only for the rows that failed, under their original slot ids.
    const message = buildMessage(surface, pending, lore, opts) + note;
    const res = await callRoastModel(message, `lines ${surface}${attempt ? " retry" : ""}`, LINES_REQUEST);
    out.usage = addUsage(out.usage, res.usage);
    out.model = res.model ?? out.model;
    if (!res.ok) {
      // An outage is not the rows' fault; a refusal or an empty answer is.
      if (attempt === 0 && (res.reason === "error" || res.reason === "not_configured")) {
        out.unavailable = pending.map((p) => p.row.id);
        return out;
      }
      break;
    }
    const reply = parseLinesReply(res.text);
    const problems: Array<{ slot: string; reasons: string[] }> = [];
    const still: Slotted[] = [];
    for (const p of pending) {
      const c = checkLine(reply.get(p.slot), p.row, allowed, exempt, cuck);
      if (c.line) out.lines[p.row.id] = c.line;
      else {
        for (const d of c.dropped) console.warn(`[lines] ${surface} ${p.slot}: failed sentence (${describeDrops([d]).join("; ")}): ${d.sentence}`);
        problems.push({ slot: p.slot, reasons: c.reasons });
        still.push(p);
      }
    }
    pending = still;
    note = retryNote(problems);
  }
  out.failed = pending.map((p) => p.row.id);
  return out;
}

/** Every due row, in MAX_ROWS_PER_CALL batches, until the deadline. */
async function writeLines(surface: RoastSurface, rows: SurfaceRow[], opts: WriteOptions = {}): Promise<WriteResult> {
  const notes = await loadRoastNotes().catch(() => ({}));
  const out: WriteResult = { lines: {}, failed: [], unavailable: [], skipped: [], model: null, usage: null };
  const cuck = opts.cuck ?? { left: CUCK_CHAIR_PER_TABLE };
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_CALL) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_CALL);
    if (opts.deadline !== undefined && Date.now() > opts.deadline) {
      out.skipped.push(...chunk.map((r) => r.id));
      continue;
    }
    const r = await writeChunk(surface, chunk, notes, opts, cuck);
    Object.assign(out.lines, r.lines);
    out.failed.push(...r.failed);
    out.unavailable.push(...r.unavailable);
    out.usage = addUsage(out.usage, r.usage);
    out.model = r.model ?? out.model;
  }
  return out;
}

/**
 * One mean line per row, written in batches. Every row id is in the result; a row's value is
 * null when there is no line (no API key, the row failed the checks, or the writer is down).
 * Jobs use refreshSurfaceLines (which stores); this is the bare writer.
 */
export async function surfaceLines(surface: RoastSurface, rows: SurfaceRow[], ctx?: LeagueContext, opts: WriteOptions = {}): Promise<SurfaceLineMap> {
  void ctx;
  const none: SurfaceLineMap = Object.fromEntries(rows.map((r) => [r.id, null]));
  if (!rows.length || !hasRoastClient()) return none;
  try {
    const out = await writeLines(surface, rows, opts);
    return { ...none, ...out.lines };
  } catch {
    return none;
  }
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

const leagueOf = (ctx?: LeagueContext) => ctx?.leagueId ?? envLeagueId();

/** The stored batch for a surface and key, or null. */
export async function getStoredSurfaceLines(surface: RoastSurface, key: string, ctx?: LeagueContext): Promise<StoredSurfaceLines | null> {
  return store.get<StoredSurfaceLines>(store.keys.surfaceLines(leagueOf(ctx), surface, key)).catch(() => null);
}

/** What pages call: rowId -> line for a surface and key. A store read only; {} when nothing is stored. */
export async function getSurfaceLines(surface: RoastSurface, key: string, ctx?: LeagueContext): Promise<SurfaceLineMap> {
  const lines = (await getStoredSurfaceLines(surface, key, ctx))?.lines ?? {};
  return Object.fromEntries(Object.entries(lines).filter(([, v]) => typeof v === "string" && v.trim().length > 0));
}

export interface RefreshResult {
  /**
   * "fresh": nothing changed. "throttled": rows changed, but each is inside its rewrite window
   * or backing off after failures. "written": at least one line stored. "skipped": no writer,
   * or the writer produced nothing usable. "busy": another run holds the surface's claim.
   */
  status: "fresh" | "throttled" | "written" | "skipped" | "busy";
  lines: SurfaceLineMap;
  /** Rows sent to the writer. */
  asked: number;
  /** Rows that got a new line. */
  written?: number;
  /** Rows asked that failed the checks (they back off). */
  failed?: number;
  /** Due rows left for the next refresh (maxRows or the deadline). */
  pending?: number;
}

export interface RefreshOptions extends LinesPromptOptions {
  now?: number;
  /** Rewrite window for rows that already have a line (default SURFACE_MAX_AGE_MS[surface]). */
  maxAgeMs?: number;
  /** Ask every row again, ignoring hashes, windows and backoff. */
  force?: boolean;
  /** Ask at most this many rows now (in the order given); the rest wait for the next refresh. */
  maxRows?: number;
  /** Do not start another model call after this time (epoch ms). */
  deadline?: number;
  /**
   * Taken only when there is something to write (so an idle check costs one store read):
   * resolves to a release function, or null when another run holds it. The stored batch is
   * re-read after the claim, so two runs never write the same rows.
   */
  claim?: () => Promise<(() => Promise<void>) | null>;
  /**
   * The writer's voice version (ROAST_VOICE in lib/jobs/tick.ts). Folded into every row's hash,
   * so a new voice makes every stored line due again (at the surface's usual pace), pick rows
   * included.
   */
  voice?: number;
}

/** A row's hash under a voice version (unchanged when no voice is given). */
export function voicedHash(hash: string, voice: number | undefined): string {
  return voice === undefined ? hash : `${hash}.v${voice}`;
}

/**
 * For jobs: write lines for the rows whose facts changed (or that have no line yet) and store
 * the merged batch. Rows that left the surface are dropped. Never throws.
 */
export async function refreshSurfaceLines(
  surface: RoastSurface,
  key: string,
  rows: SurfaceRow[],
  ctx?: LeagueContext,
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const now = opts.now ?? Date.now();
  const stored = await getStoredSurfaceLines(surface, key, ctx);
  const previous = stored?.lines ?? {};
  const prevHashes = stored?.rowHashes ?? {};
  const prevAt = stored?.rowAt ?? {};
  const prevFailures = stored?.failures ?? {};
  const hashes = Object.fromEntries(rows.map((r) => [r.id, voicedHash(rowHash(r), opts.voice)]));
  const kept: SurfaceLineMap = Object.fromEntries(rows.map((r) => [r.id, previous[r.id] ?? null]));
  const maxAge = opts.maxAgeMs ?? SURFACE_MAX_AGE_MS[surface];

  const changed = rows.filter((r) => opts.force || !previous[r.id] || prevHashes[r.id] !== hashes[r.id]);
  if (!changed.length) return { status: "fresh", lines: kept, asked: 0 };
  const due = changed.filter((r) => {
    if (opts.force) return true;
    const f = prevFailures[r.id];
    if (f && f.hash === hashes[r.id] && (f.n >= MAX_ROW_ATTEMPTS || now - f.at < ROW_RETRY_AFTER_MS)) return false;
    if (previous[r.id]) {
      const at = prevAt[r.id] ?? stored?.generatedAt ?? 0;
      if (maxAge > 0 && now - at < maxAge) return false;
    }
    return true;
  });
  if (!due.length) return { status: "throttled", lines: kept, asked: 0 };
  if (!hasRoastClient()) return { status: "skipped", lines: kept, asked: 0 };
  if (opts.claim) {
    const release = await opts.claim().catch(() => null);
    if (!release) return { status: "busy", lines: kept, asked: 0, pending: due.length };
    try {
      return await refreshSurfaceLines(surface, key, rows, ctx, { ...opts, claim: undefined });
    } finally {
      await release().catch(() => undefined);
    }
  }

  const ask = opts.maxRows !== undefined ? due.slice(0, Math.max(0, opts.maxRows)) : due;
  // One cuck chair per table: a line already on it (even one about to be rewritten) uses it up.
  const names = lineSources(rows, {}).allowed.names;
  const onTable = Object.values(kept).filter((l) => typeof l === "string" && cuckChairIn(l, names)).length;
  let written: WriteResult;
  try {
    written = await writeLines(surface, ask, {
      context: opts.context,
      deadline: opts.deadline,
      cuck: { left: Math.max(0, CUCK_CHAIR_PER_TABLE - onTable) },
    });
  } catch {
    return { status: "skipped", lines: kept, asked: ask.length, pending: due.length };
  }
  const attempted = new Set([...Object.keys(written.lines), ...written.failed, ...written.unavailable]);
  const fresh = ask.filter((r) => typeof written.lines[r.id] === "string");

  const lines: SurfaceLineMap = { ...kept };
  const rowHashes: Record<string, string> = {};
  const rowAt: Record<string, number> = {};
  const failures: Record<string, SurfaceRowFailure> = {};
  for (const r of rows) {
    // A row keeps the hash of the facts its current line was written from (with the line and its
    // time) until a new line replaces it: a changed row stays due while its facts differ, and is
    // fresh again, with no model call, if they change back.
    if (previous[r.id] && prevHashes[r.id]) rowHashes[r.id] = prevHashes[r.id];
    if (previous[r.id] && prevAt[r.id] !== undefined) rowAt[r.id] = prevAt[r.id];
    const f = prevFailures[r.id];
    if (f && f.hash === hashes[r.id]) failures[r.id] = f;
  }
  for (const r of fresh) {
    lines[r.id] = written.lines[r.id];
    rowHashes[r.id] = hashes[r.id];
    rowAt[r.id] = now;
    delete failures[r.id];
  }
  for (const id of written.failed) {
    const prior = failures[id];
    failures[id] = { hash: hashes[id], at: now, n: (prior?.hash === hashes[id] ? prior.n : 0) + 1 };
  }
  for (const id of written.unavailable) {
    const prior = failures[id];
    failures[id] = { hash: hashes[id], at: now, n: prior?.hash === hashes[id] ? prior.n : 0 };
  }

  const record: StoredSurfaceLines = {
    surface,
    key,
    factsHash: surfaceFactsHash(rows),
    rowHashes,
    rowAt,
    failures,
    generatedAt: fresh.length ? now : (stored?.generatedAt ?? now),
    model: written.model ?? stored?.model ?? null,
    usage: fresh.length ? written.usage : (stored?.usage ?? null),
    lines,
  };
  if (attempted.size) await store.set(store.keys.surfaceLines(leagueOf(ctx), surface, key), record).catch(() => undefined);
  const pending = due.length - attempted.size;
  if (!fresh.length) return { status: "skipped", lines: kept, asked: attempted.size, written: 0, failed: written.failed.length, pending };
  return { status: "written", lines, asked: attempted.size, written: fresh.length, failed: written.failed.length, pending };
}
