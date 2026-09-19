/*
 * DIRECTION CONTRACT (home, from DESIGN.md)
 * THESIS: The stadium message board for ten friends. The verdict flashes in giant pixel type
 *   and the numbers underneath prove it. Refuses the dark neon fantasy dashboard and the cream
 *   editorial newspaper.
 * OWN-WORLD: Newsprint paper, true black ink, one scoreboard red. Black header bars with
 *   reversed Silkscreen caps, ruled panels touching on 2px ink rules, square corners, hard
 *   offset shadows only on pressables, dithered dot-matrix fields as the only ornament.
 * STORY: See who got roasted and the stat that earned it, then the scores and odds, then
 *   screenshot it into the group chat.
 * FIRST VIEWPORT: Black top bar (MSTP DYNASTY, week or draft status, texture block). Left 8
 *   columns: the latest roast, victim and stat in Jersey 10, grotesk roast, receipt, red square
 *   and time. Right 4: the scoreboard (pre-draft: draft order; draft: on the clock). Phones stack
 *   lead then scoreboard; no subscribe action anywhere (recipients live in the private env).
 * FORM: Emigre bitmap specimen fused with stadium message boards. Roast-first broadside.
 *   Seed fd65bdc4.
 */
import { getLeagueContext } from "@/lib/league";
import { pagePhase, type SearchParams } from "./_lib/phase";
import { fireTick } from "./_lib/tick";
import { HomeDrafting, HomeInSeason, HomeOffseason, HomePreDraft } from "./_home/views";

/** Room for the newest pick to be written while the page streams (and for the tick in after()). */
export const maxDuration = 60;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  await fireTick();

  return (
    <>
      <h1 className="sr-only">MSTP Dynasty: what just happened and the league right now</h1>
      {phase === "pre_draft" ? (
        <HomePreDraft ctx={ctx} />
      ) : phase === "drafting" ? (
        <HomeDrafting ctx={ctx} />
      ) : phase === "in_season" ? (
        <HomeInSeason ctx={ctx} />
      ) : (
        <HomeOffseason ctx={ctx} />
      )}
    </>
  );
}
