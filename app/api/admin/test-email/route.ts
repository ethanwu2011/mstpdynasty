/**
 * POST /api/admin/test-email: send the newest stored issue (or, before any issue exists, a
 * sample Daily built from current facts) as a marked test copy to COMMISSIONER_EMAIL only.
 *
 *   Authorization: Bearer <ADMIN_SECRET>   constant-time compare; 401 when missing or wrong, and
 *                                          also while ADMIN_SECRET is unset or shorter than 32
 *                                          characters (never open, not even in dev)
 *   body                                   ignored
 *   answer                                 { status, recipients, issueSlug, sample, error? }:
 *                                          counts and slugs only, never an address
 *
 * Every bearer attempt, right or wrong, is counted per IP (10) and overall (30) per 15 minutes
 * BEFORE the secret is compared, so parallel guesses cannot race past the limit. sendTest allows
 * 10 test emails an hour and its checks run before a sample issue is built, so a leaked secret can
 * neither flood the inbox nor spend model calls without bound. The proxy lets this path through
 * the password gate (it carries its own secret).
 */
import { scrubAddresses } from "@/lib/email";
import { bearerOf, checkAdminAuth, clientIp } from "@/lib/email/gate";
import { allowAdminAttempt } from "@/lib/email/limits";
import { sendTestEmail } from "@/lib/jobs";
import type { TestEmailResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" };

const HTTP: Record<TestEmailResult["status"], number> = {
  test_sent: 200,
  sent: 200,
  review_sent: 200,
  skipped: 409,
  not_configured: 503,
  error: 502,
};

export async function POST(req: Request): Promise<Response> {
  // Counted first, compared second: only a request that carries a bearer is ever compared.
  if (bearerOf(req) && !(await allowAdminAttempt(clientIp(req)))) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: NO_STORE });
  }
  const auth = checkAdminAuth(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  const res = await sendTestEmail(new Date());
  const body: Record<string, unknown> = {
    status: res.status,
    recipients: res.recipients,
    issueSlug: res.issueSlug,
    sample: res.sample,
  };
  if (res.error) body.error = scrubAddresses(res.error);
  return Response.json(body, { status: HTTP[res.status] ?? 500, headers: NO_STORE });
}
