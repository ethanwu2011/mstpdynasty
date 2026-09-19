/**
 * Unsubscribe link from every email: ?token=<HMAC-signed token>.
 *   GET   a one-button confirmation page (link scanners only GET, so they never unsubscribe anyone)
 *   POST  unsubscribes; also serves RFC 8058 one-click (List-Unsubscribe-Post) from mail clients
 */
import { isUnsubscribeTokenValid, unsubscribe } from "@/lib/email";
import { htmlPage, postButton } from "@/lib/email/page";

export const dynamic = "force-dynamic";

const tokenOf = (req: Request) => new URL(req.url).searchParams.get("token") ?? "";

export async function GET(req: Request): Promise<Response> {
  const token = tokenOf(req);
  if (!isUnsubscribeTokenValid(token)) return htmlPage("Unsubscribe", "<h1>Unsubscribe</h1><p>This unsubscribe link is not valid.</p>", 403);
  return htmlPage(
    "Unsubscribe",
    [
      "<h1>Unsubscribe from the MSTP Dynasty newsletter?</h1>",
      "<p>You will stop getting the newsletter. The site stays up, and so does everything on it about you.</p>",
      postButton(`/api/unsubscribe?token=${encodeURIComponent(token)}`, "Unsubscribe"),
    ].join("\n"),
  );
}

export async function POST(req: Request): Promise<Response> {
  let token = tokenOf(req);
  if (!token) {
    const form = await req.formData().catch(() => null);
    const t = form?.get("token");
    token = typeof t === "string" ? t : "";
  }
  const res = await unsubscribe(token);
  switch (res.status) {
    case "unsubscribed":
      return htmlPage("Unsubscribed", "<h1>You're off the list</h1><p>No more newsletter emails.</p>");
    case "not_found":
      return htmlPage("Unsubscribed", "<h1>Already off the list</h1><p>This address is not subscribed.</p>");
    case "bad_signature":
      return htmlPage("Unsubscribe", "<h1>Unsubscribe</h1><p>This unsubscribe link is not valid.</p>", 403);
    default:
      return htmlPage("Unsubscribe", "<h1>Unsubscribe</h1><p>Something broke. Try the link again in a minute.</p>", 500);
  }
}
