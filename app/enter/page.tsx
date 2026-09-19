/**
 * Password gate page. OWNER: ops agent. Minimal and unstyled on purpose; the designer
 * restyles it. Posts to /api/enter, which sets the cookie.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { gateEnabled, safeNextPath } from "@/lib/email/gate";

export const metadata: Metadata = { title: "Enter", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EnterPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(first(sp.next));
  const error = first(sp.error);

  if (!gateEnabled()) {
    return (
      <main>
        <h1>MSTP Dynasty</h1>
        <p>No password is set, so the site is open.</p>
        <p>
          <Link href={next}>Go in</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>MSTP Dynasty</h1>
      <p>League members only.</p>
      <form method="post" action="/api/enter">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password">Password</label>{" "}
        <input id="password" name="password" type="password" required autoComplete="current-password" autoFocus />{" "}
        <button type="submit">Enter</button>
      </form>
      {error === "1" ? <p role="alert">Wrong password.</p> : null}
      {error === "locked" ? <p role="alert">Too many tries. Wait 15 minutes and try again.</p> : null}
    </main>
  );
}
