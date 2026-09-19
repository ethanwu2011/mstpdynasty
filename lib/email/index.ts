/**
 * Email public API. OWNER: ops agent (lib/jobs/**, lib/email/**, app/api/**, proxy.ts,
 * app/enter/**, app/subscribe/**, tests/ops*).
 *
 * Resend, from "The Roast <roast@mstpdynasty.com>" (EMAIL_FROM). One text-first HTML email
 * per issue plus a plain-text part (lib/email/render.ts).
 *
 *   review mode  the draft goes only to COMMISSIONER_EMAIL, with an HMAC-signed, single-use,
 *                7-day "Approve and send to the league" link (/api/admin/approve)
 *   auto mode    straight to every confirmed subscriber
 *
 * Subscriptions are double opt-in (a signed confirm link). At most 30 confirmed subscribers
 * and 10 pending sign-ups; pending ones expire 7 days after the first sign-up and get at most
 * two confirmation emails, and confirmation emails are rate limited per IP and site-wide
 * (lib/email/limits.ts) so nobody can lock out the league or burn the Resend quota. The form
 * answers the same for a new and an already confirmed address. Every email carries a signed unsubscribe
 * link plus RFC 8058 one-click headers. Links carry an HMAC reference to the address, never
 * the address itself. Nothing is ever emailed about a dev league, and with no
 * RESEND_API_KEY or ADMIN_SECRET everything reports "not_configured" instead of failing.
 */
import "server-only";
import { createHash } from "node:crypto";
import { managerByKey } from "@/config/managers";
import { getIssue, saveIssue } from "@/lib/archive";
import { isDevLeague, leagueId as currentLeagueId, newsletterMode, siteUrl } from "@/lib/env";
import * as store from "@/lib/store";
import type {
  Issue,
  NewsletterMode,
  SendResult,
  SubscribeInput,
  SubscribeResult,
  Subscriber,
  UnsubscribeResult,
} from "@/lib/types";
import { claimOnce, markDone, releaseClaim } from "@/lib/jobs/once";
import { allowConfirmEmail, allowSubscribeAttempt } from "./limits";
import { renderConfirmEmail, renderIssueEmail } from "./render";
import { adminSecret, deriveId, safeEqual, signToken, subscriberRef, verifyToken } from "./sign";
import { getTransport, type EmailMessage, type EmailTransport } from "./transport";

export { escapeHtml, renderIssueEmail } from "./render";
export { setEmailTransportForTests } from "./transport";

/** Confirmed subscribers. */
export const MAX_SUBSCRIBERS = 30;
/** Unconfirmed sign-ups waiting on their link. */
export const MAX_PENDING = 10;
/** Confirmation emails per pending sign-up (the first one plus one resend). */
export const MAX_CONFIRM_SENDS = 2;
export const APPROVE_VALID_DAYS = 7;
export const CONFIRM_VALID_DAYS = 7;

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

/** Signed unsubscribe link for one address (no expiry). Null without ADMIN_SECRET. */
export function unsubscribeLink(leagueId: string, email: string): string | null {
  const r = subscriberRef(email);
  const token = r ? signToken({ p: "unsub", l: leagueId, r }) : null;
  return token ? link("/api/unsubscribe", { token }) : null;
}

function confirmLink(leagueId: string, email: string, expiresAtMs: number): string | null {
  const r = subscriberRef(email);
  const token = r ? signToken({ p: "confirm", l: leagueId, r, exp: Math.floor(expiresAtMs / 1000) }) : null;
  return token ? link("/api/subscribe/confirm", { token }) : null;
}

function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

const shortHash = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 16);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function isSubscriber(v: unknown): v is Subscriber {
  const o = v as Subscriber | null;
  return Boolean(o && typeof o.email === "string" && typeof o.managerKey === "string" && typeof o.confirmed === "boolean");
}

/** Every subscriber of a league, pending ones included, oldest first. */
export async function listSubscribers(leagueId: string = currentLeagueId()): Promise<Subscriber[]> {
  const ks = await store.list(store.keys.subscriberPrefix(leagueId));
  const subs = (await Promise.all(ks.map((k) => store.get<Subscriber>(k)))).filter(isSubscriber);
  return subs.sort((a, b) => a.createdAt - b.createdAt);
}

async function findByRef(leagueId: string, ref: string): Promise<Subscriber | null> {
  for (const s of await listSubscribers(leagueId)) {
    const r = subscriberRef(s.email);
    if (r && safeEqual(r, ref)) return s;
  }
  return null;
}

/* ------------------------------ sending ----------------------------- */

const notConfigured = (error: string): SendResult => ({ status: "not_configured", recipients: 0, messageIds: [], error });
const skipped = (error: string): SendResult => ({ status: "skipped", recipients: 0, messageIds: [], error });

/**
 * Email an issue. `review` = commissioner only with an approve link; `auto` = every confirmed
 * subscriber. Never sends the same issue twice (per mode), and marks the issue `sent` in the
 * archive after a successful league send.
 */
export async function sendIssue(issue: Issue, mode: NewsletterMode = newsletterMode()): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) return notConfigured("RESEND_API_KEY is not set.");
  if (!adminSecret()) return notConfigured("ADMIN_SECRET is not set (it signs the approve and unsubscribe links).");
  if (isDevLeague(issue.leagueId)) return skipped("Dev league: never emailed.");
  if (issue.placeholder) return skipped("Placeholder issue: never emailed.");
  try {
    return mode === "review" ? await sendReview(issue, transport) : await sendToSubscribers(issue, transport);
  } catch (err) {
    return { status: "error", recipients: 0, messageIds: [], error: errText(err) };
  }
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

async function sendToSubscribers(issue: Issue, transport: EmailTransport): Promise<SendResult> {
  const l = issue.leagueId;
  const current = (await getIssue(l, issue.slug)) ?? issue;
  if (current.status === "sent") return skipped("Already sent to the league.");

  const name = `email:send:${issue.slug}`;
  const claim = await claimOnce(l, name, 900);
  if (claim === "done") return skipped("Already sent to the league.");
  if (claim === "busy") return skipped("Being sent right now.");
  try {
    const subs = (await listSubscribers(l)).filter((s) => s.confirmed).slice(0, MAX_SUBSCRIBERS);
    const webUrl = link(`/newsletter/${encodeURIComponent(current.slug)}`, {});
    const messages: EmailMessage[] = [];
    for (const s of subs) {
      const unsub = unsubscribeLink(l, s.email);
      if (!unsub) throw new Error("Could not sign unsubscribe links.");
      messages.push({ to: s.email, ...renderIssueEmail(current, { unsubscribeUrl: unsub, webUrl }), headers: unsubscribeHeaders(unsub) });
    }
    const ids = messages.length
      ? (await transport.send(messages, { idempotencyKey: `send/${l}/${current.slug}/${shortHash(subs.map((s) => s.email).join(","))}` })).ids
      : [];
    const sentAt = Date.now();
    await saveIssue({ ...current, status: "sent", sentAt, recipientCount: messages.length });
    await markDone(l, name, { at: sentAt, recipients: messages.length });
    return { status: "sent", recipients: messages.length, messageIds: ids };
  } catch (err) {
    await releaseClaim(l, name);
    throw err;
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

/** Validate an approve link without using it (for the confirmation page). */
export async function inspectApproveLink(token: string, slug: string, now = Date.now()): Promise<ApproveResult & { subscribers: number }> {
  const c = await checkApprove(token, slug, now);
  if ("error" in c) return { ...c.error, subscribers: 0 };
  const subscribers = (await listSubscribers(c.leagueId)).filter((x) => x.confirmed).length;
  return { ...approveResult("sent", c.issue, 0, "Ready to send."), subscribers };
}

/** Use an approve link: send the reviewed issue to every confirmed subscriber, once. */
export async function approveIssue(token: string, slug: string, now = Date.now()): Promise<ApproveResult> {
  const c = await checkApprove(token, slug, now);
  if ("error" in c) return c.error;
  const transport = getTransport();
  if (!transport || !adminSecret()) return approveResult("not_configured", c.issue);

  const usedKey = store.keys.token(c.leagueId, `approve:${c.nonce}`);
  const ttl = Math.max(3600, c.exp - Math.floor(now / 1000) + DAY);
  if (!(await store.lock(usedKey, ttl))) return approveResult("already_used", c.issue);
  try {
    const res = await sendToSubscribers(c.issue, transport);
    if (res.status === "sent") return approveResult("sent", { ...c.issue, status: "sent" }, res.recipients);
    if (res.status === "skipped") return approveResult("already_sent", c.issue, 0, res.error);
    await store.unlock(usedKey);
    return approveResult("error", c.issue, 0, res.error);
  } catch (err) {
    await store.unlock(usedKey);
    return approveResult("error", c.issue, 0, `${APPROVE_MESSAGES.error} (${errText(err)})`);
  }
}

/* --------------------------- subscriptions -------------------------- */

/** Copy for each subscribe outcome (the /subscribe page reuses it after a redirect). */
export const SUBSCRIBE_MESSAGES: Record<SubscribeResult["status"], string> = {
  subscribed: "Almost there. If that address is not on the list yet, a confirmation link is on its way.",
  already_subscribed: "Almost there. If that address is not on the list yet, a confirmation link is on its way.",
  invalid_email: "That does not look like an email address.",
  unknown_manager: "Pick your name from the list.",
  full: `The list is full (${MAX_SUBSCRIBERS} max).`,
  try_later: "Too many sign-ups right now. Try again in an hour.",
  not_configured: "The newsletter is not set up yet.",
  error: "Something broke. Try again later.",
};

/** Fixed copy only: error details go to the server log, never to the (anonymous) caller. */
const subResult = (ok: boolean, status: SubscribeResult["status"]): SubscribeResult => ({ ok, status, message: SUBSCRIBE_MESSAGES[status] });

/** Stored subscriber record: the shared shape plus how many confirmation emails it got. */
interface StoredSubscriber extends Subscriber {
  sends?: number;
}

const SUBSCRIBE_LOCK_SECONDS = 15;

export interface SubscribeOptions {
  /** Caller's address for the per-IP limit (the route passes it; internal callers may not). */
  ip?: string | null;
}

/**
 * Add a subscriber (validated email, one of the ten managers). Double opt-in. Answers
 * "subscribed" for a new, a pending and an already confirmed address alike.
 */
export async function subscribe(input: SubscribeInput, now = Date.now(), opts: SubscribeOptions = {}): Promise<SubscribeResult> {
  const l = currentLeagueId();
  if (!emailStatus(l).ready) return subResult(false, "not_configured");
  const email = normalizeEmail(input?.email);
  if (!email) return subResult(false, "invalid_email");
  const manager = typeof input?.managerKey === "string" ? managerByKey(input.managerKey) : undefined;
  if (!manager) return subResult(false, "unknown_manager");
  if (opts.ip && !(await allowSubscribeAttempt(opts.ip))) return subResult(false, "try_later");

  // One sign-up at a time, so parallel requests cannot race past the caps.
  const lockKey = store.keys.lock(l, "subscribe");
  let locked = false;
  try {
    for (let attempt = 0; attempt < 3 && !locked; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250));
      locked = await store.lock(lockKey, SUBSCRIBE_LOCK_SECONDS);
    }
    if (!locked) return subResult(false, "try_later");

    const key = store.keys.subscriber(l, email);
    const existing = await store.get<StoredSubscriber>(key);
    if (existing?.confirmed) return subResult(true, "subscribed");
    if (!existing) {
      const subs = await listSubscribers(l);
      if (subs.filter((x) => x.confirmed).length >= MAX_SUBSCRIBERS) return subResult(false, "full");
      if (subs.filter((x) => !x.confirmed).length >= MAX_PENDING) return subResult(false, "try_later");
    }
    const sends = existing ? (existing.sends ?? 1) : 0;
    // A pending address gets its link at most MAX_CONFIRM_SENDS times, and never a fresh TTL.
    if (sends >= MAX_CONFIRM_SENDS) return subResult(true, "subscribed");
    // At most one confirmation email per address per 10 minutes.
    const mailLock = store.keys.lock(l, `confirm-mail:${subscriberRef(email) ?? shortHash(email)}`);
    if (!(await store.lock(mailLock, 600))) return subResult(true, "subscribed");
    if (!(await allowConfirmEmail())) {
      await store.unlock(mailLock);
      return subResult(false, "try_later");
    }

    const createdAt = existing?.createdAt ?? now;
    const expiresAt = createdAt + CONFIRM_VALID_DAYS * DAY * 1000;
    const ttlSeconds = Math.max(60, Math.ceil((expiresAt - now) / 1000));
    const url = confirmLink(l, email, expiresAt);
    const transport = getTransport();
    if (!url || !transport) return subResult(false, "not_configured");
    const sub: StoredSubscriber = { email, managerKey: manager.key, createdAt, confirmed: false, sends: sends + 1 };
    await store.set(key, sub, { ttlSeconds });
    try {
      await transport.send([{ to: email, ...renderConfirmEmail({ confirmUrl: url, managerName: manager.firstName, validDays: CONFIRM_VALID_DAYS }) }]);
    } catch (err) {
      if (existing) await store.set(key, existing, { ttlSeconds });
      else await store.del(key);
      await store.unlock(mailLock);
      console.error(`[email] subscribe: confirmation email failed: ${errText(err)}`);
      return subResult(false, "error");
    }
    return subResult(true, "subscribed");
  } catch (err) {
    console.error(`[email] subscribe: ${errText(err)}`);
    return subResult(false, "error");
  } finally {
    if (locked) await store.unlock(lockKey).catch(() => {});
  }
}

export interface ConfirmResult {
  ok: boolean;
  status: "confirmed" | "already_confirmed" | "not_found" | "expired" | "bad_signature" | "error";
  managerKey: string | null;
}

/** Use a confirm link from the confirmation email. */
export async function confirmSubscription(token: string, now = Date.now()): Promise<ConfirmResult> {
  const v = verifyToken(token, "confirm", { now });
  if (!v.ok) return { ok: false, status: v.reason === "expired" ? "expired" : "bad_signature", managerKey: null };
  if (!v.payload.r) return { ok: false, status: "bad_signature", managerKey: null };
  try {
    const sub = await findByRef(v.payload.l, v.payload.r);
    if (!sub) return { ok: false, status: "not_found", managerKey: null };
    if (sub.confirmed) return { ok: true, status: "already_confirmed", managerKey: sub.managerKey };
    await store.set(store.keys.subscriber(v.payload.l, sub.email), { ...sub, confirmed: true });
    return { ok: true, status: "confirmed", managerKey: sub.managerKey };
  } catch {
    return { ok: false, status: "error", managerKey: null };
  }
}

/** Check an unsubscribe link without using it (for the confirmation page). */
export function isUnsubscribeTokenValid(token: string): boolean {
  const v = verifyToken(token, "unsub");
  return v.ok && Boolean(v.payload.r);
}

/** Remove a subscriber. `token` is the HMAC-signed token from the unsubscribe link. */
export async function unsubscribe(token: string): Promise<UnsubscribeResult> {
  const v = verifyToken(token, "unsub");
  if (!v.ok || !v.payload.r) return { ok: false, status: "bad_signature" };
  try {
    const sub = await findByRef(v.payload.l, v.payload.r);
    if (!sub) return { ok: false, status: "not_found" };
    await store.del(store.keys.subscriber(v.payload.l, sub.email));
    return { ok: true, status: "unsubscribed" };
  } catch {
    return { ok: false, status: "error" };
  }
}
