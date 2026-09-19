/**
 * Vercel cron, once a day at 12:00 UTC (vercel.json). Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}`; without CRON_SECRET the route only runs in local dev.
 */
import { checkCronAuth } from "@/lib/email/gate";
import { runDaily } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request): Promise<Response> {
  const auth = checkCronAuth(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const report = await runDaily(new Date());
  return Response.json(report, { headers: NO_STORE });
}
