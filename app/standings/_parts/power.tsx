/** Power rankings: the table and the one-sentence formula. */
import { DataTable } from "@/components/DataTable";
import { DotBar } from "@/components/DotBar";
import { Numeral } from "@/components/Numeral";
import { lineOf } from "@/components/RowLine";
import type { DraftOdds, PowerRankings, PowerRow, SurfaceLineMap } from "@/lib/types";
import { fmtPts, record } from "../../_lib/format";
import { pctText } from "../../_lib/odds-board";

function Move({ row }: { row: PowerRow }) {
  if (row.previousRank === null) return <span className="text-ink-muted">--</span>;
  const d = row.previousRank - row.rank;
  if (d === 0) return <span className="type-label text-ink-muted">Held</span>;
  return (
    <span className="type-label whitespace-nowrap">
      <span aria-hidden>{d > 0 ? `Up ${d}` : `Down ${-d}`}</span>
      <span className="sr-only">{d > 0 ? `Up ${d} from ${row.previousRank}` : `Down ${-d} from ${row.previousRank}`}</span>
    </span>
  );
}

export function PowerTable({ power, games, lines }: { power: PowerRankings; games: boolean; lines?: SurfaceLineMap }) {
  return (
    <DataTable
      caption={`Power rankings${power.asOfWeek ? ` through Week ${power.asOfWeek}` : ""}`}
      rows={power.rows}
      rowKey={(r) => String(r.team.rosterId)}
      mark={(_, i) => (i === 0 ? "leader" : null)}
      line={(r) => lineOf(lines, r.team.rosterId)}
      minWidth={760}
      columns={[
        {
          key: "team",
          header: "Team",
          cell: (r) => (
            <span className="flex items-center gap-3">
              <span className="w-8 shrink-0">
                <Numeral value={r.rank} pad={2} size="d20" tone={r.rank === 1 ? "ink" : "muted"} label={`Rank ${r.rank}`} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body leading-tight">{r.team.managerName}</span>
                <span className="max-w-[12rem] truncate text-fine font-normal text-ink-muted">{r.team.teamName}</span>
              </span>
            </span>
          ),
        },
        { key: "move", header: "Move", className: "whitespace-nowrap", cell: (r) => <Move row={r} /> },
        {
          key: "score",
          header: "Score",
          className: "min-w-[17rem]",
          cell: (r) => (
            <span className="flex items-center gap-3">
              <DotBar value={r.score} dots={20} label={`Power score ${r.score.toFixed(1)} of 100`} className="max-w-[13rem]" />
              <span className="w-10 shrink-0 text-right font-bold">{r.score.toFixed(1)}</span>
            </span>
          ),
        },
        {
          key: "allplay",
          header: "All-play",
          align: "right",
          className: "whitespace-nowrap",
          cell: (r) => (games ? `${Math.round(r.allPlayWinPct * 100)}%` : "--"),
        },
        { key: "ppg", header: "Pts/game", align: "right", className: "whitespace-nowrap", cell: (r) => (games ? fmtPts(r.pointsPerGame) : "--") },
        { key: "proj", header: "Proj lineup", align: "right", className: "whitespace-nowrap", cell: (r) => fmtPts(r.projectedStrength, 1) },
        { key: "rec", header: "Record", align: "right", className: "whitespace-nowrap", cell: (r) => record(r.wins, r.losses) },
      ]}
    />
  );
}

/**
 * Power rankings while the startup draft runs: every team ranked by the projected weekly points
 * of its best lineup from the players drafted so far (the draft odds model), with the playoff
 * and title odds those rosters give. Each row carries the drafted-roster odds line when there is one.
 */
export function DraftPowerTable({ odds, lines }: { odds: DraftOdds; lines?: SurfaceLineMap }) {
  const rows = [...odds.teams].sort((a, b) => a.projectedRank - b.projectedRank || b.projectedPoints - a.projectedPoints);
  return (
    <DataTable
      caption="Power rankings from the players drafted so far"
      rows={rows}
      rowKey={(r) => String(r.team.rosterId)}
      mark={(_, i) => (i === 0 ? "leader" : null)}
      line={(r) => lineOf(lines, r.team.rosterId)}
      minWidth={340}
      columns={[
        {
          key: "team",
          header: "Team",
          cell: (r, i) => (
            <span className="flex items-center gap-3">
              <span className="w-8 shrink-0">
                <Numeral value={i + 1} pad={2} size="d20" tone={i === 0 ? "ink" : "muted"} label={`Rank ${i + 1}`} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body leading-tight">{r.team.managerName}</span>
                <span className="max-w-[7rem] truncate text-fine font-normal text-ink-muted sm:max-w-[10rem]">{r.team.teamName}</span>
              </span>
            </span>
          ),
        },
        { key: "proj", header: "Proj", align: "right", className: "whitespace-nowrap", cell: (r) => fmtPts(r.projectedPoints, 1) },
        { key: "playoff", header: "Playoffs", align: "right", className: "whitespace-nowrap", cell: (r) => `${pctText(r.playoffPct)}%` },
        { key: "title", header: "Title", align: "right", hideOnPhone: true, className: "whitespace-nowrap", cell: (r) => `${pctText(r.titlePct)}%` },
        { key: "players", header: "Players", align: "right", hideOnPhone: true, className: "whitespace-nowrap", cell: (r) => r.playersDrafted },
      ]}
    />
  );
}
