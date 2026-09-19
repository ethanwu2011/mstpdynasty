/** The season simulator table. */
import { DataTable } from "@/components/DataTable";
import { DotBar } from "@/components/DotBar";
import type { SimResult, SimTeamOdds } from "@/lib/types";
import { record } from "../../_lib/format";

/** Percent to one decimal, with the ends of the scale said honestly. */
export function pctText(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v < 0.1) return "<0.1";
  if (v >= 100) return "100";
  if (v > 99.9) return ">99.9";
  return v.toFixed(1);
}

function Pct({ v, strong = false }: { v: number; strong?: boolean }) {
  return <span className={strong ? "font-bold" : undefined}>{pctText(v)}</span>;
}

export function OddsTable({ sim }: { sim: SimResult }) {
  const teams = sim.teams;
  const worst = teams.reduce<SimTeamOdds | null>((w, t) => (!w || t.lastPlacePct > w.lastPlacePct ? t : w), null);
  const leader = teams.reduce<SimTeamOdds | null>((w, t) => (!w || t.titlePct > w.titlePct ? t : w), null);
  const ties = teams.some((t) => t.ties > 0);
  return (
    <DataTable
      caption={`Season odds from ${sim.runs.toLocaleString("en-US")} simulated seasons`}
      rows={teams}
      rowKey={(t) => String(t.team.rosterId)}
      mark={(t) => (t === leader && t.titlePct > 0 ? "leader" : t === worst && t.lastPlacePct > 0 ? "alarm" : null)}
      minWidth={880}
      columns={[
        {
          key: "team",
          header: "Team",
          cell: (t) => (
            <span className="flex flex-col">
              <span className="text-body leading-tight">
                {t === worst && t.lastPlacePct > 0 ? <span className="sr-only">Most likely to finish last: </span> : null}
                {t.team.managerName}
              </span>
              <span className="max-w-[12rem] truncate text-fine font-normal text-ink-muted">{t.team.teamName}</span>
            </span>
          ),
        },
        { key: "rec", header: ties ? "W-L-T" : "W-L", align: "right", className: "whitespace-nowrap", cell: (t) => record(t.wins, t.losses, t.ties) },
        { key: "xw", header: "Exp wins", align: "right", className: "whitespace-nowrap", cell: (t) => t.expectedWins.toFixed(1) },
        {
          key: "playoff",
          header: "Playoffs %",
          className: "min-w-[16rem]",
          cell: (t) => (
            <span className="flex items-center gap-3">
              <DotBar value={t.playoffPct} label={`Playoff odds ${pctText(t.playoffPct)} percent`} className="max-w-[12.5rem]" />
              <span className="w-12 shrink-0 text-right font-bold">{pctText(t.playoffPct)}</span>
            </span>
          ),
        },
        { key: "bye", className: "whitespace-nowrap", header: "Bye %", align: "right", cell: (t) => <Pct v={t.byePct} /> },
        { key: "title", className: "whitespace-nowrap", header: "Title %", align: "right", cell: (t) => <Pct v={t.titlePct} strong /> },
        { key: "last", className: "whitespace-nowrap", header: "Last %", align: "right", cell: (t) => <Pct v={t.lastPlacePct} /> },
        {
          key: "first",
          header: (
            <span>
              1.01 %<span aria-hidden>*</span>
              <span className="sr-only"> (approximate)</span>
            </span>
          ),
          align: "right",
          className: "whitespace-nowrap",
          cell: (t) => <Pct v={t.firstPickPct} />,
        },
      ]}
    />
  );
}
