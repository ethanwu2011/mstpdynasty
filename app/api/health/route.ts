import { leagueEmailsFromEnv, recipientSummary } from "@/lib/email";
import { adminSecretProblem, bearerOf, checkAdminAuth, checkCronAuth, clientIp } from "@/lib/email/gate";
import { allowAdminAttempt } from "@/lib/email/limits";
import { configured } from "@/lib/env";
import { isRoastConfigured } from "@/lib/roast";
import { pickBackend } from "@/lib/store";
import { readWriterStatus } from "@/lib/roast/status";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Operational status only: which services are configured and how the last writer call went.
 * Public (when the site has no password) it says only whether a recipient list is configured.
 * With the CRON_SECRET or ADMIN_SECRET bearer it adds the counts (how many addresses the next
 * send would reach and how many opted out: a count, never an address, but in a ten-person league
 * a public opt-out count would still say somebody unsubscribed) and whether ADMIN_SECRET is
 * usable. Bearer attempts go through the admin limiter, counted before anything is compared.
 */
export async function GET(req: Request) {
  let authed = false;
  if (bearerOf(req)) {
    if (!(await allowAdminAttempt(clientIp(req)))) {
      return Response.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: NO_STORE });
    }
    authed = Boolean(process.env.CRON_SECRET && checkCronAuth(req).ok) || checkAdminAuth(req).ok;
  }
  const [writer, recipients] = await Promise.all([readWriterStatus(), authed ? recipientSummary().catch(() => null) : Promise.resolve(null)]);
  return Response.json(
    {
      store: pickBackend(),
      writerConfigured: configured.anthropic(),
      // False on Vercel until the shared store is connected, even with the key set.
      writerRunning: isRoastConfigured(),
      emailConfigured: configured.resend(),
      commissionerEmailConfigured: configured.commissionerEmail(),
      recipients: authed ? recipients : { configured: leagueEmailsFromEnv().length > 0 },
      ...(authed ? { adminSecret: adminSecretProblem() ?? "ok" } : {}),
      lastWriterCall: writer,
    },
    { headers: NO_STORE },
  );
}
