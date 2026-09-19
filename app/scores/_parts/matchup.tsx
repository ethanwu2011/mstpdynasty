/** One matchup of the week: the two sides, the win-odds dots, the proof, and the box score. */
import type { ReactNode } from "react";
import { cx } from "@/components/cx";
import { Numeral } from "@/components/Numeral";
import { Panel } from "@/components/Panel";
import { LiveSquare, Tag } from "@/components/Tag";
import { WinDots } from "@/components/WinDots";
import type { MatchupFact, StarterLine, TeamWeekFact, TeamWinProb, WinProb, WinProbWeek, ZeroStarterFact } from "@/lib/types";
import { fmtPts, pct } from "../../_lib/format";

export type GameStatus = "pre" | "live" | "final";

export function gameStatus(wp: WinProb, basis: WinProbWeek["basis"]): GameStatus {
  if (wp.isFinal || basis === "final") return "final";
  if (basis === "live") return "live";
  return "pre";
}

const SLOT: Record<string, string> = {
  FLEX: "Flex",
  SUPER_FLEX: "SF",
  REC_FLEX: "W/T",
  WRRB_FLEX: "W/R",
  IDP_FLEX: "IDP",
};

function slotLabel(slot: string): string {
  return SLOT[slot] ?? slot;
}

const ZERO_REASON: Record<ZeroStarterFact["reason"], string> = {
  bye: "on bye",
  out: "ruled out",
  ir: "on IR",
  inactive: "inactive",
  empty_slot: "an empty slot",
  played_zero: "played and scored zero",
};

/* ------------------------------ one side ------------------------------ */

function Side({
  side,
  fact,
  status,
  align,
  isWinner,
  isLoser,
}: {
  side: TeamWinProb;
  fact?: TeamWeekFact;
  status: GameStatus;
  align: "left" | "right";
  isWinner: boolean;
  isLoser: boolean;
}) {
  const shown = status === "pre" ? side.mean : side.actual;
  const right = align === "right";
  const notes: ReactNode[] = [];
  if (status === "live") notes.push(<span key="proj">Proj {fmtPts(side.mean, 1)}</span>);
  if (fact && status !== "pre") notes.push(<span key="bench">{status === "live" ? "Bench so far" : "Bench left"} {fmtPts(fact.benchPointsLeft)}</span>);
  return (
    <div
      className={cx(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3.5 md:flex md:flex-col md:gap-2 md:py-0",
        right ? "md:items-end md:border-l-2 md:border-ink md:pl-6 md:text-right" : "md:items-start",
      )}
    >
      <div className={cx("flex min-w-0 flex-col", right && "md:items-end")}>
        <p className="m-0 flex max-w-full items-center gap-2">
          <span className={cx("truncate text-lede leading-tight", isWinner ? "font-extrabold" : isLoser ? "font-medium text-ink-muted" : "font-bold")}>
            {side.team.managerName}
          </span>
          {isWinner ? <Tag>W</Tag> : null}
          {fact?.robbed ? <Tag tone="outline" title="Lost with a top-3 score">Robbed</Tag> : null}
          {fact?.fraud ? <Tag tone="outline" title="Won with a bottom-3 score">Fraud</Tag> : null}
        </p>
        <p className="m-0 max-w-full truncate text-fine text-ink-muted">{side.team.teamName}</p>
      </div>
      <div className="row-span-2 self-center md:self-auto">
        <Numeral
          value={shown}
          decimals={2}
          tone={status === "pre" || isLoser ? "muted" : "ink"}
          className="text-d40 md:text-d80 xl:text-d60 min-[1440px]:text-d80"
          label={`${side.team.managerName} ${status === "pre" ? "projected " : ""}${fmtPts(shown)} points`}
        />
      </div>
      {notes.length ? (
        <p className={cx("type-label m-0 flex flex-wrap gap-x-3 gap-y-1 text-ink-muted", right && "md:justify-end")}>{notes}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------ win odds ------------------------------ */

function OddsRow({ a, b, status }: { a: TeamWinProb; b: TeamWinProb; status: GameStatus }) {
  const aPct = pct(a.winProb);
  return (
    <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-2">
      <div className="type-label flex items-center justify-between gap-3 text-ink-muted">
        <span>{status === "final" ? "Result" : status === "live" ? "Win odds right now" : "Win odds before kickoff"}</span>
        <span className="sr-only">
          {a.team.managerName} {aPct} percent, {b.team.managerName} {100 - aPct} percent
        </span>
      </div>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3">
        <Numeral size="d20" value={aPct} className="text-left" label={`${a.team.managerName} ${aPct} percent`} />
        <WinDots aProb={a.winProb} aName={a.team.managerName} bName={b.team.managerName} isFinal={status === "final"} animate />
        <Numeral size="d20" value={100 - aPct} className="text-right" label={`${b.team.managerName} ${100 - aPct} percent`} />
      </div>
    </div>
  );
}

/* ------------------------------ the proof ------------------------------ */

function Proof({ fact, teams }: { fact?: MatchupFact; teams: Array<TeamWeekFact | undefined> }) {
  const lines: Array<{ key: string; label: string; text: ReactNode }> = [];
  const swap = fact?.flipSwap;
  if (swap) {
    lines.push({
      key: "swap",
      label: "The swap",
      text: (
        <>
          <strong>{swap.team.managerName}</strong> had the win on the bench: {swap.benchPlayer.name} ({fmtPts(swap.benchPlayer.points)}) over{" "}
          {swap.starter.name} ({fmtPts(swap.starter.points)}) at {slotLabel(swap.slot)} is worth +{fmtPts(swap.gain)}.
        </>
      ),
    });
  }
  for (const t of teams) {
    for (const z of t?.zeroStarters ?? []) {
      lines.push({
        key: `${t!.team.rosterId}-${z.playerId}-${z.slot}`,
        label: "Zero",
        text: (
          <>
            <strong>{z.team.managerName}</strong> started {z.reason === "empty_slot" ? `nobody at ${slotLabel(z.slot)}` : `${z.name}, ${ZERO_REASON[z.reason]}`}.
          </>
        ),
      });
    }
  }
  if (!lines.length) return null;
  return (
    <ul className="m-0 list-none border-t-2 border-ink p-0">
      {lines.map((l) => (
        <li key={l.key} className="grid grid-cols-[auto_4.5rem_minmax(0,1fr)] items-start gap-x-3 border-b border-ink py-2.5 text-data">
          <LiveSquare size={8} className="mt-1.5 self-start" />
          <span className="type-label pt-[3px]">{l.label}</span>
          <span>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ box score ------------------------------ */

function StatusMark({ s }: { s: StarterLine }) {
  if (s.status === "bye") return <Tag tone="alarm">Bye</Tag>;
  if (s.status === "out") return <Tag tone="alarm">Out</Tag>;
  if (s.status === "empty") return <Tag tone="alarm">Empty</Tag>;
  return null;
}

function starterPoints(s: StarterLine, status: GameStatus): ReactNode {
  if (s.status === "empty") return <span className="text-ink-muted">--</span>;
  if (status === "pre" || s.status === "pre") {
    return (
      <span className="whitespace-nowrap text-ink-muted">
        {fmtPts(s.projected, 1)}
        <span className="sr-only"> projected</span>
      </span>
    );
  }
  return <span className="whitespace-nowrap font-semibold">{fmtPts(s.actual)}</span>;
}

export function BoxScore({ side, fact, status }: { side: TeamWinProb; fact?: TeamWeekFact; status: GameStatus }) {
  const total = status === "pre" ? side.projected : side.actual;
  const mixed = status === "live" && side.starters.some((s) => s.status === "pre");
  return (
    <table className="type-data w-full table-fixed border-collapse">
      <caption className="sr-only">{side.team.managerName}&apos;s starters</caption>
      <colgroup>
        <col className="w-[3rem]" />
        <col />
        <col className="w-[4.25rem]" />
      </colgroup>
      <thead>
        <tr className="bg-ink text-paper">
          <th scope="col" className="type-label px-2 py-2 text-left font-normal">
            Slot
          </th>
          <th scope="col" className="type-label truncate px-2 py-2 text-left font-normal">
            {side.team.managerName}
          </th>
          <th scope="col" className="type-label px-2 py-2 text-right font-normal">
            {status === "pre" ? "Proj" : "Pts"}
          </th>
        </tr>
      </thead>
      <tbody>
        {side.starters.map((s, i) => (
          <tr key={`${s.slot}-${i}`} className={i % 2 ? "bg-paper-shade" : "bg-paper"}>
            <td className="type-label px-2 py-2 text-ink-muted">{slotLabel(s.slot)}</td>
            <th scope="row" className="px-2 py-2 text-left font-normal">
              <span className="flex min-w-0 items-center gap-2">
                {s.status === "live" ? (
                  <>
                    <LiveSquare size={8} />
                    <span className="sr-only">Playing now: </span>
                  </>
                ) : null}
                <span className="truncate font-semibold">{s.status === "empty" ? "Nobody" : s.name}</span>
                {s.status !== "empty" && (s.nflTeam || s.position !== s.slot) ? (
                  <span className="shrink-0 text-fine text-ink-muted">
                    {[s.position !== s.slot ? s.position : null, s.nflTeam].filter(Boolean).join(" ")}
                  </span>
                ) : null}
                <StatusMark s={s} />
              </span>
            </th>
            <td className="px-2 py-2 text-right">{starterPoints(s, status)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-ink">
          <th scope="row" colSpan={2} className="type-label px-2 pb-1 pt-2.5 text-left font-normal">
            {status === "pre" ? "Projected" : mixed ? "So far" : "Total"}
          </th>
          <td className="px-2 pb-1 pt-2.5 text-right font-bold">{fmtPts(total)}</td>
        </tr>
        {fact && status !== "pre" ? (
          <tr>
            <th scope="row" colSpan={2} className="type-label px-2 py-1 text-left font-normal text-ink-muted">
              Best possible lineup
            </th>
            <td className="px-2 py-1 text-right text-ink-muted">{fmtPts(fact.optimalPoints)}</td>
          </tr>
        ) : null}
      </tfoot>
    </table>
  );
}

function PlusGlyph() {
  // A pixel plus that becomes a minus when the box score is open.
  return (
    <svg aria-hidden viewBox="0 0 5 5" width="15" height="15" shapeRendering="crispEdges" className="shrink-0">
      <path fill="currentColor" d="M0 2h5v1H0z" />
      <path fill="currentColor" d="M2 0h1v5H2z" className="group-open:hidden" />
    </svg>
  );
}

/* ------------------------------ the panel ------------------------------ */

export interface MatchupPanelProps {
  wp: WinProb;
  basis: WinProbWeek["basis"];
  facts: Map<number, TeamWeekFact>;
  matchupFact?: MatchupFact;
  /** "Title game", "Playoffs". */
  tag?: string | null;
  /** Two matchups per row from xl (1280) up; full width below that so box scores keep their names. */
  pair: boolean;
}

export function MatchupPanel({ wp, basis, facts, matchupFact, tag, pair }: MatchupPanelProps) {
  const status = gameStatus(wp, basis);
  const a = wp.home;
  const b = wp.away;
  const aFact = facts.get(a.team.rosterId);
  const bFact = facts.get(b.team.rosterId);
  const aWins = status === "final" && a.actual > b.actual;
  const bWins = status === "final" && b.actual > a.actual;
  const statusTag =
    status === "live" ? (
      <Tag tone="paper" square="blink">
        Live
      </Tag>
    ) : status === "final" ? (
      <Tag tone="paper">Final</Tag>
    ) : (
      <span className="text-paper-shade">Projected</span>
    );

  return (
    <Panel
      id={`m${wp.matchupId}`}
      label={`Matchup ${wp.matchupId}`}
      labelRight={
        <>
          {tag ? <span className="hidden text-paper-shade sm:inline">{tag} ·</span> : null}
          {statusTag}
        </>
      }
      span={12}
      className={cx("scroll-mt-4", pair && "xl:col-span-6")}
    >
      <div className="flex flex-1 flex-col gap-5 md:gap-6">
        {tag ? <p className="type-label m-0 -mb-2 sm:hidden">{tag}</p> : null}
        <div className="grid divide-y divide-ink border-y-2 border-ink md:grid-cols-2 md:gap-x-6 md:divide-y-0 md:border-0">
          <Side side={a} fact={aFact} status={status} align="left" isWinner={aWins} isLoser={bWins} />
          <Side side={b} fact={bFact} status={status} align="right" isWinner={bWins} isLoser={aWins} />
        </div>

        <OddsRow a={a} b={b} status={status} />

        <Proof fact={matchupFact} teams={[aFact, bFact]} />

        {/* Phones: the box score folds away so the matchup fits one screen. */}
        <details className="group -mx-4 border-t-2 border-ink md:hidden">
          <summary className="type-label flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 hover:bg-paper-shade [&::-webkit-details-marker]:hidden">
            <span>Box score · {Math.max(a.starters.length, b.starters.length)} starters each</span>
            <PlusGlyph />
          </summary>
          <div className="flex flex-col gap-4 px-4 pb-1 pt-1">
            <BoxScore side={a} fact={aFact} status={status} />
            <BoxScore side={b} fact={bFact} status={status} />
          </div>
        </details>

        {/* Tablets and up: side by side, always open. */}
        <div className="mt-auto hidden grid-cols-2 gap-4 md:grid">
          <BoxScore side={a} fact={aFact} status={status} />
          <BoxScore side={b} fact={bFact} status={status} />
        </div>
      </div>
    </Panel>
  );
}
