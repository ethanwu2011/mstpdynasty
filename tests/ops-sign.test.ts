/** HMAC link tokens and request auth: tamper, expiry, purpose, secrets, redirects, cron. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCronAuth, checkPassword, checkTickAuth, clientIp, gateToken, isGateCookieValid, isUngatedPath, safeNextPath } from "@/lib/email/gate";
import { safeEqual, signToken, subscriberRef, verifyToken, type TokenPayload } from "@/lib/email/sign";

const SECRET = "test-admin-secret";
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

afterEach(() => vi.unstubAllEnvs());

function reencode(token: string, mutate: (p: TokenPayload) => TokenPayload): string {
  const [v, body, sig] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  return [v, Buffer.from(JSON.stringify(mutate(payload))).toString("base64url"), sig].join(".");
}

describe("signed tokens", () => {
  const approve: TokenPayload = { p: "approve", l: "league-1", s: "2026-09-29-weekly-roast", n: "nonce-1", exp: NOW / 1000 + 3600 };

  it("round-trips a valid token", () => {
    const t = signToken(approve, SECRET)!;
    const v = verifyToken(t, "approve", { now: NOW, secret: SECRET });
    expect(v).toEqual({ ok: true, payload: approve });
  });

  it("rejects a tampered payload (same signature)", () => {
    const t = signToken(approve, SECRET)!;
    const forged = reencode(t, (p) => ({ ...p, s: "some-other-issue" }));
    expect(verifyToken(forged, "approve", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "bad_signature" });
    const extended = reencode(t, (p) => ({ ...p, exp: (p.exp ?? 0) + 86400 * 365 }));
    expect(verifyToken(extended, "approve", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered signature and a different secret", () => {
    const t = signToken(approve, SECRET)!;
    const last = t.slice(-1);
    const flipped = t.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(verifyToken(flipped, "approve", { now: NOW, secret: SECRET }).ok).toBe(false);
    expect(verifyToken(t, "approve", { now: NOW, secret: "another-secret" })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("expires exactly at exp, and checks the signature before expiry", () => {
    const t = signToken({ ...approve, exp: NOW / 1000 + 60 }, SECRET)!;
    expect(verifyToken(t, "approve", { now: NOW + 59_000, secret: SECRET }).ok).toBe(true);
    expect(verifyToken(t, "approve", { now: NOW + 60_000, secret: SECRET })).toEqual({ ok: false, reason: "expired" });
    const forged = reencode(t, (p) => ({ ...p, exp: undefined }));
    expect(verifyToken(forged, "approve", { now: NOW + 3600_000, secret: SECRET })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("tokens without exp never expire (unsubscribe links)", () => {
    const t = signToken({ p: "unsub", l: "league-1", r: "ref" }, SECRET)!;
    expect(verifyToken(t, "unsub", { now: NOW + 10 * 365 * 86400_000, secret: SECRET }).ok).toBe(true);
  });

  it("will not accept a token minted for another purpose", () => {
    const t = signToken({ p: "confirm", l: "league-1", r: "ref", exp: NOW / 1000 + 60 }, SECRET)!;
    expect(verifyToken(t, "unsub", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "wrong_purpose" });
    expect(verifyToken(t, "approve", { now: NOW, secret: SECRET })).toEqual({ ok: false, reason: "wrong_purpose" });
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "v1", "v1.abc", "v2.abc.def", "v1.@@.##", "v1..", `v1.${"a".repeat(3000)}.b`, null, undefined]) {
      expect(verifyToken(bad as string, "approve", { now: NOW, secret: SECRET }).ok).toBe(false);
    }
    const junk = `v1.${Buffer.from("not json").toString("base64url")}`;
    const signed = signToken({ p: "unsub", l: "x" }, SECRET)!.split(".")[2];
    expect(verifyToken(`${junk}.${signed}`, "unsub", { secret: SECRET }).ok).toBe(false);
  });

  it("reports not_configured with no ADMIN_SECRET", () => {
    vi.stubEnv("ADMIN_SECRET", "");
    expect(signToken(approve)).toBeNull();
    expect(verifyToken("v1.a.b", "approve")).toEqual({ ok: false, reason: "not_configured" });
    expect(subscriberRef("a@b.co")).toBeNull();
  });

  it("subscriber refs are stable, case-insensitive and secret-dependent", () => {
    expect(subscriberRef("Ann@Example.com", SECRET)).toBe(subscriberRef("ann@example.com", SECRET));
    expect(subscriberRef("ann@example.com", SECRET)).not.toBe(subscriberRef("ann@example.com", "other"));
    expect(subscriberRef("ann@example.com", SECRET)).not.toContain("ann");
  });

  it("safeEqual compares in constant time, any lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("request auth", () => {
  it("cron: open in dev without CRON_SECRET, refused in production, bearer checked when set", () => {
    const req = (auth?: string) => new Request("https://x.test/api/cron/daily", { headers: auth ? { authorization: auth } : {} });
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(checkCronAuth(req()).ok).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(checkCronAuth(req())).toEqual({ ok: false, status: 503, error: "CRON_SECRET is not set." });
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(checkCronAuth(req()).ok).toBe(false);
    expect(checkCronAuth(req("Bearer nope")).ok).toBe(false);
    expect(checkCronAuth(req("cron-secret")).ok).toBe(false);
    expect(checkCronAuth(req("Bearer cron-secret")).ok).toBe(true);
  });

  it("cron in dev needs CRON_SECRET once a paid key is set (next dev listens on the whole network)", () => {
    const req = (auth?: string) => new Request("https://x.test/api/cron/daily", { headers: auth ? { authorization: auth } : {} });
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    expect(checkCronAuth(req())).toMatchObject({ ok: false, status: 503 });
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-x");
    expect(checkCronAuth(req()).ok).toBe(false);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(checkCronAuth(req("Bearer cron-secret")).ok).toBe(true);
  });

  it("tick: open without the gate; with it, the gate cookie or the cron bearer", () => {
    const req = (headers: Record<string, string> = {}) => new Request("https://x.test/api/tick", { headers });
    vi.stubEnv("SITE_PASSWORD", "");
    expect(checkTickAuth(req()).ok).toBe(true);
    vi.stubEnv("SITE_PASSWORD", "hunter2");
    vi.stubEnv("CRON_SECRET", "");
    expect(checkTickAuth(req())).toMatchObject({ ok: false, status: 401 });
    expect(checkTickAuth(req({ cookie: `other=1; mstp_gate=${gateToken()}` })).ok).toBe(true);
    expect(checkTickAuth(req({ cookie: "mstp_gate=nope" })).ok).toBe(false);
    expect(checkTickAuth(req({ authorization: "Bearer anything" })).ok).toBe(false);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(checkTickAuth(req({ authorization: "Bearer cron-secret" })).ok).toBe(true);
  });

  it("client address for rate limits: x-real-ip, else the first forwarded hop, else one shared bucket", () => {
    expect(clientIp(new Request("https://x.test", { headers: { "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request("https://x.test", { headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" } }))).toBe("198.51.100.7");
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });

  it("password gate cookie is derived from the password", () => {
    vi.stubEnv("SITE_PASSWORD", "hunter2");
    const token = gateToken()!;
    expect(isGateCookieValid(token)).toBe(true);
    expect(isGateCookieValid(`${token}x`)).toBe(false);
    expect(isGateCookieValid(undefined)).toBe(false);
    expect(checkPassword("hunter2")).toBe(true);
    expect(checkPassword("hunter3")).toBe(false);
    vi.stubEnv("GATE_VERSION", "2");
    expect(isGateCookieValid(token)).toBe(false); // bumping GATE_VERSION signs everyone out
    vi.stubEnv("GATE_VERSION", "");
    expect(isGateCookieValid(token)).toBe(true);
    vi.stubEnv("SITE_PASSWORD", "changed");
    expect(isGateCookieValid(token)).toBe(false);
    vi.stubEnv("SITE_PASSWORD", "");
    expect(checkPassword("")).toBe(false);
    expect(isGateCookieValid(token)).toBe(false);
  });

  it("redirect targets stay on this site", () => {
    expect(safeNextPath("/draft?week=3")).toBe("/draft?week=3");
    for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "evil", "/enter", "/enter?next=/", 42, null]) {
      expect(safeNextPath(bad)).toBe("/");
    }
    expect(safeNextPath(`/a${String.fromCharCode(10)}b`)).toBe("/");
  });

  it("signed-link routes, cron and assets bypass the gate; pages and other APIs do not", () => {
    for (const p of ["/enter", "/api/enter", "/api/unsubscribe", "/api/admin/approve", "/api/subscribe/confirm", "/api/cron/daily", "/api/tick", "/_next/static/x.js"]) {
      expect(isUngatedPath(p)).toBe(true);
    }
    for (const p of ["/", "/draft", "/api/subscribe", "/newsletter/2026-09-29-weekly-roast", "/enterprise", "/api/admin"]) {
      expect(isUngatedPath(p)).toBe(false);
    }
  });
});
