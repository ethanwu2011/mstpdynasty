/**
 * Roast engine public API. OWNER: roast agent (lib/facts/**, lib/roast/**, config/roast-notes.ts,
 * tests/facts*, tests/roast*).
 *
 * Rule 1: code computes every fact; the writer only writes jokes about the facts it is handed.
 *   1. plan (lib/roast/plan.ts, items.ts, memory.ts): deterministic sections, tables and fact
 *      lines, the slots the model fills, and the compact FACTS payload (plus league memory:
 *      rap sheets, Loser of the Week crowns, draft slots, odds movement)
 *   2. call (llm.ts): one request with the frozen, cached system prompt (persona.ts)
 *   3. check (postcheck.ts): a slot passes only if EVERY sentence passes (league stats in FACTS
 *      and next to the right name, exact claims like "17 spots early", "age 29", "30 picks left",
 *      "8 AM" and "round 4 resumes" equal to their FACTS value, history and hyperbole numbers
 *      free, no invented streaks, scores, pick times or box-score stats, no theme words, slurs,
 *      filler or banned shapes, at most one all-caps rant sentence and one cuck chair per issue). Removing a
 *      sentence can leave a punchline with no setup, so a failing slot is re-asked once (one
 *      call for all failing slots, with a note saying what failed). If it fails again and only
 *      one sentence in the middle failed, the rest is kept (the punchline and the manager's name
 *      survive); otherwise its code-written fallback is used in full
 *   4. render: slots become paragraphs; anything missing falls back to code-written lines
 * Issues also see PREVIOUS (the last issues' history, headlines, closers and short lines, from
 * each issue's never-printed writerNotes), the same way item posts see RECENT.
 * Never throws for LLM reasons: no key, refusal, API error or too many failed slots all
 * publish facts only (factsOnly: true, note FACTS_ONLY_NOTE, which is null: no apology).
 */
import "server-only";
import { listIssues } from "@/lib/archive";
import { getLeagueContext } from "@/lib/league";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type {
  DraftPickFact,
  Issue,
  IssueBlock,
  IssueFacts,
  IssueKind,
  IssueSection,
  LeagueContext,
  Roast,
  RoastItemFact,
  RoastItemKind,
  RoastUsage,
} from "@/lib/types";
import { configured } from "@/lib/env";
import { draftFacts } from "@/lib/facts";
import { planItem, type ItemPlan } from "./items";
import { addUsage, callRoastModel, hasRoastClient, sharedStoreMissing } from "./llm";
import { draftContext, EMPTY_MEMORY, issueMemory, starterCounts, type PayloadMemory } from "./memory";
import { loadRoastNotes, notesFor } from "./notes";
import { ALLUSION_SLOT, HIDDEN_SLOTS, planDaily, planDraftGrades, planThursday, planWeekly, type IssuePlan, type SlotSpec, type WaiverMode } from "./plan";
import { recordDrops } from "./status";
import { AllowedNumbers, checkText, describeDrops, limitExclamations, parseSlots, sanitize, splitSentences, type Dropped } from "./postcheck";

export { ISSUE_TITLES, issueTitle } from "./plan";
export { SYSTEM_PROMPT } from "./persona";
export { draftContext, issueMemory } from "./memory";
export {
  buildRoastRequest,
  dailyBudgetUsd,
  hasRoastClient,
  MAX_WRITER_CALLS_PER_DAY,
  ROAST_MODEL,
  ROAST_MODELS,
  setRoastClient,
  sharedStoreMissing,
  spentTodayUsd,
  withinBudget,
} from "./llm";
export {
  checkLine,
  CUCK_CHAIR_PER_TABLE,
  currentLines,
  getStoredSurfaceLines,
  getSurfaceLines,
  linesMessage,
  MAX_ROW_ATTEMPTS,
  MAX_ROWS_PER_CALL,
  parseLinesReply,
  refreshSurfaceLines,
  ROW_RETRY_AFTER_MS,
  rowHash,
  SURFACE_MAX_AGE_MS,
  SURFACE_STALE_REWRITE_MS,
  SURFACES,
  surfaceFactsHash,
  surfaceKeys,
  surfaceLines,
  voicedHash,
  type RefreshOptions,
  type RefreshResult,
} from "./surfaces";
export {
  draftOddsRows,
  draftRows,
  finalMatchupRows,
  oddsRows,
  powerRows,
  pregameMatchupRows,
  SHAME_LISTS,
  shameRows,
  standingsRows,
  teamRows,
  tradeRows,
  type TeamPageInput,
} from "./surface-rows";

/**
 * The note on a facts-only issue: none. The facts simply run (never announce the writer:
 * nothing a reader sees talks about it). Kept as an export so callers and tests read one value.
 */
export const FACTS_ONLY_NOTE: string | null = null;

/** An issue falls back to facts only when more than this share of its slots fail twice. */
export const MAX_FAILED_SLOT_SHARE = 0.5;

/** Item roasts are 1 to 3 sentences. More is a failure to retry, never something to truncate. */
export const MAX_ITEM_SENTENCES = 3;

/** How many recent roasts of the same kind an item roast sees, so it does not repeat itself. */
export const RECENT_ROASTS = 8;

/** How many published issues PREVIOUS looks back over (allusions; fewer for the other lists). */
export const PREVIOUS_ISSUES = 10;

/** A sentence this short is a signature line ("That is the whole joke."): later issues must not repeat it. */
const SHORT_LINE_WORDS = 7;

/** All-caps rant sentences allowed per issue (never in the headline, never in an item). */
export const CAPS_PER_ISSUE = 1;

/** Cuck-chair sentences allowed per issue (the persona's rule, enforced by the post-check). */
export const CUCK_CHAIR_PER_ISSUE = 1;

export interface RoastOptions {
  /** Clock for the issue date and createdAt (tests). */
  now?: number;
  /** Draft picks so far, for draft pick roasts (saves a draftFacts() call per pick). */
  draftPicks?: DraftPickFact[];
}

/**
 * True when ANTHROPIC_API_KEY is set (and, on Vercel, the shared store is connected). When
 * false, show "not configured yet" and publish facts only.
 */
export function isRoastConfigured(): boolean {
  return configured.anthropic() && !sharedStoreMissing();
}

/** FAAB when the league's waiver_type is 2; otherwise claims are decided by priority. */
export function waiverModeOf(ctx: LeagueContext): WaiverMode {
  return ctx.league.settings.waiver_type === 2 ? "faab" : "priority";
}

/* ------------------------------------------------------------------ */
/* user message                                                        */
/* ------------------------------------------------------------------ */

interface Promptable {
  header: string;
  task: string;
  slots: SlotSpec[];
  facts: Record<string, unknown>;
}

/**
 * The per-request user message. Deterministic for the same facts, lore and previous issues.
 * PREVIOUS (issues only, when there is any) goes last, so everything before it stays the same.
 */
export function userMessage(p: Promptable, lore: Record<string, string>, previous: Record<string, unknown> | null = null): string {
  return [
    p.header,
    `TASK: ${p.task}`,
    "SLOTS:",
    ...p.slots.map((s) => `@@${s.id}: ${s.brief}`),
    "FACTS:",
    JSON.stringify(p.facts),
    "LORE:",
    JSON.stringify(lore),
    ...(previous && Object.keys(previous).length ? ["PREVIOUS:", JSON.stringify(previous)] : []),
  ].join("\n");
}

function numberSources(p: Promptable, lore: Record<string, string>): { allowed: AllowedNumbers; exempt: string } {
  const factsJson = JSON.stringify(p.facts);
  const loreJson = JSON.stringify(lore);
  return { allowed: new AllowedNumbers([factsJson, loreJson]), exempt: `${factsJson}\n${loreJson}` };
}

function logDrops(label: string, dropped: Dropped[]): void {
  for (const d of dropped) console.warn(`[roast] ${label}: failed sentence (${describeDrops([d]).join("; ")}): ${d.sentence}`);
  // Also keep the last few in the store so /api/health can show why lines were thrown out.
  void recordDrops(dropped.map((d) => ({ at: Date.now(), label, reasons: describeDrops([d]), sentence: d.sentence }))).catch(() => {});
}

/** The note appended to a retry: what failed, in plain words. */
function retryNote(reasons: string[], extra = ""): string {
  const what = reasons.length ? reasons.slice(0, 12).join("; ") : "material FACTS does not support";
  return `\nNOTE: your last draft broke the rules with: ${what}. ${extra}Write it again. Every league number (points, picks, spots, ranks, ages, dollars, records, streaks, percentages, anything next to a name or a stat word) must appear in FACTS, in the same sentence as (or right after) the name it belongs to. History and hyperbole numbers stay in sentences with no league name and no stat word. None of the banned words or shapes.`;
}

/* ------------------------------------------------------------------ */
/* issues                                                              */
/* ------------------------------------------------------------------ */

/**
 * Deterministic plan for an issue (exported for tests and previews). `memory` only adds to
 * FACTS; the sections are the same with or without it.
 */
export function planIssue(facts: IssueFacts, ctx: LeagueContext, memory: PayloadMemory = EMPTY_MEMORY): IssuePlan {
  const plan = planFor(facts, ctx, memory);
  // The hidden allusion slot rides right after the cold open it names.
  const at = plan.slots.findIndex((s) => s.id === "cold-open");
  if (at >= 0) plan.slots.splice(at + 1, 0, ALLUSION_SLOT);
  return plan;
}

function planFor(facts: IssueFacts, ctx: LeagueContext, memory: PayloadMemory): IssuePlan {
  switch (facts.kind) {
    case "weekly_recap":
      return planWeekly(facts, memory);
    case "thursday_fallout":
      return planThursday(facts, memory);
    case "daily":
      return planDaily(facts, ctx.league.settings.waiver_budget ?? 100, memory, waiverModeOf(ctx));
    case "draft_grades":
      return planDraftGrades(facts, memory);
  }
}

/**
 * What the last published issues already used, for PREVIOUS: the histories of their cold opens,
 * their headlines, closers and short signature lines. Null when there is nothing (a new league,
 * or only facts-only issues). Never throws.
 */
export async function previousIssues(leagueId: string, slug: string): Promise<Record<string, unknown> | null> {
  try {
    const issues = (await listIssues(leagueId, { limit: PREVIOUS_ISSUES + 1 })).filter((i) => i.slug !== slug && !i.factsOnly).slice(0, PREVIOUS_ISSUES);
    const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => Boolean(x)))];
    const out: Record<string, unknown> = {};
    const allusions = uniq(issues.map((i) => i.writerNotes?.allusion));
    const headlines = uniq(issues.filter((i) => i.dekSource === "model").map((i) => i.dek)).slice(0, 5);
    const closers = uniq(issues.map((i) => i.writerNotes?.closer)).slice(0, 3);
    const lines = uniq(issues.slice(0, 3).flatMap((i) => i.writerNotes?.lines ?? [])).slice(0, 15);
    if (allusions.length) out.allusions = allusions;
    if (headlines.length) out.headlines = headlines;
    if (closers.length) out.closers = closers;
    if (lines.length) out.lines = lines;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** The never-printed notes an issue keeps for PREVIOUS. */
function writerNotesFor(raw: Map<string, string>, prose: Map<string, string>, names: string[]): NonNullable<Issue["writerNotes"]> {
  const allusion = sanitize(raw.get(ALLUSION_SLOT.id) ?? "").split("\n")[0].trim().slice(0, 120) || null;
  const closer = prose.get("closer")?.replace(/\s+/g, " ").trim() || null;
  const lines = [...prose.entries()]
    .filter(([id]) => id !== "dek")
    .flatMap(([, text]) => splitSentences(text.replace(/\s+/g, " "), names))
    .filter((x) => x.split(/\s+/).length <= SHORT_LINE_WORDS);
  return { allusion, closer, lines: [...new Set(lines)] };
}

const paragraphs = (text: string): IssueBlock[] =>
  text
    .split(/\n{2,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ type: "paragraph" as const, text: t }));

/** Render a plan with the surviving prose (or none for facts only). */
export function renderSections(plan: IssuePlan, prose: Map<string, string> | null): IssueSection[] {
  return plan.sections
    .map((sec) => ({
      heading: sec.heading,
      blocks: sec.blocks.flatMap((b): IssueBlock[] => {
        if (b.type !== "slot") return [b];
        const text = prose?.get(b.slot);
        return text ? paragraphs(text) : b.fallback;
      }),
    }))
    .filter((sec) => sec.blocks.length > 0);
}

/**
 * Slots from one reply that pass every check, and what failed in the rest. `partial` holds, for
 * a failed slot, what is left when exactly one sentence failed and it was not the last one, at
 * least two sentences remain and the slot still names its manager: a last resort after the retry.
 * `caps` is the issue's all-caps allowance, spent in reading order by accepted slots only.
 */
function acceptSlots(reply: string, slots: SlotSpec[], allowed: AllowedNumbers, exempt: string, label: string, caps: { left: number }, cuck: { left: number }) {
  const raw = parseSlots(reply);
  const accepted = new Map<string, string>();
  const partial = new Map<string, string>();
  const failed: SlotSpec[] = [];
  const reasons: string[] = [];
  for (const s of slots) {
    if (HIDDEN_SLOTS.has(s.id)) continue;
    const text = raw.get(s.id);
    if (!text) {
      failed.push(s);
      reasons.push(`slot ${s.id} was missing`);
      continue;
    }
    const before = caps.left;
    const beforeCuck = cuck.left;
    const checked = checkText(text, allowed, exempt, s.id === "dek" ? { cuck } : { caps, cuck });
    logDrops(`${label} ${s.id}`, checked.dropped);
    if (checked.dropped.length === 0 && checked.text) accepted.set(s.id, checked.text);
    else {
      caps.left = before;
      cuck.left = beforeCuck;
      failed.push(s);
      reasons.push(...describeDrops(checked.dropped));
      const named = !s.manager || new RegExp(`(?<![A-Za-z])${s.manager.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(checked.text);
      if (checked.dropped.length === 1 && !checked.lastDropped && checked.kept >= 2 && named && checked.capsUsed === 0 && checked.cuckUsed === 0) partial.set(s.id, checked.text);
    }
  }
  return { raw, accepted, partial, failed, reasons: [...new Set(reasons)] };
}

/** Write a full newsletter issue from its facts. Never throws for LLM reasons. */
export async function roastIssue(kind: IssueKind, facts: IssueFacts, ctx?: LeagueContext, opts: RoastOptions = {}): Promise<Issue> {
  const c = ctx ?? (await getLeagueContext());
  const now = opts.now ?? Date.now();
  const date = etDate(now);
  if (facts.kind !== kind) console.warn(`[roast] roastIssue: kind ${kind} does not match facts.kind ${facts.kind}; using facts.kind`);
  const writer = hasRoastClient();
  const memory = writer ? await issueMemory(facts, c).catch(() => EMPTY_MEMORY) : EMPTY_MEMORY;
  const plan = planIssue(facts, c, memory);
  const slug = `${date}-${plan.kind.replace(/_/g, "-")}`;
  const lore = writer ? notesFor(await loadRoastNotes(), plan.managers) : {};
  const label = `${plan.kind} ${date}`;

  const base: Issue = {
    id: `${c.leagueId}:${date}:${plan.kind}`,
    slug,
    kind: plan.kind,
    leagueId: c.leagueId,
    season: c.season,
    week: plan.week ?? (plan.kind === "daily" && c.phase === "in_season" && c.week > 0 ? c.week : null),
    date,
    title: plan.title,
    dek: plan.fallbackDek,
    dekSource: "code",
    sections: renderSections(plan, null),
    factsOnly: true,
    note: FACTS_ONLY_NOTE,
    status: "draft",
    createdAt: now,
    sentAt: null,
    recipientCount: null,
    model: null,
    usage: null,
    imageUrl: null,
    placeholder: plan.placeholder,
  };

  const previous = writer ? await previousIssues(c.leagueId, slug) : null;
  const res = await callRoastModel(userMessage(plan, lore, previous), label, "issue");
  if (!res.ok) return { ...base, model: res.model, usage: res.usage };
  let usage: RoastUsage | null = res.usage;
  let model: string | null = res.model;

  const { allowed, exempt } = numberSources(plan, lore);
  const visible = plan.slots.filter((s) => !HIDDEN_SLOTS.has(s.id));
  const caps = { left: CAPS_PER_ISSUE };
  const cuck = { left: CUCK_CHAIR_PER_ISSUE };
  const first = acceptSlots(res.text, visible, allowed, exempt, label, caps, cuck);
  const accepted = first.accepted;
  let failed = first.failed;
  let second: ReturnType<typeof acceptSlots> | null = null;
  if (failed.length) {
    // One more call for just the failing slots. The system prompt is cached, so this is cheap.
    const retry = { ...plan, slots: failed };
    const again = await callRoastModel(userMessage(retry, lore, previous) + retryNote(first.reasons), `${label} retry`, "issue");
    usage = addUsage(usage, again.usage);
    model = again.model ?? model;
    if (again.ok) {
      second = acceptSlots(again.text, failed, allowed, exempt, `${label} retry`, caps, cuck);
      for (const [id, text] of second.accepted) accepted.set(id, text);
      failed = second.failed;
    }
  }
  // Last resort: a slot that lost one sentence in the middle keeps the rest (never its punchline).
  for (const s of failed) {
    const kept = second?.partial.get(s.id) ?? first.partial.get(s.id);
    if (kept) {
      console.warn(`[roast] ${label}: kept ${s.id} without its one failed sentence`);
      accepted.set(s.id, kept);
    }
  }
  failed = failed.filter((s) => !accepted.has(s.id));
  if (!accepted.size || failed.length / Math.max(1, visible.length) > MAX_FAILED_SLOT_SHARE) {
    console.warn(`[roast] ${label}: ${failed.length} of ${visible.length} slots failed the checks twice; publishing facts only`);
    return { ...base, model, usage };
  }
  if (failed.length) console.warn(`[roast] ${label}: code fallback for ${failed.map((s) => s.id).join(", ")}`);

  // One exclamation point per issue at most, in reading order.
  const order = visible.map((s) => s.id).filter((id) => accepted.has(id));
  const limited = limitExclamations(order.map((id) => accepted.get(id)!));
  const prose = new Map(order.map((id, i) => [id, limited[i]]));
  const dek = prose.get("dek")?.split("\n")[0]?.trim();
  return {
    ...base,
    dek: dek || plan.fallbackDek,
    dekSource: dek ? "model" : "code",
    sections: renderSections(plan, prose),
    factsOnly: false,
    note: null,
    model,
    usage,
    writerNotes: writerNotesFor(first.raw, prose, allowed.names),
  };
}

/* ------------------------------------------------------------------ */
/* item roasts                                                         */
/* ------------------------------------------------------------------ */

/**
 * Recently published roasts of the same kind, so the next one does not reuse their jokes.
 * Reads only the newest few keys (pick numbers are zero-padded and transaction ids grow with
 * time, so key order is close to time order): a 340-pick draft must not read every earlier
 * roast for every pick.
 */
async function recentRoasts(leagueId: string, kind: RoastItemKind): Promise<Roast[]> {
  const keys = (await store.list(store.keys.roastPrefix(leagueId, kind === "draft_pick" ? "pick" : kind))).slice(-RECENT_ROASTS * 3);
  const roasts = (await Promise.all(keys.map((k) => store.get<Roast>(k)))).filter((r): r is Roast => Boolean(r));
  return roasts.sort((a, b) => b.createdAt - a.createdAt);
}

async function recentBlock(leagueId: string, plan: ItemPlan): Promise<string> {
  try {
    const recent = (await recentRoasts(leagueId, plan.kind)).filter((r) => r.id !== plan.id && r.source === "llm").slice(0, RECENT_ROASTS);
    if (!recent.length) return "";
    return `\nRECENT (already published, do not reuse these comparisons or shapes):\n${recent.map((r) => `- ${r.text.replace(/\s+/g, " ")}`).join("\n")}`;
  } catch {
    return "";
  }
}

async function writeItem(plan: ItemPlan, lore: Record<string, string>, recent: string): Promise<{ text: string | null; model: string | null; usage: RoastUsage | null }> {
  const { allowed, exempt } = numberSources(plan, lore);
  // RECENT goes after FACTS and LORE, so everything before it stays the same request to request.
  const message = userMessage(plan, lore) + recent;
  let usage: RoastUsage | null = null;
  let model: string | null = null;
  let note = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callRoastModel(message + note, `${plan.id}${attempt ? " retry" : ""}`, "item");
    usage = addUsage(usage, res.usage);
    model = res.model ?? model;
    if (!res.ok) return { text: null, model, usage };
    const slots = parseSlots(res.text, "roast");
    const raw = slots.get("roast") ?? [...slots.values()][0] ?? "";
    const checked = checkText(raw, allowed, exempt);
    logDrops(plan.id, checked.dropped);
    // Only a clean roast is published: no failed sentence, and no more sentences than asked for.
    if (checked.text && checked.dropped.length === 0 && checked.sentences <= MAX_ITEM_SENTENCES) {
      return { text: limitExclamations([checked.text])[0], model, usage };
    }
    const tooLong = checked.sentences > MAX_ITEM_SENTENCES ? `It also ran ${checked.sentences} sentences; the limit is ${MAX_ITEM_SENTENCES}. ` : "";
    note = retryNote(describeDrops(checked.dropped), tooLong);
  }
  return { text: null, model, usage };
}

/** 1-3 sentence instant post on one trade, one waiver batch, or one draft pick. Never throws for LLM reasons. */
export async function roastItem(kind: RoastItemKind, fact: RoastItemFact, ctx?: LeagueContext, opts: RoastOptions = {}): Promise<Roast> {
  const c = ctx ?? (await getLeagueContext());
  const isPick = !Array.isArray(fact) && fact.kind === "draft_pick";
  const writer = hasRoastClient();
  let picks = opts.draftPicks;
  if (isPick && !picks && writer) {
    picks = await draftFacts(c)
      .then((d) => d.picks)
      .catch(() => []);
  }
  // Pick extras (who was passed on, the clock limit) only for the league's own current draft,
  // whose type and settings are known.
  const sameDraft = isPick && c.draft !== null && (fact as DraftPickFact).draftId === c.draft.draft_id;
  const draft = writer && sameDraft ? await draftContext(c, picks ?? []).catch(() => null) : null;
  const plan = planItem(kind, fact, c.league.settings.waiver_budget ?? 100, {
    picks,
    draft,
    waiverMode: waiverModeOf(c),
    commissioner: writer ? (c.managers.find((m) => m.isCommissioner)?.name ?? null) : null,
    starters: writer && isPick ? starterCounts(c.starterSlots) : null,
  });
  const base: Roast = {
    id: plan.id,
    kind: plan.kind,
    leagueId: c.leagueId,
    rosterIds: plan.rosterIds,
    text: sanitize(plan.factsOnlyText),
    facts: fact,
    source: "facts_only",
    model: null,
    createdAt: opts.now ?? Date.now(),
    usage: null,
  };
  if (!writer) return base;
  const lore = notesFor(await loadRoastNotes(), plan.managers);
  const out = await writeItem(plan, lore, await recentBlock(c.leagueId, plan));
  if (!out.text) return { ...base, model: out.model, usage: out.usage };
  return { ...base, text: out.text, source: "llm", model: out.model, usage: out.usage };
}
