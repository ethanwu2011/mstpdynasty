/** Power rankings: the table and the one-sentence formula. */
import { DataTable } from "@/components/DataTable";
import { DotBar } from "@/components/DotBar";
import { Numeral } from "@/components/Numeral";
import type { PowerRankings, PowerRow } from "@/lib/types";
import { fmtPts, record } from "../../_lib/format";

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

export function PowerTable({ power, games }: { power: PowerRankings; games: boolean }) {
  return (
    <DataTable
      caption={`Power rankings${power.asOfWeek ? ` through Week ${power.asOfWeek}` : ""}`}
      rows={power.rows}
      rowKey={(r) => String(r.team.rosterId)}
      mark={(_, i) => (i === 0 ? "leader" : null)}
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
