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
import { sendIssue } from "@/lib/email";
import { newsletterMode } from "@/lib/env";
import { draftFacts, tnfFacts, weeklyFacts } from "@/lib/facts";
import { backfillOddsHistory, getPowerRankings, getWinProbabilities, runSeasonSim } from "@/lib/models";
import { roastIssue } from "@/lib/roast";
import * as store from "@/lib/store";
import type { Issue, IssueFacts, JobOutcome, LeagueContext, NflGame } from "@/lib/types";
import { buildDailyFacts } from "./daily-facts";
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

export async function runIssueJob(job: PlannedJob, ctx: LeagueContext, now: number, schedule: NflGame[]): Promise<JobOutcome> {
  const l = ctx.leagueId;
  const legacy = legacyJobKey(job.key);
  if (legacy && (await getDone(l, legacy).catch(() => null))) {
    return { job: job.job, status: "skipped", detail: "Already done for this period (before the issue rename)." };
  }
  const claim = await claimOnce(l, job.key).catch(() => "busy" as const);
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
