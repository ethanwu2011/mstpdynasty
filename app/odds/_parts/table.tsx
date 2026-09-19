/** The season simulator table. Playoff and title odds lead; the rest of the sim follows. */
import { DataTable, type DataColumn } from "@/components/DataTable";
import { DotBar } from "@/components/DotBar";
import { lineOf } from "@/components/RowLine";
import type { SurfaceLineMap, TeamRef } from "@/lib/types";
import { pctText } from "../../_lib/odds-board";

export { pctText };

/** One team's odds, from the season sim or from the drafted rosters. */
export interface OddsTableRow {
  team: TeamRef;
  playoffPct: number;
  titlePct: number;
  byePct: number;
  lastPlacePct: number;
  expectedWins: number;
  /** "7-2" in season; absent before games. */
  record?: string;
  /** Approximate 1.01 odds (season sim only). */
  firstPickPct?: number;
  /** Projected weekly points (drafted rosters only). */
  projectedPoints?: number;
  playersDrafted?: number;
}

function Pct({ v, strong = false }: { v: number; strong?: boolean }) {
  return <span className={strong ? "font-bold" : undefined}>{pctText(v)}</span>;
}

export function OddsTable({ rows, runs, lines }: { rows: OddsTableRow[]; runs: number; lines?: SurfaceLineMap }) {
  const worst = rows.reduce<OddsTableRow | null>((w, t) => (!w || t.lastPlacePct > w.lastPlacePct ? t : w), null);
  const leader = rows.reduce<OddsTableRow | null>((w, t) => (!w || t.titlePct > w.titlePct ? t : w), null);
  const inSeason = rows.some((r) => r.record !== undefined);
  const drafted = rows.some((r) => r.projectedPoints !== undefined);
  const columns: DataColumn<OddsTableRow>[] = [
    {
      key: "team",
      header: "Team",
      cell: (t) => (
        <span className="flex flex-col">
          <span className="text-body leading-tight">
            {t === worst && t.lastPlacePct > 0 ? <span className="sr-only">Most likely to finish last: </span> : null}
            {t.team.managerName}
          </span>
          <span className="max-w-[9rem] truncate text-fine font-normal text-ink-muted md:max-w-[12rem]">{t.team.teamName}</span>
        </span>
      ),
    },
    {
      key: "playoff",
      header: "Playoffs %",
      align: "right",
      className: "md:min-w-[17rem]",
      cell: (t) => (
        <span className="flex items-center justify-end gap-3">
          <DotBar value={t.playoffPct} label={`Playoff odds ${pctText(t.playoffPct)} percent`} className="hidden max-w-[12.5rem] md:grid" />
          <span className="type-display w-[3.5rem] shrink-0 text-right text-j2 leading-none">{pctText(t.playoffPct)}</span>
        </span>
      ),
    },
    {
      key: "title",
      header: "Title %",
      align: "right",
      cell: (t) => <span className="type-display inline-block w-[3.5rem] text-right text-j2 leading-none">{pctText(t.titlePct)}</span>,
    },
  ];
  if (inSeason) {
    columns.push({
      key: "rec",
      header: rows.some((r) => r.record?.split("-").length === 3) ? "W-L-T" : "W-L",
      align: "right",
      className: "whitespace-nowrap",
      cell: (t) => t.record ?? "--",
    });
  }
  if (drafted) {
    columns.push(
      { key: "players", header: "Players", align: "right", className: "whitespace-nowrap", cell: (t) => t.playersDrafted ?? "--" },
      {
        key: "proj",
        header: "Proj pts",
        align: "right",
        className: "whitespace-nowrap",
        cell: (t) => (t.projectedPoints !== undefined ? t.projectedPoints.toFixed(1) : "--"),
      },
    );
  }
  columns.push(
    { key: "xw", header: "Exp wins", align: "right", className: "whitespace-nowrap", cell: (t) => t.expectedWins.toFixed(1) },
    { key: "bye", className: "whitespace-nowrap", header: "Bye %", align: "right", cell: (t) => <Pct v={t.byePct} /> },
    { key: "last", className: "whitespace-nowrap", header: "Last %", align: "right", cell: (t) => <Pct v={t.lastPlacePct} strong={t === worst} /> },
  );
  if (rows.some((r) => r.firstPickPct !== undefined)) {
    columns.push({
      key: "first",
      header: (
        <span>
          1.01 %<span aria-hidden>*</span>
          <span className="sr-only"> (approximate)</span>
        </span>
      ),
      align: "right",
      className: "whitespace-nowrap",
      cell: (t) => (t.firstPickPct !== undefined ? <Pct v={t.firstPickPct} /> : "--"),
    });
  }
  return (
    <DataTable
      caption={`Season odds from ${runs.toLocaleString("en-US")} simulated seasons`}
      rows={rows}
      rowKey={(t) => String(t.team.rosterId)}
      mark={(t) => (t === leader && t.titlePct > 0 ? "leader" : t === worst && t.lastPlacePct > 0 ? "alarm" : null)}
      line={(t) => lineOf(lines, t.team.rosterId)}
      minWidth={0}
      columns={columns}
    />
  );
}
