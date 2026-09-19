/**
 * Every trade, judged in hindsight: what was written about it (or the plain facts), both sides
 * with what each got, FantasyCalc value at the time against value now, a grade, and the value
 * over time in dots. Plus the worst trades in league history. Formatting only: every number
 * comes from a TradeFact or a TradeHindsight as given.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { DataTable } from "@/components/DataTable";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Numeral } from "@/components/Numeral";
import { Board, Panel, type PanelSpan } from "@/components/Panel";
import { Receipt, RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { lineOf } from "@/components/RowLine";
import { LiveSquare, SampleMark, Tag } from "@/components/Tag";
import { Button } from "@/components/Button";
import { TeamSub } from "@/components/TeamSub";
import { formatEt } from "@/lib/time";
import type {
  LetterGrade,
  PickAsset,
  PlayerAsset,
  Roast,
  SeasonPhase,
  SurfaceLineMap,
  TradeFact,
  TradeHindsight,
  TradeHindsightSide,
  TradeSide,
} from "@/lib/types";
import { fmtInt, fmtSigned } from "../_lib/format";
import { roastAnchor, roastToBlock, shortDay } from "../_lib/roast-view";
import { ValueDots } from "./value-dots";

export interface TradeItem {
  /** The facts the text was written from when there is one, else today's facts. */
  fact: TradeFact;
  roast: Roast | null;
  placeholder: boolean;
  /** Value at the time against value now, from the daily FantasyCalc snapshots. */
  hindsight: TradeHindsight | null;
  /** The trade's one-liner (the trades surface), when there is one. */
  line: string | null;
}

export interface TradeRules {
  deadlineWeek: number | null;
  reviewDays: number | null;
  pickTrading: boolean | null;
  faabBudget: number | null;
}

export interface TradesViewProps {
  trades: TradeItem[];
  /** The worst trades in league history, most value lost first. */
  worst: TradeHindsight[];
  /** Trade one-liners by transaction id, for the leaderboard. */
  lines: SurfaceLineMap;
  /** First stored FantasyCalc day: history starts there. */
  historyFrom: string | null;
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

const dayOf = (date: string) => formatEt(Date.parse(`${date}T12:00:00Z`), { month: "short", day: "numeric", year: "numeric" });

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
  if (roast) return { ...roastToBlock(roast), receipt: undefined, lede: item.line };
  const tags = item.placeholder ? <SampleMark /> : null;
  const sides = bySide(f);
  const loser = sides[0];
  const fair = f.winnerRosterId === null || !loser;
  return {
    event: `Trade, ${shortDay(f.createdAt)}`,
    kicker: `Week ${f.week}`,
    victim: fair ? sides.map((s) => s.team.managerName).join(" & ") : loser.team.managerName,
    stat: fair ? `${fmtInt(f.valueGap)} value apart` : `${fmtSigned(loser.net)} value`,
    lede: item.line,
    text: factsText(f),
    at: f.createdAt,
    href: `/trades#${tradeAnchor(f.transactionId)}`,
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

function SideColumn({ side, hs, tone }: { side: TradeSide; hs: TradeHindsightSide | null; tone: "won" | "lost" | "fair" }) {
  const got = side.playersIn.length + side.picksIn.length + (side.faabIn ? 1 : 0);
  // Assets are shown at today's value when hindsight has it, else as the facts gave them.
  const playersIn = hs?.playersIn ?? side.playersIn;
  const picksIn = hs?.picksIn ?? side.picksIn;
  const grade = hs?.gradeNow ?? side.grade;
  const valueIn = hs?.valueInNow ?? side.valueIn;
  const valueOut = hs?.valueOutNow ?? side.valueOut;
  const net = hs?.netNow ?? side.net;
  return (
    <div className="flex min-w-0 flex-col gap-4 bg-paper px-4 py-5 md:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2">
            <span className="truncate text-lede font-bold leading-tight">{side.team.managerName}</span>
          </p>
          <TeamSub as="p" team={side.team.teamName} manager={side.team.managerName} className="m-0 truncate text-fine text-ink-muted" />
          <p className="m-0 mt-2">
            {tone === "lost" ? (
              <Tag tone="alarm">Losing it</Tag>
            ) : tone === "won" ? (
              <Tag>Winning it</Tag>
            ) : (
              <Tag tone="outline">Even</Tag>
            )}
          </p>
        </div>
        <GradeTile grade={grade} tone={tone} />
      </div>

      <div className="flex flex-col gap-1">
        <p className="type-label m-0 text-ink-muted">Got</p>
        {got ? (
          <ul className="m-0 list-none p-0 text-data">
            {playersIn.map((p) => (
              <PlayerLine key={p.playerId} p={p} />
            ))}
            {picksIn.map((p) => (
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
          <dt className="type-label text-ink-muted">{hs ? "In, now" : "Value in"}</dt>
          <dd className="m-0 font-semibold">{fmtInt(valueIn)}</dd>
        </div>
        <div>
          <dt className="type-label text-ink-muted">{hs ? "Out, now" : "Value out"}</dt>
          <dd className="m-0 font-semibold">{fmtInt(valueOut)}</dd>
        </div>
        <div className="text-right">
          <dt className="type-label text-ink-muted">Net</dt>
          <dd className="m-0">
            <Numeral value={net} sign size="d30" tone={net < 0 && tone === "lost" ? "red" : "ink"} label={`Net ${fmtSigned(net)} value`} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function toneOf(f: TradeFact, h: TradeHindsight | null, s: TradeSide): "won" | "lost" | "fair" {
  if (h) {
    if (h.winnerNowRosterId === s.team.rosterId) return "won";
    if (h.loserNowRosterId === s.team.rosterId && h.winnerNowRosterId !== null) return "lost";
    return "fair";
  }
  return f.winnerRosterId === null ? "fair" : s.team.rosterId === f.winnerRosterId ? "won" : s.net < 0 ? "lost" : "fair";
}

/** At the time against now, per side, and the value over time in dots for the side furthest behind. */
function Hindsight({ h, historyFrom }: { h: TradeHindsight; historyFrom: string | null }) {
  const sides = [...h.sides].sort((a, b) => a.netNow - b.netNow);
  const behind = sides[0];
  return (
    <section aria-label="Then and now" className="flex flex-col gap-4 bg-paper px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="type-label m-0">Then and now</h4>
        <span className="text-fine text-ink-muted">
          {h.thenDate ? `At the time: FantasyCalc on ${dayOf(h.thenDate)}` : `At the time: not recorded. History starts ${historyFrom ? dayOf(historyFrom) : "with the first stored day"}.`}
        </span>
      </div>
      <dl className="m-0 border-t-2 border-ink">
        {sides.map((s) => (
          <div key={s.team.rosterId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 border-b border-ink py-2.5">
            <dt className="flex min-w-0 items-center gap-2 font-bold">
              {h.loserNowRosterId === s.team.rosterId && h.valueLost > 0 ? <LiveSquare size={8} /> : null}
              <span className="truncate">{s.team.managerName}</span>
            </dt>
            <dd className="m-0 text-right text-data">
              <span className="text-ink-muted">Then </span>
              {s.netThen === null ? <span className="text-ink-muted">--</span> : <span className="font-semibold">{fmtSigned(s.netThen)}</span>}
            </dd>
            <dd className="m-0 text-right text-data">
              <span className="text-ink-muted">Now </span>
              <span className="font-bold">{fmtSigned(s.netNow)}</span>
            </dd>
          </div>
        ))}
      </dl>
      {behind && behind.series.length ? <ValueDots series={behind.series} name={behind.team.managerName} /> : null}
      {behind && behind.series.length ? (
        <p className="m-0 text-fine text-ink-muted">
          {behind.team.managerName}&apos;s net value, one column per day. Above the line is ahead, below it is behind.
        </p>
      ) : null}
    </section>
  );
}

function Sides({ f, h, historyFrom }: { f: TradeFact; h: TradeHindsight | null; historyFrom: string | null }) {
  const sides = bySide(f);
  const hsFor = (s: TradeSide) => h?.sides.find((x) => x.team.rosterId === s.team.rosterId) ?? null;
  return (
    <div className="flex flex-col gap-[2px] bg-ink">
      <div className={cx("grid gap-[2px]", sides.length === 2 ? "sm:grid-cols-2" : sides.length > 2 ? "sm:grid-cols-2 xl:grid-cols-3" : "")}>
        {sides.map((s) => (
          <SideColumn key={s.team.rosterId} side={s} hs={hsFor(s)} tone={toneOf(f, h, s)} />
        ))}
      </div>
      {h ? <Hindsight h={h} historyFrom={historyFrom} /> : null}
    </div>
  );
}

/* ------------------------------ one trade ------------------------------ */

function TradePanel({ item, lead = false, span = 12, historyFrom }: { item: TradeItem; lead?: boolean; span?: PanelSpan; historyFrom: string | null }) {
  const f = item.fact;
  const block = headline(item);
  return (
    <Panel
      id={tradeAnchor(f.transactionId)}
      label={block.event ?? `Trade, ${shortDay(f.createdAt)}`}
      labelRight={<span className="text-paper-shade">{lead ? "Latest" : `Week ${f.week}`}</span>}
      span={span}
      pad={false}
      className="scroll-mt-4"
    >
      <div className={cx("grid flex-1 gap-[2px] bg-ink", !lead && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
        <div className="flex bg-paper px-4 pb-5 pt-6 md:px-6 md:pt-8">
          <RoastBlock {...block} eventInPanel size={lead ? "hero" : "compact"} animate={lead} headingLevel={3} />
        </div>
        <Sides f={f} h={item.hindsight} historyFrom={historyFrom} />
      </div>
    </Panel>
  );
}

/* ------------------------------ worst trades ------------------------------ */

function WorstTradesPanel({ worst, lines, span = 4 }: { worst: TradeHindsight[]; lines: SurfaceLineMap; span?: PanelSpan }) {
  return (
    <Panel label="Worst trades ever" labelRight={<span className="text-paper-shade">Value lost</span>} span={span} pad={false}>
      {worst.length ? (
        <DataTable
          caption="Worst trades in league history, most value lost as of today"
          rows={worst}
          rowKey={(t) => t.transactionId}
          dense
          minWidth={0}
          mark={(_, i) => (i === 0 ? "alarm" : null)}
          line={(t) => lineOf(lines, t.transactionId)}
          columns={[
            {
              key: "who",
              header: "Who",
              className: "w-full whitespace-normal",
              cell: (t) => {
                const loser = t.sides.find((s) => s.team.rosterId === t.loserNowRosterId);
                const winner = t.sides.find((s) => s.team.rosterId === t.winnerNowRosterId) ?? t.sides.find((s) => s !== loser);
                return (
                  <a href={`#${tradeAnchor(t.transactionId)}`} className="flex min-w-0 flex-col no-underline hover:underline">
                    <span className="font-bold">{loser?.team.managerName ?? "--"}</span>
                    <span className="text-fine font-normal text-ink-muted">
                      {winner ? `To ${winner.team.managerName}, ` : ""}
                      {formatEt(t.createdAt, { month: "short", day: "numeric" })}
                    </span>
                  </a>
                );
              },
            },
            {
              key: "lost",
              header: "Lost",
              align: "right",
              cell: (t) => (
                <span className="flex flex-col items-end">
                  <span className="type-display text-j2 leading-none">{fmtInt(t.valueLost)}</span>
                  {t.lostSinceTrade !== null && t.lostSinceTrade !== 0 ? (
                    <span className="whitespace-nowrap text-fine font-normal text-ink-muted">
                      {t.lostSinceTrade > 0 ? `${fmtInt(t.lostSinceTrade)} since` : `${fmtInt(-t.lostSinceTrade)} back since`}
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      ) : (
        <div className="flex flex-col gap-4 px-4 pb-6 pt-6 md:px-6">
          <p className="m-0 text-body">Nobody is behind on a trade yet. The first side that falls behind by today&apos;s values goes on this list.</p>
        </div>
      )}
      <p className="m-0 mt-auto border-t border-ink px-4 py-3 text-fine text-ink-muted md:px-6 lg:px-4 xl:px-6">
        Ranked by what the losing side gave away, valued by FantasyCalc today. It moves every day.
      </p>
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
                <TeamSub team={r.teamName} manager={r.name} className="block max-w-[11rem] truncate text-fine font-normal text-ink-muted" />
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
        {factsFailed ? <p className="m-0 text-ink">Live values did not load. These are the numbers from when each trade went through.</p> : null}
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
      Each side is graded on the FantasyCalc dynasty value it got back against the value it gave up, at the time and again every day since.
      A player FantasyCalc does not rank counts as zero. The side that gives value away gets a spot on the{" "}
      <Link href="/shame?kind=trades#ledger" className="link-ink text-ink">
        Wall of Shame
      </Link>
      .
    </p>
  );
}

function RulesPanel({ rules, span = 8 }: { rules: TradeRules; span?: PanelSpan }) {
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
    <Panel label="Waiver wire" labelRight={<span className="text-paper-shade">Latest {roasts.length}</span>} pad={false}>
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
  const head = failed ? ["Trades did not load"] : ["No trades"];
  const line = failed
    ? "Sleeper or FantasyCalc did not answer, so the trade ledger is blank for a minute. Nobody's bad trade got erased."
    : phase === "pre_draft" || phase === "drafting"
      ? "Nobody has traded yet. Every trade gets both sides valued on FantasyCalc when it goes through and again every day after."
      : "Not one trade this season. Ten managers, zero nerve. The first one gets graded on FantasyCalc value within minutes and tracked every day after.";
  return (
    <article className="flex flex-1 flex-col gap-6 md:gap-7">
      <h3 className="type-display m-0 text-j3 md:text-j4 xl:text-j5">
        {head.map((h) => (
          <span key={h} className="board-wipe block">
            {h}
          </span>
        ))}
      </h3>
      <p className="measure m-0 text-body md:text-lede">{line}</p>
      <DotMatrixFill label={failed ? "Sleeper or FantasyCalc did not answer." : "The ledger is empty."} rows={5} density={failed ? 0.3 : 0.55} />
      {children}
    </article>
  );
}

/* ------------------------------ page ------------------------------ */

export function TradesView({ trades, worst, lines, historyFrom, waiverRoasts, managers, rules, phase, factsFailed }: TradesViewProps) {
  const placeholder = trades.some((t) => t.placeholder);

  if (!trades.length) {
    return (
      <Board>
        <Panel label="Trades" labelRight={<span className="text-paper-shade">None yet</span>} span={8}>
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
      <TradePanel item={latest} lead span={8} historyFrom={historyFrom} />
      <WorstTradesPanel worst={worst} lines={lines} span={4} />
      {rest.map((t) => (
        <TradePanel key={t.fact.transactionId} item={t} historyFrom={historyFrom} />
      ))}
      <BalancePanel trades={trades} managers={managers} placeholder={placeholder} factsFailed={factsFailed} />
      <RulesPanel rules={rules} span={8} />
      <WaiverPanel roasts={waiverRoasts} />
    </Board>
  );
}
