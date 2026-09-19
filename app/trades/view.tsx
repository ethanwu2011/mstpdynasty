/**
 * Every trade: the roast (or the plain facts when it has not been roasted yet), both sides with
 * what each got, FantasyCalc value in and out, the net, a grade, and the value split in dots.
 * Formatting only: every number comes from a TradeFact as given.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { DataTable } from "@/components/DataTable";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Numeral } from "@/components/Numeral";
import { Board, Panel, type PanelSpan } from "@/components/Panel";
import { Receipt, RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { SampleMark, Tag } from "@/components/Tag";
import { Button } from "@/components/Button";
import { formatEt } from "@/lib/time";
import type { LetterGrade, PickAsset, PlayerAsset, Roast, SeasonPhase, TradeFact, TradeSide } from "@/lib/types";
import { fmtInt, fmtSigned } from "../_lib/format";
import { roastAnchor, roastToBlock } from "../_lib/roast-view";

export interface TradeItem {
  /** The facts the roast was written from when there is a roast, else today's facts. */
  fact: TradeFact;
  roast: Roast | null;
  placeholder: boolean;
}

export interface TradeRules {
  deadlineWeek: number | null;
  reviewDays: number | null;
  pickTrading: boolean | null;
  faabBudget: number | null;
}

export interface TradesViewProps {
  trades: TradeItem[];
  waiverRoasts: Roast[];
  managers: Array<{ key: string; name: string; teamName: string }>;
  rules: TradeRules;
  phase: SeasonPhase;
  season: string;
  /** Trade facts did not load (roasted trades may still show). */
  factsFailed: boolean;
}

export function tradeAnchor(transactionId: string): string {
  return `trade-${transactionId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

const shortDate = (ms: number) => formatEt(ms, { month: "short", day: "numeric" });

/* ------------------------------ headline ------------------------------ */

/** Sides ordered the way the roast reads: the side that lost value first. */
function bySide(f: TradeFact): TradeSide[] {
  return [...f.sides].sort((a, b) => a.net - b.net);
}

function factsText(f: TradeFact): string {
  const lines = bySide(f).map(
    (s) => `${s.team.managerName} got ${fmtInt(s.valueIn)} in FantasyCalc value for ${fmtInt(s.valueOut)} (${s.grade}).`,
  );
  const winner = f.sides.find((s) => s.team.rosterId === f.winnerRosterId);
  lines.push(winner ? `${winner.team.managerName} wins it by ${fmtInt(f.valueGap)}.` : `Called fair: ${fmtInt(f.valueGap)} apart.`);
  return lines.join(" ");
}

function headline(item: TradeItem): RoastBlockData {
  const { fact: f, roast } = item;
  if (roast) return { ...roastToBlock(roast), receipt: undefined };
  const tags = item.placeholder ? <SampleMark /> : <Tag tone="outline">Facts only</Tag>;
  const sides = bySide(f);
  const loser = sides[0];
  const fair = f.winnerRosterId === null || !loser;
  return {
    kicker: `Trade · Week ${f.week}`,
    victim: fair ? sides.map((s) => s.team.managerName).join(" & ") : loser.team.managerName,
    stat: fair ? `${fmtInt(f.valueGap)} value apart` : `${fmtSigned(loser.net)} value`,
    text: factsText(f),
    at: f.createdAt,
    href: `/trades#${tradeAnchor(f.transactionId)}`,
    byline: "the numbers",
    tags,
  };
}

/* ------------------------------ sides ------------------------------ */

function GradeTile({ grade, tone }: { grade: LetterGrade; tone: "won" | "lost" | "fair" }) {
  return (
    <span
      className={cx(
        "type-display grid size-16 shrink-0 place-items-center border-2 text-j3 leading-none",
        tone === "lost"
          ? "border-red bg-red text-on-red"
          : tone === "won"
            ? "border-ink bg-ink text-paper"
            : "border-ink bg-paper text-ink",
      )}
      aria-label={`Grade ${grade}`}
    >
      <span aria-hidden className="translate-y-[2px]">
        {grade}
      </span>
    </span>
  );
}

function AssetValue({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-fine text-ink-muted">Unranked</span>
  ) : (
    <span className="font-semibold">{fmtInt(value)}</span>
  );
}

function PlayerLine({ p }: { p: PlayerAsset }) {
  const meta = [p.position, p.nflTeam, p.age ? `${Math.floor(p.age)}` : null].filter(Boolean).join(" · ");
  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="font-semibold">{p.name}</span> <span className="whitespace-nowrap text-fine text-ink-muted">{meta}</span>
      </span>
      <AssetValue value={p.value} />
    </li>
  );
}

function PickLine({ p }: { p: PickAsset }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="type-label mr-2 border border-ink px-1 py-px align-[1px]">Pick</span>
        <span className="font-semibold">{p.label}</span>
      </span>
      <AssetValue value={p.value} />
    </li>
  );
}

function SideColumn({ side, tone }: { side: TradeSide; tone: "won" | "lost" | "fair" }) {
  const got = side.playersIn.length + side.picksIn.length + (side.faabIn ? 1 : 0);
  return (
    <div className="flex min-w-0 flex-col gap-4 bg-paper px-4 py-5 md:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2">
            <span className="truncate text-lede font-bold leading-tight">{side.team.managerName}</span>
          </p>
          <p className="m-0 truncate text-fine text-ink-muted">{side.team.teamName}</p>
          <p className="m-0 mt-2">
            {tone === "lost" ? (
              <Tag tone="alarm">Lost the trade</Tag>
            ) : tone === "won" ? (
              <Tag>Won the trade</Tag>
            ) : (
              <Tag tone="outline">Fair</Tag>
            )}
          </p>
        </div>
        <GradeTile grade={side.grade} tone={tone} />
      </div>

      <div className="flex flex-col gap-1">
        <p className="type-label m-0 text-ink-muted">Got</p>
        {got ? (
          <ul className="m-0 list-none p-0 text-data">
            {side.playersIn.map((p) => (
              <PlayerLine key={p.playerId} p={p} />
            ))}
            {side.picksIn.map((p) => (
              <PickLine key={`${p.season}-${p.round}-${p.originalRosterId}`} p={p} />
            ))}
            {side.faabIn ? (
              <li className="flex items-baseline justify-between gap-3 py-1">
                <span className="font-semibold">${fmtInt(side.faabIn)} FAAB</span>
                <span className="text-fine text-ink-muted">No value</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="m-0 text-data text-ink-muted">Nothing</p>
        )}
      </div>

      <dl className="m-0 mt-auto grid grid-cols-[1fr_1fr_auto] items-end gap-x-4 border-t-2 border-ink pt-3">
        <div>
          <dt className="type-label text-ink-muted">Value in</dt>
          <dd className="m-0 font-semibold">{fmtInt(side.valueIn)}</dd>
        </div>
        <div>
          <dt className="type-label text-ink-muted">Value out</dt>
          <dd className="m-0 font-semibold">{fmtInt(side.valueOut)}</dd>
        </div>
        <div className="text-right">
          <dt className="type-label text-ink-muted">Net</dt>
          <dd className="m-0">
            <Numeral value={side.net} sign size="d30" label={`Net ${fmtSigned(side.net)} value`} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Forty cells (2.5% each) split by each side's share of the value that changed hands. */
const SPLIT_CELLS = 40;

function ValueSplit({ a, b }: { a: TradeSide; b: TradeSide }) {
  const total = a.valueIn + b.valueIn;
  if (total <= 0) return null;
  const aPct = Math.round((a.valueIn / total) * 100);
  const filled = Math.round((a.valueIn / total) * SPLIT_CELLS);
  return (
    <div className="flex flex-col gap-2 bg-paper px-4 py-4 md:px-6">
      <div className="type-label flex items-center justify-between gap-3">
        <span>
          {a.team.managerName} {aPct}%
        </span>
        <span className="hidden text-ink-muted sm:inline">Share of the value</span>
        <span>
          {100 - aPct}% {b.team.managerName}
        </span>
      </div>
      <div
        role="img"
        aria-label={`Share of the value: ${a.team.managerName} got ${aPct} percent, ${b.team.managerName} ${100 - aPct} percent`}
        className="grid w-full gap-[2px] sm:gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${SPLIT_CELLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: SPLIT_CELLS }, (_, i) => (
          <span key={i} className={cx("block aspect-square", i < filled ? "bg-ink" : "border border-ink sm:border-2")} />
        ))}
      </div>
    </div>
  );
}

function Sides({ f }: { f: TradeFact }) {
  const sides = bySide(f);
  const tone = (s: TradeSide): "won" | "lost" | "fair" =>
    f.winnerRosterId === null ? "fair" : s.team.rosterId === f.winnerRosterId ? "won" : s.net < 0 ? "lost" : "fair";
  return (
    <div className="flex flex-col gap-[2px] bg-ink">
      <div
        className={cx("grid gap-[2px]", sides.length === 2 ? "sm:grid-cols-2" : sides.length > 2 ? "sm:grid-cols-2 xl:grid-cols-3" : "")}
      >
        {sides.map((s) => (
          <SideColumn key={s.team.rosterId} side={s} tone={tone(s)} />
        ))}
      </div>
      {sides.length === 2 ? <ValueSplit a={sides[0]} b={sides[1]} /> : null}
    </div>
  );
}

/* ------------------------------ one trade ------------------------------ */

function TradePanel({ item, lead = false, span = 12 }: { item: TradeItem; lead?: boolean; span?: PanelSpan }) {
  const f = item.fact;
  const block = headline(item);
  return (
    <Panel
      id={tradeAnchor(f.transactionId)}
      label={lead ? "The latest trade" : `Trade · Week ${f.week}`}
      labelRight={
        <span className="text-paper-shade">
          {lead ? `Week ${f.week} · ` : ""}
          {shortDate(f.createdAt)}
        </span>
      }
      span={span}
      pad={false}
      className="scroll-mt-4"
    >
      <div className={cx("grid flex-1 gap-[2px] bg-ink", !lead && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
        <div className="flex bg-paper px-4 pb-5 pt-6 md:px-6 md:pt-8">
          <RoastBlock {...block} size={lead ? "hero" : "compact"} animate={lead} headingLevel={3} />
        </div>
        <Sides f={f} />
      </div>
    </Panel>
  );
}

/* ------------------------------ balance ------------------------------ */

interface BalanceRow {
  key: string;
  name: string;
  teamName: string;
  trades: number;
  net: number;
}

function balance(trades: TradeItem[]): BalanceRow[] {
  const map = new Map<string, BalanceRow>();
  for (const { fact } of trades) {
    for (const s of fact.sides) {
      const row = map.get(s.team.managerKey) ?? {
        key: s.team.managerKey,
        name: s.team.managerName,
        teamName: s.team.teamName,
        trades: 0,
        net: 0,
      };
      row.trades += 1;
      row.net += s.net;
      map.set(row.key, row);
    }
  }
  return [...map.values()].sort((a, b) => a.net - b.net || a.name.localeCompare(b.name));
}

function BalancePanel({
  trades,
  managers,
  placeholder,
  factsFailed,
}: {
  trades: TradeItem[];
  managers: TradesViewProps["managers"];
  placeholder: boolean;
  factsFailed: boolean;
}) {
  const rows = balance(trades);
  const idle = managers
    .filter((m) => !rows.some((r) => r.key === m.key))
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b));
  const best = rows[rows.length - 1];
  return (
    <Panel
      label="Trade balance"
      labelRight={placeholder ? <SampleMark onInk /> : <span className="text-paper-shade">Net value</span>}
      span={4}
      pad={false}
    >
      <DataTable
        caption="Net FantasyCalc value from every trade, worst first"
        rows={rows}
        rowKey={(r) => r.key}
        dense
        minWidth={0}
        mark={(r) => (r === rows[0] && r.net < 0 ? "alarm" : best && r === best && r.net > 0 ? "leader" : null)}
        columns={[
          {
            key: "who",
            header: "Who",
            className: "w-full",
            cell: (r) => (
              <span className="flex min-w-0 flex-col">
                <span className="font-bold">{r.name}</span>
                <span className="block max-w-[11rem] truncate text-fine font-normal text-ink-muted">{r.teamName}</span>
              </span>
            ),
          },
          { key: "n", header: "Trades", align: "right", cell: (r) => <span className="tnum">{r.trades}</span> },
          {
            key: "net",
            header: "Net",
            align: "right",
            cell: (r) => <span className="whitespace-nowrap font-bold">{fmtSigned(r.net)}</span>,
          },
        ]}
      />
      <div className="flex flex-col gap-2 border-t border-ink px-4 py-4 text-fine text-ink-muted md:px-6 lg:px-4 xl:px-6">
        <p className="m-0">
          Every trade&apos;s FantasyCalc value in minus value out, added up. The top of the table is paying for everyone else.
        </p>
        {idle.length ? <p className="m-0">Not one trade yet: {idle.join(", ")}.</p> : null}
        {factsFailed ? <p className="m-0 text-ink">Live values did not load. These are the numbers each trade was roasted on.</p> : null}
      </div>
    </Panel>
  );
}

/* ------------------------------ rules ------------------------------ */

function rulesItems(r: TradeRules) {
  return [
    { label: "Deadline", value: r.deadlineWeek ? `Week ${r.deadlineWeek}` : "None" },
    {
      label: "Review",
      value: r.reviewDays === null ? "--" : r.reviewDays === 0 ? "Instant" : `${r.reviewDays} ${r.reviewDays === 1 ? "day" : "days"}`,
    },
    { label: "Pick trading", value: r.pickTrading === null ? "--" : r.pickTrading ? "On" : "Off" },
    { label: "FAAB", value: r.faabBudget ? `$${fmtInt(r.faabBudget)}` : "None" },
  ];
}

/** The rules as a 2 by 2 box score, for narrow panels. */
function RulesGrid({ rules }: { rules: TradeRules }) {
  return (
    <dl className="m-0 grid grid-cols-2 border-y-2 border-ink">
      {rulesItems(rules).map((r, i) => (
        <div
          key={r.label}
          className={cx("flex flex-col gap-1 px-3 py-3", i % 2 === 1 && "border-l border-ink", i >= 2 && "border-t border-ink")}
        >
          <dt className="type-label text-ink-muted">{r.label}</dt>
          <dd className="type-display m-0 text-j2">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function GradingNote() {
  return (
    <p className="measure m-0 text-data text-ink-muted">
      Each side is graded on the FantasyCalc dynasty value it got back against the value it gave up. Unranked players count for nothing and
      say so. The side that gives value away takes the roast and a spot on the{" "}
      <Link href="/shame?kind=trades#ledger" className="link-ink text-ink">
        Wall of Shame
      </Link>
      .
    </p>
  );
}

function RulesPanel({ rules, span = 12 }: { rules: TradeRules; span?: PanelSpan }) {
  return (
    <Panel label="How trades get graded" span={span}>
      <div className="flex flex-col gap-5">
        <GradingNote />
        <Receipt items={rulesItems(rules)} />
      </div>
    </Panel>
  );
}

/* ------------------------------ waivers ------------------------------ */

function WaiverPanel({ roasts }: { roasts: Roast[] }) {
  if (!roasts.length) return null;
  return (
    <Panel label="Waiver wire, roasted" labelRight={<span className="text-paper-shade">Latest {roasts.length}</span>} pad={false}>
      <div className={cx("grid flex-1 grid-cols-1 gap-[2px] bg-ink", roasts.length > 1 && "md:grid-cols-2")}>
        {roasts.map((r, i) => (
          <div
            key={r.id}
            id={roastAnchor(r)}
            className={cx(
              "flex scroll-mt-4 bg-paper px-4 pb-5 pt-6 md:px-6",
              roasts.length % 2 === 1 && i === roasts.length - 1 && "md:col-span-2",
            )}
          >
            <RoastBlock {...roastToBlock(r)} size="compact" headingLevel={3} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------ empty and failed ------------------------------ */

function EmptyLead({ phase, failed, children }: { phase: SeasonPhase; failed: boolean; children?: ReactNode }) {
  const head = failed ? ["Trades did not load"] : ["No trades", "Yet"];
  const line = failed
    ? "Sleeper or FantasyCalc did not answer, so the trade ledger is blank for a minute. Nobody's bad trade got erased."
    : phase === "pre_draft" || phase === "drafting"
      ? "Nobody has traded yet. When somebody does, both sides get graded on FantasyCalc dynasty value and roasted within minutes of the trade going through."
      : "Not one trade this season. Ten managers, zero nerve. The first one gets graded on FantasyCalc value and roasted within minutes.";
  return (
    <article className="flex flex-1 flex-col gap-6 md:gap-7">
      <p className="type-label m-0">Trade ledger</p>
      <h3 className="type-display m-0 text-j3 md:text-j4 xl:text-j5">
        {head.map((h) => (
          <span key={h} className="board-wipe block">
            {h}
          </span>
        ))}
      </h3>
      <p className="measure m-0 text-body md:text-lede">{line}</p>
      <DotMatrixFill label={failed ? "No signal." : "The ledger is empty."} rows={5} density={failed ? 0.3 : 0.55} />
      {children}
    </article>
  );
}

/* ------------------------------ page ------------------------------ */

export function TradesView({ trades, waiverRoasts, managers, rules, phase, factsFailed }: TradesViewProps) {
  const placeholder = trades.some((t) => t.placeholder);

  if (!trades.length) {
    return (
      <Board>
        <Panel label="The latest trade" labelRight={<span className="text-paper-shade">None yet</span>} span={8}>
          <EmptyLead phase={phase} failed={factsFailed}>
            {factsFailed ? (
              <div>
                <Button href="/trades" variant="primary">
                  Try again
                </Button>
              </div>
            ) : null}
          </EmptyLead>
        </Panel>
        <Panel label="Trade rules" labelRight={<span className="text-paper-shade">From Sleeper</span>} span={4}>
          <div className="flex flex-1 flex-col gap-6">
            <RulesGrid rules={rules} />
            <GradingNote />
          </div>
        </Panel>
        <WaiverPanel roasts={waiverRoasts} />
      </Board>
    );
  }

  const [latest, ...rest] = trades;
  return (
    <Board>
      <TradePanel item={latest} lead span={8} />
      <BalancePanel trades={trades} managers={managers} placeholder={placeholder} factsFailed={factsFailed} />
      {rest.map((t) => (
        <TradePanel key={t.fact.transactionId} item={t} />
      ))}
      <WaiverPanel roasts={waiverRoasts} />
      <RulesPanel rules={rules} />
    </Board>
  );
}
