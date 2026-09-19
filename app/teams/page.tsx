/*
 * /teams: every team in one table, each a link to its page. Inside the Jumbotron Specimen
 * world (DESIGN.md): an ink-headed table on paper, the leader in bold, last place in red.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { Board, Panel } from "@/components/Panel";
import { getFantasyCalc } from "@/lib/fantasycalc";
import { getLeagueContext, standingsFromRosters } from "@/lib/league";
import { getPlayers } from "@/lib/sleeper";
import type { PlayersMap } from "@/lib/types";
import { fmtInt, fmtPts, ordinal, record } from "../_lib/format";
import { safe } from "../_lib/phase";
import { draftOrder } from "../_lib/draft";
import { leagueValues } from "./_lib/roster";

export const metadata: Metadata = {
  title: "Teams",
  description: "All ten MSTP Dynasty teams, with records and dynasty value.",
};

export default async function TeamsPage() {
  const ctx = await getLeagueContext();
  const standings = standingsFromRosters(ctx);
  const anyPlayers = ctx.rosters.some((r) => r.players.length > 0);
  const [players, fc] = anyPlayers
    ? await Promise.all([safe(getPlayers(), {} as PlayersMap, "players"), safe(getFantasyCalc(), null, "fantasycalc")])
    : [{} as PlayersMap, null];
  const values = anyPlayers ? leagueValues(ctx, players, fc) : [];
  const valueById = new Map(values.map((v) => [v.rosterId, v.total]));
  const valueRank = new Map([...values].sort((a, b) => b.total - a.total).map((v, i) => [v.rosterId, i + 1]));
  const slots = new Map(ctx.draft ? draftOrder(ctx.draft).map((o) => [o.rosterId, o.slot]) : []);
  const played = standings.some((s) => s.wins + s.losses + s.ties > 0);
  const rows = played ? standings : [...standings].sort((a, b) => (slots.get(a.team.rosterId) ?? 99) - (slots.get(b.team.rosterId) ?? 99));

  return (
    <Board>
      <h1 className="sr-only">Every team in MSTP Dynasty</h1>
      <Panel label="The teams" labelRight={<span className="text-paper-shade">{rows.length} teams</span>} pad={false}>
        <DataTable
          caption={played ? "Teams by standings" : "Teams in draft order"}
          rows={rows}
          rowKey={(s) => String(s.team.rosterId)}
          mark={(_, i) => (played ? (i === 0 ? "leader" : i === rows.length - 1 ? "last" : null) : null)}
          minWidth={520}
          columns={[
            {
              key: "team",
              header: "Team",
              cell: (s) => (
                <Link href={`/teams/${s.team.rosterId}`} className="flex flex-col no-underline hover:underline">
                  <span className="font-bold">{s.team.managerName}</span>
                  <span className="text-fine font-normal text-ink-muted">{s.team.teamName}</span>
                </Link>
              ),
            },
            played
              ? { key: "rec", header: "Record", align: "right", cell: (s) => record(s.wins, s.losses, s.ties) }
              : { key: "slot", header: "Slot", align: "right", cell: (s) => slots.get(s.team.rosterId) ?? "--" },
            { key: "pf", header: "Points for", align: "right", hideOnPhone: true, cell: (s) => (played ? fmtPts(s.pointsFor) : "--") },
            {
              key: "value",
              header: "Value",
              align: "right",
              cell: (s) => (valueById.has(s.team.rosterId) ? fmtInt(valueById.get(s.team.rosterId)) : <span className="text-ink-muted">No roster</span>),
            },
            { key: "vr", header: "Value rank", align: "right", hideOnPhone: true, cell: (s) => (valueRank.get(s.team.rosterId) ? ordinal(valueRank.get(s.team.rosterId) as number) : "--") },
          ]}
        />
      </Panel>
    </Board>
  );
}
