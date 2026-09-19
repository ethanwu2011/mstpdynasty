/** In-season and offseason home panels: the scoreboard, the standings strip, the final table. */
import Link from "next/link";
import type { ReactNode } from "react";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { BarLink } from "@/components/HeaderBar";
import { MatchupRow, matchupFromWinProb } from "@/components/MatchupRow";
import { Numeral } from "@/components/Numeral";
import { Panel, type PanelSpan } from "@/components/Panel";
import { lineOf, RowLine } from "@/components/RowLine";
import { LiveSquare, SampleMark, Tag } from "@/components/Tag";
import { cx } from "@/components/cx";
import type { RosterId, StandingRow, SurfaceLineMap, TeamWeekFact, WeeklyFacts, WinProbWeek } from "@/lib/types";
import { fmtPts, record } from "../_lib/format";

/* ------------------------------ the week in numbers ------------------------------ */

/** The rest of the week under the lead roast: the other numbers worth a screenshot. */
export function WeekInNumbers({ facts, bare = false, className }: { facts: WeeklyFacts; bare?: boolean; className?: string }) {
  const bench = [...facts.teams].sort((a, b) => b.benchPointsLeft - a.benchPointsLeft)[0];
  const closest = [...facts.matchups].sort((a, b) => a.margin - b.margin)[0];
  const robbed = facts.teams.filter((t) => t.robbed);
  const frauds = facts.teams.filter((t) => t.fraud);
  const names = (ts: TeamWeekFact[]) => ts.map((t) => t.team.managerName).join(", ");
  const rows: Array<{ label: string; who: string; value: string; alarm?: boolean }> = [];
  if (facts.highest) rows.push({ label: "Top score", who: facts.highest.team.managerName, value: fmtPts(facts.highest.points) });
  if (facts.lowest) rows.push({ label: "Bottom score", who: facts.lowest.team.managerName, value: fmtPts(facts.lowest.points), alarm: true });
  if (bench && bench.benchPointsLeft > 0) rows.push({ label: "Most left on bench", who: bench.team.managerName, value: fmtPts(bench.benchPointsLeft) });
  if (closest) rows.push({ label: "Closest game", who: `${closest.home.team.managerName} v ${closest.away.team.managerName}`, value: fmtPts(closest.margin) });
  if (robbed.length) rows.push({ label: "Robbed", who: names(robbed), value: "Top 3, lost" });
  if (frauds.length) rows.push({ label: "Fraud", who: names(frauds), value: "Bottom 3, won" });
  if (!rows.length) return null;
  return (
    <section aria-label={`Week ${facts.week} by the numbers`} className={cx("flex-col gap-3", className ?? "flex")}>
      {bare ? (
        facts.placeholder ? (
          <div>
            <SampleMark />
          </div>
        ) : null
      ) : (
        <h3 className="type-label m-0 flex items-center gap-2">
          Week {facts.week} by the numbers
          {facts.placeholder ? <SampleMark /> : null}
        </h3>
      )}
      <dl className="m-0 grid grid-cols-1 border-t-2 border-ink sm:grid-cols-2 sm:gap-x-8">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-ink py-2.5">
            <dt className="type-label flex items-center gap-2 text-ink-muted">
              {r.alarm ? <LiveSquare size={8} /> : null}
              {r.label}
            </dt>
            <dd className="type-data m-0 row-span-2 self-center text-right text-[1.0625rem] font-bold">{r.value}</dd>
            <dd className="m-0 truncate font-semibold">{r.who}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------ scoreboard ------------------------------ */

const BASIS_LABEL: Record<WinProbWeek["basis"], string> = {
  projections: "Projected",
  live: "Live",
  final: "Final",
  none: "No games",
};

export function Scoreboard({ wp, week, lines, span = 4 }: { wp: WinProbWeek | null; week: number; lines?: SurfaceLineMap; span?: PanelSpan }) {
  const live = wp?.basis === "live";
  const state = wp?.basis === "final" ? "final" : live ? "live" : null;
  return (
    <Panel
      label={state === "final" ? `Week ${week} final` : live ? `Week ${week}, live` : `Week ${week}`}
      live={live}
      labelRight={
        <>
          {wp?.placeholder ? <SampleMark onInk /> : null}
          {wp && !live ? <span className="hidden text-paper-shade sm:inline">{BASIS_LABEL[wp.basis]}</span> : null}
        </>
      }
      span={span}
      bodyClassName="px-4 pb-2 pt-1 md:px-6"
      pad={false}
    >
      {wp && wp.matchups.length ? (
        <>
          <div className="divide-y divide-ink">
            {wp.matchups.map((m) => (
              <MatchupRow
                key={m.matchupId}
                {...matchupFromWinProb(m, wp.basis)}
                href={`/scores/${week}#m${m.matchupId}`}
                line={lineOf(lines, m.matchupId)}
                animate
              />
            ))}
          </div>
          <div className="mt-auto border-t-2 border-ink py-3">
            <BarLinkOnPaper href={`/scores/${week}`}>Box scores</BarLinkOnPaper>
          </div>
        </>
      ) : (
        <div className="py-6">
          <DotMatrixFill label={wp ? "No matchups on the board this week." : "Scores are not loading. Sleeper did not answer."} />
        </div>
      )}
    </Panel>
  );
}

function BarLinkOnPaper({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="type-label link-ink inline-flex min-h-11 items-center px-0.5">
      {children}
    </Link>
  );
}

/* ------------------------------ standings strip ------------------------------ */

/** A stadium ribbon: all ten teams in order, rank in dots, record in dots. */
export function StandingsStrip({
  rows,
  lines,
  label = "Standings",
  span = 12,
}: {
  rows: StandingRow[];
  lines?: SurfaceLineMap;
  label?: string;
  span?: PanelSpan;
}) {
  const last = rows.length ? rows[rows.length - 1].team.rosterId : null;
  const played = rows.some((r) => r.wins + r.losses + r.ties > 0);
  return (
    <Panel label={label} labelRight={<BarLink href="/standings">Full table</BarLink>} span={span} pad={false}>
      <ol className="m-0 grid list-none grid-cols-1 gap-px bg-ink p-0 sm:grid-cols-5 xl:grid-cols-10">
        {rows.map((r) => {
          const leader = r.rank === 1 && played;
          const isLast = r.team.rosterId === last && played;
          const mark = isLast ? (
            <span className="type-label flex items-center gap-1.5">
              <LiveSquare size={10} />
              Last
            </span>
          ) : leader ? (
            <Tag>First</Tag>
          ) : null;
          return (
            <li
              key={r.team.rosterId}
              className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 bg-paper px-4 py-2.5 sm:flex sm:flex-col sm:items-stretch sm:gap-2 sm:px-3 sm:py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Numeral value={r.rank} pad={2} size="d30" tone={leader ? "ink" : "muted"} label={`Rank ${r.rank}`} />
                <span className="hidden sm:inline-flex">{mark}</span>
              </div>
              <div className="min-w-0">
                <p className={cx("m-0 flex items-center gap-2 text-body leading-tight", leader ? "font-extrabold" : "font-semibold")}>
                  <span className="truncate">{r.team.managerName}</span>
                  <span className="sm:hidden">{mark}</span>
                </p>
                <p className="m-0 truncate text-fine text-ink-muted">{r.team.teamName}</p>
              </div>
              <div className="flex flex-col items-end gap-1 sm:mt-auto sm:items-start">
                <Numeral value={record(r.wins, r.losses, r.ties)} size="d20" label={`Record ${record(r.wins, r.losses, r.ties)}`} />
                <span className="type-data whitespace-nowrap text-fine text-ink-muted">{fmtPts(r.pointsFor, 1)} PF</span>
              </div>
              {lineOf(lines, r.team.rosterId) ? (
                <RowLine text={lineOf(lines, r.team.rosterId)} className="col-span-3 mt-1.5 sm:mt-0 sm:text-fine" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ------------------------------ final standings ------------------------------ */

export function FinalStandings({
  rows,
  championId,
  season,
  span = 4,
}: {
  rows: StandingRow[];
  championId: RosterId | null;
  season: string;
  span?: PanelSpan;
}) {
  const champ = rows.find((r) => r.team.rosterId === championId);
  const last = rows[rows.length - 1];
  return (
    <Panel label={`Final · ${season}`} labelRight={<BarLink href="/standings">Full table</BarLink>} span={span}>
      <div className="flex flex-1 flex-col gap-6">
        {champ ? (
          <div className="flex flex-col gap-2">
            <span className="type-label text-ink-muted">Champion</span>
            <span className="type-display text-j3">{champ.team.managerName}</span>
            <span className="text-fine text-ink-muted">{champ.team.teamName}</span>
          </div>
        ) : null}
        <ol className="m-0 list-none border-t-2 border-ink p-0">
          {rows.map((r) => (
            <li key={r.team.rosterId} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-ink py-2">
              <Numeral value={r.rank} pad={2} size="d20" tone={r.rank === 1 ? "ink" : "muted"} />
              <span className={cx("flex min-w-0 items-center gap-2 truncate", r.team.rosterId === championId ? "font-extrabold" : "font-semibold")}>
                {r === last ? <LiveSquare size={10} /> : null}
                <span className="truncate">{r.team.managerName}</span>
                {r.team.rosterId === championId ? <Tag>Champ</Tag> : null}
              </span>
              <span className="type-data text-ink-muted">{record(r.wins, r.losses, r.ties)}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
