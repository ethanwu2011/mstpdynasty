/**
 * Playoff and title odds per team, the two headline numbers wherever odds appear: the home page
 * in season, and "if the season started today" on the home page and /draft during the draft.
 * Each row carries its one-liner when there is one. Formatting only: every percent is the model's.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { Numeral } from "@/components/Numeral";
import { Panel, type PanelSpan } from "@/components/Panel";
import { lineOf, RowLine } from "@/components/RowLine";
import { LiveSquare } from "@/components/Tag";
import { TeamSub } from "@/components/TeamSub";
import type { SurfaceLineMap, TeamRef } from "@/lib/types";
import { oddsOrder } from "@/lib/roast/format";

export interface OddsRow {
  team: TeamRef;
  /** 0..100 */
  playoffPct: number;
  titlePct: number;
  lastPlacePct?: number;
  /** Small line under the name: "14 players, 131.2 projected", "5-3". */
  detail?: string | null;
}

/** "If the season started today", shortened on a phone so the black bar stays one line. */
export function StartedToday() {
  return (
    <>
      <span className="sm:hidden">If it started today</span>
      <span className="hidden sm:inline">If the season started today</span>
    </>
  );
}

/** How the drafted-roster odds are built while the draft runs, in one plain line. */
export const DRAFT_ODDS_NOTE =
  "Playoff and title odds from the players each team has drafted so far, played out over 10,000 seasons. A starting spot a team has not filled yet counts as the best player nobody has drafted.";

/** Percent to one decimal, with the ends of the scale said honestly. */
export function pctText(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v < 0.1) return "<0.1";
  if (v >= 100) return "100";
  if (v > 99.9) return ">99.9";
  return v.toFixed(1);
}

/** The one order every odds table uses (shared with the stat lines, lib/roast/format.ts). */
export { oddsOrder };

export const ODDS_ORDER_NOTE = "Ranked by title odds, then playoff odds.";

/** The visible key under an odds table: the order, and what the red square means. */
export function OddsKey({ last, className }: { last: boolean; className?: string }) {
  return (
    <p className={cx("m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-data text-ink-muted", className)}>
      <span>{ODDS_ORDER_NOTE}</span>
      {last ? (
        <span className="inline-flex items-center gap-2">
          <LiveSquare size={10} />
          Likeliest to finish last
        </span>
      ) : null}
    </p>
  );
}

export interface OddsBoardProps {
  rows: OddsRow[];
  lines?: SurfaceLineMap;
  label: ReactNode;
  labelRight?: ReactNode;
  /** One plain line over the table: what the odds are built from. */
  note?: ReactNode;
  /** Link under the table ("Full odds"). */
  more?: { href: string; label: string } | null;
  live?: boolean;
  span?: PanelSpan;
  mdSpan?: 12 | 6;
  id?: string;
}

const GRID = "grid grid-cols-[1.75rem_minmax(0,1fr)_4.25rem_4.25rem] gap-x-3";

function Head({ className }: { className?: string }) {
  return (
    <div role="row" className={cx("on-ink items-center bg-ink px-4 py-2 text-paper md:px-6", GRID, className)}>
      <span role="columnheader" className="sr-only">
        Rank
      </span>
      <span role="columnheader" aria-hidden className="type-label col-start-1 col-end-3">
        Team
      </span>
      <span role="columnheader" className="type-label text-right">
        Playoffs
      </span>
      <span role="columnheader" className="type-label text-right">
        Title
      </span>
    </div>
  );
}

export function OddsBoard({ rows: given, lines, label, labelRight, note, more, live, span = 12, mdSpan = 12, id }: OddsBoardProps) {
  const rows = [...given].sort(oddsOrder);
  const leader = rows.reduce<OddsRow | null>((w, r) => (!w || r.titlePct > w.titlePct ? r : w), null);
  const doomed = rows.reduce<OddsRow | null>((w, r) => ((r.lastPlacePct ?? 0) > (w?.lastPlacePct ?? 0) ? r : w), null);
  // Full width on a wide screen: two columns of five, each with its own header, so the numbers
  // sit next to the names instead of across the room.
  const wide = span === 12;
  const half = Math.ceil(rows.length / 2);
  const groups = wide ? [rows.slice(0, half), rows.slice(half)] : [rows];
  const row = (r: OddsRow, i: number) => {
    const quip = lineOf(lines, r.team.rosterId);
    const lead = r === leader && r.titlePct > 0;
    const last = r === doomed && (r.lastPlacePct ?? 0) > 0;
    return (
      <div key={r.team.rosterId} role="row" className={cx("items-center gap-y-2 px-4 py-3 md:px-6", GRID, i % 2 ? "bg-paper-shade" : "bg-paper")}>
        <span role="cell" className="self-center">
          <Numeral value={i + 1} pad={2} size="d20" tone={lead ? "ink" : "muted"} label={`Rank ${i + 1}`} />
        </span>
        <span role="rowheader" className="flex min-w-0 flex-col">
          <Link href={`/teams/${r.team.rosterId}`} className="group flex min-h-11 min-w-0 flex-col justify-center no-underline">
            <span className="flex min-w-0 items-center gap-2">
              {last ? (
                <>
                  <LiveSquare size={10} />
                  <span className="sr-only">Most likely to finish last: </span>
                </>
              ) : null}
              <span className={cx("truncate text-body leading-tight group-hover:underline", lead ? "font-extrabold" : "font-bold")}>{r.team.managerName}</span>
            </span>
            {r.detail ? <span className="text-data leading-snug text-ink-muted">{r.detail}</span> : <TeamSub team={r.team.teamName} manager={r.team.managerName} className="text-data leading-snug text-ink-muted" />}
          </Link>
        </span>
        <span role="cell" className="text-right">
          <Numeral value={pctText(r.playoffPct)} size="d30" label={`${pctText(r.playoffPct)} percent to make the playoffs`} />
        </span>
        <span role="cell" className="text-right">
          <Numeral value={pctText(r.titlePct)} size="d30" label={`${pctText(r.titlePct)} percent to win the title`} />
        </span>
        {quip ? (
          <span role="cell" className="col-span-4 md:col-start-2 md:col-end-5">
            <RowLine text={quip} />
          </span>
        ) : null}
      </div>
    );
  };
  return (
    <Panel label={label} labelRight={labelRight} live={live} span={span} mdSpan={mdSpan} id={id} pad={false}>
      {note ? <div className="measure px-4 pb-4 pt-5 text-data text-ink-muted md:px-6">{note}</div> : null}
      <div
        role="table"
        aria-label="Playoff and title odds by team"
        className={cx("flex flex-col", Boolean(note) && "border-t-2 border-ink", wide && "lg:grid lg:grid-cols-2 lg:gap-x-[2px] lg:bg-ink")}
      >
        {groups.map((g, gi) => (
          <div key={gi} role="rowgroup" className="flex flex-col bg-paper">
            <Head className={gi > 0 ? "hidden lg:grid" : undefined} />
            {g.map((r, k) => row(r, gi * half + k))}
          </div>
        ))}
      </div>
      <OddsKey last={Boolean(doomed && (doomed.lastPlacePct ?? 0) > 0)} className="border-t-2 border-ink px-4 py-3 md:px-6" />
      {more ? (
        <p className="m-0 mt-auto border-t border-ink px-4 py-1 md:px-6">
          <Link href={more.href} className="type-label link-ink inline-flex min-h-11 items-center px-0.5">
            {more.label}
          </Link>
        </p>
      ) : null}
    </Panel>
  );
}
