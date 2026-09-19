/**
 * Newsletter sign-up. OWNER: ops agent. Minimal and unstyled on purpose; the designer
 * restyles it. Posts to /api/subscribe, which redirects back here with ?status=.
 */
import type { Metadata } from "next";
import { MANAGERS } from "@/config/managers";
import { emailStatus, SUBSCRIBE_MESSAGES } from "@/lib/email";
import { requireGate } from "@/lib/email/require-gate";
import type { SubscribeResult } from "@/lib/types";

export const metadata: Metadata = { title: "Subscribe" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SubscribePage({ searchParams }: { searchParams: SearchParams }) {
  await requireGate("/subscribe");
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  // Own keys only: `raw in` would also match inherited ones like "__proto__" or "constructor".
  const status = raw && Object.hasOwn(SUBSCRIBE_MESSAGES, raw) ? (raw as SubscribeResult["status"]) : null;
  const email = emailStatus();

  return (
    <main>
      <h1>Get The Roast by email</h1>
      <p>
        The Daily Roast when there is something to roast, Thursday Night Fallout on Fridays, The Weekly Roast on
        Tuesdays. Every email has an unsubscribe link, in case you can&apos;t take it.
      </p>
      {status ? <p role="status">{SUBSCRIBE_MESSAGES[status]}</p> : null}
      {email.ready ? (
        <form method="post" action="/api/subscribe">
          <p>
            <label htmlFor="managerKey">Who are you?</label>{" "}
            <select id="managerKey" name="managerKey" required defaultValue="">
              <option value="" disabled>
                Pick your name
              </option>
              {MANAGERS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.firstName}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="email">Email</label>{" "}
            <input id="email" name="email" type="email" required autoComplete="email" maxLength={254} />
          </p>
          <p>
            <button type="submit">Sign me up</button>
          </p>
        </form>
      ) : (
        <p>The newsletter is not set up yet.</p>
      )}
    </main>
  );
}
