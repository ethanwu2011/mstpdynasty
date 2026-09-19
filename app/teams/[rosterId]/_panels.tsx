/** Team page panels: the lead, the picks, the roster tables, value, the rap sheet, the draft haul. */
import Link from "next/link";
import { cx } from "@/components/cx";
import { DataTable, type DataColumn } from "@/components/DataTable";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { BarLink } from "@/components/HeaderBar";
import { Numeral } from "@/components/Numeral";
import { Panel, type PanelSpan } from "@/components/Panel";
import { RoastBlock } from "@/components/RoastBlock";
import { LiveSquare, SampleMark, Tag } from "@/components/Tag";
import type { DraftGrade, LeagueContext, Manager, Roast, ShameEntry, ShameKind, StandingRow } from "@/lib/types";
import { fmtInt, fmtPts, ordinal, record } from "../../_lib/format";
import { roastToBlock } from "../../_lib/roast-view";
import { Verdict } from "../../draft/_board/DraftBoard";
import type { BoardCell } from "../../draft/_board/model";
import { injuryTag, isAlarm, VALUE_POSITIONS, type RosterRow, type TeamValue } from "../_lib/roster";

/* ------------------------------ lead ------------------------------ */

export interface LeadStat {
  label: string;
  value: string | number | null;
  /** Doto digits (default) or grotesk text. */
  kind?: "numeral" | "text";
  alarm?: boolean;
}

export function TeamLead({ manager, kicker, stats, note }: { manager: Manager; kicker: React.ReactNode; stats: LeadStat[]; note?: React.ReactNode }) {
  return (
    <Panel label="The team" labelRight={manager.username ? <span className="text-paper-shade">@{manager.username}</span> : null} span={8} id="team">
      <div className="flex flex-1 flex-col gap-6 md:gap-7">
        {kicker ? <div className="flex flex-wrap items-center gap-2">{kicker}</div> : null}
        <p className="type-display m-0 break-words">
          <span className="board-wipe block text-j4 xl:text-j5">{manager.name}</span>
          <span className="board-wipe mt-2 block text-j2 md:text-j3">{manager.teamName}</span>
        </p>
        {note ? <div className="measure text-body md:text-lede">{note}</div> : null}
        <dl className="m-0 mt-auto grid grid-cols-2 border-y-2 border-ink sm:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={cx(
                "flex min-w-0 flex-col gap-2 px-3 py-3",
                i % 2 === 1 && "border-l border-ink",
                i >= 2 && "border-t border-ink sm:border-t-0",
                i > 0 && "sm:border-l",
              )}
            >
              <dt className="type-label flex items-center gap-2 text-ink-muted">
                {s.alarm ? <LiveSquare size={8} /> : null}
                {s.label}
              </dt>
              <dd className="m-0 min-w-0">
                {s.kind === "text" ? (
                  <span className="type-data block truncate text-[1.0625rem] font-semibold">{s.value ?? "--"}</span>
                ) : (
                  <Numeral value={s.value} size="d30" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

/* ------------------------------ picks held ------------------------------ */

export function PicksPanel({ rosterId, cells, away, live, span = 4 }: { rosterId: number; cells: BoardCell[]; away: BoardCell[]; live: boolean; span?: PanelSpan }) {
  const made = cells.filter((c) => c.pick);
  const next = cells.find((c) => !c.pick) ?? null;
  const acquired = cells.filter((c) => c.traded && c.ownerRosterId === rosterId);
  return (
    <Panel label="Startup picks" labelRight={<span className="text-paper-shade">{made.length ? `${made.length} of ${cells.length} made` : `${cells.length} picks`}</span>} span={span}>
      {cells.length ? (
        <div className="flex flex-1 flex-col gap-5">
          <ol className="m-0 grid list-none grid-cols-5 border-l-2 border-t-2 border-ink p-0 sm:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6">
            {cells.map((c) => {
              const isNext = live && next?.pickNo === c.pickNo;
              return (
                <li key={c.pickNo} className="flex border-b-2 border-r-2 border-ink">
                  <Link
                    href={`/draft#pick-${c.pickNo}`}
                    aria-label={`Pick ${c.label}${c.pick ? `, ${c.pick.player.name}` : isNext ? ", next up" : ", still to come"}${c.traded ? `, from ${c.columnName}` : ""}`}
                    className={cx(
                      "type-label relative flex h-10 w-full items-center justify-center no-underline focus-visible:outline-offset-[-4px]",
                      c.pick ? "on-ink bg-ink text-paper hover:bg-paper hover:text-ink" : "bg-paper text-ink hover:bg-paper-shade",
                    )}
                  >
                    {c.label}
                    {isNext ? <LiveSquare blink size={8} className="absolute right-1 top-1" /> : null}
                    {c.traded ? <span aria-hidden className="absolute bottom-1 left-1 size-1.5 border border-current" /> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
          <ul className="type-label m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-ink-muted">
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-block size-2.5 bg-ink" />
              Made
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="inline-block size-2.5 border-2 border-ink" />
              To come
            </li>
            {acquired.length ? (
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block size-1.5 border border-ink" />
                Acquired
              </li>
            ) : null}
          </ul>
          {acquired.length || away.length ? (
            <dl className="m-0 border-t-2 border-ink">
              {acquired.length ? (
                <div className="flex items-baseline justify-between gap-4 border-b border-ink py-2">
                  <dt className="type-label">Acquired</dt>
                  <dd className="type-data m-0 text-right">{acquired.map((c) => `${c.label} from ${c.columnName}`).join(", ")}</dd>
                </div>
              ) : null}
              {away.length ? (
                <div className="flex items-baseline justify-between gap-4 border-b border-ink py-2">
                  <dt className="type-label">Traded away</dt>
                  <dd className="type-data m-0 text-right">{away.map((c) => `${c.label} to ${c.ownerName}`).join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {next && !made.length ? (
            <p className="m-0 mt-auto text-body">
              First pick: <b>{next.label}</b>, {ordinal(next.pickNo)} overall.
            </p>
          ) : next ? (
            <p className="m-0 mt-auto text-body">
              Next pick: <b>{next.label}</b>, {ordinal(next.pickNo)} overall.
            </p>
          ) : null}
        </div>
      ) : (
        <DotMatrixFill label="Sleeper has not set the draft order, so nobody owns a pick yet." rows={6} />
      )}
    </Panel>
  );
}

/* ------------------------------ latest roast ------------------------------ */

export function LatestRoastPanel({ roast, shame, span = 4 }: { roast: Roast | null; shame: ShameEntry | null; span?: PanelSpan }) {
  return (
    <Panel label="Latest roast" labelRight={<BarLink href="#rap-sheet">Rap sheet</BarLink>} span={span}>
      {roast ? (
        <RoastBlock {...roastToBlock(roast)} size="compact" headingLevel={3} />
      ) : shame ? (
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center gap-2">
            <Tag tone="alarm">{KIND_LABEL[shame.kind]}</Tag>
            <span className="type-label text-ink-muted">{shame.week ? `Week ${shame.week}` : shame.season}</span>
          </div>
          <p className="type-display m-0 text-j2">{shame.headline}</p>
          {shame.detail ? <p className="m-0 text-body">{shame.detail}</p> : null}
          <p className="type-label m-0 mt-auto flex items-center gap-2">
            <LiveSquare size={10} />
            Damage: {damage(shame)}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-6">
          <p className="type-display m-0 text-j3">Clean so far</p>
          <DotMatrixFill label="Nothing roasted yet. Nobody stays clean in this league for long." rows={5} />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ roster tables ------------------------------ */

function playerColumns(opts: { slotHeader: string; starters?: boolean }): DataColumn<RosterRow>[] {
  return [
    {
      key: "player",
      header: opts.slotHeader,
      cell: (r) => (
        <span className="flex items-center gap-3">
          <Tag className="w-11 justify-center">{r.slot}</Tag>
          {r.playerId ? (
            <span className="flex min-w-0 flex-col md:flex-row md:items-center md:gap-2.5">
              <span className="flex items-center gap-2">
                <span className="font-bold">{r.info?.name ?? `Player ${r.playerId}`}</span>
                {injuryTag(r.info) ? (
                  <Tag tone={isAlarm(r) ? "alarm" : "outline"} className="px-1 py-px">
                    {injuryTag(r.info)}
                  </Tag>
                ) : null}
              </span>
              <span className="text-fine font-normal text-ink-muted">
                {[opts.starters ? r.info?.pos : null, r.info?.team ?? "Free agent"].filter(Boolean).join(" · ")}
                {(r.info?.age ?? r.value?.age) ? <span className="md:hidden"> · age {r.info?.age ?? r.value?.age}</span> : null}
              </span>
            </span>
          ) : (
            <span className="font-bold">Empty slot</span>
          )}
        </span>
      ),
    },
    { key: "age", header: "Age", align: "right", hideOnPhone: true, cell: (r) => (r.info?.age ?? r.value?.age ?? "--") },
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (r) => (r.value ? <span className="font-bold">{fmtInt(r.value.value)}</span> : r.playerId ? <span className="text-ink-muted">Unranked</span> : "--"),
    },
    {
      key: "rank",
      header: "FC rank",
      align: "right",
      hideOnPhone: true,
      cell: (r) => (r.value ? `${r.value.position}${r.value.positionRank} · ${ordinal(r.value.overallRank)}` : "--"),
    },
  ];
}

export function LineupPanel({ rows, alarms, span = 8 }: { rows: RosterRow[]; alarms: boolean; span?: PanelSpan }) {
  const out = alarms ? rows.filter(isAlarm).length : 0;
  return (
    <Panel
      label="Starting lineup"
      labelRight={out ? <span className="flex items-center gap-2 text-paper"><LiveSquare size={8} />{out} not playing</span> : <span className="text-paper-shade">{rows.length} slots</span>}
      span={span}
      pad={false}
    >
      <DataTable
        caption="Starting lineup by slot"
        dense
        rows={rows}
        rowKey={(r) => r.key}
        mark={(r) => (alarms && isAlarm(r) ? "alarm" : null)}
        minWidth={320}
        columns={playerColumns({ slotHeader: "Slot", starters: true })}
      />
      <LineFoot rows={rows} label="Starters" />
    </Panel>
  );
}

/** Total value and average age of a group of rows, as a ruled footer line. */
function LineFoot({ rows, label }: { rows: RosterRow[]; label: string }) {
  const valued = rows.filter((r) => r.value);
  const ages = rows.map((r) => r.info?.age ?? r.value?.age ?? null).filter((a): a is number => typeof a === "number");
  if (!valued.length && !ages.length) return null;
  const total = valued.reduce((a, r) => a + (r.value?.value ?? 0), 0);
  return (
    <p className="type-label m-0 mt-auto flex flex-wrap justify-between gap-x-4 gap-y-1 border-t-2 border-ink px-4 py-3 md:px-6">
      <span>{label}</span>
      <span>
        {valued.length ? `${fmtInt(total)} value` : "No ranked players"}
        {ages.length ? ` · average age ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)}` : ""}
      </span>
    </p>
  );
}

export function BenchPanel({ rows, span = 8 }: { rows: RosterRow[]; span?: PanelSpan }) {
  return (
    <Panel label="Bench" labelRight={<span className="text-paper-shade">{rows.length} players</span>} span={span} pad={false}>
      <DataTable
        caption="Bench, by position then value"
        dense
        rows={rows}
        rowKey={(r) => r.key}
        minWidth={320}
        columns={playerColumns({ slotHeader: "Pos" })}
        empty={
          <div className="px-4 py-6 md:px-6">
            <DotMatrixFill label="Nobody on the bench." rows={3} />
          </div>
        }
      />
      {rows.length ? <LineFoot rows={rows} label="Bench" /> : null}
    </Panel>
  );
}

function ShortList({ rows, empty }: { rows: RosterRow[]; empty: string }) {
  if (!rows.length) return <p className="type-label m-0 text-ink-muted">{empty}</p>;
  return (
    <ul className="m-0 list-none border-t-2 border-ink p-0">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-ink py-2">
          <Tag className="justify-center">{r.slot}</Tag>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold">{r.info?.name ?? "--"}</span>
            <span className="truncate text-fine text-ink-muted">
              {[r.info?.team ?? "Free agent", r.info?.age ? `age ${r.info.age}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="type-data text-right">{r.value ? fmtInt(r.value.value) : <span className="text-ink-muted">Unranked</span>}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReservesPanel({ taxi, ir, taxiSlots, irSlots, span = 4 }: { taxi: RosterRow[]; ir: RosterRow[]; taxiSlots: number; irSlots: number; span?: PanelSpan }) {
  return (
    <Panel label="Taxi and IR" labelRight={<span className="text-paper-shade">{taxi.length + ir.length} players</span>} span={span}>
      <div className="flex flex-col gap-7">
        <section aria-labelledby="taxi-h" className="flex flex-col gap-2">
          <h3 id="taxi-h" className="type-label m-0 flex justify-between">
            Taxi squad
            <span className="text-ink-muted">
              {taxi.length} of {taxiSlots}
            </span>
          </h3>
          <ShortList rows={taxi} empty="Taxi squad is empty." />
        </section>
        <section aria-labelledby="ir-h" className="flex flex-col gap-2">
          <h3 id="ir-h" className="type-label m-0 flex justify-between">
            Injured reserve
            <span className="text-ink-muted">
              {ir.length} of {irSlots}
            </span>
          </h3>
          <ShortList rows={ir} empty="Nobody on IR." />
        </section>
      </div>
    </Panel>
  );
}

/* ------------------------------ value ------------------------------ */

function DotBar({ share, label }: { share: number; label: string }) {
  const n = Math.round(Math.min(1, Math.max(0, share)) * 10);
  return (
    <span role="img" aria-label={label} className="grid w-full grid-cols-10 gap-[2px]">
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={cx("block aspect-square", i < n ? "bg-ink" : "border border-ink")} />
      ))}
    </span>
  );
}

export function ValuePanel({ rosterId, values, roster, span = 4 }: { rosterId: number; values: TeamValue[]; roster: RosterRow[]; span?: PanelSpan }) {
  const top = roster
    .filter((r) => r.value)
    .sort((a, b) => (b.value?.value ?? 0) - (a.value?.value ?? 0))
    .slice(0, 3);
  const ages = roster.map((r) => r.info?.age ?? r.value?.age ?? null).filter((a): a is number => typeof a === "number");
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const mine = values.find((v) => v.rosterId === rosterId);
  if (!mine) return null;
  const n = values.length;
  const rank = [...values].sort((a, b) => b.total - a.total).findIndex((v) => v.rosterId === rosterId) + 1;
  const rows = VALUE_POSITIONS.map((pos) => {
    const all = values.map((v) => v.byPos[pos] ?? 0);
    const top = Math.max(1, ...all);
    const val = mine.byPos[pos] ?? 0;
    const r = [...all].sort((a, b) => b - a).indexOf(val) + 1;
    return { pos, val, share: val / top, rank: r };
  });
  return (
    <Panel label="Team value" labelRight={<span className="text-paper-shade">FantasyCalc</span>} span={span}>
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="type-label text-ink-muted">Dynasty value</span>
            <Numeral value={mine.total} size="d60" ghost label={`${fmtInt(mine.total)} dynasty value`} />
          </div>
          <span className={cx("type-display text-j3", rank === n && "text-red")}>{ordinal(rank)}</span>
        </div>
        <p className="type-label m-0 text-ink-muted">
          {ordinal(rank)} of {n} · {mine.ranked} ranked, {mine.unranked} unranked
        </p>
        <dl className="m-0 border-t-2 border-ink">
          {rows.map((r) => (
            <div key={r.pos} className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_2.5rem] items-center gap-3 border-b border-ink py-2.5">
              <dt className="type-label">{r.pos}</dt>
              <dd className="m-0">
                <DotBar share={r.share} label={`${r.pos}: ${Math.round(r.share * 100)} percent of the best ${r.pos} room`} />
              </dd>
              <dd className="type-data m-0 text-right">{fmtInt(r.val)}</dd>
              <dd className={cx("type-label m-0 text-right", r.rank === n ? "text-red" : "text-ink-muted")}>{ordinal(r.rank)}</dd>
            </div>
          ))}
        </dl>
        <p className="type-label m-0 text-ink-muted">Bars: share of the best room in the league at that position.</p>
        {top.length ? (
          <section aria-labelledby="top-assets" className="mt-auto flex flex-col gap-2">
            <h3 id="top-assets" className="type-label m-0 flex justify-between">
              Most valuable
              {avgAge ? <span className="text-ink-muted">Roster age {avgAge.toFixed(1)}</span> : null}
            </h3>
            <ol className="m-0 list-none border-t-2 border-ink p-0">
              {top.map((r, i) => (
                <li key={r.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-ink py-2">
                  <span className="type-label">{i + 1}</span>
                  <span className="min-w-0 truncate">
                    <b>{r.info?.name}</b>
                    <span className="text-fine text-ink-muted">
                      {" "}
                      {r.info?.pos}
                      {r.info?.age ? `, ${r.info.age}` : ""}
                    </span>
                  </span>
                  <span className="type-data text-right">{fmtInt(r.value?.value)}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------ rap sheet ------------------------------ */

const KIND_LABEL: Record<ShameKind, string> = {
  bench_points: "Bench",
  zero_starter: "Zero",
  bad_trade: "Trade",
  zero_bid_lost: "$0 bid",
  overpay: "Overpay",
  lineup_negligence: "Lineup",
  draft_reach: "Reach",
};

function damage(e: ShameEntry): string {
  switch (e.unit) {
    case "pts":
      return `${fmtPts(e.amount)} pts`;
    case "$":
      return `$${fmtInt(e.amount)}`;
    case "value":
      return `${fmtInt(e.amount)} value`;
    case "picks":
      return `${fmtInt(e.amount)} picks`;
  }
}

export function RapSheetPanel({
  manager,
  shame,
  roasts,
  shamePlaceholder,
  span = 12,
}: {
  manager: Manager;
  shame: ShameEntry[];
  roasts: Roast[];
  shamePlaceholder: boolean;
  span?: PanelSpan;
}) {
  const narrow = span < 8;
  const count = shame.length + roasts.length;
  return (
    <Panel
      label="Rap sheet"
      id="rap-sheet"
      span={span}
      labelRight={
        <>
          {shamePlaceholder && shame.length ? <SampleMark onInk /> : null}
          <span className="text-paper-shade">{count ? `${count} ${count === 1 ? "entry" : "entries"}` : "Clean"}</span>
        </>
      }
      pad={false}
    >
      {count === 0 ? (
        <div className="px-4 pb-5 pt-6 md:px-6 md:pb-6 md:pt-8">
          <DotMatrixFill label={`${manager.name} has a clean sheet. Every bad trade, $0 bid and benched 30-point week lands here.`} rows={narrow ? 4 : 5} />
        </div>
      ) : (
        <div className="flex flex-col">
          {shame.length ? (
            <DataTable
              caption={`${manager.name}'s Wall of Shame entries, worst first`}
              rows={shame}
              rowKey={(e) => e.id}
              mark={(_, i) => (i === 0 ? "alarm" : null)}
              minWidth={480}
              columns={[
                {
                  key: "what",
                  header: "What",
                  className: "w-full",
                  cell: (e) => (
                    <span className="flex items-center gap-2.5 whitespace-normal">
                      <Tag>{KIND_LABEL[e.kind]}</Tag>
                      <span>{e.headline}</span>
                    </span>
                  ),
                },
                { key: "week", header: "Wk", align: "right", hideOnPhone: true, cell: (e) => (e.week ? e.week : "--") },
                { key: "damage", header: "Damage", align: "right", cell: (e) => <span className="whitespace-nowrap font-bold">{damage(e)}</span> },
              ]}
            />
          ) : null}
          {roasts.length ? (
            <div className={cx("grid grid-cols-1 gap-px bg-ink", !narrow && "md:grid-cols-2", shame.length > 0 && "border-t-2 border-ink")}>
              {roasts.map((r) => (
                <div key={r.id} className="flex bg-paper px-4 pb-5 pt-6 md:px-6">
                  <RoastBlock {...roastToBlock(r)} size="compact" headingLevel={3} />
                </div>
              ))}
              {!narrow && roasts.length % 2 === 1 ? <div aria-hidden className="hidden bg-paper md:block" /> : null}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ draft haul ------------------------------ */

export function DraftHaulPanel({ cells, grade, placeholder }: { cells: BoardCell[]; grade: DraftGrade | null; placeholder: boolean }) {
  const made = cells.filter((c) => c.pick);
  if (!made.length) return null;
  const total = made.reduce((a, c) => a + (c.pick?.player.value ?? 0), 0);
  return (
    <Panel
      label="Draft haul"
      labelRight={
        <>
          {placeholder ? <SampleMark onInk /> : null}
          <span className="text-paper-shade">{grade ? `Grade ${grade.grade}` : `${made.length} picks`}</span>
        </>
      }
      pad={false}
    >
      <DataTable
        caption="Startup draft picks, in order"
        rows={made}
        rowKey={(c) => String(c.pickNo)}
        rowId={(c) => `haul-${c.pickNo}`}
        minWidth={520}
        columns={[
          {
            key: "pick",
            header: "Pick",
            cell: (c) => (
              <Link href={`/draft#pick-${c.pickNo}`} className="type-label link-ink px-0.5">
                {c.label}
              </Link>
            ),
          },
          {
            key: "player",
            header: "Player",
            className: "w-full",
            cell: (c) => (
              <span className="flex items-center gap-2.5">
                <Tag className="w-9 justify-center">{c.pick?.player.position || "--"}</Tag>
                <span className="font-bold">{c.pick?.player.name}</span>
                <span className="text-fine font-normal text-ink-muted">{c.pick?.player.nflTeam ?? ""}</span>
              </span>
            ),
          },
          { key: "verdict", header: "Verdict", cell: (c) => (c.pick ? <Verdict pick={c.pick} /> : null) ?? <span className="text-ink-muted">--</span> },
          { key: "fc", header: "FC rank", align: "right", hideOnPhone: true, cell: (c) => (c.pick?.fcRank ? ordinal(c.pick.fcRank) : "--") },
          { key: "value", header: "Value", align: "right", cell: (c) => (c.pick?.player.value ? fmtInt(c.pick.player.value) : <span className="text-ink-muted">--</span>) },
        ]}
      />
      <p className="type-label m-0 flex justify-between gap-4 border-t-2 border-ink px-4 py-3 md:px-6">
        <span>Draft value</span>
        <span>
          {grade ? fmtInt(grade.totalValue) : made.some((c) => c.pick?.player.value) ? fmtInt(total) : "--"}
          {grade ? ` · ${ordinal(grade.valueRank)} in the league` : ""}
        </span>
      </p>
    </Panel>
  );
}

/* ------------------------------ roster empty ------------------------------ */

export function RosterEmptyPanel({ manager, drafting, span = 8 }: { manager: Manager; drafting: boolean; span?: PanelSpan }) {
  return (
    <Panel label="Roster" labelRight={<span className="text-paper-shade">Empty</span>} span={span}>
      <DotMatrixFill
        label={
          drafting
            ? `Sleeper fills ${manager.name}'s roster when the draft ends. Until then the picks are the roster.`
            : `No roster until the startup draft. ${manager.name}'s players land here pick by pick.`
        }
        rows={6}
      />
    </Panel>
  );
}

/* ------------------------------ the other teams ------------------------------ */

export function TeamsStrip({ ctx, current, order, standings }: { ctx: LeagueContext; current: number; order: number[]; standings: StandingRow[] }) {
  const byId = new Map(standings.map((s) => [s.team.rosterId, s]));
  const played = standings.some((s) => s.wins + s.losses + s.ties > 0);
  return (
    <Panel label="The league" labelRight={<span className="text-paper-shade">{order.length} teams</span>} pad={false}>
      <nav aria-label="Every team">
        <ol className="m-0 grid list-none grid-cols-2 gap-px bg-ink p-0 md:grid-cols-5 xl:grid-cols-10">
          {order.map((id) => {
            const m = ctx.managers.find((x) => x.rosterId === id);
            const s = byId.get(id);
            const here = id === current;
            return (
              <li key={id} className="flex">
                <Link
                  href={`/teams/${id}`}
                  aria-current={here ? "page" : undefined}
                  className={cx(
                    "flex w-full min-w-0 flex-col gap-1 px-3 py-3 no-underline focus-visible:outline-offset-[-4px]",
                    here ? "on-ink bg-ink text-paper" : "bg-paper text-ink hover:bg-paper-shade",
                  )}
                >
                  <span className="type-label truncate text-[1rem] leading-tight">{m?.name ?? `Roster ${id}`}</span>
                  <span className={cx("truncate text-fine", here ? "text-paper-shade" : "text-ink-muted")}>{m?.teamName ?? ""}</span>
                  {played && s ? <span className="type-label mt-1">{record(s.wins, s.losses, s.ties)}</span> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </Panel>
  );
}
