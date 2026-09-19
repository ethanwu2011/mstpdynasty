/** Email: escaping, review and approve (single use), send-once, league recipients, unsubscribe, no addresses leak. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIssue, saveIssue } from "@/lib/archive";
import {
  approveIssue,
  inspectApproveLink,
  MAX_RECIPIENTS,
  purgeLegacySubscribers,
  recipients,
  scrubAddresses,
  sendIssue,
  setEmailTransportForTests,
  unsubscribe,
} from "@/lib/email";
import * as emailModule from "@/lib/email";
import { renderIssueEmail } from "@/lib/email/render";
import { MSTP_LEAGUE_ID } from "@/lib/env";
import * as store from "@/lib/store";
import { addr, fakeTransport, linkIn, makeIssue, type FakeTransport } from "./ops-helpers";

const RLO = String.fromCharCode(0x202e);
const EM_DASH = String.fromCharCode(0x2014);
const EVIL = `<script>alert("x")</script><img src=x onerror=alert(1)> & Co${RLO}`;

let t: FakeTransport;

beforeEach(() => {
  store.resetStoreForTests();
  vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
  vi.stubEnv("COMMISSIONER_EMAIL", addr("commish"));
  vi.stubEnv("SITE_URL", "https://mstpdynasty.test");
  vi.stubEnv("LEAGUE_ID", "");
  vi.stubEnv("NEWSLETTER_MODE", "");
  vi.stubEnv("LEAGUE_EMAILS", "");
  t = fakeTransport();
  setEmailTransportForTests(t);
});

afterEach(() => {
  setEmailTransportForTests(undefined);
  vi.unstubAllEnvs();
});

/** The league list (LEAGUE_EMAILS), as Ethan sets it in the private env. */
function leagueList(...names: string[]) {
  vi.stubEnv("LEAGUE_EMAILS", names.map(addr).join(", "));
}

describe("rendering", () => {
  const evilIssue = () =>
    makeIssue({
      title: "Week 3 Recap",
      dek: `${EVIL} got sunk\r\nBcc: ${addr("victim")}`,
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
    expect(subject.startsWith("Week 3 Recap: ")).toBe(true);
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

  it("auto mode sends each issue once, to the league list", async () => {
    leagueList("a", "b");
    const issue = makeIssue();
    await saveIssue(issue);

    const first = await sendIssue(issue, "auto");
    expect(first).toMatchObject({ status: "sent", recipients: 2 });
    expect(t.sent).toHaveLength(1);
    const msgs = t.sent[0].messages;
    expect(msgs.map((m) => m.to).sort()).toEqual([addr("a"), addr("b")]);
    expect(msgs[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(linkIn(msgs[0].text, "/api/unsubscribe").href).not.toBe(linkIn(msgs[1].text, "/api/unsubscribe").href);
    expect(msgs[0].text).not.toContain(addr("a")); // links carry an HMAC ref, not the address
    expect(t.sent[0].idempotencyKey).toMatch(/^send\//);

    const stored = await getIssue(MSTP_LEAGUE_ID, issue.slug);
    expect(stored).toMatchObject({ status: "sent", recipientCount: 2 });

    const again = await sendIssue(issue, "auto");
    expect(again.status).toBe("skipped");
    expect(t.sent).toHaveLength(1);
  });

  it("a failed send can be retried and then goes out once", async () => {
    leagueList("a");
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
  it("review copy goes to the commissioner only, once; the approve link sends to the league once", async () => {
    leagueList("a", "b");
    const issue = makeIssue();
    await saveIssue(issue);

    const review = await sendIssue(issue, "review");
    expect(review).toMatchObject({ status: "review_sent", recipients: 1 });
    expect((await sendIssue(issue, "review")).status).toBe("skipped");
    expect(t.sent).toHaveLength(1);
    const copy = t.sent[0].messages[0];
    expect(copy.to).toBe(addr("commish"));
    expect(copy.subject.startsWith("[Review] ")).toBe(true);
    expect(copy.html).toContain("Approve and send to the league");
    expect((await getIssue(MSTP_LEAGUE_ID, issue.slug))?.status).toBe("draft");

    const link = linkIn(copy.text, "/api/admin/approve");
    const slug = link.searchParams.get("issue")!;
    const sig = link.searchParams.get("sig")!;
    expect(slug).toBe(issue.slug);

    // peeking does not use the link
    expect(await inspectApproveLink(sig, slug)).toMatchObject({ ok: true, recipients: 2 });

    // tampered, wrong issue, expired
    expect((await approveIssue(`${sig.slice(0, -2)}xx`, slug)).status).toBe("bad_signature");
    expect((await approveIssue(sig, "2026-09-30-daily")).status).toBe("bad_signature");
    expect((await approveIssue(sig, slug, Date.now() + 8 * 86400_000)).status).toBe("expired");
    expect(t.sent).toHaveLength(1);

    // a failed send leaves the link usable
    t.fail = true;
    expect((await approveIssue(sig, slug)).status).toBe("error");
    t.fail = false;

    const ok = await approveIssue(sig, slug);
    expect(ok).toMatchObject({ ok: true, status: "sent", recipients: 2 });
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].messages.map((m) => m.to).sort()).toEqual([addr("a"), addr("b")]);
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
    expect(renderIssueEmail(makeIssue({ dek: "Kevin's Kitchen put up 150.20." }), opts).subject).toBe("Week 3 Recap: Kevin's Kitchen put up 150.20.");
    const grades = makeIssue({ kind: "draft_grades", title: "Draft Grades", week: null, dek: "Most value drafted: Sam I Am (A+). Least: Dev Null (F)." });
    expect(renderIssueEmail(grades, opts).subject).toBe("Draft Grades. Most value drafted: Sam I Am (A+). Least: Dev Null (F).");
  });
});

describe("approve links are bound to the reviewed version", () => {
  it("a draft rebuilt under the same slug cannot be sent with the old link", async () => {
    leagueList("a");
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

describe("no public sign-up", () => {
  it("lib/email has no sign-up or confirm flow left", () => {
    for (const gone of ["subscribe", "confirmSubscription", "listSubscribers", "SUBSCRIBE_MESSAGES", "MAX_SUBSCRIBERS", "renderConfirmEmail"]) {
      expect(gone in emailModule).toBe(false);
    }
  });

  it("the daily purge deletes records the old form stored, which held addresses", async () => {
    const prefix = store.keys.legacySubscriberPrefix(MSTP_LEAGUE_ID);
    await store.set(`${prefix}${addr("old")}`, { email: addr("old"), confirmed: true });
    await store.set(`${prefix}${addr("older")}`, { email: addr("older"), confirmed: false });
    expect(await purgeLegacySubscribers(MSTP_LEAGUE_ID)).toBe(2);
    expect(await store.list(prefix)).toEqual([]);
    expect(await purgeLegacySubscribers(MSTP_LEAGUE_ID)).toBe(0);
  });
});

describe("league recipients", () => {
  it(`a league send is capped at ${MAX_RECIPIENTS} addresses`, async () => {
    leagueList(...Array.from({ length: MAX_RECIPIENTS + 5 }, (_, i) => `m${i}`));
    const issue = makeIssue();
    await saveIssue(issue);
    expect(await sendIssue(issue, "auto")).toMatchObject({ status: "sent", recipients: MAX_RECIPIENTS });
  });

  it("unsubscribe: signed, one address, idempotent, stored by ref only", async () => {
    leagueList("a", "b");
    const issue = makeIssue();
    await saveIssue(issue);
    await sendIssue(issue, "auto");
    const msgA = t.sent[0].messages.find((m) => m.to === addr("a"))!;
    const token = linkIn(msgA.text, "/api/unsubscribe").searchParams.get("token")!;

    expect((await unsubscribe(`${token}x`)).status).toBe("bad_signature");
    expect((await unsubscribe("")).status).toBe("bad_signature");
    expect(await unsubscribe(token)).toEqual({ ok: true, status: "unsubscribed" });
    expect((await unsubscribe(token)).status).toBe("not_found");
    expect(await recipients(MSTP_LEAGUE_ID)).toEqual([addr("b")]);

    // Nothing in the store holds an address: opt-outs are keyed by an HMAC ref.
    for (const k of await store.list("")) {
      expect(k).not.toContain("example.com");
      expect(JSON.stringify(await store.get(k))).not.toContain("example.com");
    }
  });

  it("provider errors never carry an address into a result or a log", async () => {
    expect(scrubAddresses(`Resend: invalid recipient ${addr("x.y+z")} (to: <${addr("q")}>)`)).toBe("Resend: invalid recipient [address] (to: <[address]>)");
    leagueList("a");
    const issue = makeIssue();
    await saveIssue(issue);
    t.failWith = `Resend: 422 for ${addr("a")}`;
    t.fail = true;
    const res = await sendIssue(issue, "auto");
    expect(res.status).toBe("error");
    expect(res.error).not.toContain("example.com");
  });
});
