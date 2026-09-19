/**
 * Email public API. OWNER: ops agent (lib/jobs/**, lib/email/**, app/api/**, proxy.ts,
 * app/enter/**, app/subscribe/**, tests/ops*).
 *
 * FOUNDATION STUB: sends nothing. The real implementation uses Resend: one text-first HTML
 * email per issue plus a plain-text part; NEWSLETTER_MODE=review sends only to
 * COMMISSIONER_EMAIL with an HMAC-signed single-use approve link, auto sends to all
 * subscribers; every email has an HMAC-signed unsubscribe link; subscribers capped at 30;
 * all Sleeper-provided text escaped.
 */
import { configured, newsletterMode } from "@/lib/env";
import type { Issue, NewsletterMode, SendResult, SubscribeInput, SubscribeResult, UnsubscribeResult } from "@/lib/types";

export const MAX_SUBSCRIBERS = 30;

/** Email an issue. `review` = commissioner only with an approve link; `auto` = every subscriber. */
export async function sendIssue(issue: Issue, mode: NewsletterMode = newsletterMode()): Promise<SendResult> {
  void issue;
  void mode;
  if (!configured.resend()) return { status: "not_configured", recipients: 0, messageIds: [] };
  return { status: "skipped", recipients: 0, messageIds: [], error: "Not implemented yet (foundation stub)." };
}

/** Add a subscriber (validated email, one of the ten managers, max 30). */
export async function subscribe(input: SubscribeInput): Promise<SubscribeResult> {
  void input;
  return { ok: false, status: "not_configured", message: "The newsletter is not set up yet." };
}

/** Remove a subscriber. `token` is the HMAC-signed token from the unsubscribe link. */
export async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  void token;
  return { ok: false, status: "error" };
}
