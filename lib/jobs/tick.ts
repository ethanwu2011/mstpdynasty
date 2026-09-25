/**
 * The tick: instant write-ups of new trades, waiver runs and draft picks (site only, never
 * emailed; job details never call them roasts). Fired from page renders via after() and from /api/tick; runTick() in index.ts
 * holds the 2-minute cooldown lock around this.
 *
 * Idempotency: a roast index (keys.snapshot(leagueId, "roast-index"), id -> source + time)
 * says what is already roasted, in one read. Each item is also claimed (a short per-item lock)
 * before its model call, so two overlapping ticks never pay for the same roast, and the index
 * is re-read and merged right before it is written, so neither run erases the other's entries. A roast is only redone when it was written
 * without the LLM and the roast writer has since been configured (at most once a day), or
 * when the last attempt threw (after an hour). At most MAX_ROASTS_PER_TICK per tick, trades
 * first, then waivers, then picks, newest first, so a backlog drains over a few ticks.
 * Transactions older than TICK_LOOKBACK_MS and drafts that ended longer ago than that are
 * never roasted (so a wiped store cannot trigger hundreds of LLM calls).
 */
import { getRoast, listRoasts, roastIds, saveRoast } from "@/lib/archive";
import { draftFacts, transactionFacts } from "@/lib/facts";
import { withFrozenRank } from "@/lib/facts/draft";
import { isRoastConfigured, roastItem, withinBudget, WriterOutage } from "@/lib/roast";
import { getDraftPicks } from "@/lib/sleeper";
import * as store from "@/lib/store";
import type { DraftPickFact, JobOutcome, LeagueContext, Roast, RoastItemFact, RoastItemKind, RoastSource, WaiverFact } from "@/lib/types";
import { freezeDraftPickRanks, recordDraftPickTimes } from "./draft-seen";
import { DAY_MS } from "./schedule";

export const TICK_COOLDOWN_SECONDS = 120;
/** In-flight lock for one tick run: the route's maxDuration, so a crashed run frees it. */
export const TICK_RUN_LOCK_SECONDS = 300;
/** Per-item claim while its roast is being written (one model call plus one retry fit easily). */
export const ROAST_CLAIM_SECONDS = 300;
export const MAX_ROASTS_PER_TICK = 6;
/** Transactions older than this are never roasted by the tick. */
export const TICK_LOOKBACK_MS = 7 * DAY_MS;
const ROAST_CONCURRENCY = 3;
/** A roast written with the writer configured but kept facts-only (post-check failed) is retried after this. */
const REROAST_AFTER_MS = 30 * 60_000;
/**
 * Bump when the writer's voice changes: every item written in an older voice is written again.
 * 3: the fake-epic voice of the approved Daily (headline, cold open, per-manager hits), with no
 * pick-clock times.
 * 4: that voice merged with round 3 (the same persona and post-check behind the stat-table
 * lines, the once-per-issue cuck chair enforced by code): every stored item is written again.
 */
export const ROAST_VOICE = 4;
/**
 * A new voice rewrites only this many of the newest items per kind. Bumping the voice once
 * rewrote every pick of the draft (hundreds of calls); older items keep the voice they have.
 */
export const REVOICE_NEWEST = 10;
/** Give up on the writer for an item after this many facts-only results while it was configured. */
const MAX_WRITER_ATTEMPTS = 3;
const RETRY_ERROR_AFTER_MS = 3600_000;

type Group = "roast_trades" | "roast_waivers" | "roast_picks";

interface Candidate {
  group: Group;
  kind: RoastItemKind;
  id: string;
  fact: RoastItemFact;
}

interface IndexEntry {
  s: RoastSource | "error";
  t: number;
  /** Whether the joke writer was configured when this entry was written. */
  w?: boolean;
  /** Facts-only results while the writer was configured. */
  n?: number;
  /** ROAST_VOICE the item was written in. */
  v?: number;
  /** ROAST_VOICE of the attempts counted in n and o (older attempts do not count at a new voice). */
  av?: number;
  /** Writer outages since the last result (retried later, never counted as failed attempts). */
  o?: number;
}

/** Stop retrying through an outage after this many tries (about a day at the retry pace). */
const MAX_OUTAGE_RETRIES = 24;

/** Attempts and outages counted at the current voice. */
const attemptsOf = (e: IndexEntry) => {
  // An entry from before av existed: a written post's failed attempts were made at this voice.
  const av = e.av ?? (e.s === "llm" && e.n ? ROAST_VOICE : (e.v ?? 1));
  return av < ROAST_VOICE ? { n: 0, o: 0 } : { n: e.n ?? 0, o: e.o ?? 0 };
};
type RoastIndex = Record<string, IndexEntry>;

const INDEX = "roast-index";
const indexKey = (leagueId: string) => store.keys.snapshot(leagueId, INDEX);

async function loadIndex(leagueId: string): Promise<RoastIndex> {
  const idx = await store.get<RoastIndex>(indexKey(leagueId));
  if (idx) return idx;
  // Missing index (first run or a wiped key): rebuild it from the stored roasts once.
  const rebuilt: RoastIndex = {};
  for (const r of await listRoasts(leagueId)) rebuilt[r.id] = { s: r.source, t: r.createdAt };
  return rebuilt;
}

function wants(idx: RoastIndex, id: string, now: number, writerConfigured: boolean, revoice = true): boolean {
  const e = idx[id];
  if (!e) return true;
  if (e.s === "error") return now - e.t > RETRY_ERROR_AFTER_MS;
  if (!writerConfigured) return false;
  const { n, o } = attemptsOf(e);
  if (o >= MAX_OUTAGE_RETRIES) return false;
  // A written post is rewritten only for a new voice, and a failed rewrite or an outage waits and
  // gives up like any other attempt (the written post stays up meanwhile).
  if (e.s === "llm") return revoice && (e.v ?? 1) < ROAST_VOICE && n < MAX_WRITER_ATTEMPTS && now - e.t > (n || o ? REROAST_AFTER_MS : 0);
  // Written before the writer existed (for example before the API key was added): redo it now.
  if (!e.w) return true;
  // Gave up on the writer: a new voice (and its new checks) gets one more try.
  if (n >= MAX_WRITER_ATTEMPTS) return (e.v ?? 1) < ROAST_VOICE && (e.av ?? e.v ?? 1) < ROAST_VOICE;
  return now - e.t > REROAST_AFTER_MS;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const LABEL: Record<Group, [string, string]> = {
  roast_trades: ["trade", "trades"],
  roast_waivers: ["waiver run", "waiver runs"],
  roast_picks: ["draft pick", "draft picks"],
};

/** Waiver claims worth an instant roast, grouped by waiver run, newest run first. */
export function waiverBatches(waivers: WaiverFact[]): WaiverFact[][] {
  const byBatch = new Map<string, WaiverFact[]>();
  for (const w of waivers) {
    if (w.type !== "waiver" && !w.notableDrop) continue;
    byBatch.set(w.batchId, [...(byBatch.get(w.batchId) ?? []), w]);
  }
  return [...byBatch.values()]
    .map((b) => b.sort((a, c) => a.createdAt - c.createdAt))
    .sort((a, b) => Math.max(...b.map((w) => w.createdAt)) - Math.max(...a.map((w) => w.createdAt)));
}

export async function tickOutcomes(ctx: LeagueContext, now: number): Promise<JobOutcome[]> {
  const l = ctx.leagueId;
  const notes: Partial<Record<Group, JobOutcome>> = {};
  const candidates: Candidate[] = [];

  // Trades and waiver runs from the last week.
  try {
    const tx = await transactionFacts(now - TICK_LOOKBACK_MS, ctx, now);
    if (tx.placeholder) {
      notes.roast_trades = { job: "roast_trades", status: "skipped", detail: "Facts are still placeholder data." };
      notes.roast_waivers = { job: "roast_waivers", status: "skipped", detail: "Facts are still placeholder data." };
    } else {
      for (const t of [...tx.trades].sort((a, b) => b.createdAt - a.createdAt)) {
        candidates.push({ group: "roast_trades", kind: "trade", id: roastIds.trade(t.transactionId), fact: t });
      }
      for (const batch of waiverBatches(tx.waivers)) {
        candidates.push({ group: "roast_waivers", kind: "waiver", id: roastIds.waiver(batch[0].batchId), fact: batch });
      }
    }
  } catch (err) {
    notes.roast_trades = { job: "roast_trades", status: "error", detail: errText(err) };
    notes.roast_waivers = { job: "roast_waivers", status: "error", detail: errText(err) };
  }

  // Draft picks: stamp first-seen times, then roast the new ones.
  const draft = ctx.draft;
  let draftPicks: DraftPickFact[] | undefined;
  if (!draft || draft.status === "pre_draft") {
    notes.roast_picks = { job: "roast_picks", status: "skipped", detail: draft ? "The draft has not started." : "No draft." };
  } else if (draft.status === "complete" && (draft.last_picked ?? 0) < now - TICK_LOOKBACK_MS) {
    // Same lookback as transactions: a wiped store must not re-roast a whole old draft.
    notes.roast_picks = { job: "roast_picks", status: "skipped", detail: "The draft ended more than a week ago." };
  } else {
    try {
      const raw = await getDraftPicks(draft.draft_id);
      await recordDraftPickTimes(l, draft, raw, now);
      const df = await draftFacts(ctx);
      if (df.placeholder) notes.roast_picks = { job: "roast_picks", status: "skipped", detail: "Facts are still placeholder data." };
      else {
        // Freeze each new pick's FantasyCalc ranks before anything is written about it, so the
        // write-up, its card and the board all state the same rank from then on.
        const frozen = await freezeDraftPickRanks(l, df.draftId, df.picks).catch(() => null);
        draftPicks = frozen ? df.picks.map((p) => withFrozenRank(p, frozen.get(p.pickNo))) : df.picks;
        for (const p of [...draftPicks].sort((a, b) => b.pickNo - a.pickNo)) {
          candidates.push({ group: "roast_picks", kind: "draft_pick", id: roastIds.pick(p.draftId, p.pickNo), fact: p });
        }
      }
    } catch (err) {
      notes.roast_picks = { job: "roast_picks", status: "error", detail: errText(err) };
    }
  }

  const index = await loadIndex(l);
  const writer = isRoastConfigured();
  // Candidates are newest first within each group, so the first REVOICE_NEWEST of a group are its newest.
  const seen: Partial<Record<Group, number>> = {};
  const recent = new Set(candidates.filter((c) => (seen[c.group] = (seen[c.group] ?? 0) + 1) <= REVOICE_NEWEST).map((c) => c.id));
  const wanted = candidates.filter((c) => wants(index, c.id, now, writer, recent.has(c.id)));
  // Out of today's budget for items: write nothing, so nothing counts as a failed attempt.
  const affordable = !writer || (await withinBudget("item", now));
  const selected = affordable ? wanted.slice(0, MAX_ROASTS_PER_TICK) : [];

  const updates: RoastIndex = {};
  const results = await mapLimit(selected, ROAST_CONCURRENCY, async (c) => {
    // Checked again per item: earlier items in this tick may have spent the rest of the budget,
    // and a refused call must not be saved as a failed attempt. (No writer: nothing to spend.)
    if (writer && !(await withinBudget("item", Date.now()))) return "budget" as const;
    const claim = store.keys.lock(l, `roast:${c.id}`);
    if (!(await store.lock(claim, ROAST_CLAIM_SECONDS).catch(() => false))) return "busy" as const;
    try {
      // A page may have written this item since the index was read: never pay for it twice.
      const fresh = await store.get<RoastIndex>(indexKey(l)).catch(() => null);
      if (fresh && !wants(fresh, c.id, Date.now(), writer, recent.has(c.id))) return "busy" as const;
      const prev = (fresh ?? index)[c.id];
      // What is on the site decides, not the index (an entry can be lost to a concurrent write):
      // a written post is never replaced by a facts-only one.
      let stored: Roast | null;
      try {
        stored = await getRoast(l, c.id);
      } catch {
        return "busy" as const; // cannot see what is on the site: try again next tick
      }
      const posted = stored?.source === "llm" || prev?.s === "llm";
      const base: IndexEntry = prev ?? (posted && stored ? { s: "llm", t: stored.createdAt, w: writer } : { s: "facts_only", t: now, w: writer });
      const counted = attemptsOf(base);
      let entry: IndexEntry;
      let result: "roasted" | "placeholder" | "error";
      try {
        // Pick roasts reuse the draft facts computed above instead of one draftFacts() call per pick.
        const r = await roastItem(c.kind, c.fact, ctx, { now, draftPicks });
        if (r.source === "placeholder") return "placeholder" as const;
        if (r.source === "llm") {
          await saveRoast({ ...r, id: c.id });
          entry = { s: "llm", t: now, w: writer, n: 0, o: 0, v: ROAST_VOICE, av: ROAST_VOICE };
        } else if (posted) {
          // A failed rewrite of a written post: keep the post, count the attempt.
          entry = { ...base, s: "llm", t: now, n: counted.n + 1, o: counted.o, av: ROAST_VOICE };
        } else {
          await saveRoast({ ...r, id: c.id });
          entry = { s: r.source, t: now, w: writer, n: writer ? counted.n + 1 : counted.n, o: counted.o, v: ROAST_VOICE, av: ROAST_VOICE };
        }
        result = "roasted";
      } catch (err) {
        if (err instanceof WriterOutage) {
          // The writer is down: keep a written post, show the facts where there is nothing yet
          // (once: a re-save would move an old post above newer ones), and try again later
          // without counting a failed attempt.
          if (!stored) await saveRoast({ ...err.fallback, id: c.id });
          entry = posted
            ? { ...base, s: "llm", t: now, n: counted.n, o: counted.o + 1, av: ROAST_VOICE }
            : { s: "facts_only", t: now, w: writer, n: counted.n, o: counted.o + 1, v: ROAST_VOICE, av: ROAST_VOICE };
          result = "error";
        } else {
          // Anything else: a written post keeps its place and the attempt counts (never retried
          // on every tick); an item with no post waits the hour like before.
          entry = posted ? { ...base, s: "llm", t: now, n: counted.n + 1, o: counted.o, av: ROAST_VOICE } : { ...base, s: "error", t: now };
          result = "error";
        }
      }
      // Recorded while the claim is still held, so a page never writes this item again meanwhile.
      updates[c.id] = entry;
      const latest = (await store.get<RoastIndex>(indexKey(l)).catch(() => null)) ?? index;
      await store.set(indexKey(l), { ...latest, [c.id]: entry });
      return result;
    } finally {
      await store.unlock(claim).catch(() => {});
    }
  });
  if (Object.keys(updates).length) {
    // Merge once more onto the latest index (concurrent items in this tick can race each other's
    // writes above), never over an entry another run recorded after ours.
    const latest = (await store.get<RoastIndex>(indexKey(l)).catch(() => null)) ?? index;
    const mine = Object.fromEntries(Object.entries(updates).filter(([id, e]) => !latest[id] || latest[id].t <= e.t));
    await store.set(indexKey(l), { ...latest, ...mine });
  }

  const outcomes: JobOutcome[] = [];
  for (const group of ["roast_trades", "roast_waivers", "roast_picks"] as Group[]) {
    if (notes[group]) {
      outcomes.push(notes[group]!);
      continue;
    }
    const [one, many] = LABEL[group];
    const mine = selected.map((c, i) => ({ c, r: results[i] })).filter((x) => x.c.group === group);
    const roasted = mine.filter((x) => x.r === "roasted").length;
    const failed = mine.filter((x) => x.r === "error").length;
    const placeholders = mine.filter((x) => x.r === "placeholder").length;
    const busy = mine.filter((x) => x.r === "busy").length;
    const broke = mine.filter((x) => x.r === "budget").length;
    const waiting = wanted.filter((c) => c.group === group).length - mine.length;
    const parts: string[] = [];
    if (roasted) parts.push(`Wrote up ${roasted} ${roasted === 1 ? one : many}.`);
    if (failed) parts.push(`${failed} failed.`);
    if (placeholders) parts.push(`${placeholders} came back as placeholders (not saved).`);
    if (busy) parts.push(`${busy} already being written by another run.`);
    if (broke) parts.push(`${broke} waiting for tomorrow's writer budget.`);
    if (waiting > 0) parts.push(affordable ? `${waiting} more next tick.` : `${waiting} waiting for tomorrow's writer budget.`);
    const status: JobOutcome["status"] = failed && !roasted ? "error" : roasted ? "ran" : "skipped";
    outcomes.push({ job: group, status, detail: parts.join(" ") || `No new ${many}.` });
  }
  return outcomes;
}


/**
 * Write one draft pick's line right now, for a page someone is looking at. It uses the same
 * per-item claim and the same index as the tick, so a pick is never written twice, and it obeys
 * the same retry rules (no endless retries on a pick the checks keep rejecting). If another
 * writer holds the claim it waits for that write, up to `budgetMs`. Never throws.
 */
export async function ensurePickRoast(
  ctx: LeagueContext,
  pick: DraftPickFact,
  picks: DraftPickFact[],
  budgetMs = 25_000,
): Promise<Roast | null> {
  const l = ctx.leagueId;
  const id = roastIds.pick(pick.draftId, pick.pickNo);
  const existing = await getRoast(l, id).catch(() => null);
  try {
    const writer = isRoastConfigured();
    if (!writer || existing?.source === "llm") return existing;
    const index = await loadIndex(l);
    const deadline = Date.now() + budgetMs;
    // Nothing to wait for unless this pick is wanted and some run is (or is about to be) writing
    // it: a pick the writer gave up on, one retried later, or one the budget cannot pay for today.
    if (!wants(index, id, Date.now(), writer)) return existing;
    if (!(await withinBudget("item"))) return existing;
    const claim = store.keys.lock(l, `roast:${id}`);
    if (await store.lock(claim, ROAST_CLAIM_SECONDS).catch(() => false)) {
      const now = Date.now();
      try {
        // Someone may have finished this pick between our first read and the claim.
        const again = await getRoast(l, id).catch(() => null);
        if (again?.source === "llm") return again;
        const idxNow = (await store.get<RoastIndex>(indexKey(l)).catch(() => null)) ?? index;
        if (idxNow[id]?.t !== index[id]?.t && !wants(idxNow, id, now, writer)) return again ?? existing;
        const frozen = await freezeDraftPickRanks(l, pick.draftId, picks).catch(() => null);
        const draftPicks = frozen ? picks.map((p) => withFrozenRank(p, frozen.get(p.pickNo))) : picks;
        const fact = draftPicks.find((p) => p.pickNo === pick.pickNo) ?? pick;
        const latest0 = (await store.get<RoastIndex>(indexKey(l)).catch(() => null)) ?? index;
        const counted = latest0[id] ? attemptsOf(latest0[id]) : { n: 0, o: 0 };
        let r: Roast;
        let outage = false;
        try {
          r = await roastItem("draft_pick", fact, ctx, { now, draftPicks });
        } catch (err) {
          if (!(err instanceof WriterOutage)) throw err;
          // The writer is down: show the facts, record the outage so pages and the tick wait.
          r = err.fallback;
          outage = true;
        }
        if (r.source === "placeholder") return existing;
        const saved: Roast = { ...r, id };
        await saveRoast(saved);
        const latest = (await store.get<RoastIndex>(indexKey(l)).catch(() => null)) ?? latest0;
        const entry: IndexEntry =
          r.source === "llm"
            ? { s: "llm", t: now, w: writer, n: 0, o: 0, v: ROAST_VOICE, av: ROAST_VOICE }
            : { s: r.source, t: now, w: writer, n: outage ? counted.n : counted.n + 1, o: outage ? counted.o + 1 : counted.o, v: ROAST_VOICE, av: ROAST_VOICE };
        await store.set(indexKey(l), { ...latest, [id]: entry });
        return saved;
      } finally {
        await store.unlock(claim).catch(() => {});
      }
    }
    // Someone else holds the claim (the tick or another viewer): wait for their result, and stop
    // as soon as they record one, whatever it is.
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await getRoast(l, id).catch(() => null);
      if (got?.source === "llm") return got;
      const entry = (await store.get<RoastIndex>(indexKey(l)).catch(() => null))?.[id];
      if (entry && entry.t !== index[id]?.t) return got ?? existing;
      // The holder let go without recording anything (a refused call): stop waiting.
      if (await store.lock(claim, 5).catch(() => false)) {
        await store.unlock(claim).catch(() => {});
        return got ?? existing;
      }
    }
    return (await getRoast(l, id).catch(() => null)) ?? existing;
  } catch {
    return existing;
  }
}
