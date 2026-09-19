/**
 * Instant roasts for new trades, waiver runs and draft picks. Pages already fire the tick
 * through after(); this route is for an uptime pinger during the draft. runTick() takes its
 * 2-minute cooldown lock before any other work, so a request loop costs one KV command per
 * hit, and the response carries only statuses, never league text. With the password gate on,
 * it needs the gate cookie or `Authorization: Bearer ${CRON_SECRET}`.
 */
import { checkTickAuth } from "@/lib/email/gate";
import { runTick } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

async function handle(req: Request): Promise<Response> {
  const auth = checkTickAuth(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const report = await runTick(new Date());
  return Response.json({ locked: report.locked, outcomes: report.outcomes.map((o) => ({ job: o.job, status: o.status })) }, { headers: NO_STORE });
}

export const GET = handle;
export const POST = handle;
