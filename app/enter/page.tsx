/**
 * Password gate page. Posts to /api/enter, which sets the cookie. Plain paper, one field, big
 * targets: it is the first thing a phone sees when the gate is on.
 */
import type { Metadata } from "next";
import { Button, PixelArrow } from "@/components/Button";
import { Board, Panel } from "@/components/Panel";
import { gateEnabled, safeNextPath } from "@/lib/email/gate";

export const metadata: Metadata = { title: "Enter", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EnterPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(first(sp.next));
  const error = first(sp.error);

  return (
    <Board>
      <Panel label="League members only">
        <div className="flex max-w-md flex-col gap-6">
          <h1 className="type-display m-0 text-j3 md:text-j4">MSTP Dynasty</h1>
          {gateEnabled() ? (
            <form method="post" action="/api/enter" className="flex flex-col gap-4">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="password" className="type-label">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                autoFocus
                className="min-h-12 w-full border-2 border-ink bg-paper px-3 text-[1.0625rem] text-ink outline-none focus-visible:shadow-hard"
              />
              {error === "1" ? (
                <p role="alert" className="m-0 text-body font-semibold">
                  Wrong password.
                </p>
              ) : null}
              {error === "locked" ? (
                <p role="alert" className="m-0 text-body font-semibold">
                  Too many tries. Wait 15 minutes and try again.
                </p>
              ) : null}
              <div>
                <Button type="submit" variant="primary">
                  Enter
                  <PixelArrow />
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="m-0 text-body">No password is set, so the site is open.</p>
              <div>
                <Button href={next} variant="secondary">
                  Go in
                  <PixelArrow />
                </Button>
              </div>
            </>
          )}
        </div>
      </Panel>
    </Board>
  );
}
