/**
 * Newsletter sign-up. Accepts the /subscribe form (redirects back with ?status=) or JSON
 * ({ email, managerKey } -> SubscribeResult, fixed messages only). Double opt-in, capped and
 * rate limited per IP and site-wide: see lib/email subscribe().
 */
import { subscribe } from "@/lib/email";
import { clientIp } from "@/lib/email/gate";
import type { SubscribeResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const HTTP: Record<SubscribeResult["status"], number> = {
  subscribed: 200,
  already_subscribed: 200,
  invalid_email: 400,
  unknown_manager: 400,
  full: 409,
  try_later: 429,
  not_configured: 503,
  error: 500,
};

export async function POST(req: Request): Promise<Response> {
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let email: unknown;
  let managerKey: unknown;
  if (isJson) {
    const body = (await req.json().catch(() => null)) as { email?: unknown; managerKey?: unknown } | null;
    email = body?.email;
    managerKey = body?.managerKey;
  } else {
    const form = await req.formData().catch(() => null);
    email = form?.get("email");
    managerKey = form?.get("managerKey");
  }
  const result = await subscribe(
    { email: typeof email === "string" ? email : "", managerKey: typeof managerKey === "string" ? managerKey : "" },
    Date.now(),
    { ip: clientIp(req) },
  );
  if (isJson) return Response.json(result, { status: HTTP[result.status], headers: { "cache-control": "no-store" } });
  return Response.redirect(new URL(`/subscribe?status=${result.status}`, req.url), 303);
}
