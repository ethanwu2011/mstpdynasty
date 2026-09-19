/**
 * Password gate form target (/enter posts here). Sets an httpOnly cookie derived from
 * SITE_PASSWORD and sends the visitor back where they were going (same-site paths only).
 *
 * Guessing is limited: every attempt counts against a per-IP and a site-wide budget
 * (lib/email/limits.ts) BEFORE the password is checked, so parallel requests cannot race past
 * it, and a wrong password also waits 400 ms. SITE_PASSWORD should still be a long passphrase.
 */
import { NextResponse } from "next/server";
import { checkPassword, clientIp, GATE_COOKIE, GATE_MAX_AGE_SECONDS, gateEnabled, gateToken, safeNextPath } from "@/lib/email/gate";
import { allowGateAttempt } from "@/lib/email/limits";

export const dynamic = "force-dynamic";

function back(req: Request, next: string, error: "1" | "locked"): Response {
  const url = new URL("/enter", req.url);
  url.searchParams.set("error", error);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const next = safeNextPath(form?.get("next"));
  if (!gateEnabled()) return NextResponse.redirect(new URL(next, req.url), 303);

  if (!(await allowGateAttempt(clientIp(req)))) return back(req, next, "locked");

  const password = form?.get("password");
  const token = gateToken();
  if (!checkPassword(password) || !token) {
    // Slow down guessing a little more.
    await new Promise((r) => setTimeout(r, 400));
    return back(req, next, "1");
  }

  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GATE_MAX_AGE_SECONDS,
  });
  return res;
}
