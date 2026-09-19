/**
 * The Wall of Shame. Leads with the most wanted manager (or the rap sheet you asked for), then
 * every manager's tally, the all-time record for each kind of sin, and the full ranked ledger.
 * Formatting only: every number is a ShameEntry amount or a count of entries.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, PixelArrow } from "@/components/Button";
import { cx } from "@/components/cx";
import { DataTable } from "@/components/DataTable";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { FilterLinks } from "@/components/FilterLinks";
import { BarLink } from "@/components/HeaderBar";
import { Numeral } from "@/components/Numeral";
import { Board, Panel } from "@/components/Panel";
import { RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { lineOf, RowLine } from "@/components/RowLine";
import { LiveSquare, SampleMark } from "@/components/Tag";
import type { SeasonPhase, ShameBoard, ShameEntry, ShameKind, SurfaceLineMap } from "@/lib/types";
import { ordinal } from "../_lib/format";
import { amountText, damageText, entryHref, groupByKind, KIND_ORDER, KINDS, shortHeadline } from "./kinds";

export interface ShameManager {
  key: string;
  name: string;
  teamName: string;
}

export interface ShameViewProps {
  /** null when the wall could not be computed. */
  board: ShameBoard | null;
  managers: ShameManager[];
  season: string;
  phase: SeasonPhase;
  kind: ShameKind | null;
  /** managerKey filter. */
  who: string | null;
  /** One-liners by entry id (the shame surface). */
  lines?: SurfaceLineMap;
}

/** Rows per kind in the unfiltered ledger. */
const GROUP_LIMIT = 8;

/** Links inside dense rows: a 1px underline, inverting on hover like link-ink. */
const QUIET_LINK = "underline decoration-1 underline-offset-[3px] hover:bg-ink hover:text-paper";

/** What each record is called in a sentence ("holds the record for the worst trade"). */
const RECORD_PHRASE: Partial<Record<ShameKind, string>> = {
  bench_points: "the most points left on a bench",
  bad_trade: "the worst trade",
  zero_bid_lost: "the worst $0 bid",
  overpay: "the biggest overpay",
  draft_reach: "the biggest draft reach",
};

export function shameHref({ kind, who }: { kind?: ShameKind | null; who?: string | null }, hash = "ledger"): string {
  const q = new URLSearchParams();
  if (kind) q.set("kind", KINDS[kind].slug);
  if (who) q.set("who", who);
  const qs = q.toString();
  return `/shame${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Left 41.2 points" -> "left 41.2 points" (only when the second letter is lowercase). */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/* ------------------------------ tallies ------------------------------ */

interface Tally {
  manager: ShameManager;
  count: number;
  rank: number;
  byKind: Map<ShameKind, number>;
  /** Kinds where this manager holds the all-time worst entry. */
  records: ShameKind[];
  /** Their single worst ranked entry (best position within its kind), else their latest. */
  lowlight: ShameEntry | null;
}

function tallies(managers: ShameManager[], groups: Map<ShameKind, ShameEntry[]>): Tally[] {
  const base = new Map<string, Tally>();
  const known = [...managers];
  for (const list of groups.values()) {
    for (const e of list) {
      if (!known.some((m) => m.key === e.team.managerKey)) {
        known.push({ key: e.team.managerKey, name: e.team.managerName, teamName: e.team.teamName });
      }
    }
  }
  for (const m of known) base.set(m.key, { manager: m, count: 0, rank: 0, byKind: new Map(), records: [], lowlight: null });
  const lowPos = new Map<string, number>();
  for (const [kind, list] of groups) {
    list.forEach((e, i) => {
      const t = base.get(e.team.managerKey);
      if (!t) return;
      t.count += 1;
      t.byKind.set(kind, (t.byKind.get(kind) ?? 0) + 1);
      if (KINDS[kind].ranked) {
        if (i === 0) t.records.push(kind);
        if (i < (lowPos.get(t.manager.key) ?? Infinity)) {
          lowPos.set(t.manager.key, i);
          t.lowlight = e;
        }
      } else if (!t.lowlight) {
        t.lowlight = e;
      }
    });
  }
  const rows = [...base.values()].sort(
    (a, b) => b.count - a.count || b.records.length - a.records.length || a.manager.name.localeCompare(b.manager.name),
  );
  for (const r of rows) r.rank = 1 + rows.filter((x) => x.count > r.count).length;
  return rows;
}

/* ------------------------------ lead ------------------------------ */

function rapSheetBlock(
  t: Tally,
  groups: Map<ShameKind, ShameEntry[]>,
  total: number,
  kicker: string,
  placeholder: boolean,
  tiedWith: Tally[] = [],
): RoastBlockData {
  const parts: string[] = [];
  for (const k of KIND_ORDER) {
    const c = t.byKind.get(k);
    if (!c) continue;
    parts.push(k === "bench_points" ? `${c} of the ${groups.get(k)?.length ?? c} worst bench weeks` : plural(c, KINDS[k].count));
  }
  const lines = [`${t.manager.name} is on the wall ${t.count === 1 ? "once" : `${t.count} times`}: ${joinAnd(parts)}.`];
  if (tiedWith.length) lines.push(`Tied for the most with ${joinAnd(tiedWith.map((x) => x.manager.name))}.`);
  const recs = t.records.map((k) => RECORD_PHRASE[k]).filter((x): x is string => Boolean(x));
  if (recs.length) lines.push(`Holds the league record for ${joinAnd(recs)}.`);
  if (t.lowlight) lines.push(`Lowlight: ${lowerFirst(t.lowlight.headline)}${t.lowlight.week ? `, week ${t.lowlight.week}` : ""}.`);
  const most = [...t.byKind.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    kicker,
    victim: t.manager.name,
    stat: `${t.count} ${t.count === 1 ? "entry" : "entries"}`,
    text: lines.join(" "),
    receipt: [
      { label: "Entries", value: t.count },
      { label: "Records held", value: t.records.length },
      { label: "Most often", value: most ? `${KINDS[most[0]].short} (${most[1]})` : "--" },
      { label: "Rank", value: `${ordinal(t.rank)} of ${total}` },
    ],
    href: shameHref({ who: t.manager.key }, ""),
    tags: placeholder ? <SampleMark /> : null,
  };
}

function cleanBlock(m: ShameManager, season: string): RoastBlockData {
  return {
    kicker: `Rap sheet · ${season} season`,
    victim: m.name,
    stat: "Clean so far",
    text: `${m.name} has not made the wall. No bench disaster, no zero-point starter, no lopsided trade, no wasted bid.`,
    receipt: [
      { label: "Entries", value: 0 },
      { label: "Records held", value: 0 },
      { label: "Team", value: m.teamName },
    ],
    href: shameHref({ who: m.key }, ""),
  };
}

function EmptyLead({ phase, season }: { phase: SeasonPhase; season: string }) {
  const line =
    phase === "pre_draft"
      ? "The startup draft comes first. The worst reaches go up here with the FantasyCalc rank that proves it."
      : phase === "drafting"
        ? "The draft is on. The worst reaches go up here with the FantasyCalc rank that proves it."
        : "Nobody has earned a spot yet. The first bench disaster, zero-point starter, lopsided trade or losing $0 bid goes up with the number that proves it.";
  return (
    <article className="flex flex-1 flex-col gap-6 md:gap-7">
      <p className="type-label m-0">Wall of shame · {season} season</p>
      <h3 className="type-display m-0 text-j3 md:text-j4 xl:text-j5">
        <span className="board-wipe block">Nobody on the wall</span>
      </h3>
      <p className="measure m-0 text-body md:text-lede">{line}</p>
      <DotMatrixFill label="Seven ways to get on it. Every one is a number from Sleeper or FantasyCalc." rows={5} />
    </article>
  );
}

/* ------------------------------ rap sheets ------------------------------ */

function TallyDots({ n, inverted }: { n: number; inverted: boolean }) {
  if (n === 0) return null;
  return (
    <span aria-hidden className="flex max-w-[16.5rem] flex-wrap gap-[3px] pt-1.5">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cx("block size-[6px]", inverted ? "bg-paper" : "bg-ink")} />
      ))}
    </span>
  );
}

function RapSheets({ rows, who, placeholder, empty }: { rows: Tally[]; who: string | null; placeholder: boolean; empty: boolean }) {
  const topCount = rows[0]?.count ?? 0;
  return (
    <Panel
      label="Rap sheets"
      labelRight={placeholder ? <SampleMark onInk /> : <span className="text-paper-shade">{empty ? "All clean" : "Entries"}</span>}
      span={4}
      pad={false}
    >
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((t) => {
          const selected = who === t.manager.key;
          const top = t.count > 0 && t.count === topCount;
          return (
            <li key={t.manager.key} className="border-b border-ink">
              <Link
                href={selected ? shameHref({}, "") : shameHref({ who: t.manager.key })}
                aria-current={selected ? "true" : undefined}
                aria-label={`${t.manager.name}: ${t.count} ${t.count === 1 ? "entry" : "entries"}${selected ? ", showing" : ""}`}
                className={cx(
                  "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 no-underline md:px-6 lg:px-4 xl:px-6",
                  "focus-visible:outline-offset-[-4px]",
                  selected ? "on-ink bg-ink text-paper" : "hover:bg-paper-shade",
                )}
              >
                {t.count ? (
                  <Numeral value={t.rank} pad={2} size="d20" tone={selected ? "paper" : "ink"} label={`Rank ${t.rank}`} />
                ) : (
                  <Numeral value="--" size="d20" tone={selected ? "paper" : "muted"} label="Not ranked" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2">
                    {top ? <LiveSquare size={8} /> : null}
                    <span className="truncate font-bold leading-tight">{t.manager.name}</span>
                  </span>
                  {t.count ? (
                    <TallyDots n={t.count} inverted={selected} />
                  ) : (
                    <span className={cx("truncate text-fine", selected ? "text-paper-shade" : "text-ink-muted")}>{t.manager.teamName}</span>
                  )}
                </span>
                <Numeral value={t.count} size="d30" tone={selected ? "paper" : t.count ? "ink" : "muted"} label={`${t.count} entries`} />
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="m-0 mt-auto px-4 py-3 text-data text-ink-muted md:px-6 lg:px-4 xl:px-6">
        {empty ? "Ten clean records." : "One dot per entry. Pick a name for the rap sheet."}
      </p>
    </Panel>
  );
}

/* ------------------------------ record wall ------------------------------ */

const GHOST: Record<ShameEntry["unit"] | "count", string> = { pts: "88.88", $: "$888", value: "8,888", picks: "88", count: "88" };
const UNIT_OF: Record<ShameKind, ShameEntry["unit"]> = {
  bench_points: "pts",
  zero_starter: "pts",
  lineup_negligence: "pts",
  bad_trade: "value",
  zero_bid_lost: "$",
  overpay: "$",
  draft_reach: "picks",
};

/** A row of 3px square dots that runs from the title to the number, like a records board. */
function Leader() {
  return (
    <span
      aria-hidden
      className="hidden h-[3px] min-w-6 flex-1 self-end mb-[0.4rem] md:block"
      style={{ backgroundImage: "linear-gradient(to right, var(--color-ink) 3px, transparent 3px)", backgroundSize: "7px 3px" }}
    />
  );
}

function RecordRow({ kind, list, rows }: { kind: ShameKind; list: ShameEntry[] | undefined; rows: Tally[] }) {
  const meta = KINDS[kind];
  const top = list?.[0];
  let value: ReactNode;
  let holder: ReactNode;
  let what: ReactNode;

  if (!list?.length || !top) {
    value = (
      <span className="type-numeral text-paper-shade">
        <span aria-hidden>
          {GHOST[meta.ranked ? UNIT_OF[kind] : "count"]
            .split(/(\.)/)
            .map((part, i) => (part === "." ? <span key={i} className="numeral-point" /> : part))}
        </span>
        <span className="sr-only">No record yet</span>
      </span>
    );
    holder = <span className="text-ink-muted">Nobody yet</span>;
    what = <span className="text-ink-muted">{meta.rule}.</span>;
  } else if (meta.ranked) {
    const href = entryHref(top);
    value = <Numeral value={amountText(top)} label={damageText(top)} />;
    holder = (
      <>
        <span className="block truncate font-bold">{top.team.managerName}</span>
        <span className="block truncate text-fine text-ink-muted">{top.team.teamName}</span>
      </>
    );
    what = (
      <>
        {href ? (
          <Link href={href} className={QUIET_LINK}>
            {shortHeadline(top)}
          </Link>
        ) : (
          shortHeadline(top)
        )}
        <span className="block text-fine text-ink-muted">
          {top.week ? `Week ${top.week}` : "Startup draft"}
          {top.detail ? ` · ${top.detail}` : ""}
        </span>
      </>
    );
  } else {
    const worst = rows.map((r) => ({ r, n: r.byKind.get(kind) ?? 0 })).sort((a, b) => b.n - a.n)[0];
    value = <Numeral value={list.length} label={`${list.length} ${meta.count[1]}`} />;
    holder = worst ? (
      <>
        <span className="block truncate font-bold">{worst.r.manager.name}</span>
        <span className="block truncate text-fine text-ink-muted">Most of them: {worst.n}</span>
      </>
    ) : null;
    what = (
      <>
        Latest: {top.headline}
        <span className="block text-fine text-ink-muted">{top.week ? `Week ${top.week}` : ""}</span>
      </>
    );
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-ink px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(12rem,1.15fr)_8.5rem_minmax(0,12rem)_minmax(0,1.5fr)] md:px-6 md:py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-label m-0 flex items-center gap-2">
            {top && meta.ranked ? <LiveSquare size={8} /> : null}
            {list?.length ? (
              <Link href={shameHref({ kind })} className="underline decoration-2 underline-offset-[3px] hover:bg-ink hover:text-paper">
                {meta.title}
              </Link>
            ) : (
              meta.title
            )}
          </p>
          <p className="m-0 text-fine text-ink-muted">{meta.unitLabel}</p>
        </div>
        <Leader />
      </div>
      <div className="text-right text-d40 leading-none">{value}</div>
      <div className="col-span-2 min-w-0 md:col-span-1">{holder}</div>
      <div className="col-span-2 min-w-0 text-data md:col-span-1">{what}</div>
    </li>
  );
}

function RecordWall({ groups, rows, placeholder }: { groups: Map<ShameKind, ShameEntry[]>; rows: Tally[]; placeholder: boolean }) {
  const held = KIND_ORDER.filter((k) => groups.has(k)).length;
  return (
    <Panel
      label="All-time records"
      labelRight={
        placeholder ? (
          <SampleMark onInk />
        ) : (
          <span className="text-paper-shade">
            {held} of {KIND_ORDER.length} set
          </span>
        )
      }
      pad={false}
    >
      <ul className="m-0 list-none p-0">
        {KIND_ORDER.map((k) => (
          <RecordRow key={k} kind={k} list={groups.get(k)} rows={rows} />
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------ ledger ------------------------------ */

function LedgerGroup({
  kind,
  list,
  limit,
  who,
  lines,
}: {
  kind: ShameKind;
  list: ShameEntry[];
  limit: number | null;
  who: string | null;
  lines?: SurfaceLineMap;
}) {
  const meta = KINDS[kind];
  const shown = limit ? list.slice(0, limit) : list;
  const headingId = `ledger-${meta.slug}`;
  return (
    <section aria-labelledby={headingId} className="border-t-2 border-ink">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 pb-3 pt-5 md:px-6">
        <h3 id={headingId} className="type-label m-0 flex items-center gap-2.5">
          {meta.title}
          <span className="tnum font-sans text-fine font-bold">{list.length}</span>
        </h3>
        <p className="m-0 text-data text-ink-muted">
          {meta.rule}. {meta.ranked ? "Worst first." : "Newest first."}
        </p>
      </div>
      {/* Phones: one entry per block, full width (a table leaves the story a 170px column). */}
      <ol aria-label={`${meta.title}, ${meta.ranked ? "worst first" : "newest first"}`} className="m-0 list-none border-t border-ink p-0 sm:hidden">
        {shown.map((e, i) => {
          const href = entryHref(e);
          const quip = lineOf(lines, e.id);
          return (
            <li key={e.id} className={cx("flex flex-col gap-1.5 px-4 py-3", i % 2 ? "bg-paper-shade" : "bg-paper")}>
              <p className="m-0 flex min-w-0 items-baseline gap-2">
                {meta.ranked ? (
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    {i === 0 ? <LiveSquare size={10} /> : null}
                    <span className="tnum text-data text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                ) : null}
                <span className="shrink-0 font-bold">{e.team.managerName}</span>
                <span className="truncate text-fine text-ink-muted">{e.team.teamName}</span>
                <span className="ml-auto shrink-0 text-fine text-ink-muted">{e.week ? `Wk ${e.week}` : "Draft"}</span>
              </p>
              {meta.ranked ? <p className="m-0 text-body font-bold">{damageText(e)}</p> : null}
              <p className="m-0 text-body">
                {href ? (
                  <Link href={href} className={QUIET_LINK}>
                    {meta.ranked ? shortHeadline(e) : e.headline}
                  </Link>
                ) : meta.ranked ? (
                  shortHeadline(e)
                ) : (
                  e.headline
                )}
              </p>
              {e.detail ? <p className="m-0 text-fine text-ink-muted">{e.detail}</p> : null}
              {quip ? <RowLine text={quip} /> : null}
            </li>
          );
        })}
      </ol>
      <DataTable
        caption={`${meta.title}, ${meta.ranked ? "worst first" : "newest first"}`}
        rows={shown}
        rowKey={(e) => e.id}
        rowId={(e) => `entry-${e.id.replace(/[^a-zA-Z0-9_]+/g, "-")}`}
        dense
        line={(e) => lineOf(lines, e.id)}
        minWidth={340}
        className="hidden sm:block"
        columns={[
          {
            key: "who",
            header: meta.ranked ? "# · Who" : "Who",
            cell: (e, i) => (
              <span className="flex items-baseline gap-2">
                {meta.ranked ? (
                  <span className="flex w-9 shrink-0 items-baseline gap-1.5">
                    <span className="inline-flex w-2.5 self-center">{i === 0 ? <LiveSquare size={10} /> : null}</span>
                    <span className="tnum text-fine font-normal text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-col">
                  <span className="font-bold">{e.team.managerName}</span>
                  <span className="block max-w-[8.5rem] truncate text-fine font-normal text-ink-muted md:max-w-[13rem]">
                    {e.team.teamName}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: "what",
            header: "What they did",
            className: "w-full min-w-[10rem]",
            cell: (e) => {
              const href = entryHref(e);
              return (
                <span className="flex flex-col">
                  {meta.ranked ? <span className="whitespace-nowrap font-bold md:hidden">{damageText(e)}</span> : null}
                  {href ? (
                    <Link href={href} className={cx(QUIET_LINK, "self-start")}>
                      {shortHeadline(e)}
                    </Link>
                  ) : (
                    <span>{shortHeadline(e)}</span>
                  )}
                  {e.detail ? <span className="text-fine font-normal text-ink-muted">{e.detail}</span> : null}
                </span>
              );
            },
          },
          { key: "week", header: "Wk", align: "right", hideOnPhone: true, cell: (e) => <span className="tnum">{e.week ?? "Draft"}</span> },
          ...(meta.ranked
            ? [
                {
                  key: "damage",
                  header: meta.column,
                  align: "right" as const,
                  hideOnPhone: true,
                  cell: (e: ShameEntry) => <span className="whitespace-nowrap font-bold">{damageText(e)}</span>,
                },
              ]
            : []),
        ]}
      />
      {limit && list.length > limit ? (
        <p className="m-0 border-t border-ink px-4 py-3 md:px-6">
          <Link href={shameHref({ kind, who })} className="type-label link-ink inline-flex min-h-11 items-center gap-2 px-0.5">
            All {list.length} {meta.title.toLowerCase().startsWith("$") ? meta.title : meta.title.toLowerCase()}
            <PixelArrow />
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function Ledger({
  groups,
  allGroups,
  kind,
  who,
  whoName,
  placeholder,
  total,
  lines,
}: {
  groups: Map<ShameKind, ShameEntry[]>;
  allGroups: Map<ShameKind, ShameEntry[]>;
  kind: ShameKind | null;
  who: string | null;
  whoName: string | null;
  placeholder: boolean;
  total: number;
  lines?: SurfaceLineMap;
}) {
  const shownKinds = kind ? [kind] : KIND_ORDER.filter((k) => groups.has(k));
  const count = shownKinds.reduce((n, k) => n + (groups.get(k)?.length ?? 0), 0);
  const filters = [
    { href: shameHref({ who }), label: "All", count: [...groups.values()].reduce((n, l) => n + l.length, 0), selected: !kind },
    ...KIND_ORDER.filter((k) => allGroups.has(k)).map((k) => ({
      href: shameHref({ kind: k, who }),
      label: KINDS[k].short,
      count: groups.get(k)?.length ?? 0,
      selected: kind === k,
    })),
  ];

  return (
    <Panel
      id="ledger"
      label="The ledger"
      labelRight={
        <>
          {placeholder ? <SampleMark onInk /> : null}
          <span className="text-paper-shade">
            {count} of {total}
          </span>
        </>
      }
      pad={false}
    >
      {total > 0 || whoName ? (
        <div className="flex flex-col gap-4 px-4 pb-5 pt-6 md:px-6 md:pt-8">
          {whoName ? (
            <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 text-body">
              <span>
                Showing <strong>{whoName}</strong>&apos;s rap sheet.
              </span>
              <Link href={shameHref({ kind })} className="type-label link-ink hit-area px-0.5">
                Show everyone
              </Link>
            </p>
          ) : null}
          {total > 0 ? <FilterLinks label="Filter the ledger by kind" items={filters} /> : null}
        </div>
      ) : null}

      {count === 0 ? (
        <div className={cx("px-4 pb-6 pt-6 md:px-6", (total > 0 || whoName) && "border-t-2 border-ink")}>
          <DotMatrixFill
            label={
              whoName
                ? `Nothing on ${whoName}'s rap sheet${kind ? ` for ${KINDS[kind].title.toLowerCase()}` : ""}.`
                : kind
                  ? `No ${KINDS[kind].title.toLowerCase()} yet.`
                  : "No entries."
            }
            rows={4}
          />
        </div>
      ) : (
        shownKinds.map((k) => {
          const list = groups.get(k);
          return list?.length ? <LedgerGroup key={k} kind={k} list={list} limit={kind ? null : GROUP_LIMIT} who={who} lines={lines} /> : null;
        })
      )}
    </Panel>
  );
}

/* ------------------------------ rules (empty wall) ------------------------------ */

function Rules() {
  return (
    <Panel label="What gets you on it" span={12} pad={false}>
      <ul className="m-0 grid list-none grid-cols-1 gap-px bg-ink p-0 md:grid-cols-2 xl:grid-cols-4">
        {KIND_ORDER.map((k) => (
          <li key={k} className="flex flex-col gap-1.5 bg-paper px-4 py-4 md:px-6">
            <span className="type-label">{KINDS[k].title}</span>
            <span className="text-data text-ink-muted">{KINDS[k].rule}.</span>
          </li>
        ))}
        <li aria-hidden className="tex-halftone hidden bg-paper md:block" />
      </ul>
    </Panel>
  );
}

/* ------------------------------ page ------------------------------ */

export function ShameView({ board, managers, season, phase, kind, who, lines }: ShameViewProps) {
  if (!board) {
    return (
      <Board>
        <Panel label="Wall of shame">
          <div className="flex flex-col gap-6">
            <h2 className="type-display m-0 text-j3 md:text-j4">The wall did not load</h2>
            <p className="measure m-0 text-body md:text-lede">
              The shame is computed fresh from Sleeper and FantasyCalc, and one of them did not answer. Nobody got pardoned. Try again in a
              minute.
            </p>
            <DotMatrixFill label="Sleeper or FantasyCalc did not answer." rows={5} density={0.3} />
            <div>
              <Button href="/shame" variant="primary">
                Try again
              </Button>
            </div>
          </div>
        </Panel>
        <Rules />
      </Board>
    );
  }

  const allGroups = groupByKind(board.entries);
  const rows = tallies(managers, allGroups);
  const total = board.entries.length;
  const whoTally = who ? (rows.find((r) => r.manager.key === who) ?? null) : null;
  const filtered = whoTally ? groupByKind(board.entries.filter((e) => e.team.managerKey === whoTally.manager.key)) : allGroups;
  const empty = total === 0;

  const lead: RoastBlockData | null = whoTally
    ? whoTally.count
      ? rapSheetBlock(whoTally, allGroups, rows.length, `Rap sheet · ${season} season`, board.placeholder)
      : cleanBlock(whoTally.manager, season)
    : !empty && rows[0]
      ? rapSheetBlock(
          rows[0],
          allGroups,
          rows.length,
          `Most wanted · ${season} season`,
          board.placeholder,
          rows.slice(1).filter((r) => r.count === rows[0].count),
        )
      : null;

  return (
    <Board>
      <Panel
        label={lead ? (whoTally ? `Rap sheet, ${season}` : `Most wanted, ${season}`) : "Wall of shame"}
        labelRight={whoTally ? <BarLink href="/shame">Everyone</BarLink> : lead ? null : <span className="text-paper-shade">{season}</span>}
        span={8}
        id="lead"
      >
        {lead ? <RoastBlock {...lead} kicker={undefined} size="hero" animate headingLevel={3} /> : <EmptyLead phase={phase} season={season} />}
      </Panel>
      <RapSheets rows={rows} who={whoTally?.manager.key ?? null} placeholder={board.placeholder} empty={empty} />
      <RecordWall groups={allGroups} rows={rows} placeholder={board.placeholder} />
      <Ledger
        groups={filtered}
        allGroups={allGroups}
        kind={kind}
        who={whoTally?.manager.key ?? null}
        whoName={whoTally?.manager.name ?? null}
        placeholder={board.placeholder}
        total={total}
        lines={lines}
      />
    </Board>
  );
}
