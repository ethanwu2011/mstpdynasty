/**
 * The review email's "Approve and send to the league" link:
 *   GET   shows what will go out and a Send button (mail scanners that prefetch links only GET,
 *         so they can never send an issue)
 *   POST  verifies the HMAC-signed, single-use token and sends to every league recipient
 *         (LEAGUE_EMAILS minus opt-outs; only the count is ever shown)
 * Query: ?issue=<slug>&sig=<token>
 */
import { approveIssue, inspectApproveLink, type ApproveStatus } from "@/lib/email";
import { htmlPage, postButton } from "@/lib/email/page";
import { escapeHtml, issueDateLabel } from "@/lib/email/render";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HTTP: Record<ApproveStatus, number> = {
  sent: 200,
  already_sent: 409,
  already_used: 409,
  expired: 410,
  bad_signature: 403,
  not_found: 404,
  not_configured: 503,
  error: 500,
};

function params(req: Request): { slug: string; sig: string } {
  const url = new URL(req.url);
  return { slug: url.searchParams.get("issue") ?? "", sig: url.searchParams.get("sig") ?? "" };
}

export async function GET(req: Request): Promise<Response> {
  const { slug, sig } = params(req);
  const info = await inspectApproveLink(sig, slug);
  if (!info.ok || !info.issue) return htmlPage("Approve", `<h1>Approve</h1><p>${escapeHtml(info.message)}</p>`, HTTP[info.status]);
  const i = info.issue;
  const action = `/api/admin/approve?issue=${encodeURIComponent(slug)}&sig=${encodeURIComponent(sig)}`;
  const who = info.recipients === 1 ? "1 address on the league list" : `${info.recipients} addresses on the league list`;
  return htmlPage(
    "Approve",
    [
      "<h1>Send to the league?</h1>",
      `<p><strong>${escapeHtml(i.title)}</strong>, ${escapeHtml(issueDateLabel(i.date))}</p>`,
      i.dek ? `<p><em>${escapeHtml(i.dek)}</em></p>` : "",
      `<p>This goes to ${escapeHtml(who)} and publishes the issue on the site. The link works once.</p>`,
      postButton(action, "Send it"),
    ].join("\n"),
  );
}

export async function POST(req: Request): Promise<Response> {
  const { slug, sig } = params(req);
  const res = await approveIssue(sig, slug);
  const body = res.ok
    ? `<h1>Sent</h1><p>${escapeHtml(res.issue?.title ?? "The issue")} went to ${res.recipients} ${res.recipients === 1 ? "address" : "addresses"} on the league list and is live on the site.</p>`
    : `<h1>Not sent</h1><p>${escapeHtml(res.message)}</p>`;
  return htmlPage(res.ok ? "Sent" : "Not sent", body, HTTP[res.status]);
}
