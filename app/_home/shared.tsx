/** Home panels used in more than one phase. */
import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable } from "@/components/DataTable";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { BarLink } from "@/components/HeaderBar";
import { Panel, type PanelSpan } from "@/components/Panel";
import { RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { lineOf } from "@/components/RowLine";
import { SampleMark, Tag } from "@/components/Tag";
import { issueTitle } from "@/lib/roast";
import type { Issue, ShameBoard, ShameEntry, ShameKind, SurfaceLineMap } from "@/lib/types";
import { etStamp, fmtInt, fmtPts } from "../_lib/format";
import { CADENCE, issueLabel, ISSUE_ORDER } from "../newsletter/issue-kinds";

/* ------------------------------ lead ------------------------------ */

export function LeadPanel({
  data,
  empty,
  emptyLabel = "Latest",
  below,
  line,
  span = 8,
  right,
}: {
  data: RoastBlockData | null;
  empty?: ReactNode;
  /** Panel label when there is nothing to lead with. */
  emptyLabel?: string;
  /** Supporting numbers under the lead (the week in numbers, the last few picks). */
  below?: ReactNode;
  /** The lead item's one-liner, when its surface has one. */
  line?: string | null;
  span?: PanelSpan;
  right?: ReactNode;
}) {
  // The panel names the event ("Pick 3.07", "Trade, Sep 21"); the headline inside is an h3.
  return (
    <Panel label={data?.event ?? data?.kicker ?? emptyLabel} labelRight={right} span={span} id="latest">
      <div className="flex flex-1 flex-col gap-10">
        {data ? <RoastBlock {...data} kicker={data.event ? data.kicker : undefined} eventInPanel size="hero" animate headingLevel={3} lede={data.lede ?? line} /> : empty}
        {below}
      </div>
    </Panel>
  );
}

/* ------------------------------ issues ------------------------------ */

export function IssuesPanel({
  issues,
  recapWeek,
  span = 4,
  mdSpan = 12,
}: {
  issues: Issue[];
  /** The week the recap is named by ("Week 5 Recap"), from recapWeek() in app/newsletter/issue-kinds. */
  recapWeek: number;
  span?: PanelSpan;
  mdSpan?: 12 | 6;
}) {
  const latest = issues[0];
  return (
    <Panel label="The issues" labelRight={<BarLink href="/newsletter">Archive</BarLink>} span={span} mdSpan={mdSpan}>
      <div className="flex flex-col gap-6">
        {latest ? (
          <Link href={`/newsletter/${latest.slug}`} className="group flex flex-col gap-3 no-underline">
            <span className="type-label flex items-center gap-2 text-ink-muted">
              Latest · {etStamp(latest.sentAt ?? latest.createdAt)}
              {latest.placeholder ? <SampleMark /> : null}
            </span>
            <span className="type-display text-j2 group-hover:underline group-hover:decoration-4">{issueTitle(latest.kind, latest.week)}</span>
            {latest.dek ? <span className="text-body font-semibold">{latest.dek}</span> : null}
          </Link>
        ) : (
          <p className="m-0 text-body">Nothing has gone out yet. Every issue goes to the league by email, and a copy stays here.</p>
        )}

        <dl className="m-0 border-t-2 border-ink">
          {ISSUE_ORDER.map((kind) => (
            <div key={kind} className="flex flex-col gap-0.5 border-b border-ink py-2.5">
              <dt className="type-label">{issueLabel(kind, recapWeek)}</dt>
              <dd className="m-0 text-data text-ink-muted">{CADENCE[kind]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

/* ------------------------------ wall of shame ------------------------------ */

const KIND_LABEL: Record<ShameKind, string> = {
  bench_points: "Bench",
  zero_starter: "Zero",
  bad_trade: "Trade",
  zero_bid_lost: "$0 bid",
  overpay: "Overpay",
  lineup_negligence: "Lineup",
  draft_reach: "Reach",
};

const KIND_RULE: Record<ShameKind, string> = {
  bench_points: "Points left on your bench",
  zero_starter: "Starting a player who scores zero",
  lineup_negligence: "Starting someone on bye or ruled out",
  bad_trade: "Dynasty value lost in a trade",
  zero_bid_lost: "A $0 waiver bid that lost",
  overpay: "Paying far past the next best bid",
  draft_reach: "Drafting way ahead of FantasyCalc",
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
      return `${fmtInt(e.amount)} ${e.amount === 1 ? "spot" : "spots"}`;
  }
}

/** The worst entry of each kind first, then the next worst, up to `limit`. */
export function topShame(entries: ShameEntry[], limit: number): ShameEntry[] {
  const seen = new Set<ShameKind>();
  const firsts: ShameEntry[] = [];
  const rest: ShameEntry[] = [];
  for (const e of entries) {
    if (!seen.has(e.kind)) {
      seen.add(e.kind);
      firsts.push(e);
    } else rest.push(e);
  }
  return [...firsts, ...rest].slice(0, limit);
}

export function ShamePanel({
  board,
  lines,
  limit = 5,
  span = 8,
  mdSpan = 12,
  hideSample = false,
}: {
  board: ShameBoard | null;
  /** One-liners by entry id (the shame surface). */
  lines?: SurfaceLineMap;
  limit?: number;
  span?: PanelSpan;
  mdSpan?: 12 | 6;
  /** Before games exist the sample entries make no sense: show the empty wall instead. */
  hideSample?: boolean;
}) {
  const usable = board && !(hideSample && board.placeholder) ? board : null;
  const rows = usable ? topShame(usable.entries, limit) : [];
  return (
    <Panel
      label="Wall of shame"
      labelRight={
        <>
          {usable?.placeholder ? <SampleMark onInk /> : null}
          <BarLink href="/shame">All of it</BarLink>
        </>
      }
      span={span}
      mdSpan={mdSpan}
      pad={rows.length === 0}
    >
      {rows.length === 0 ? (
        <div className="flex flex-col gap-6">
          <DotMatrixFill label="The wall is empty. The first bad decision gets the first entry." rows={5} />
          <div className="flex flex-col gap-2">
            <p className="type-label m-0">What gets you on it</p>
            <ul className="m-0 list-none border-t-2 border-ink p-0">
              {(Object.keys(KIND_RULE) as ShameKind[]).map((k) => (
                <li key={k} className="flex items-center gap-3 border-b border-ink py-2 text-data">
                  <Tag className="w-[4.75rem] justify-center">{KIND_LABEL[k]}</Tag>
                  {KIND_RULE[k]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <DataTable
          caption="Wall of shame, worst first"
          rows={rows}
          rowKey={(e) => e.id}
          mark={(_, i) => (i === 0 ? "alarm" : null)}
          line={(e) => lineOf(lines, e.id)}
          minWidth={500}
          columns={[
            {
              key: "who",
              header: "Who",
              cell: (e) => (
                <span className="flex flex-col">
                  <span className="font-bold">{e.team.managerName}</span>
                  <span className="text-fine font-normal text-ink-muted">{e.team.teamName}</span>
                </span>
              ),
            },
            {
              key: "what",
              header: "What they did",
              className: "w-full",
              cell: (e) => (
                <span className="flex items-center gap-2.5">
                  <Tag>{KIND_LABEL[e.kind]}</Tag>
                  <span>{e.headline}</span>
                </span>
              ),
            },
            { key: "week", header: "Wk", align: "right", hideOnPhone: true, cell: (e) => (e.week ? e.week : "--") },
            { key: "damage", header: "Damage", align: "right", cell: (e) => <span className="whitespace-nowrap font-bold">{damage(e)}</span> },
          ]}
        />
      )}
    </Panel>
  );
}
