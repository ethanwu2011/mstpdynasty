/**
 * The test email behind POST /api/admin/test-email: the newest stored issue, or (when nothing
 * is stored yet) a sample Daily built from current facts, sent as a marked test copy to
 * COMMISSIONER_EMAIL only. The sample is never saved and moves no cursor, so it cannot change
 * what the real Daily covers. Every check and the hourly count come first (testSendPreflight),
 * so a refused or capped request never builds a sample, which costs a model call.
 */
import { listIssues } from "@/lib/archive";
import { sendTest, testSendPreflight } from "@/lib/email";
import { getLeagueContext } from "@/lib/league";
import { roastIssue } from "@/lib/roast";
import { getSchedule } from "@/lib/sleeper";
import type { Issue, LeagueContext, NflGame, TestEmailResult } from "@/lib/types";
import { buildDailyFacts } from "./daily-facts";

async function sampleIssue(ctx: LeagueContext, now: number): Promise<Issue | null> {
  const schedule = await getSchedule(ctx.season).catch(() => [] as NflGame[]);
  const b = await buildDailyFacts(ctx, now, schedule);
  if (b.placeholder) return null;
  return roastIssue("daily", b.facts, ctx, { now });
}

export async function sendTestEmail(now: Date = new Date(), opts: { ctx?: LeagueContext } = {}): Promise<TestEmailResult> {
  try {
    const ctx = opts.ctx ?? (await getLeagueContext());
    const refused = await testSendPreflight(ctx.leagueId);
    if (refused) return { ...refused, issueSlug: null, sample: false };
    const stored = (await listIssues(ctx.leagueId, { includeUnsent: true, limit: 1 }))[0] ?? null;
    const issue = stored ?? (await sampleIssue(ctx, now.getTime()));
    if (!issue) return { status: "skipped", recipients: 0, messageIds: [], error: "No issue and no facts to build a sample from.", issueSlug: null, sample: false };
    const res = await sendTest({ issue, counted: true });
    return { ...res, issueSlug: stored ? stored.slug : null, sample: !stored };
  } catch (err) {
    return { status: "error", recipients: 0, messageIds: [], error: err instanceof Error ? err.message : String(err), issueSlug: null, sample: false };
  }
}
