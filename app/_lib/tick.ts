import { headers } from "next/headers";
import { after } from "next/server";
import { siteUrl } from "@/lib/env";

const TIMEOUT_MS = 10_000;

/**
 * Fire /api/tick after the response is sent (Next `after()`), so page visits trigger the
 * instant roasts on Vercel Hobby. Tolerates everything: a missing route (404), a method
 * mismatch, the password gate, a timeout. It never throws and never delays the page.
 *
 * The URL comes from SITE_URL / VERCEL_URL when set, else from a localhost Host header in
 * development. A public Host header is never trusted to build a URL.
 */
export async function fireTick(): Promise<void> {
  let base: string | null = null;
  if (process.env.SITE_URL || process.env.VERCEL_URL) {
    base = siteUrl();
  } else {
    const host = (await headers()).get("host") ?? "";
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) base = `http://${host}`;
  }
  if (!base) return;
  const url = `${base}/api/tick`;

  after(async () => {
    try {
      const init = { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) } as const;
      const res = await fetch(url, { ...init, method: "POST" });
      if (res.status === 405) await fetch(url, { ...init, method: "GET" });
    } catch {
      // The tick is best effort. The route may not exist yet.
    }
  });
}
