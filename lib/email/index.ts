/**
 * Email public API. OWNER: ENGINE agent (lib/**, app/api/**, proxy.ts, tests/**).
 *
 * Resend, from "MSTP Dynasty" (EMAIL_FROM, default DEFAULT_EMAIL_FROM in lib/env). One
 * text-first HTML email per issue plus a plain-text part (lib/email/render.ts).
 *
 * Recipients (`recipients()`, the only implementation): the private env var LEAGUE_EMAILS
 * (comma-separated; a Vercel secret, never in the repo, a test, a doc or a log) plus the
 * confirmed subscribers the old sign-up form stored, minus stored opt-outs. There is no public
 * sign-up any more, so nothing new is ever added to the subscriber records. Opt-outs are stored
 * by HMAC ref, never by address.
 *
 *   review mode  every issue goes first to COMMISSIONER_EMAIL only, with an HMAC-signed,
 *                single-use, 7-day "Approve and send to the league" link (/api/admin/approve)
 *   auto mode    straight to every recipient
 *   sendTest     a marked [Test] copy to COMMISSIONER_EMAIL only (POST /api/admin/test-email
 *                with the bearer, and GET /api/admin/send-test through sendTestCopy)
 *
 * Every email carries a signed unsubscribe link plus RFC 8058 one-click headers. Links carry
 * an HMAC reference to the address, never the address itself. Nothing is ever emailed about a
 * dev league, and with no RESEND_API_KEY or ADMIN_SECRET everything reports "not_configured"
 * instead of failing. Addresses are never logged, returned from a route or rendered: use
 * recipientSummary() for counts.
 */
import "server-only";
import { createHash } from "node:crypto";
import { getIssue, listIssues, saveIssue } from "@/lib/archive";
import { isDevLeague, leagueId as currentLeagueId, newsletterMode, siteUrl } from "@/lib/env";
import * as store from "@/lib/store";
import type { Issue, NewsletterMode, RecipientSummary, SendResult, Subscriber, UnsubscribeResult } from "@/lib/types";
import { claimOnce, markDone, releaseClaim } from "@/lib/jobs/once";
import { renderIssueEmail } from "./render";
import { adminSecret, deriveId, optOutSecret, optOutSecrets, safeEqual, signToken, subscriberRef, verifyToken, verifyUnsubToken } from "./sign";
import { getTransport, scrubAddresses, type EmailMessage, type EmailTransport } from "./transport";

export { escapeHtml, renderIssueEmail } from "./render";
export { scrubAddresses, setEmailTransportForTests } from "./transport";

/** Most addresses one league send goes to (a guard against a pasted list gone wrong). */
export const MAX_RECIPIENTS = 30;
export const APPROVE_VALID_DAYS = 7;

const DAY = 24 * 3600;

/* ------------------------------ status ------------------------------ */

export interface EmailStatus {
  ready: boolean;
  /** Why not, in one plain sentence (for "not configured yet" states). */
  reason: string | null;
}

export function emailStatus(forLeagueId: string = currentLeagueId()): EmailStatus {
  if (!getTransport()) return { ready: false, reason: "RESEND_API_KEY is not set." };
  if (!adminSecret()) return { ready: false, reason: "ADMIN_SECRET is not set (it signs the approve and unsubscribe links)." };
  if (isDevLeague(forLeagueId)) return { ready: false, reason: "This is a dev league, so email is off." };
  return { ready: true, reason: null };
}

/* ------------------------------ helpers ----------------------------- */

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Lowercased, trimmed address, or null when it is not a plausible email. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e) || e.includes("..")) return null;
  return e;
}

function link(path: string, params: Record<string, string>): string {
  const u = new URL(path, `${siteUrl()}/`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export function approveLink(slug: string, token: string): string {
  return link("/api/admin/approve", { issue: slug, sig: token });
}

/** Signed unsubscribe link for one address (no expiry). Null without OPTOUT_SECRET or ADMIN_SECRET. */
export function unsubscribeLink(leagueId: string, email: string): string | null {
  const secret = optOutSecret();
  const r = subscriberRef(email, secret);
  const token = r ? signToken({ p: "unsub", l: leagueId, r }, secret) : null;
  return token ? link("/api/unsubscribe", { token }) : null;
}

function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

const shortHash = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 16);
/** Error text for results and logs, with any address blanked out. */
const errText = (err: unknown) => scrubAddresses(err instanceof Error ? err.message : String(err));

function isSubscriber(v: unknown): v is Subscriber {
  const o = v as Subscriber | null;
  return Boolean(o && typeof o.email === "string" && typeof o.confirmed === "boolean");
}

/**
 * Sign-up records the old public form stored, pending ones included, oldest first. Nothing
 * writes them any more; confirmed ones still get the league email until they opt out.
 */
export async function listSubscribers(leagueId: string = currentLeagueId()): Promise<Subscriber[]> {
  const ks = await store.list(store.keys.subscriberPrefix(leagueId));
  const subs = (await Promise.all(ks.map((k) => store.get<Subscriber>(k)))).filter(isSubscriber);
  return subs.sort((a, b) => a.createdAt - b.createdAt);
}

/** Confirmed subscribers' addresses (valid, lowercased). Server-only data, never rendered or logged. */
async function confirmedSubscribers(leagueId: string): Promise<string[]> {
  return (await listSubscribers(leagueId))
    .filter((s) => s.confirmed)
    .map((s) => normalizeEmail(s.email))
    .filter((e): e is string => Boolean(e));
}

/* ----------------------------- recipients ---------------------------- */

/** Valid, unique, lowercased addresses from LEAGUE_EMAILS (comma, semicolon or whitespace separated). */
export function leagueEmailsFromEnv(): string[] {
  const raw = process.env.LEAGUE_EMAILS ?? "";
  const out = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = normalizeEmail(part);
    if (e) out.add(e);
  }
  return [...out];
}

/**
 * Whether an address opted out, under any ref it may be stored under (OPTOUT_SECRET's or
 * ADMIN_SECRET's). A store error is thrown, never read as "not opted out": a hiccup at send time
 * must fail the send (which then releases its claim, so the approve link still works), not
 * email someone who unsubscribed.
 */
async function isOptedOut(leagueId: string, email: string): Promise<boolean> {
  for (const secret of optOutSecrets()) {
    const ref = subscriberRef(email, secret);
    if (ref && (await store.get(store.keys.optOut(leagueId, ref)))) return true;
  }
  return false;
}

/** LEAGUE_EMAILS plus confirmed subscribers, each address once, before opt-outs. */
async function candidates(leagueId: string): Promise<string[]> {
  return [...new Set([...leagueEmailsFromEnv(), ...(await confirmedSubscribers(leagueId))])];
}

/**
 * Who gets the league email: LEAGUE_EMAILS plus confirmed subscribers, minus stored opt-outs.
 * The one recipients() in the codebase. Server-only data: never render, return from a route,
 * or log these addresses (use recipientSummary()).
 */
export async function recipients(leagueId: string = currentLeagueId()): Promise<string[]> {
  const out: string[] = [];
  for (const e of await candidates(leagueId)) if (!(await isOptedOut(leagueId, e))) out.push(e);
  return out;
}

/** Counts only, safe for pages and /api/health. */
export async function recipientSummary(leagueId: string = currentLeagueId()): Promise<RecipientSummary> {
  const all = await candidates(leagueId);
  const count = (await recipients(leagueId)).length;
  return { configured: all.length > 0, count, optedOut: all.length - count };
}

/* ------------------------------ health ------------------------------ */

const EMAIL_STATUS_KEY = "ops:email-status";

/** Last send outcome for /api/health: counts and scrubbed errors only, never addresses. */
async function recordEmailStatus(result: SendResult): Promise<void> {
  const error = result.error ? scrubAddresses(result.error).slice(0, 240) : undefined;
  await store.set(EMAIL_STATUS_KEY, { at: Date.now(), status: result.status, recipients: result.recipients, error }).catch(() => {});
}

/** What recordEmailStatus stored last (null before the first send). */
export async function readEmailStatus(): Promise<unknown> {
  return store.get(EMAIL_STATUS_KEY).catch(() => null);
}

/** Everyone a league send goes to: recipients(), capped at MAX_RECIPIENTS. */
async function audience(leagueId: string): Promise<string[]> {
  return (await recipients(leagueId)).slice(0, MAX_RECIPIENTS);
}

/**
 * On Vercel without the shared store, every instance keeps its own /tmp store: a league send
 * could not see opt-outs written on another instance, nor the single-use approve lock or the
 * "sent" mark. League sends refuse until KV is connected.
 */
function perInstanceStore(): boolean {
  return Boolean(process.env.VERCEL) && store.getStore().backend === "file";
}
const KV_MISSING = "The KV store is not connected, so league sends are off until it is.";

/* ------------------------------ sending ----------------------------- */

const notConfigured = (error: string): SendResult => ({ status: "not_configured", recipients: 0, messageIds: [], error });
const skipped = (error: string): SendResult => ({ status: "skipped", recipients: 0, messageIds: [], error });

/**
 * Email an issue. `review` = COMMISSIONER_EMAIL only, with an approve link; `auto` = every
 * league recipient. Never sends the same issue twice (per mode), and marks the issue `sent` in
 * the archive after a successful league send.
 */
export async function sendIssue(issue: Issue, mode: NewsletterMode = newsletterMode()): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) return notConfigured("RESEND_API_KEY is not set.");
  if (!adminSecret()) return notConfigured("ADMIN_SECRET is not set (it signs the approve and unsubscribe links).");
  if (isDevLeague(issue.leagueId)) return skipped("Dev league: never emailed.");
  if (issue.placeholder) return skipped("Placeholder issue: never emailed.");
  let result: SendResult;
  try {
    result = mode === "review" ? await sendReview(issue, transport) : await sendToLeague(issue, transport);
  } catch (err) {
    result = { status: "error", recipients: 0, messageIds: [], error: errText(err) };
  }
  await recordEmailStatus(result);
  return result;
}

/**
 * The approve token is derived from the issue (slug + createdAt), so a retried review send
 * renders byte-identical and Resend's idempotency key can dedupe it.
 */
function reviewToken(issue: Issue): string | null {
  const secret = adminSecret();
  if (!secret) return null;
  const n = deriveId(`approve:${issue.leagueId}:${issue.slug}:${issue.createdAt}`, secret);
  if (!n) return null;
  const exp = Math.floor(issue.createdAt / 1000) + APPROVE_VALID_DAYS * DAY;
  return signToken({ p: "approve", l: issue.leagueId, s: issue.slug, n, exp }, secret);
}

async function sendReview(issue: Issue, transport: EmailTransport): Promise<SendResult> {
  const to = normalizeEmail(process.env.COMMISSIONER_EMAIL ?? "");
  if (!to) return notConfigured("COMMISSIONER_EMAIL is not set.");
  const l = issue.leagueId;
  const current = (await getIssue(l, issue.slug)) ?? issue;
  if (current.status === "sent") return skipped("Already sent to the league.");

  const name = `email:review:${issue.slug}`;
  const claim = await claimOnce(l, name, 600);
  if (claim === "done") return skipped("Review copy already sent.");
  if (claim === "busy") return skipped("Review copy is being sent right now.");
  try {
    const token = reviewToken(current);
    const unsub = unsubscribeLink(l, to);
    if (!token || !unsub) throw new Error("Could not sign links.");
    const email = renderIssueEmail(current, {
      unsubscribeUrl: unsub,
      approveUrl: approveLink(current.slug, token),
      webUrl: null,
      approveValidDays: APPROVE_VALID_DAYS,
    });
    const { ids } = await transport.send([{ to, ...email, headers: unsubscribeHeaders(unsub) }], {
      idempotencyKey: `review/${l}/${issue.slug}/${current.createdAt}`,
    });
    await markDone(l, name, { at: Date.now() }, 90 * DAY);
    return { status: "review_sent", recipients: 1, messageIds: ids };
  } catch (err) {
    await releaseClaim(l, name);
    throw err;
  }
}

async function sendToLeague(issue: Issue, transport: EmailTransport): Promise<SendResult> {
  if (perInstanceStore()) return notConfigured(KV_MISSING);
  const l = issue.leagueId;
  const current = (await getIssue(l, issue.slug)) ?? issue;
  if (current.status === "sent") return skipped("Already sent to the league.");

  const name = `email:send:${issue.slug}`;
  const claim = await claimOnce(l, name, 900);
  if (claim === "done") return skipped("Already sent to the league.");
  if (claim === "busy") return skipped("Being sent right now.");
  try {
    const to = await audience(l);
    const webUrl = link(`/newsletter/${encodeURIComponent(current.slug)}`, {});
    const messages: EmailMessage[] = [];
    for (const email of to) {
      const unsub = unsubscribeLink(l, email);
      if (!unsub) throw new Error("Could not sign unsubscribe links.");
      messages.push({ to: email, ...renderIssueEmail(current, { unsubscribeUrl: unsub, webUrl }), headers: unsubscribeHeaders(unsub) });
    }
    const ids = messages.length
      ? (await transport.send(messages, { idempotencyKey: `send/${l}/${current.slug}/${shortHash(to.join(","))}` })).ids
      : [];
    const sentAt = Date.now();
    // The record of what went out is saved with the "sent" status itself: they cannot disagree.
    await saveIssue(withEmailed({ ...current, status: "sent", sentAt, recipientCount: messages.length }));
    await markDone(l, name, { at: sentAt, recipients: messages.length });
    return { status: "sent", recipients: messages.length, messageIds: ids };
  } catch (err) {
    await releaseClaim(l, name);
    throw err;
  }
}

/** The words of an issue as emailed (dek and sections), hashed. */
export const issueWordsHash = (i: Pick<Issue, "dek" | "sections">) => shortHash(JSON.stringify([i.dek, i.sections]));

/**
 * The versions the league holds. An issue sent before the record existed holds the words it
 * carried when it was first rewritten (publishExternal fills this in before it changes them).
 */
export function emailedVersions(i: Pick<Issue, "status" | "emailedWords" | "dek" | "sections">): string[] {
  if (i.emailedWords) return i.emailedWords;
  return i.status === "sent" ? [issueWordsHash(i)] : [];
}

const withEmailed = (i: Issue): Issue => ({ ...i, emailedWords: [...new Set([...emailedVersions(i), issueWordsHash(i)])] });

/** Resends of one issue per day, so a looping writer cannot spam the league. */
export const MAX_RESENDS_PER_ISSUE_PER_DAY = 2;

/**
 * Email an issue that already went out again, to the same audience, after its words were
 * rewritten (POST /api/admin/issue with deliver "now"). The idempotency key includes the
 * issue's words, so the same words never go out twice.
 */
export async function resendIssue(issue: Issue): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) return notConfigured("RESEND_API_KEY is not set.");
  if (!adminSecret()) return notConfigured("ADMIN_SECRET is not set (it signs the unsubscribe links).");
  if (isDevLeague(issue.leagueId)) return skipped("Dev league: never emailed.");
  if (issue.placeholder || issue.factsOnly) return skipped("Only a written issue is sent again.");
  if (perInstanceStore()) return notConfigured(KV_MISSING);
  // Review mode: nothing reaches the league without the commissioner's approve link.
  if (newsletterMode() === "review") return skipped("Review mode: a rewritten issue is not sent again without approval.");
  const l = issue.leagueId;
  let result: SendResult;
  try {
    const n = await store.incr(store.keys.rate(`resend:${l}:${issue.slug}`), 86_400);
    if (n > MAX_RESENDS_PER_ISSUE_PER_DAY) return skipped(`At most ${MAX_RESENDS_PER_ISSUE_PER_DAY} resends of one issue a day.`);
    const current = (await getIssue(l, issue.slug)) ?? issue;
    const to = await audience(l);
    const webUrl = link(`/newsletter/${encodeURIComponent(current.slug)}`, {});
    const messages: EmailMessage[] = [];
    for (const email of to) {
      const unsub = unsubscribeLink(l, email);
      if (!unsub) throw new Error("Could not sign unsubscribe links.");
      messages.push({ to: email, ...renderIssueEmail(current, { unsubscribeUrl: unsub, webUrl }), headers: unsubscribeHeaders(unsub) });
    }
    const words = issueWordsHash(current);
    if (emailedVersions(current).includes(words)) return skipped("These exact words already went to the league.");
    const ids = messages.length
      ? (await transport.send(messages, { idempotencyKey: `resend/${l}/${current.slug}/${words}/${shortHash(to.join(","))}` })).ids
      : [];
    await saveIssue(withEmailed({ ...current, status: "sent", sentAt: Date.now(), recipientCount: messages.length }));
    result = { status: "sent", recipients: messages.length, messageIds: ids };
  } catch (err) {
    result = { status: "error", recipients: 0, messageIds: [], error: errText(err) };
  }
  await recordEmailStatus(result);
  return result;
}

/** Test sends per hour (POST /api/admin/test-email), so a leaked admin secret cannot spam the inbox. */
export const MAX_TEST_SENDS_PER_HOUR = 10;

export interface SendTestOptions {
  /** The issue to send. Default: the newest stored issue (drafts included). */
  issue?: Issue | null;
  /** testSendPreflight already ran and took this send's slot in the hourly count. */
  counted?: boolean;
}

/**
 * Everything a test send checks before it builds anything: the transport, ADMIN_SECRET,
 * COMMISSIONER_EMAIL, the dev-league rule, and one slot of the hourly count (taken here). Null
 * when the send may go ahead. Run it before building a sample issue, so a refused request never
 * spends a model call.
 */
export async function testSendPreflight(leagueId: string = currentLeagueId()): Promise<SendResult | null> {
  if (!getTransport()) return notConfigured("RESEND_API_KEY is not set.");
  if (!adminSecret()) return notConfigured("ADMIN_SECRET is not set (it signs the unsubscribe link).");
  if (!normalizeEmail(process.env.COMMISSIONER_EMAIL ?? "")) return notConfigured("COMMISSIONER_EMAIL is not set.");
  if (isDevLeague(leagueId)) return skipped("Dev league: never emailed.");
  try {
    if ((await store.incr(store.keys.rate(`test-email:${leagueId}`), 3600)) > MAX_TEST_SENDS_PER_HOUR) {
      return skipped(`At most ${MAX_TEST_SENDS_PER_HOUR} test emails an hour.`);
    }
  } catch (err) {
    return { status: "error", recipients: 0, messageIds: [], error: errText(err) };
  }
  return null;
}

/**
 * Send a marked test copy of an issue to COMMISSIONER_EMAIL only. Never marks anything sent,
 * never touches the league list, never emails about a dev league. `test_sent` on success.
 */
export async function sendTest(opts: SendTestOptions = {}): Promise<SendResult> {
  const result = await sendTestOnce(opts);
  // Only a send that was attempted: a refused request (no key, no COMMISSIONER_EMAIL) is not news.
  if (result.status === "test_sent" || result.status === "error") await recordEmailStatus(result);
  return result;
}

/**
 * A [Test] copy of one issue to COMMISSIONER_EMAIL, and nothing else (GET /api/admin/send-test,
 * which holds its own 15-minute lock, so the hourly count is not taken here).
 */
export async function sendTestCopy(issue: Issue): Promise<SendResult> {
  return sendTest({ issue, counted: true });
}

async function sendTestOnce(opts: SendTestOptions): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) return notConfigured("RESEND_API_KEY is not set.");
  if (!adminSecret()) return notConfigured("ADMIN_SECRET is not set (it signs the unsubscribe link).");
  const to = normalizeEmail(process.env.COMMISSIONER_EMAIL ?? "");
  if (!to) return notConfigured("COMMISSIONER_EMAIL is not set.");
  const l = opts.issue?.leagueId ?? currentLeagueId();
  if (isDevLeague(l)) return skipped("Dev league: never emailed.");
  const issue = opts.issue ?? (await listIssues(l, { includeUnsent: true, limit: 1 }))[0] ?? null;
  if (!issue) return skipped("No issue to send yet.");
  if (issue.placeholder) return skipped("Placeholder issue: never emailed.");
  try {
    if (!opts.counted && (await store.incr(store.keys.rate(`test-email:${l}`), 3600)) > MAX_TEST_SENDS_PER_HOUR) {
      return skipped(`At most ${MAX_TEST_SENDS_PER_HOUR} test emails an hour.`);
    }
    const unsub = unsubscribeLink(l, to);
    if (!unsub) throw new Error("Could not sign the unsubscribe link.");
    const email = renderIssueEmail(issue, { unsubscribeUrl: unsub, webUrl: null, test: true });
    const { ids } = await transport.send([{ to, ...email, headers: unsubscribeHeaders(unsub) }]);
    return { status: "test_sent", recipients: 1, messageIds: ids };
  } catch (err) {
    return { status: "error", recipients: 0, messageIds: [], error: errText(err) };
  }
}

/* ----------------------------- approving ---------------------------- */

export type ApproveStatus =
  | "sent"
  | "already_sent"
  | "already_used"
  | "expired"
  | "bad_signature"
  | "not_found"
  | "not_configured"
  | "error";

export interface ApproveResult {
  ok: boolean;
  status: ApproveStatus;
  recipients: number;
  issue: Pick<Issue, "slug" | "title" | "dek" | "date" | "status"> | null;
  message: string;
}

const APPROVE_MESSAGES: Record<ApproveStatus, string> = {
  sent: "Sent to the league.",
  already_sent: "This issue already went out.",
  already_used: "This approve link was already used.",
  expired: "This approve link has expired.",
  bad_signature: "This approve link is not valid.",
  not_found: "That issue no longer exists.",
  not_configured: "Email is not set up yet.",
  error: "Sending failed. Nothing was marked as sent, so the link still works.",
};

function approveResult(status: ApproveStatus, issue: Issue | null = null, recipients = 0, message?: string): ApproveResult {
  return {
    ok: status === "sent",
    status,
    recipients,
    issue: issue ? { slug: issue.slug, title: issue.title, dek: issue.dek, date: issue.date, status: issue.status } : null,
    message: message ?? APPROVE_MESSAGES[status],
  };
}

type ApproveCheck = { error: ApproveResult } | { issue: Issue; leagueId: string; nonce: string; exp: number };

async function checkApprove(token: string, slug: string, now: number): Promise<ApproveCheck> {
  const v = verifyToken(token, "approve", { now });
  if (!v.ok) {
    const status: ApproveStatus = v.reason === "expired" ? "expired" : v.reason === "not_configured" ? "not_configured" : "bad_signature";
    return { error: approveResult(status) };
  }
  const { l, s, n, exp } = v.payload;
  if (!s || !n || s !== slug) return { error: approveResult("bad_signature") };
  if (isDevLeague(l)) return { error: approveResult("error", null, 0, "Dev league: never emailed.") };
  const issue = await getIssue(l, s);
  if (!issue) return { error: approveResult("not_found") };
  // The link is bound to the exact version the commissioner reviewed: a draft rebuilt under the
  // same slug has a new createdAt, so an older link can never send content nobody saw.
  const expected = deriveId(`approve:${l}:${s}:${issue.createdAt}`);
  if (!expected || !safeEqual(expected, n)) return { error: approveResult("bad_signature") };
  if (issue.status === "sent") return { error: approveResult("already_sent", issue) };
  if (await store.get(store.keys.token(l, `approve:${n}`))) return { error: approveResult("already_used", issue) };
  return { issue, leagueId: l, nonce: n, exp: exp ?? Math.floor(now / 1000) + DAY };
}

/** Validate an approve link without using it (for the confirmation page). `recipients` is a count. */
export async function inspectApproveLink(token: string, slug: string, now = Date.now()): Promise<ApproveResult & { recipients: number }> {
  const c = await checkApprove(token, slug, now);
  if ("error" in c) return { ...c.error, recipients: 0 };
  let recipientCount: number;
  try {
    recipientCount = (await audience(c.leagueId)).length;
  } catch (err) {
    return { ...approveResult("error", c.issue, 0, `Could not read the opt-out list (${errText(err)}). Try again in a minute.`), recipients: 0 };
  }
  return { ...approveResult("sent", c.issue, 0, "Ready to send."), recipients: recipientCount };
}

/** Use an approve link: send the reviewed issue to every league recipient, once. */
export async function approveIssue(token: string, slug: string, now = Date.now()): Promise<ApproveResult> {
  const c = await checkApprove(token, slug, now);
  if ("error" in c) return c.error;
  const transport = getTransport();
  if (!transport || !adminSecret()) return approveResult("not_configured", c.issue);
  if (perInstanceStore()) return approveResult("not_configured", c.issue, 0, KV_MISSING);

  const usedKey = store.keys.token(c.leagueId, `approve:${c.nonce}`);
  const ttl = Math.max(3600, c.exp - Math.floor(now / 1000) + DAY);
  if (!(await store.lock(usedKey, ttl))) return approveResult("already_used", c.issue);
  try {
    const res = await sendToLeague(c.issue, transport);
    if (res.status === "sent") return approveResult("sent", { ...c.issue, status: "sent" }, res.recipients);
    if (res.status === "skipped") return approveResult("already_sent", c.issue, 0, res.error);
    await store.unlock(usedKey);
    return approveResult("error", c.issue, 0, res.error);
  } catch (err) {
    await store.unlock(usedKey);
    return approveResult("error", c.issue, 0, `${APPROVE_MESSAGES.error} (${errText(err)})`);
  }
}

/* ---------------------------- unsubscribing --------------------------- */

/** Check an unsubscribe link without using it (for the confirmation page). */
export function isUnsubscribeTokenValid(token: string): boolean {
  const v = verifyUnsubToken(token);
  return v.ok && Boolean(v.payload.r);
}

/** The stored subscriber an unsubscribe ref points at, under any secret it may be signed with. */
async function subscriberByRef(leagueId: string, ref: string): Promise<Subscriber | null> {
  for (const s of await listSubscribers(leagueId)) {
    for (const secret of optOutSecrets()) {
      const r = subscriberRef(s.email, secret);
      if (r && safeEqual(r, ref)) return s;
    }
  }
  return null;
}

/**
 * Opt an address out. `token` is the HMAC-signed token from the unsubscribe link, which only
 * carries the address's HMAC ref. The opt-out marker is stored under that ref (keys.optOut), so
 * the address stays out of recipients() for good, whether it came from LEAGUE_EMAILS or a
 * confirmed subscription (whose stored record is deleted too). Idempotent: a second click
 * writes the same marker and answers "unsubscribed" again.
 */
export async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  const v = verifyUnsubToken(token);
  if (!v.ok || !v.payload.r) return { ok: false, status: "bad_signature" };
  const l = v.payload.l;
  const ref = v.payload.r;
  try {
    if (!(await store.get(store.keys.optOut(l, ref)))) await store.set(store.keys.optOut(l, ref), { at: Date.now() });
    const sub = await subscriberByRef(l, ref);
    if (sub) await store.del(store.keys.subscriber(l, sub.email));
    return { ok: true, status: "unsubscribed" };
  } catch {
    return { ok: false, status: "error" };
  }
}
