/** Email: escaping, review and approve (single use), send-once, double opt-in, cap, unsubscribe. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIssue, saveIssue } from "@/lib/archive";
import {
  approveIssue,
  confirmSubscription,
  inspectApproveLink,
  listSubscribers,
  MAX_CONFIRM_SENDS,
  MAX_PENDING,
  MAX_SUBSCRIBERS,
  sendIssue,
  setEmailTransportForTests,
  subscribe,
  unsubscribe,
} from "@/lib/email";
import { CONFIRM_EMAILS_PER_HOUR, SUBSCRIBES_PER_IP } from "@/lib/email/limits";
import { renderIssueEmail } from "@/lib/email/render";
import { subscriberRef } from "@/lib/email/sign";
import { MSTP_LEAGUE_ID } from "@/lib/env";
import * as store from "@/lib/store";
import type { Subscriber } from "@/lib/types";
import { fakeTransport, linkIn, makeIssue, type FakeTransport } from "./ops-helpers";

const RLO = String.fromCharCode(0x202e);
const EM_DASH = String.fromCharCode(0x2014);
const EVIL = `<script>alert("x")</script><img src=x onerror=alert(1)> & Co${RLO}`;

let t: FakeTransport;

beforeEach(() => {
  store.resetStoreForTests();
  vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
  vi.stubEnv("COMMISSIONER_EMAIL", "commish@example.com");
  vi.stubEnv("SITE_URL", "https://mstpdynasty.test");
  vi.stubEnv("LEAGUE_ID", "");
  vi.stubEnv("NEWSLETTER_MODE", "");
  t = fakeTransport();
  setEmailTransportForTests(t);
});

afterEach(() => {
  setEmailTransportForTests(undefined);
  vi.unstubAllEnvs();
});

async function addSubscriber(email: string, confirmed = true) {
  const s: Subscriber = { email, managerKey: "ethan", createdAt: Date.now(), confirmed };
  await store.set(store.keys.subscriber(MSTP_LEAGUE_ID, email), s);
}

describe("rendering", () => {
  const evilIssue = () =>
    makeIssue({
      title: "The Weekly Roast",
      dek: `${EVIL} got cooked\r\nBcc: victim@example.com`,
      note: EVIL,
      sections: [
        {
          heading: EVIL,
          blocks: [
            { type: "heading", text: EVIL },
            { type: "paragraph", text: `${EVIL} left 41.2 points on the bench.` },
            { type: "list", items: [EVIL, "fine"] },
            { type: "table", caption: EVIL, columns: ["Team", "Pts"], rows: [[EVIL, 101.5], ["Team 2", 99]] },
            { type: "note", text: EVIL },
          ],
        },
      ],
    });

  it("escapes a malicious team name everywhere in the HTML", () => {
    const { html, text, subject } = renderIssueEmail(evilIssue(), { unsubscribeUrl: 'https://x.test/u?t=a"b', webUrl: "https://x.test/n" });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; Co");
    expect(html).toContain('href="https://x.test/u?t=a&quot;b"');
    expect(html).not.toContain(RLO);
    expect(text).not.toContain(RLO);
    expect(text).toContain('<script>alert("x")</script>'); // plain text is not HTML
    expect(subject).not.toMatch(/[\r\n]/);
    // A code-written dek: title and week lead the subject, with one colon.
    expect(subject.startsWith("The Weekly Roast, week 3: ")).toBe(true);
  });

  it("is text-first: one column, no images, an unsubscribe link, no em dashes", () => {
    const { html, text } = renderIssueEmail(makeIssue(), { unsubscribeUrl: "https://x.test/u", webUrl: "https://x.test/n" });
    expect(html).not.toMatch(/<img|background-image/i);
    expect(html).toContain("MSTP Dynasty");
    expect(html).toContain("Unsubscribe</a>, in case you can't take it.");
    expect(text).toContain("Unsubscribe (in case you can't take it): https://x.test/u");
    expect(html + text).not.toContain(EM_DASH);
  });

  it("renders tables as aligned plain text", () => {
    const issue = makeIssue({ sections: [{ heading: "Scores", blocks: [{ type: "table", columns: ["Team", "Pts"], rows: [["Long Team Name", 101.5], ["B", 9]] }] }] });
    const { text } = renderIssueEmail(issue, { unsubscribeUrl: "https://x.test/u" });
    expect(text).toContain("Team              Pts\n--------------  -----\nLong Team Name  101.5\nB                   9");
  });
});

describe("sending", () => {
  it("reports not_configured without Resend or ADMIN_SECRET, and never emails a dev league", async () => {
    setEmailTransportForTests(null);
    expect((await sendIssue(makeIssue(), "auto")).status).toBe("not_configured");
    setEmailTransportForTests(t);
    vi.stubEnv("ADMIN_SECRET", "");
    expect((await sendIssue(makeIssue(), "auto")).status).toBe("not_configured");
    vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
    expect((await sendIssue(makeIssue({ leagueId: "some-dev-league" }), "auto")).status).toBe("skipped");
    expect(t.sent).toHaveLength(0);
  });

  it("auto mode sends each issue once, to confirmed subscribers only", async () => {
    await addSubscriber("a@example.com");
    await addSubscriber("b@example.com");
    await addSubscriber("pending@example.com", false);
    const issue = makeIssue();
    await saveIssue(issue);

    const first = await sendIssue(issue, "auto");
    expect(first).toMatchObject({ status: "sent", recipients: 2 });
    expect(t.sent).toHaveLength(1);
    const msgs = t.sent[0].messages;
    expect(msgs.map((m) => m.to).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(msgs[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(linkIn(msgs[0].text, "/api/unsubscribe").href).not.toBe(linkIn(msgs[1].text, "/api/unsubscribe").href);
    expect(msgs[0].text).not.toContain("a@example.com"); // links carry an HMAC ref, not the address
    expect(t.sent[0].idempotencyKey).toMatch(/^send\//);

    const stored = await getIssue(MSTP_LEAGUE_ID, issue.slug);
    expect(stored).toMatchObject({ status: "sent", recipientCount: 2 });

    const again = await sendIssue(issue, "auto");
    expect(again.status).toBe("skipped");
    expect(t.sent).toHaveLength(1);
  });

  it("a failed send can be retried and then goes out once", async () => {
    await addSubscriber("a@example.com");
    const issue = makeIssue();
    await saveIssue(issue);
    t.fail = true;
    expect((await sendIssue(issue, "auto")).status).toBe("error");
    t.fail = false;
    expect((await sendIssue(issue, "auto")).status).toBe("sent");
    expect((await sendIssue(issue, "auto")).status).toBe("skipped");
    expect(t.sent).toHaveLength(1);
  });
});

describe("review and approve", () => {
  it("review copy goes to the commissioner once; the approve link sends to the league once", async () => {
    await addSubscriber("a@example.com");
    await addSubscriber("b@example.com");
    await addSubscriber("pending@example.com", false);
    const issue = makeIssue();
    await saveIssue(issue);

    const review = await sendIssue(issue, "review");
    expect(review).toMatchObject({ status: "review_sent", recipients: 1 });
    expect((await sendIssue(issue, "review")).status).toBe("skipped");
    expect(t.sent).toHaveLength(1);
    const copy = t.sent[0].messages[0];
    expect(copy.to).toBe("commish@example.com");
    expect(copy.subject.startsWith("[Review] ")).toBe(true);
    expect(copy.html).toContain("Approve and send to the league");
    expect((await getIssue(MSTP_LEAGUE_ID, issue.slug))?.status).toBe("draft");

    const link = linkIn(copy.text, "/api/admin/approve");
    const slug = link.searchParams.get("issue")!;
    const sig = link.searchParams.get("sig")!;
    expect(slug).toBe(issue.slug);

    // peeking does not use the link
    expect(await inspectApproveLink(sig, slug)).toMatchObject({ ok: true, subscribers: 2 });

    // tampered, wrong issue, expired
    expect((await approveIssue(`${sig.slice(0, -2)}xx`, slug)).status).toBe("bad_signature");
    expect((await approveIssue(sig, "2026-09-30-daily-roast")).status).toBe("bad_signature");
    expect((await approveIssue(sig, slug, Date.now() + 8 * 86400_000)).status).toBe("expired");
    expect(t.sent).toHaveLength(1);

    // a failed send leaves the link usable
    t.fail = true;
    expect((await approveIssue(sig, slug)).status).toBe("error");
    t.fail = false;

    const ok = await approveIssue(sig, slug);
    expect(ok).toMatchObject({ ok: true, status: "sent", recipients: 2 });
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].messages.map((m) => m.to).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect((await getIssue(MSTP_LEAGUE_ID, slug))?.status).toBe("sent");

    expect((await approveIssue(sig, slug)).status).toBe("already_sent");
    // even if the issue were somehow back in draft, the link is spent
    await saveIssue({ ...issue, status: "draft" });
    expect((await approveIssue(sig, slug)).status).toBe("already_used");
    expect(t.sent).toHaveLength(2);
  });
});

describe("subjects", () => {
  it("a dek the model wrote is the whole subject; a code-written one gets the title and week", () => {
    const opts = { unsubscribeUrl: "https://x.test/u", webUrl: null };
    const model = makeIssue({ factsOnly: false, dekSource: "model", dek: "Rory benched 24.3 and blamed the wind." });
    expect(renderIssueEmail(model, opts).subject).toBe("Rory benched 24.3 and blamed the wind.");
    expect(renderIssueEmail(makeIssue({ dek: "Kevin's Kitchen put up 150.20." }), opts).subject).toBe("The Weekly Roast, week 3: Kevin's Kitchen put up 150.20.");
    const grades = makeIssue({ kind: "draft_grades", title: "Draft Grades", week: null, dek: "Most value drafted: Sam I Am (A+). Least: Dev Null (F)." });
    expect(renderIssueEmail(grades, opts).subject).toBe("Draft Grades. Most value drafted: Sam I Am (A+). Least: Dev Null (F).");
  });
});

describe("approve links are bound to the reviewed version", () => {
  it("a draft rebuilt under the same slug cannot be sent with the old link", async () => {
    await addSubscriber("a@example.com");
    const issue = makeIssue({ createdAt: Date.now() - 60_000 });
    await saveIssue(issue);
    await sendIssue(issue, "review");
    const link = linkIn(t.sent[0].messages[0].text, "/api/admin/approve");
    const slug = link.searchParams.get("issue")!;
    const sig = link.searchParams.get("sig")!;
    // Rebuilt (for example after a lost built: pointer): same slug, new content, new createdAt.
    await saveIssue({ ...issue, createdAt: Date.now(), dek: "Different words." });
    expect((await inspectApproveLink(sig, slug)).status).toBe("bad_signature");
    expect((await approveIssue(sig, slug)).status).toBe("bad_signature");
    expect(t.sent).toHaveLength(1);
  });
});

describe("subscriptions", () => {
  it("is not configured without email", async () => {
    setEmailTransportForTests(null);
    expect((await subscribe({ email: "a@example.com", managerKey: "ethan" })).status).toBe("not_configured");
  });

  it("validates input", async () => {
    for (const email of ["", "nope", "a@b", "a b@example.com", "a@example.com\r\nBcc: x@y.z", `${"a".repeat(250)}@example.com`]) {
      expect((await subscribe({ email, managerKey: "ethan" })).status).toBe("invalid_email");
    }
    expect((await subscribe({ email: "a@example.com", managerKey: "nobody" })).status).toBe("unknown_manager");
    expect(t.sent).toHaveLength(0);
  });

  it("double opt-in: pending until the signed link is used", async () => {
    const res = await subscribe({ email: " Ann@Example.com ", managerKey: "ethan" });
    expect(res).toMatchObject({ ok: true, status: "subscribed" });
    expect(t.sent).toHaveLength(1);
    const mail = t.sent[0].messages[0];
    expect(mail.to).toBe("ann@example.com");
    expect(mail.text).toContain("signed up as Ethan");
    expect((await listSubscribers(MSTP_LEAGUE_ID))[0]).toMatchObject({ email: "ann@example.com", confirmed: false });

    // a second sign-up right away does not spam a second email
    expect((await subscribe({ email: "ann@example.com", managerKey: "ethan" })).status).toBe("subscribed");
    expect(t.sent).toHaveLength(1);

    const token = linkIn(mail.text, "/api/subscribe/confirm").searchParams.get("token")!;
    expect((await unsubscribe(token)).status).toBe("bad_signature"); // wrong purpose
    expect((await confirmSubscription(token, Date.now() + 8 * 86400_000)).status).toBe("expired");
    expect(await confirmSubscription(token)).toMatchObject({ ok: true, status: "confirmed", managerKey: "ethan" });
    expect((await confirmSubscription(token)).status).toBe("already_confirmed");
    expect((await listSubscribers(MSTP_LEAGUE_ID))[0].confirmed).toBe(true);
    // A confirmed address gets the same answer as a new one (the form reveals nothing), and no email.
    const again = await subscribe({ email: "ann@example.com", managerKey: "ethan" });
    expect(again).toEqual(await subscribe({ email: "new@example.com", managerKey: "peter" }));
    expect(again.status).toBe("subscribed");
    expect(t.sent.map((x) => x.messages[0].to)).toEqual(["ann@example.com", "new@example.com"]);
  });

  it(`caps confirmed subscribers at ${MAX_SUBSCRIBERS} and pending sign-ups at ${MAX_PENDING}`, async () => {
    for (let i = 0; i < MAX_SUBSCRIBERS; i++) await addSubscriber(`fan${i}@example.com`);
    expect((await subscribe({ email: "one-too-many@example.com", managerKey: "peter" })).status).toBe("full");
    expect(t.sent).toHaveLength(0);

    store.resetStoreForTests();
    for (let i = 0; i < MAX_PENDING; i++) await addSubscriber(`pending${i}@example.com`, false);
    await addSubscriber("real@example.com");
    // Pending sign-ups can no longer lock the real managers out: they have their own cap.
    expect((await subscribe({ email: "throwaway@example.com", managerKey: "peter" })).status).toBe("try_later");
    // An existing pending sign-up can still get its link again.
    expect((await subscribe({ email: "pending1@example.com", managerKey: "peter" })).status).toBe("subscribed");
    expect(t.sent).toHaveLength(1);
  });

  it(`sends a pending address its link at most ${MAX_CONFIRM_SENDS} times and never refreshes its expiry`, async () => {
    const t0 = Date.now();
    expect((await subscribe({ email: "ann@example.com", managerKey: "ethan" }, t0)).status).toBe("subscribed");
    const first = linkIn(t.sent[0].messages[0].text, "/api/subscribe/confirm").searchParams.get("token")!;
    for (let i = 0; i < 4; i++) {
      await store.unlock(store.keys.lock(MSTP_LEAGUE_ID, `confirm-mail:${subscriberRef("ann@example.com")}`));
      expect((await subscribe({ email: "ann@example.com", managerKey: "ethan" }, t0 + (i + 1) * 3600_000)).status).toBe("subscribed");
    }
    expect(t.sent).toHaveLength(MAX_CONFIRM_SENDS);
    const second = linkIn(t.sent[1].messages[0].text, "/api/subscribe/confirm").searchParams.get("token")!;
    // Both links expire 7 days after the FIRST sign-up.
    expect((await confirmSubscription(second, t0 + 7 * 86400_000 + 1000)).status).toBe("expired");
    expect((await confirmSubscription(first, t0 + 6 * 86400_000)).status).toBe("confirmed");
  });

  it("rate limits sign-ups per IP and confirmation emails site-wide", async () => {
    for (let i = 0; i < SUBSCRIBES_PER_IP; i++) {
      expect((await subscribe({ email: `ip${i}@example.com`, managerKey: "peter" }, Date.now(), { ip: "203.0.113.9" })).status).toBe("subscribed");
    }
    expect((await subscribe({ email: "ip-extra@example.com", managerKey: "peter" }, Date.now(), { ip: "203.0.113.9" })).status).toBe("try_later");
    expect((await subscribe({ email: "other-ip@example.com", managerKey: "peter" }, Date.now(), { ip: "198.51.100.7" })).status).toBe("subscribed");

    // The site-wide hourly budget is spent (a counter at the limit): nothing more goes out.
    store.resetStoreForTests();
    await store.set(store.keys.rate("confirm-mail:all"), CONFIRM_EMAILS_PER_HOUR, { ttlSeconds: 3600 });
    const before = t.sent.length;
    expect((await subscribe({ email: "over-budget@example.com", managerKey: "peter" })).status).toBe("try_later");
    expect(t.sent.length).toBe(before);
    // ...and the address can try again later (its per-address mail lock was released).
    await store.del(store.keys.rate("confirm-mail:all"));
    expect((await subscribe({ email: "over-budget@example.com", managerKey: "peter" })).status).toBe("subscribed");
    expect(t.sent.length).toBe(before + 1);
  });

  it("never returns internal error details", async () => {
    t.fail = true;
    const res = await subscribe({ email: "ann@example.com", managerKey: "ethan" });
    expect(res).toEqual({ ok: false, status: "error", message: "Something broke. Try again later." });
    t.fail = false;
  });

  it("unsubscribe: signed, one address, idempotent", async () => {
    await addSubscriber("a@example.com");
    await addSubscriber("b@example.com");
    const issue = makeIssue();
    await saveIssue(issue);
    await sendIssue(issue, "auto");
    const msgA = t.sent[0].messages.find((m) => m.to === "a@example.com")!;
    const token = linkIn(msgA.text, "/api/unsubscribe").searchParams.get("token")!;

    expect((await unsubscribe(`${token}x`)).status).toBe("bad_signature");
    expect((await unsubscribe("")).status).toBe("bad_signature");
    expect(await unsubscribe(token)).toEqual({ ok: true, status: "unsubscribed" });
    expect((await unsubscribe(token)).status).toBe("not_found");
    expect((await listSubscribers(MSTP_LEAGUE_ID)).map((s) => s.email)).toEqual(["b@example.com"]);
  });
});
