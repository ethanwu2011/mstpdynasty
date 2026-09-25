/** Email: escaping, review and approve (single use), send-once, league recipients, unsubscribe, no addresses leak. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIssue, saveIssue } from "@/lib/archive";
import {
  approveIssue,
  inspectApproveLink,
  listSubscribers,
  MAX_RECIPIENTS,
  readEmailStatus,
  recipients,
  resendIssue,
  scrubAddresses,
  sendIssue,
  sendTestCopy,
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
    // A code-written dek: the issue name leads the subject, with one colon.
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

  it("resendIssue never emails the words the league already got from the first send; new words go once", async () => {
    vi.stubEnv("NEWSLETTER_MODE", "auto");
    leagueList("a");
    const issue = makeIssue({ factsOnly: false });
    await saveIssue(issue);
    expect((await sendIssue(issue, "auto")).status).toBe("sent");

    const same = await getIssue(MSTP_LEAGUE_ID, issue.slug);
    expect(await resendIssue(same!)).toMatchObject({ status: "skipped", error: "These exact words already went to the league." });
    expect(t.sent).toHaveLength(1);

    const rewritten = { ...same!, dek: "Week 3, reviewed again." };
    await saveIssue(rewritten);
    expect(await resendIssue(rewritten)).toMatchObject({ status: "sent", recipients: 1 });
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].messages[0].text).toContain("Week 3, reviewed again.");
  });

  it("resendIssue never goes around review mode: new words wait for the approve link", async () => {
    leagueList("a");
    const issue = makeIssue({ factsOnly: false, status: "sent", sentAt: 1 });
    await saveIssue(issue);
    expect(await resendIssue({ ...issue, dek: "Unreviewed words." })).toMatchObject({ status: "skipped", error: "Review mode: a rewritten issue is not sent again without approval." });
    expect(t.sent).toHaveLength(0);
  });
});

describe("the record of emailed words (third review round)", () => {
  /** The per-issue resend counter, cleared so a test can ask again without hitting the daily limit. */
  const clearResends = (slug: string) => store.del(store.keys.rate(`resend:${MSTP_LEAGUE_ID}:${slug}`));

  it("recording a second version never drops the first, even when two resends overlap", async () => {
    vi.stubEnv("NEWSLETTER_MODE", "auto");
    leagueList("a");
    const issue = makeIssue({ factsOnly: false });
    await saveIssue(issue);
    expect((await sendIssue(issue, "auto")).status).toBe("sent");
    const sent = (await getIssue(MSTP_LEAGUE_ID, issue.slug))!;
    const v2 = { ...sent, dek: "Week 3, reviewed again." };
    const v3 = { ...sent, dek: "Week 3, reviewed a third time." };

    // A second resend (new words) runs start to finish while the first is recording its words:
    // after the first one checked the record, before its own write lands.
    const s = store.getStore();
    const set = s.set.bind(s);
    let raced = false;
    s.set = async (key, value, opts) => {
      if (!raced && key.includes("emailed-words")) {
        raced = true;
        await saveIssue(v3);
        expect(await resendIssue(v3)).toMatchObject({ status: "sent" });
      }
      return set(key, value, opts);
    };
    try {
      await saveIssue(v2);
      expect(await resendIssue(v2)).toMatchObject({ status: "sent" });
    } finally {
      s.set = set;
    }
    expect(raced).toBe(true);
    expect(t.sent.map((x) => x.messages[0].text.includes("third time"))).toEqual([false, false, true]);

    // Both versions the league got are on record: neither goes out a second time.
    await clearResends(issue.slug);
    expect(await resendIssue(v3)).toMatchObject({ status: "skipped", error: "These exact words already went to the league." });
    await saveIssue(v2);
    expect(await resendIssue(v2)).toMatchObject({ status: "skipped", error: "These exact words already went to the league." });
    await clearResends(issue.slug);
    await saveIssue(sent);
    expect(await resendIssue(sent)).toMatchObject({ status: "skipped", error: "These exact words already went to the league." });
    expect(t.sent).toHaveLength(3);
  });

  it("resendIssue sends nothing when the record of emailed words cannot be read", async () => {
    vi.stubEnv("NEWSLETTER_MODE", "auto");
    leagueList("a");
    const issue = makeIssue({ factsOnly: false });
    await saveIssue(issue);
    expect((await sendIssue(issue, "auto")).status).toBe("sent");
    const rewritten = { ...(await getIssue(MSTP_LEAGUE_ID, issue.slug))!, dek: "Week 3, reviewed again." };
    await saveIssue(rewritten);

    const s = store.getStore();
    const get = s.get.bind(s);
    s.get = async <T>(key: string) => (key.includes("emailed-words") ? Promise.reject(new Error("store timed out")) : get<T>(key));
    try {
      expect((await resendIssue(rewritten)).status).not.toBe("sent");
    } finally {
      s.get = get;
    }
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
    const daily = makeIssue({ kind: "daily", title: "The Daily Roast", week: null, dek: "Theo took Tavon Reyes at pick 1, 8 spots before his FantasyCalc rank." });
    expect(renderIssueEmail(daily, opts).subject).toBe("The Daily. Theo took Tavon Reyes at pick 1, 8 spots before his FantasyCalc rank.");
  });

  it("the writer's headline is the subject and the H1; nothing says Roast", () => {
    const opts = { unsubscribeUrl: "https://x.test/u", webUrl: null };
    const headline = "Theo Stacked Two Tight Ends on Top and Still Couldn't Stay Up";
    // Stored under the old name: it still goes out as The Daily.
    const issue = makeIssue({ kind: "daily", title: "The Daily Roast", week: null, factsOnly: false, dekSource: "model", dek: headline });
    const { subject, html, text } = renderIssueEmail(issue, opts);
    expect(subject).toBe(headline);
    expect(html).toContain(`>${headline.replace("'", "&#39;")}</h1>`);
    expect(html).toContain("MSTP Dynasty \u00b7 The Daily</p>");
    expect(text.split("\n").slice(0, 3)).toEqual(["MSTP DYNASTY \u00b7 THE DAILY", "", headline]);
    expect(`${subject}\n${html}\n${text}`).not.toMatch(/roast/i);
    // A facts-only issue keeps its name as the H1 and the fact line under it.
    const plain = renderIssueEmail(makeIssue({ dek: "Kevin's Kitchen put up 150.20." }), opts).html;
    expect(plain).toContain(">Week 3 Recap</h1>");
    expect(plain).toContain("Kevin&#39;s Kitchen put up 150.20.</p>");
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
    for (const gone of ["subscribe", "confirmSubscription", "SUBSCRIBE_MESSAGES", "MAX_SUBSCRIBERS", "renderConfirmEmail", "purgeLegacySubscribers"]) {
      expect(gone in emailModule).toBe(false);
    }
  });
});

describe("recipients(): LEAGUE_EMAILS plus confirmed subscribers, minus opt-outs", () => {
  const subscribe = (local: string, confirmed: boolean) =>
    store.set(store.keys.subscriber(MSTP_LEAGUE_ID, addr(local)), { email: addr(local), managerKey: "x", createdAt: 1, confirmed });

  it("confirmed subscribers the old form stored still get the league email; pending ones do not; each address once", async () => {
    leagueList("a", "b");
    await subscribe("b", true); // also on the league list: sent once
    await subscribe("c", true);
    await subscribe("d", false);
    expect((await recipients(MSTP_LEAGUE_ID)).sort()).toEqual([addr("a"), addr("b"), addr("c")]);
    const issue = makeIssue();
    await saveIssue(issue);
    expect(await sendIssue(issue, "auto")).toMatchObject({ status: "sent", recipients: 3 });
    expect(t.sent[0].messages.map((m) => m.to).sort()).toEqual([addr("a"), addr("b"), addr("c")]);
  });

  it("a subscriber who unsubscribes gets an opt-out marker and loses the record; again is still fine", async () => {
    await subscribe("c", true);
    const issue = makeIssue();
    await saveIssue(issue);
    await sendIssue(issue, "auto");
    const token = linkIn(t.sent[0].messages[0].text, "/api/unsubscribe").searchParams.get("token")!;
    expect(await unsubscribe(token)).toEqual({ ok: true, status: "unsubscribed" });
    expect(await unsubscribe(token)).toEqual({ ok: true, status: "unsubscribed" });
    expect(await listSubscribers(MSTP_LEAGUE_ID)).toEqual([]);
    expect(await recipients(MSTP_LEAGUE_ID)).toEqual([]);
    // Added to the league list later: the opt-out still holds.
    leagueList("c");
    expect(await recipients(MSTP_LEAGUE_ID)).toEqual([]);
  });
});

describe("sendTestCopy (GET /api/admin/send-test)", () => {
  it("sends one [Test] copy to COMMISSIONER_EMAIL only, never the league list, and marks nothing sent", async () => {
    leagueList("a", "b");
    const issue = makeIssue();
    await saveIssue(issue);
    const res = await sendTestCopy(issue);
    expect(res).toMatchObject({ status: "test_sent", recipients: 1 });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].messages.map((m) => m.to)).toEqual([addr("commish")]);
    expect(t.sent[0].messages[0].subject.startsWith("[Test] ")).toBe(true);
    expect((await getIssue(MSTP_LEAGUE_ID, issue.slug))?.status).toBe(issue.status);
    expect(await readEmailStatus()).toMatchObject({ status: "test_sent", recipients: 1 });
  });

  it("without COMMISSIONER_EMAIL nothing is sent to anyone", async () => {
    vi.stubEnv("COMMISSIONER_EMAIL", "");
    leagueList("a", "b");
    const issue = makeIssue();
    await saveIssue(issue);
    expect((await sendTestCopy(issue)).status).toBe("not_configured");
    expect(t.sent).toHaveLength(0);
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
    // Idempotent: a second click still reads as unsubscribed (the opt-out marker stays).
    expect((await unsubscribe(token)).status).toBe("unsubscribed");
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
