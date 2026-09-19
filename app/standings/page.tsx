import type { Metadata } from "next";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";
import { type Shout, ShoutList } from "@/components/ShoutList";
import { SampleMark } from "@/components/Tag";
import { getLeagueContext, playoffRounds, standingsFromRosters } from "@/lib/league";
import { lastCompletedWeek } from "@/lib/facts";
import { draftOdds, getPowerRankings } from "@/lib/models";
import { surfaceKeys } from "@/lib/roast";
import { getWinnersBracket } from "@/lib/sleeper";
import type { LeagueContext, PowerRow, SleeperBracketMatch, StandingRow, SurfaceLineMap } from "@/lib/types";
import { record } from "../_lib/format";
import { surfaceLinesFor } from "../_lib/lines";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { DraftPowerTable, PowerTable } from "./_parts/power";
import { StandingsTable } from "./_parts/table";

export const metadata: Metadata = {
  title: "Standings",
  description: "Records, points, all-play records, luck and power rankings for all ten teams.",
};

function signed(n: number): string {
  const r = Number(n.toFixed(1));
  return r === 0 ? "0.0" : `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(1)}`;
}

/** First, last and the two luck extremes, shouted. Ties at either end are left unsaid. */
function standingShouts(rows: StandingRow[], power: PowerRow[]): Shout[] {
  const out: Shout[] = [];
  if (rows.length >= 2) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const rec = (r: StandingRow) => record(r.wins, r.losses, r.ties);
    if (first.rank !== rows[1].rank) out.push({ label: "First place", name: first.team.managerName, value: rec(first), valueLabel: `record ${rec(first)}` });
    if (last.rank !== rows[rows.length - 2].rank)
      out.push({ label: "Last place", name: last.team.managerName, value: rec(last), valueLabel: `record ${rec(last)}`, alarm: true });
  }
  if (power.length >= 2) {
    const sorted = [...power].sort((a, b) => b.luck - a.luck);
    const [lucky, next] = sorted;
    const cursed = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    if (lucky.luck > 0 && lucky.luck !== next.luck) out.push({ label: "Luckiest", name: lucky.team.managerName, value: signed(lucky.luck), unit: "wins" });
    if (cursed.luck < 0 && cursed.luck !== prev.luck) out.push({ label: "Unluckiest", name: cursed.team.managerName, value: signed(cursed.luck), unit: "wins" });
  }
  return out;
}

function Rules({ ctx, byes }: { ctx: LeagueContext; byes: number }) {
  const teams = ctx.league.settings.playoff_teams ?? 0;
  const items: Array<[string, string]> = [
    [
      "Playoff line",
      teams
        ? `The top ${teams} make it${byes ? ` and the top ${byes} skip round one` : ""}. Playoffs run Weeks ${ctx.playoffWeekStart} to ${ctx.lastWeek}.`
        : "Sleeper has no playoff size set yet.",
    ],
    ["Tiebreak", "Record first, then points for."],
    ["All-play", "Your record if you had played every other team every week."],
    ["Luck", "Actual wins minus all-play expected wins. Above zero, the schedule carried you. Below zero, it robbed you."],
  ];
  return (
    <Panel label="How to read it" span={4} className="max-lg:order-last">
      <dl className="m-0 border-t-2 border-ink">
        {items.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 border-b border-ink py-3">
            <dt className="type-label">{k}</dt>
            <dd className="m-0 text-data">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export default async function StandingsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  const noTeams = phase === "pre_draft" || phase === "drafting";
  const standings = standingsFromRosters(ctx);
  const played = !noTeams && standings.some((r) => r.wins + r.losses + r.ties > 0);
  const over = phase === "complete" || phase === "offseason";

  const [power, bracket, standingLines, drafted] = await Promise.all([
    noTeams ? Promise.resolve(null) : safe(getPowerRankings(ctx), null, "power rankings"),
    over && played ? safe(getWinnersBracket(ctx.leagueId), [] as SleeperBracketMatch[], "winners bracket") : Promise.resolve([] as SleeperBracketMatch[]),
    played ? surfaceLinesFor(ctx, "standings", surfaceKeys.standings(ctx.season, lastCompletedWeek(ctx))) : Promise.resolve({} as SurfaceLineMap),
    // While the draft runs, rosters are the players drafted so far: rank them by projected lineup.
    phase === "drafting" ? safe(draftOdds(ctx), null, "draft odds") : Promise.resolve(null),
  ]);
  const draftBoard = drafted?.available && drafted.teams.length && !drafted.placeholder ? drafted : null;
  const powerLines = power
    ? await surfaceLinesFor(ctx, "power", surfaceKeys.power(ctx.season, power.asOfWeek))
    : draftBoard
      ? await surfaceLinesFor(ctx, "odds", surfaceKeys.odds(ctx.season, 0))
      : {};

  // Before the first game there is no order: list the teams by name, with no ranks.
  const rows: StandingRow[] = played ? standings : [...standings].sort((a, b) => a.team.managerName.localeCompare(b.team.managerName));
  const powerById = new Map((power?.rows ?? []).map((r) => [r.team.rosterId, r]));
  const playoffTeams = ctx.league.settings.playoff_teams ?? 0;
  const byes = playoffTeams > 1 ? 2 ** playoffRounds(playoffTeams) - playoffTeams : 0;
  const championId = bracket.find((m) => m.p === 1)?.w ?? null;
  const scored = ctx.league.settings.last_scored_leg ?? 0;
  const through = Math.min(scored > 0 ? scored : Math.max(0, ctx.week - 1), ctx.lastRegularSeasonWeek);
  const powerGames = Boolean(power && power.rows.some((r) => r.pointsPerGame > 0));
  const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen"];
  const teamWord = WORDS[rows.length] ?? String(rows.length);

  return (
    <Board>
      <PageHead
        bar={`Standings · ${ctx.season}`}
        span={8}
        title={played ? "Standings" : "Everyone is 0-0"}
        meta={
          <>
            <span className="text-ink">{played ? (over ? "Regular season, final" : `Through Week ${through}`) : "No games yet"}</span>
            {playoffTeams ? <span>Top {playoffTeams} make the playoffs</span> : null}
          </>
        }
      >
        {played ? (
          <ShoutList items={standingShouts(rows, power?.placeholder ? [] : (power?.rows ?? []))} />
        ) : (
          <p className="measure m-0 text-body md:text-lede">
            {teamWord} teams, no games, no losses. The table starts moving the first week after the draft.
          </p>
        )}
      </PageHead>
      <Rules ctx={ctx} byes={byes} />

      {/* Before the first game every row would be dashes in alphabetical order: the hero above says it. */}
      {played ? (
        <Panel
          label="Standings"
          labelRight={
            power?.placeholder ? (
              <>
                <span className="hidden text-paper-shade sm:inline">All-play and luck</span>
                <SampleMark onInk />
              </>
            ) : null
          }
          pad={false}
        >
          <StandingsTable
            rows={rows}
            power={powerById}
            played={played}
            playoffTeams={playoffTeams}
            byes={byes}
            championId={championId}
            lines={standingLines}
          />
        </Panel>
      ) : null}

      <Panel
        label="Power rankings"
        labelRight={
          power?.placeholder ? (
            <SampleMark onInk />
          ) : power?.asOfWeek ? (
            <span className="text-paper-shade">Through Week {power.asOfWeek}</span>
          ) : draftBoard ? (
            <span className="text-paper-shade">Drafted so far</span>
          ) : null
        }
        pad={Boolean((noTeams && !draftBoard) || (!noTeams && !power))}
      >
        {noTeams && draftBoard ? (
          <div className="flex flex-col">
            <div className="flex flex-col gap-2 px-4 pb-5 pt-6 md:px-6">
              <span className="type-label text-ink-muted">The formula</span>
              <p className="measure m-0 text-body">
                Ranked by projected points a week: the best legal lineup from the players each team has drafted so far, with a starting spot
                it has not filled counted as the best player nobody has drafted. Games replace it once they are played.
              </p>
            </div>
            <DraftPowerTable odds={draftBoard} lines={powerLines} />
          </div>
        ) : noTeams ? (
          <div className="flex flex-col gap-6">
            <p className="measure m-0 text-body">
              Power rankings start with the first pick of the startup draft, ranked by projected starting lineup until there are real scores to
              judge.
            </p>
            <DotMatrixFill label="No rosters, no rankings." rows={6} />
          </div>
        ) : !power ? (
          <DotMatrixFill label="Power rankings did not load. Refresh in a minute." rows={6} density={0.3} />
        ) : (
          <div className="flex flex-col">
            <div className="flex flex-col gap-2 px-4 pb-5 pt-6 md:px-6">
              <span className="type-label text-ink-muted">The formula</span>
              <p className="measure m-0 text-body">{power.formula}</p>
            </div>
            <PowerTable power={power} games={powerGames} lines={powerLines} />
          </div>
        )}
      </Panel>
    </Board>
  );
}
