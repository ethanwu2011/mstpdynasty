import { configured } from "@/lib/env";
import { pickBackend } from "@/lib/store";
import { readWriterStatus } from "@/lib/roast/status";

export const dynamic = "force-dynamic";

/** Operational status only: which services are configured and how the last writer call went. */
export async function GET() {
  const writer = await readWriterStatus();
  return Response.json(
    {
      store: pickBackend(),
      writerConfigured: configured.anthropic(),
      emailConfigured: configured.resend(),
      lastWriterCall: writer,
      // Names only, never values: which relevant settings this deployment can see.
      envPresent: Object.fromEntries(
        [
          "ANTHROPIC_API_KEY", "RESEND_API_KEY", "EMAIL_FROM", "COMMISSIONER_EMAIL", "NEWSLETTER_MODE", "LEAGUE_EMAILS",
          "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_URL", "REDIS_URL",
          "CRON_SECRET", "ADMIN_SECRET", "SITE_URL",
        ].map((k) => [k, Boolean(process.env[k])]),
      ),
      deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
