/**
 * GET /api/admin/send-test: builds today's Daily from live data and emails a [Test] copy to the
 * commissioner only (COMMISSIONER_EMAIL, else the first LEAGUE_EMAILS address).
 * Safe without a secret: the recipient is fixed server-side, nothing reaches the league list,
 * the daily cursor is not moved (the 8 AM send is unaffected), and it runs at most once per 15 minutes.
 */
import { getLeagueContext } from "@/lib/league";
import { getSchedule } from "@/lib/sleeper";
import { buildDailyRoastFacts } from "@/lib/jobs/daily-facts";
import { roastIssue } from "@/lib/roast";
import { sendTestCopy } from "@/lib/email";
import * as store from "@/lib/store";
import type { NflGame } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  if (!(await store.lock("ops:send-test", 900).catch(() => false))) {
    return Response.json({ status: "wait", detail: "One test email every 15 minutes." }, { status: 429, headers: NO_STORE });
  }
  try {
    const ctx = await getLeagueContext();
    const now = Date.now();
    const schedule = await getSchedule(ctx.season).catch(() => [] as NflGame[]);
    const built = await buildDailyRoastFacts(ctx, now, schedule);
    if (built.placeholder) return Response.json({ status: "not_ready" }, { headers: NO_STORE });
    if (!built.facts.hasMaterial) return Response.json({ status: "quiet", detail: "Nothing happened since the last issue." }, { headers: NO_STORE });
    const issue = await roastIssue("daily_roast", built.facts, ctx, { now });
    const sent = await sendTestCopy(issue);
    return Response.json(
      { status: sent.status, title: issue.title, factsOnly: Boolean((issue as { factsOnly?: boolean }).factsOnly), error: sent.status === "sent" ? undefined : "see /api/health lastEmail" },
      { headers: NO_STORE },
    );
  } catch {
    return Response.json({ status: "error", detail: "Build failed. See /api/health." }, { status: 500, headers: NO_STORE });
  }
}
