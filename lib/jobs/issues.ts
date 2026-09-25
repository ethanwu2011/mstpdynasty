/**
 * Build, store and deliver one planned issue, exactly once.
 *
 *   done:<key>     set after the issue is stored AND delivered (or the day was quiet)
 *   built:<key>    slug of the stored issue, so a retry after a failed email re-delivers the
 *                  same issue instead of paying for a second LLM call
 *
 * Delivery policy:
 *   dev league                 stored as a draft only, never emailed or published
 *   review mode                review copy to the commissioner; published when approved
 *   auto mode                  emailed to the league list (LEAGUE_EMAILS minus opt-outs) and published
 *   auto, email not set up     published on the site without email ("approved")
 *   review, email not set up   stays a draft (nobody can approve it yet)
 */
import { getIssue, saveIssue } from "@/lib/archive";
import { emailedVersions, issueWordsHash, resendIssue, sendIssue } from "@/lib/email";
import { newsletterMode } from "@/lib/env";
import { draftFacts, tnfFacts, weeklyFacts } from "@/lib/facts";
import { backfillOddsHistory, getPowerRankings, getWinProbabilities, runSeasonSim } from "@/lib/models";
import { issueBrief, roastIssue, type IssueReport } from "@/lib/roast";
import * as store from "@/lib/store";
import type { Issue, IssueFacts, IssueKind, JobOutcome, LeagueContext, NflGame } from "@/lib/types";
import { buildDailyFacts, lineupAlertsNow } from "./daily-facts";
import { claimOnce, getDone, markDone, releaseClaim } from "./once";
import type { PlannedJob } from "./schedule";

const NOT_READY = "Facts are still placeholder data, so nothing was built.";

type FactsStep =
  | { kind: "facts"; facts: IssueFacts; commit?: () => Promise<void> }
  /** `final`: nothing to do for this period (mark done). Otherwise release so a later run can retry. */
  | { kind: "skip"; detail: string; final: boolean; commit?: () => Promise<void> };

const skipStep = (detail: string, final: boolean, commit?: () => Promise<void>): FactsStep => ({ kind: "skip", detail, final, commit });

async function factsFor(job: PlannedJob, ctx: LeagueContext, now: number, schedule: NflGame[]): Promise<FactsStep> {
  switch (job.job) {
    case "daily": {
      const b = await buildDailyFacts(ctx, now, schedule);
      if (b.placeholder) return skipStep(NOT_READY, false);
      if (!b.facts.hasMaterial) return skipStep("Quiet day: nothing happened, nothing sent.", true, b.commit);
      return { kind: "facts", facts: b.facts, commit: b.commit };
    }
    case "thursday_fallout": {
      const tnf = await tnfFacts(job.week, ctx);
      if (tnf.placeholder) return skipStep(NOT_READY, false);
      if (!tnf.players.some((p) => p.team)) return skipStep(`No rostered player played early in week ${job.week}.`, true);
      const winProbs = await getWinProbabilities(job.week, ctx);
      if (winProbs.placeholder) return skipStep(NOT_READY, false);
      return { kind: "facts", facts: { kind: "thursday_fallout", week: job.week, tnf, winProbs } };
    }
    case "sunday_preview": {
      const winProbs = await getWinProbabilities(job.week, ctx);
      if (winProbs.placeholder) return skipStep(NOT_READY, false);
      if (!winProbs.matchups.length) return skipStep(`No matchups in week ${job.week}.`, true);
      const lineupAlerts = await lineupAlertsNow(ctx, schedule, job.week, now);
      return { kind: "facts", facts: { kind: "sunday_preview", week: job.week, winProbs, lineupAlerts } };
    }
    case "sunday_recap": {
      const winProbs = await getWinProbabilities(job.week, ctx);
      if (winProbs.placeholder) return skipStep(NOT_READY, false);
      if (!winProbs.matchups.length) return skipStep(`No matchups in week ${job.week}.`, true);
      if (!winProbs.matchups.some((m) => m.home.actual || m.away.actual)) return skipStep(`No points in week ${job.week} yet.`, false);
      return { kind: "facts", facts: { kind: "sunday_recap", week: job.week, winProbs } };
    }
    case "weekly_recap": {
      const weekly = await weeklyFacts(job.week, ctx);
      if (weekly.placeholder) return skipStep(NOT_READY, false);
      if (weekly.teams.length === 0 || weekly.teams.every((t) => !t.points)) return skipStep(`No scores for week ${job.week} yet.`, false);
      // Rankings and odds as of the recapped week (not whatever Sleeper's week counter says).
      const power = await getPowerRankings(ctx, { asOfWeek: job.week });
      if (power.placeholder) return skipStep(NOT_READY, false);
      const odds = await runSeasonSim({ ctx, fromWeek: job.week + 1, persist: true });
      if (odds.placeholder) return skipStep(NOT_READY, false);
      // Fill any week the odds chart is missing (a skipped cron, a wiped store). Best effort.
      await backfillOddsHistory(ctx).catch(() => []);
      return { kind: "facts", facts: { kind: "weekly_recap", week: job.week, weekly, odds, power } };
    }
    case "draft_grades": {
      const draft = await draftFacts(ctx);
      if (draft.placeholder) return skipStep(NOT_READY, false);
      if (draft.status !== "complete" || !draft.grades?.length) return skipStep("Draft grades are not computed yet.", false);
      // Same model as the "if the season started today" odds on the site (draftOdds): rosters
      // rated by Sleeper's season projections, stored as the preseason odds snapshot.
      const odds = await runSeasonSim({ ctx, persist: true, strength: "season" });
      if (odds.placeholder) return skipStep(NOT_READY, false);
      return { kind: "facts", facts: { kind: "draft_grades", draft, odds } };
    }
  }
}

export interface Delivery {
  ok: boolean;
  detail: string;
}

/** Email or publish a stored issue according to the league and NEWSLETTER_MODE. */
export async function deliverIssue(issue: Issue, ctx: LeagueContext): Promise<Delivery> {
  if (ctx.isDevLeague) return { ok: true, detail: "Dev league: saved as a draft, never emailed or published." };
  const mode = newsletterMode();
  const res = await sendIssue(issue, mode);
  switch (res.status) {
    case "sent":
      return { ok: true, detail: `Emailed to ${res.recipients} league address${res.recipients === 1 ? "" : "es"} and published.` };
    case "review_sent":
      return { ok: true, detail: "Review copy sent to the commissioner. Published once approved." };
    case "skipped":
      return { ok: true, detail: `Email skipped: ${bare(res.error, "nothing to do")}.` };
    case "not_configured":
      if (mode === "auto") {
        const current = (await getIssue(issue.leagueId, issue.slug)) ?? issue;
        if (current.status === "draft") await saveIssue({ ...current, status: "approved" });
        return { ok: true, detail: `Published on the site without email (${bare(res.error, "email not configured")}).` };
      }
      return { ok: true, detail: `Saved as a draft for review; email is not configured (${bare(res.error, "unknown")}).` };
    case "error":
    default:
      return { ok: false, detail: `Issue saved as a draft, but email failed: ${bare(res.error, "unknown error")}.` };
  }
}

/** An error message inside parentheses or after a colon, without its own closing period. */
const bare = (msg: string | undefined, fallback: string) => (msg ?? fallback).trim().replace(/\.+$/, "");

const builtKey = (leagueId: string, key: string) => store.keys.snapshot(leagueId, `built:${key}`);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const published = (i: Issue) => i.status === "sent" || i.status === "approved";

/**
 * The same period's job key before the issue rename ("daily_roast:DATE", "weekly_roast:S:W").
 * A deploy on a day the old code already ran must not build and send that issue again under
 * its new key and slug.
 */
export function legacyJobKey(key: string): string | null {
  if (key.startsWith("daily:")) return `daily_roast:${key.slice("daily:".length)}`;
  if (key.startsWith("weekly_recap:")) return `weekly_roast:${key.slice("weekly_recap:".length)}`;
  return null;
}

/** Pause between claim retries in runIssueJob (tests shorten it). */
let CLAIM_RETRY_MS = 1500;
export function setClaimRetryMsForTests(ms: number): void {
  CLAIM_RETRY_MS = ms;
}

export async function runIssueJob(job: PlannedJob, ctx: LeagueContext, now: number, schedule: NflGame[]): Promise<JobOutcome> {
  const l = ctx.leagueId;
  const legacy = legacyJobKey(job.key);
  if (legacy && (await getDone(l, legacy).catch(() => null))) {
    return { job: job.job, status: "skipped", detail: "Already done for this period (before the issue rename)." };
  }
  // Mark the period seen before claiming: a writer's reply that lands after this run (which may
  // skip or fail) is then sent at once instead of waiting for a run that never comes.
  await store.set(seenKey(l, job.key), Date.now(), { ttlSeconds: 8 * 86_400 }).catch(() => undefined);
  let claim = await claimOnce(l, job.key).catch(() => "busy" as const);
  // An external writer holds the claim only for the few store writes of a save: wait it out.
  for (let i = 0; claim === "busy" && i < 4; i++) {
    await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
    claim = await claimOnce(l, job.key).catch(() => "busy" as const);
  }
  if (claim === "done") return { job: job.job, status: "skipped", detail: "Already done for this period." };
  if (claim === "busy") return { job: job.job, status: "skipped", detail: "Another run is working on it." };

  try {
    const slug = await store.get<string>(builtKey(l, job.key));
    let issue = slug ? await getIssue(l, slug) : null;

    if (!issue) {
      const step = await factsFor(job, ctx, now, schedule);
      if (step.kind === "skip") {
        if (step.final) {
          await step.commit?.();
          await markDone(l, job.key, { at: Date.now(), skipped: step.detail });
        } else await releaseClaim(l, job.key);
        return { job: job.job, status: "skipped", detail: step.detail };
      }
      // The issue's date and slug come from the job's clock, like everything else in the run.
      const built = await roastIssue(job.job, step.facts, ctx, { now });
      if (built.placeholder) {
        await releaseClaim(l, job.key);
        return { job: job.job, status: "skipped", detail: "The writer returned a placeholder issue, so nothing was stored." };
      }
      const existing = await getIssue(l, built.slug);
      if (existing && published(existing)) {
        await step.commit?.();
        await markDone(l, job.key, { at: Date.now(), slug: existing.slug });
        return { job: job.job, status: "skipped", detail: `Already published as ${existing.slug}.`, issueSlug: existing.slug };
      }
      await saveIssue(built);
      await store.set(builtKey(l, job.key), built.slug, { ttlSeconds: 30 * 24 * 3600 });
      await step.commit?.();
      issue = built;
    }

    if (published(issue)) {
      await markDone(l, job.key, { at: Date.now(), slug: issue.slug });
      return { job: job.job, status: "skipped", detail: `Already published as ${issue.slug}.`, issueSlug: issue.slug };
    }

    const d = await deliverIssue(issue, ctx);
    if (!d.ok) {
      await releaseClaim(l, job.key);
      return { job: job.job, status: "error", detail: d.detail, issueSlug: issue.slug };
    }
    await markDone(l, job.key, { at: Date.now(), slug: issue.slug });
    const how = issue.factsOnly ? " Facts only (no writer)." : "";
    return { job: job.job, status: "ran", detail: `${d.detail}${how}`, issueSlug: issue.slug };
  } catch (err) {
    await releaseClaim(l, job.key).catch(() => {});
    return { job: job.job, status: "error", detail: errText(err) };
  }
}

/* ------------------------------------------------------------------ */
/* the external writer                                                 */
/* ------------------------------------------------------------------ */

/**
 * Claude Code on the commissioner's own plan can write the issues instead of the site's API
 * writer: GET /api/admin/issue hands it each due issue's brief (the exact system prompt and user
 * message the site's writer would send), and POST /api/admin/issue brings the reply back, which
 * roastIssue holds to the same post-check. A reply that comes back before the 8 AM job is
 * stored under the job's built key, so that job sends it instead of paying for a model call. If
 * no reply comes, the job writes the issue itself as before.
 */
interface StoredBrief {
  job: PlannedJob;
  facts: IssueFacts;
  now: number;
  /**
   * Briefed with rewrite=1 against an issue that had already gone out: the words it may replace
   * (issueWordsHash). A reply is refused ("stale") once the issue's words have moved on to
   * anything but the reply's own, and a rewrite brief taken before the issue went out is an
   * ordinary brief.
   */
  rewriteOf?: string;
}

/** Set by runIssueJob when the day's job has come by for a period: a reply that arrives later is sent at once. */
const seenKey = (leagueId: string, key: string) => store.keys.snapshot(leagueId, `job-seen:${key}`);

const briefKey = (leagueId: string, slug: string) => store.keys.snapshot(leagueId, `ext-brief:${slug}`);
const BRIEF_TTL_SECONDS = 6 * 3600;

export interface ExternalBrief {
  job: PlannedJob["job"];
  key: string;
  slug: string;
  kind: IssueKind;
  date: string;
  /** Already emailed or on the site: only a rewrite brief may replace its words. */
  published: boolean;
  system: string;
  user: string;
  slots: string[];
}

/**
 * The Daily stays with the site's own writer: its facts come from a cursor that moves when an
 * issue is stored, so a brief taken at one time and a reply posted at another would drop or
 * repeat material. It runs only outside the season now.
 */
const EXTERNAL_KINDS = new Set<PlannedJob["job"]>(["thursday_fallout", "sunday_preview", "sunday_recap", "weekly_recap", "draft_grades"]);

export async function externalBriefs(
  jobs: PlannedJob[],
  ctx: LeagueContext,
  now: number,
  schedule: NflGame[],
  opts: { rewrite?: boolean } = {},
): Promise<{ briefs: ExternalBrief[]; skipped: Array<{ job: string; detail: string }> }> {
  const l = ctx.leagueId;
  const briefs: ExternalBrief[] = [];
  const skipped: Array<{ job: string; detail: string }> = [];
  for (const job of jobs) {
    if (!EXTERNAL_KINDS.has(job.job)) {
      skipped.push({ job: job.job, detail: "The site writes this one itself." });
      continue;
    }
    if (!opts.rewrite && (await getDone(l, job.key).catch(() => null))) {
      skipped.push({ job: job.job, detail: "Already done for this period (pass rewrite=1 to rewrite it)." });
      continue;
    }
    const step = await factsFor(job, ctx, now, schedule);
    if (step.kind === "skip") {
      skipped.push({ job: job.job, detail: step.detail });
      continue;
    }
    const b = await issueBrief(step.facts, ctx, now);
    const existing = await getIssue(l, b.slug);
    const rewriteOf = opts.rewrite && existing && published(existing) ? issueWordsHash(existing) : undefined;
    await store.set<StoredBrief>(briefKey(l, b.slug), { job, facts: step.facts, now, ...(rewriteOf !== undefined ? { rewriteOf } : {}) }, { ttlSeconds: BRIEF_TTL_SECONDS });
    briefs.push({ job: job.job, key: job.key, slug: b.slug, kind: b.kind, date: b.date, published: Boolean(existing && published(existing)), system: b.system, user: b.user, slots: b.slots });
  }
  return { briefs, skipped };
}

export interface ExternalPublish {
  status: "checked" | "queued" | "sent" | "updated" | "resent" | "rejected" | "missing" | "stale" | "busy" | "error";
  detail: string;
  slug: string;
  report: IssueReport | null;
  /** The dek and section text as they would print (dry runs and every result). */
  preview?: { dek: string; sections: Array<{ heading: string; text: string[] }> };
}

export interface ExternalPublishOptions {
  /** "queue" (default): the 8 AM job sends a new issue. "now": send a new issue now, or email a rewritten one again. */
  deliver?: "queue" | "now";
  /** Check the reply and return the report without saving or sending anything. */
  dryRun?: boolean;
}

function previewOf(issue: Issue): ExternalPublish["preview"] {
  return {
    dek: issue.dek,
    sections: issue.sections.map((sec) => ({
      heading: sec.heading,
      text: sec.blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "list" ? b.items : [])),
    })),
  };
}

/** The words of an issue, for "did a rewrite change anything". */
const wordsOf = (i: Pick<Issue, "dek" | "sections">) => JSON.stringify([i.dek, i.sections]);

export async function publishExternal(
  slug: string,
  text: string,
  model: string,
  ctx: LeagueContext,
  schedule: NflGame[],
  opts: ExternalPublishOptions = {},
): Promise<ExternalPublish> {
  void schedule;
  const l = ctx.leagueId;
  const brief = await store.get<StoredBrief>(briefKey(l, slug));
  if (!brief) return { status: "missing", detail: "No brief for that slug in the last 6 hours. GET /api/admin/issue first.", slug, report: null };
  const report: IssueReport = { accepted: [], failed: [], partial: [], reasons: [] };
  const built = await roastIssue(brief.job.job, brief.facts, ctx, { now: brief.now, reply: { text, model }, report });
  if (built.placeholder || built.factsOnly) {
    return { status: "rejected", detail: "Too many slots failed the checks, so nothing was saved. Fix them and post again.", slug, report };
  }
  const preview = previewOf(built);
  if (opts.dryRun) return { status: "checked", detail: "Checked only: nothing saved or sent.", slug, report, preview };

  const existing = await getIssue(l, built.slug);
  if (existing && published(existing)) {
    // Only a rewrite brief taken against this very version may replace words that went out; a
    // late reply to an older brief would put older, thinner facts over what the league was sent.
    const kept: Issue = {
      ...built,
      status: existing.status,
      sentAt: existing.sentAt,
      recipientCount: existing.recipientCount,
      createdAt: existing.createdAt,
      // What the league holds, carried over (and filled in for an issue sent before the record).
      ...(existing.status === "sent" ? { emailedWords: emailedVersions(existing) } : {}),
    };
    const onSite = issueWordsHash(existing);
    if (brief.rewriteOf === undefined || (onSite !== brief.rewriteOf && onSite !== issueWordsHash(kept))) {
      return { status: "stale", detail: "This issue already went out (or changed since this brief). Get a new rewrite brief (rewrite=1) to replace it.", slug, report, preview };
    }
    const changed = wordsOf(kept) !== wordsOf(existing);
    if (changed) await saveIssue(kept);
    const alreadyEmailed = emailedVersions(kept).includes(issueWordsHash(kept));
    if (opts.deliver !== "now" || existing.status !== "sent" || alreadyEmailed) {
      const detail = !changed
        ? "Same words as the issue on the site: nothing changed."
        : alreadyEmailed
          ? "Replaced on the site. These exact words already went to the league, so nobody was emailed."
          : "Replaced on the site. Nobody was emailed again.";
      return { status: "updated", detail, slug, report, preview };
    }
    const res = await resendIssue(kept);
    return res.status === "sent"
      ? { status: "resent", detail: `Replaced on the site and emailed again to ${res.recipients} address${res.recipients === 1 ? "" : "es"}.`, slug, report, preview }
      : { status: "error", detail: `Replaced on the site, but the email did not go: ${res.error ?? res.status}.`, slug, report, preview };
  }

  // A new issue: under the same once-per-period claim the 8 AM job takes, so the two never
  // both write or both send.
  const claim = await claimOnce(l, brief.job.key).catch(() => "busy" as const);
  if (claim === "done") return { status: "stale", detail: "This period's job already ran (a review copy may be waiting for approval).", slug, report, preview };
  if (claim === "busy") return { status: "busy", detail: "The morning job is working on this issue right now. Post again in a few minutes: if it skipped, your reply goes out then.", slug, report, preview };
  try {
    // Inside the claim, look again: the morning job may have published it just before.
    const again = await getIssue(l, built.slug);
    if (again && published(again)) {
      await releaseClaim(l, brief.job.key);
      return { status: "stale", detail: "This issue already went out.", slug, report, preview };
    }
    // A fresh createdAt: an approve link sent for an earlier version never sends this one.
    const fresh: Issue = { ...built, createdAt: Date.now() };
    await saveIssue(fresh);
    await store.set(builtKey(l, brief.job.key), built.slug, { ttlSeconds: 30 * 24 * 3600 });
    // The day's job runs once, and each weekly issue is planned on one weekday only: if it has
    // already come by for this period (and skipped or failed), nobody else will send this, so
    // send it now.
    const jobCameBy = Boolean(await store.get(seenKey(l, brief.job.key)).catch(() => null));
    if (opts.deliver !== "now" && !jobCameBy) {
      await releaseClaim(l, brief.job.key);
      return { status: "queued", detail: "Stored. The morning job sends it.", slug, report, preview };
    }
    const d = await deliverIssue(fresh, ctx);
    if (!d.ok) {
      await releaseClaim(l, brief.job.key);
      return { status: "error", detail: d.detail, slug, report, preview };
    }
    await markDone(l, brief.job.key, { at: Date.now(), slug: built.slug });
    return { status: "sent", detail: d.detail, slug, report, preview };
  } catch (err) {
    await releaseClaim(l, brief.job.key).catch(() => {});
    return { status: "error", detail: errText(err), slug, report, preview };
  }
}
