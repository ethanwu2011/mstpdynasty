/**
 * Page-level password gate, the second line behind proxy.ts. Next advisories in 2026
 * (GHSA-267c-6grr-h53f, GHSA-26hh-7cqf-hhc6, GHSA-492v-c6pp-mqqv) showed that auth enforced only
 * in the proxy can be bypassed, and the vendor's advice is to check again where the data is
 * rendered. Call `await requireGate("/draft")` at the top of every page that shows league data,
 * or from a route-group layout that does NOT wrap /enter (a root-layout call would redirect
 * /enter to itself). Off (and no cookies() call, so pages stay static) unless SITE_PASSWORD is set.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE, gateEnabled, isGateCookieValid, safeNextPath } from "./gate";

export async function requireGate(nextPath = "/"): Promise<void> {
  if (!gateEnabled()) return;
  const jar = await cookies();
  if (isGateCookieValid(jar.get(GATE_COOKIE)?.value)) return;
  const next = safeNextPath(nextPath);
  redirect(next === "/" ? "/enter" : `/enter?next=${encodeURIComponent(next)}`);
}
