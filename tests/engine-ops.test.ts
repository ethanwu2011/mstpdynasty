/**
 * Round 3 ops: the daily FantasyCalc snapshot (history for trades in hindsight) and
 * POST /api/admin/test-email. Placeholder addresses only, built at run time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as testEmailRoute } from "@/app/api/admin/test-email/route";
import { saveIssue } from "@/lib/archive";
import { setEmailTransportForTests } from "@/lib/email";
import { ADMIN_ATTEMPTS_PER_IP } from "@/lib/email/limits";
import { setRoastClient } from "@/lib/roast";
import type { RoastClient } from "@/lib/roast/llm";
import { MSTP_LEAGUE_ID } from "@/lib/env";
import { ensureDailySnapshot, getFantasyCalcValuesOn, listFantasyCalcDates, resetSnapshotMemoForTests } from "@/lib/fantasycalc";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import { hasFixtures } from "./helpers/fixtures";
import { addr, fakeTransport, makeIssue, type FakeTransport } from "./ops-helpers";

beforeEach(() => {
  store.resetStoreForTests();
  resetSnapshotMemoForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setEmailTransportForTests(undefined);
  resetSnapshotMemoForTests();
});

/* ------------------------------------------------------------------ */
/* the daily FantasyCalc snapshot                                      */
/* ------------------------------------------------------------------ */

const FC_PAYLOAD = [
  { player: { name: "Jalen Crane", sleeperId: "101", position: "RB", maybeAge: 23 }, value: 6100, overallRank: 12, positionRank: 4, redraftValue: 5000, trend30Day: 40 },
  { player: { name: "2027 1st (Mid)", sleeperId: "pick-2027-1-mid", position: "PICK" }, value: 4200, overallRank: 30 },
];

function fakeFetch(ok = true) {
  const fetch = vi.fn(async () =>
    ok
      ? new Response(JSON.stringify(FC_PAYLOAD), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("nope", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("the daily FantasyCalc snapshot", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_SOURCE", ""); // live mode, with fetch faked below
  });

  it("stores today's values once: one fetch a day, however many runs ask", async () => {
    const fetch = fakeFetch();
    const today = etDate(Date.now());
    expect(await ensureDailySnapshot()).toMatchObject({ date: today, status: "stored" });
    expect(await ensureDailySnapshot()).toMatchObject({ status: "present" });
    // A fresh instance (memo gone) finds it in the store instead of fetching again.
    resetSnapshotMemoForTests();
    expect(await ensureDailySnapshot()).toMatchObject({ status: "present" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The fetch bypasses the Next data cache, so a day's snapshot is never yesterday's payload.
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].cache).toBe("no-store");
    expect(await listFantasyCalcDates()).toEqual([today]);
    expect(await getFantasyCalcValuesOn(today)).toEqual({ date: today, values: { "101": 6100 }, picks: { "2027 1st (Mid)": 4200 } });
  });

  it("a failed fetch is retried at most every 30 minutes, not on every tick", async () => {
    const fetch = fakeFetch(false);
    expect((await ensureDailySnapshot()).status).toBe("error");
    expect((await ensureDailySnapshot()).status).toBe("waiting");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await listFantasyCalcDates()).toEqual([]);
  });

  it("fixture mode never stores a snapshot", async () => {
    vi.stubEnv("DATA_SOURCE", "fixtures");
    const fetch = fakeFetch();
    expect((await ensureDailySnapshot()).status).toBe("fixture");
    expect(fetch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/test-email                                          */
/* ------------------------------------------------------------------ */

const SECRET = "test-admin-secret-for-the-route-long-enough";
const post = (auth?: string, ip = "203.0.113.7") =>
  testEmailRoute(
    new Request("https://mstpdynasty.test/api/admin/test-email", {
      method: "POST",
      headers: { "x-real-ip": ip, ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ to: addr("attacker") }),
    }),
  );

describe("POST /api/admin/test-email", () => {
  let t: FakeTransport;
  beforeEach(() => {
    vi.stubEnv("LEAGUE_ID", "");
    vi.stubEnv("SITE_URL", "https://mstpdynasty.test");
    vi.stubEnv("COMMISSIONER_EMAIL", addr("commish"));
    vi.stubEnv("LEAGUE_EMAILS", [addr("a"), addr("b")].join(","));
    t = fakeTransport();
    setEmailTransportForTests(t);
  });

  it("is closed without ADMIN_SECRET or with a short one, with the same 401 as a wrong bearer", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    const res = await post(`Bearer ${SECRET}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized." });
    vi.stubEnv("ADMIN_SECRET", "short-secret");
    expect((await post("Bearer short-secret")).status).toBe(401);
    expect(t.sent).toHaveLength(0);
  });

  it("needs the exact bearer (401), counts every attempt, and stops answering a guessing IP (429)", async () => {
    vi.stubEnv("ADMIN_SECRET", SECRET);
    // No bearer: nothing is compared, nothing is counted.
    expect((await post()).status).toBe(401);
    expect((await post(`Bearer ${SECRET}x`)).status).toBe(401);
    for (let i = 1; i < ADMIN_ATTEMPTS_PER_IP; i++) expect((await post("Bearer wrong")).status).toBe(401);
    // The right secret is refused too once the IP has used its attempts: it is never compared.
    expect((await post(`Bearer ${SECRET}`)).status).toBe(429);
    // Another address is unaffected.
    expect((await post("Bearer wrong", "198.51.100.4")).status).toBe(401);
    expect(t.sent).toHaveLength(0);
  });

  it("parallel guesses cannot race past the limit: at most 10 are ever compared", async () => {
    vi.stubEnv("ADMIN_SECRET", SECRET);
    const codes = (await Promise.all(Array.from({ length: 50 }, () => post("Bearer wrong")))).map((r) => r.status);
    const compared = codes.filter((c) => c === 401).length;
    expect(compared).toBeLessThanOrEqual(ADMIN_ATTEMPTS_PER_IP);
    expect(codes.filter((c) => c === 429)).toHaveLength(50 - compared);
    expect(t.sent).toHaveLength(0);
  });

  it.skipIf(!hasFixtures())("a capped test email is refused before any sample is built (no model call)", async () => {
    vi.stubEnv("ADMIN_SECRET", SECRET);
    let calls = 0;
    const client: RoastClient = {
      beta: {
        messages: {
          async create() {
            calls++;
            throw new Error("no model in tests");
          },
        },
      },
    };
    setRoastClient(client);
    try {
      await store.set(store.keys.rate(`test-email:${MSTP_LEAGUE_ID}`), 10);
      const res = await post(`Bearer ${SECRET}`);
      expect(res.status).toBe(409);
      expect(calls).toBe(0);
      expect(t.sent).toHaveLength(0);
    } finally {
      setRoastClient(undefined);
    }
  });

  it.skipIf(!hasFixtures())("sends the newest issue to COMMISSIONER_EMAIL only, ignores the body, and answers without any address", async () => {
    vi.stubEnv("ADMIN_SECRET", SECRET);
    const issue = makeIssue();
    await saveIssue(issue);
    const res = await post(`Bearer ${SECRET}`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ status: "test_sent", recipients: 1, issueSlug: issue.slug, sample: false });
    expect(text).not.toContain("example.com");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].messages.map((m) => m.to)).toEqual([addr("commish")]);
    expect(t.sent[0].messages[0].subject.startsWith("[Test] ")).toBe(true);
    expect((await store.get<{ status: string }>(store.keys.issue(MSTP_LEAGUE_ID, issue.slug)))?.status).toBe("draft");
  });
});
