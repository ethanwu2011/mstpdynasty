import { after } from "next/server";
import { runTick } from "@/lib/jobs";

/**
 * Run the tick in this same server process after the response is sent (Next `after()`), so
 * every page visit writes whatever is new: picks, trades, waiver results, table lines.
 *
 * It used to call /api/tick over HTTP using SITE_URL. That broke silently in production:
 * the bare domain answers with a redirect to www and the request did not follow it, so page
 * visits never reached the tick. Calling runTick directly has no URL to get wrong. runTick has
 * its own cooldown and run lock, so many visitors still cause at most one run at a time.
 * The page's maxDuration (60 s) bounds how long this may take. It never throws.
 */
export async function fireTick(): Promise<void> {
  after(async () => {
    try {
      await runTick(new Date());
    } catch {
      // Best effort: the next visit or the daily cron picks up anything left.
    }
  });
}
