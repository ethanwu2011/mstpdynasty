/*
 * /teams: every team in one table, each a link to its page. Inside the Jumbotron Specimen
 * world (DESIGN.md): an ink-headed table on paper, the leader in bold, last place in red.
 * While the startup draft fills empty rosters, the value and the projection come from the
 * players each team has drafted so far.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/DataTable";
import { Board, Panel } from "@/components/Panel";
import { getFantasyCalc } from "@/lib/fantasycalc";
import { draftFacts } from "@/lib/facts";
import { getLeagueContext, standingsFromRosters } from "@/lib/league";
import { draftOdds } from "@/lib/models";
import { getPlayers } from "@/lib/sleeper";
import type { PlayersMap, StandingRow } from "@/lib/types";
import { fmtInt, fmtPts, ordinal, record } from "../_lib/format";
import { pctText } from "../_lib/odds-board";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { draftOrder } from "../_lib/draft";
import { leagueValues } from "./_lib/roster";

export const metadata: Metadata = {
  title: "Teams",
  description: "All ten MSTP Dynasty teams, with records, dynasty value and playoff odds.",
};

export default async function TeamsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  const standings = standingsFromRosters(ctx);
  const anyPlayers = ctx.rosters.some((r) => r.players.length > 0);
  const drafting = !anyPlayers && phase === "drafting";
  const [players, fc, facts, odds] = await Promise.all([
    anyPlayers ? safe(getPlayers(), {} as PlayersMap, "players") : Promise.resolve({} as PlayersMap),
    anyPlayers ? safe(getFantasyCalc(), null, "fantasycalc") : Promise.resolve(null),
    drafting ? safe(draftFacts(ctx), null, "draft facts") : Promise.resolve(null),
    drafting ? safe(draftOdds(ctx), null, "draft odds") : Promise.resolve(null),
  ]);

  // Dynasty value: the roster's, or while drafting the sum of the players picked so far.
  const valueById = new Map<number, number>();
  if (anyPlayers) for (const v of leagueValues(ctx, players, fc)) valueById.set(v.rosterId, v.total);
  else if (facts?.picks.length && !facts.placeholder) {
    for (const p of facts.picks) valueById.set(p.team.rosterId, (valueById.get(p.team.rosterId) ?? 0) + (p.player.value ?? 0));
  }
  const valueRank = new Map([...valueById.entries()].sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));
  const oddsById = new Map(odds?.available && !odds.placeholder ? odds.teams.map((t) => [t.team.rosterId, t]) : []);
  const slots = new Map(ctx.draft ? draftOrder(ctx.draft).map((o) => [o.rosterId, o.slot]) : []);
  const played = standings.some((s) => s.wins + s.losses + s.ties > 0);
  const rows = played ? standings : [...standings].sort((a, b) => (slots.get(a.team.rosterId) ?? 99) - (slots.get(b.team.rosterId) ?? 99));
  const draftNumbers = drafting && (valueById.size > 0 || oddsById.size > 0);

  const columns: DataColumn<StandingRow>[] = [
    {
      key: "team",
      header: "Team",
      cell: (s) => (
        <Link href={`/teams/${s.team.rosterId}`} className="flex min-h-11 max-w-[8.5rem] flex-col justify-center no-underline hover:underline sm:max-w-[11rem]">
          <span className="font-bold">{s.team.managerName}</span>
          <span className="truncate text-fine font-normal text-ink-muted">{s.team.teamName}</span>
        </Link>
      ),
    },
    played
      ? { key: "rec", header: "Record", align: "right", cell: (s) => record(s.wins, s.losses, s.ties) }
      : { key: "slot", header: "Slot", align: "right", hideOnPhone: true, cell: (s) => slots.get(s.team.rosterId) ?? "--" },
  ];
  if (played) columns.push({ key: "pf", header: "Points for", align: "right", hideOnPhone: true, cell: (s) => fmtPts(s.pointsFor) });
  columns.push({
    key: "value",
    header: drafting ? (
      <>
        <span className="sm:hidden">Value</span>
        <span className="hidden sm:inline">Draft value</span>
      </>
    ) : (
      "Value"
    ),
    align: "right",
    cell: (s) => (valueById.has(s.team.rosterId) ? fmtInt(valueById.get(s.team.rosterId)) : <span className="text-ink-muted">--</span>),
  });
  if (draftNumbers) {
    columns.push(
      {
        key: "proj",
        header: "Proj",
        align: "right",
        className: "whitespace-nowrap",
        cell: (s) => {
          const o = oddsById.get(s.team.rosterId);
          return o ? o.projectedPoints.toFixed(1) : "--";
        },
      },
      {
        key: "playoff",
        header: "Playoffs %",
        align: "right",
        hideOnPhone: true,
        className: "whitespace-nowrap",
        cell: (s) => {
          const o = oddsById.get(s.team.rosterId);
          return o ? pctText(o.playoffPct) : "--";
        },
      },
    );
  }
  columns.push({
    key: "vr",
    header: "Value rank",
    align: "right",
    hideOnPhone: true,
    cell: (s) => (valueRank.get(s.team.rosterId) ? ordinal(valueRank.get(s.team.rosterId) as number) : "--"),
  });

  return (
    <Board>
      <h1 className="sr-only">Every team in MSTP Dynasty</h1>
      <Panel label="The teams" labelRight={<span className="text-paper-shade">{rows.length} teams</span>} pad={false}>
        {draftNumbers ? (
          <p className="measure m-0 px-4 pb-4 pt-5 text-data text-ink-muted md:px-6">
            Draft value is the FantasyCalc value of the players each team has drafted so far. Projected points are the best weekly lineup
            those players make, with any open starting spot filled by the best player nobody has drafted.
          </p>
        ) : null}
        <DataTable
          caption={played ? "Teams by standings" : "Teams in draft order"}
          rows={rows}
          rowKey={(s) => String(s.team.rosterId)}
          mark={(_, i) => (played ? (i === 0 ? "leader" : i === rows.length - 1 ? "last" : null) : null)}
          minWidth={320}
          className={draftNumbers ? "border-t-2 border-ink" : undefined}
          columns={columns}
        />
      </Panel>
    </Board>
  );
}
