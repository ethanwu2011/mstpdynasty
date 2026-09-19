/**
 * Confirmation link from the sign-up email: ?token=<HMAC-signed token, 7 days>.
 *   GET   a one-button page (so a link scanner cannot confirm on someone's behalf)
 *   POST  confirms the subscription
 */
import { confirmSubscription } from "@/lib/email";
import { htmlPage, postButton } from "@/lib/email/page";
import { verifyToken } from "@/lib/email/sign";

export const dynamic = "force-dynamic";

const tokenOf = (req: Request) => new URL(req.url).searchParams.get("token") ?? "";

export async function GET(req: Request): Promise<Response> {
  const token = tokenOf(req);
  const v = verifyToken(token, "confirm");
  if (!v.ok) {
    const msg = v.reason === "expired" ? "This confirmation link has expired. Sign up again." : "This confirmation link is not valid.";
    return htmlPage("Confirm", `<h1>Confirm</h1><p>${msg}</p><p><a href="/subscribe">Back to sign-up</a></p>`, v.reason === "expired" ? 410 : 403);
  }
  return htmlPage(
    "Confirm",
    ["<h1>Get the MSTP Dynasty newsletter by email?</h1>", "<p>One click and you're on the list.</p>", postButton(`/api/subscribe/confirm?token=${encodeURIComponent(token)}`, "Confirm")].join("\n"),
  );
}

export async function POST(req: Request): Promise<Response> {
  const res = await confirmSubscription(tokenOf(req));
  switch (res.status) {
    case "confirmed":
    case "already_confirmed":
      return htmlPage("Confirmed", "<h1>You're in</h1><p>The next issue lands in your inbox. Every email has an unsubscribe link, in case you can't take it.</p>");
    case "expired":
      return htmlPage("Confirm", '<h1>Link expired</h1><p><a href="/subscribe">Sign up again</a>.</p>', 410);
    case "not_found":
      return htmlPage("Confirm", '<h1>Sign-up not found</h1><p>It may have expired. <a href="/subscribe">Sign up again</a>.</p>', 404);
    case "bad_signature":
      return htmlPage("Confirm", "<h1>Confirm</h1><p>This confirmation link is not valid.</p>", 403);
    default:
      return htmlPage("Confirm", "<h1>Confirm</h1><p>Something broke. Try the link again in a minute.</p>", 500);
  }
}
