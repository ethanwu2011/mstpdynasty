import { readEmailStatus, recipientSummary } from "@/lib/email";
import { adminSecretProblem, bearerOf, checkAdminAuth, checkCronAuth, clientIp } from "@/lib/email/gate";
import { allowAdminAttempt } from "@/lib/email/limits";
import { configured } from "@/lib/env";
import { dailyBudgetUsd, isRoastConfigured, ROAST_MODELS, spentTodayUsd } from "@/lib/roast";
import { pickBackend } from "@/lib/store";
import { readDrops, readWriterStatus } from "@/lib/roast/status";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Names only, never values: which relevant settings this deployment can see. */
const ENV_NAMES = [
  "ANTHROPIC_API_KEY", "RESEND_API_KEY", "EMAIL_FROM", "COMMISSIONER_EMAIL", "NEWSLETTER_MODE", "LEAGUE_EMAILS",
  "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_URL", "REDIS_URL",
  "CRON_SECRET", "ADMIN_SECRET", "SITE_URL",
];

/**
 * Operational status only, public: which services are configured, how the last writer call and
 * the last email went (counts and scrubbed errors, never an address), which settings the
 * deployment can see (names only) and the deployed commit. No secrets and no addresses.
 *
 * With the CRON_SECRET or ADMIN_SECRET bearer it adds detail: whether the writer actually runs
 * (false on Vercel until the shared store is connected), whether COMMISSIONER_EMAIL is set, the
 * recipient counts (how many addresses the next send would reach and how many opted out: a
 * count, never an address, but in a ten-person league a public opt-out count would still say
 * somebody unsubscribed) and whether ADMIN_SECRET is usable. Bearer attempts go through the
 * admin limiter, counted before anything is compared.
 */
export async function GET(req: Request) {
  let authed = false;
  if (bearerOf(req)) {
    if (!(await allowAdminAttempt(clientIp(req)))) {
      return Response.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: NO_STORE });
    }
    authed = Boolean(process.env.CRON_SECRET && checkCronAuth(req).ok) || checkAdminAuth(req).ok;
  }
  const [writer, email, drops, recipients, spent] = await Promise.all([
    readWriterStatus(),
    readEmailStatus(),
    readDrops(),
    authed ? recipientSummary().catch(() => null) : Promise.resolve(null),
    spentTodayUsd().catch(() => null),
  ]);
  return Response.json(
    {
      store: pickBackend(),
      writerConfigured: configured.anthropic(),
      emailConfigured: configured.resend(),
      lastWriterCall: writer,
      // Which model writes what, and today's API spend (Eastern day) against the daily budget.
      writerModels: ROAST_MODELS,
      writerSpendToday: spent === null ? null : { usd: Math.round(spent * 100) / 100, budgetUsd: dailyBudgetUsd() },
      lastEmail: email,
      // Sentences the fact check threw out most recently (the same text the site would have shown).
      recentDrops: drops.slice(0, 12),
      envPresent: Object.fromEntries(ENV_NAMES.map((k) => [k, Boolean(process.env[k])])),
      deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      ...(authed
        ? {
            writerRunning: isRoastConfigured(),
            commissionerEmailConfigured: configured.commissionerEmail(),
            recipients,
            adminSecret: adminSecretProblem() ?? "ok",
          }
        : {}),
    },
    { headers: NO_STORE },
  );
}
