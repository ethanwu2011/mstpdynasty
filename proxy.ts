/**
 * Optional password gate (Next 16 renamed middleware to proxy; it always runs on Node).
 * Off unless SITE_PASSWORD is set. Signed email links, the cron route, /api/tick and static
 * assets stay reachable without the cookie (see isUngatedPath in lib/email/gate.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateEnabled, isGateCookieValid, isUngatedPath } from "@/lib/email/gate";

export function proxy(request: NextRequest) {
  if (!gateEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (isUngatedPath(pathname)) return NextResponse.next();
  if (isGateCookieValid(request.cookies.get(GATE_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Password required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/enter";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
