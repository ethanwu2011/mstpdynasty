/**
 * The startup draft board: rounds by draft slots on a desktop, a per-round list with a sticky
 * round bar on a phone. Every made pick opens its roast in a popover card (tap or click, never
 * hover), so the proof is one tap away on any screen.
 */
import Link from "next/link";
import type { CSSProperties } from "react";
import { PixelArrow } from "@/components/Button";
import { cx } from "@/components/cx";
import { LiveSquare, Tag } from "@/components/Tag";
import type { DraftPickFact } from "@/lib/types";
import { fmtInt } from "../../_lib/format";
import { cardData, type PickCardData } from "./card";
import { CARD_ID, PickCardHost } from "./PickCardHost";
import type { BoardCell, BoardColumn, BoardModel, BoardRound } from "./model";
import { splitName } from "./model";
import s from "./board.module.css";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* ------------------------------ small pieces ------------------------------ */

/** Red square = reach, ink square = steal, with the spots. */
export function Verdict({ pick, compact = false, className }: { pick: DraftPickFact; compact?: boolean; className?: string }) {
  const spots = pick.reach === null ? null : Math.abs(pick.reach);
  if (pick.verdict !== "reach" && pick.verdict !== "steal") return null;
  const reach = pick.verdict === "reach";
  return (
    <span className={cx("type-label inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap", className)}>
      {reach ? <LiveSquare size={8} /> : <span aria-hidden className="inline-block size-2 shrink-0 bg-ink" />}
      <span aria-hidden>{compact ? (spots !== null ? fmtInt(spots) : "") : `${reach ? "Reach" : "Steal"}${spots !== null ? ` ${fmtInt(spots)}` : ""}`}</span>
      <span className="sr-only">{verdictText(pick)}</span>
    </span>
  );
}

export function verdictText(pick: DraftPickFact): string {
  const spots = pick.reach === null ? null : Math.abs(pick.reach);
  if (pick.verdict === "reach") return spots !== null ? `Reach, taken ${spots} spots ahead of FantasyCalc` : "Reach";
  if (pick.verdict === "steal") return spots !== null ? `Steal, taken ${spots} spots after FantasyCalc` : "Steal";
  if (pick.verdict === "unranked") return "Not ranked by FantasyCalc";
  return "Taken about where FantasyCalc ranks him";
}

function Direction({ forward, className }: { forward: boolean; className?: string }) {
  return <PixelArrow className={cx(!forward && "rotate-180", className)} />;
}

/* ------------------------------ team header (lg) ------------------------------ */

function TeamHead({ columns }: { columns: BoardColumn[] }) {
  return (
    <nav aria-label="Teams in draft order" className={cx(s.head, "on-ink")}>
      <div aria-hidden className="bg-ink" />
      {columns.map((c) =>
        c.rosterId !== null ? (
          <Link
            key={c.slot}
            href={`/teams/${c.rosterId}`}
            className="group flex min-w-0 flex-col gap-1 bg-ink px-2 pb-2 pt-2.5 text-paper no-underline hover:bg-paper hover:text-ink focus-visible:outline-offset-[-4px]"
          >
            <span className="type-label text-paper-shade group-hover:text-ink-muted">Slot {c.slot}</span>
            <span className="type-label truncate text-[1rem] leading-tight">{c.manager}</span>
            <span className="truncate text-fine text-paper-shade group-hover:text-ink-muted">{c.teamName}</span>
          </Link>
        ) : (
          <div key={c.slot} className="flex min-w-0 flex-col gap-1 bg-ink px-2 pb-2 pt-2.5 text-paper">
            <span className="type-label text-paper-shade">Slot {c.slot}</span>
            <span className="type-label truncate text-[1rem] leading-tight">Open</span>
            <span className="truncate text-fine text-paper-shade">Order not set</span>
          </div>
        ),
      )}
    </nav>
  );
}

/* ------------------------------ round header ------------------------------ */

function RoundHead({ r, teams }: { r: BoardRound; teams: number }) {
  const clock = r.cells.some((c) => c.state === "clock");
  const status = r.made === teams ? "Done" : clock ? "On the clock" : r.made > 0 ? `${r.made} of ${teams}` : null;
  const first = r.cells[0]?.ownerName ?? null;
  const said = [
    `Round ${r.round}`,
    first ? `${first} picks first, from slot ${r.forward ? 1 : teams}` : `slot ${r.forward ? 1 : teams} picks first`,
    r.reversal ? "the reversal round" : null,
    status === "Done" ? "all picks in" : status === "On the clock" ? "on the clock now" : status ? `${r.made} of ${teams} picked` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <h3 id={`round-${r.round}`} className={cx(s.roundHead, "on-ink bg-ink text-paper")} style={{ "--r": r.round } as Vars}>
      <span className="sr-only">{said}</span>
      {/* phones and tablets: the sticky bar */}
      <span aria-hidden className="flex min-h-10 items-center gap-3 px-4 py-2 lg:hidden">
        <span className="type-label">Round {r.round}</span>
        {first ? <span className="type-label truncate text-paper-shade">{first} first</span> : null}
        {r.reversal ? <Tag tone="paper">Flip</Tag> : null}
        {status ? (
          <span className="type-label ml-auto flex items-center gap-2 text-paper-shade">
            {clock ? <LiveSquare blink /> : null}
            {status}
          </span>
        ) : null}
      </span>
      {/* lg: the gutter */}
      <span aria-hidden className="hidden h-full flex-col items-center justify-center gap-1 py-1.5 lg:flex">
        <span className="type-numeral text-d20 leading-none">{r.round}</span>
        <Direction forward={r.forward} className="text-paper-shade" />
        {r.reversal ? <span className="type-label text-paper">Flip</span> : null}
      </span>
    </h3>
  );
}

/* ------------------------------ cells ------------------------------ */

function MadeCell({ c }: { c: BoardCell }) {
  const p = c.pick as DraftPickFact;
  const { first, last } = splitName(p.player.name);
  const anchor = { "--anchor": `--pick-${c.pickNo}` } as Vars;
  const who = c.ownerName ?? p.team.managerName;
  const label = [
    `Pick ${c.label}, ${who}`,
    `${p.player.name}, ${p.player.position}${p.player.nflTeam ? `, ${p.player.nflTeam}` : ""}`,
    p.verdict === "reach" || p.verdict === "steal" ? verdictText(p) : null,
    c.latest ? "Latest pick" : null,
    "Show the roast",
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <button
      type="button"
      popoverTarget={CARD_ID}
      popoverTargetAction="show"
      data-card={c.pickNo}
      aria-label={label}
      style={anchor}
      className={cx(s.pick, c.latest && s.latest)}
    >
        {/* phones and tablets: a list row */}
        <span className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 lg:hidden">
          <span className="type-label self-start pt-1">{c.label}</span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-bold leading-tight">{p.player.name}</span>
            <span className="flex min-w-0 items-center gap-2 text-fine text-ink-muted">
              <Tag className="px-1 py-[2px]">{p.player.position || "--"}</Tag>
              <span className="truncate">
                {[p.player.nflTeam, who].filter(Boolean).join(" · ")}
                {c.traded && c.columnName ? `, via ${c.columnName}` : ""}
              </span>
            </span>
          </span>
          <span className="flex flex-col items-end gap-1.5">
            {c.latest ? <Tag>Latest</Tag> : null}
            <Verdict pick={p} />
          </span>
        </span>

        {/* lg: a board cell */}
        <span className="hidden h-full min-h-[5.75rem] flex-col gap-0.5 px-2 pb-2 pt-2 lg:flex">
          <span className="flex items-center justify-between gap-1">
            <span className="type-label">{c.label}</span>
            <Verdict pick={p} compact />
          </span>
          <span className="mt-1 truncate text-fine leading-tight text-ink-muted">{first || " "}</span>
          <span className="truncate text-[0.9375rem] font-bold leading-tight">{last}</span>
          <span className="mt-auto flex min-w-0 items-center gap-1.5 pt-1.5">
            <Tag className="px-1 py-[2px]">{p.player.position || "--"}</Tag>
            {c.traded ? (
              <span className="truncate text-fine leading-none">
                by <b>{who}</b>
              </span>
            ) : (
              <span className="type-label truncate text-ink-muted">{p.player.nflTeam ?? "FA"}</span>
            )}
          </span>
        </span>
    </button>
  );
}

function ClockCell({ c, paused }: { c: BoardCell; paused: boolean }) {
  const what = paused ? "Paused" : "On the clock";
  return (
    <div className="on-ink flex w-full min-w-0 bg-ink text-paper">
      <span className="flex w-full items-center gap-3 px-3 py-2.5 lg:hidden">
        <span className="type-label w-12 shrink-0">{c.label}</span>
        <LiveSquare blink={!paused} />
        <span className="type-label">{what}</span>
        <span className="ml-auto truncate font-bold">{c.ownerName ?? "--"}</span>
      </span>
      <span className="hidden min-h-[5.75rem] w-full flex-col gap-1 px-2 py-2 lg:flex">
        <span className="flex items-center justify-between">
          <span className="type-label">{c.label}</span>
          <LiveSquare blink={!paused} />
        </span>
        <span className="type-label mt-1 text-paper-shade">{what}</span>
        <span className="type-label mt-auto truncate text-[1rem] leading-tight">{c.ownerName ?? "--"}</span>
      </span>
    </div>
  );
}

function FutureCell({ c }: { c: BoardCell }) {
  return (
    <div className={cx(s.future, "flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 md:flex-col md:items-start md:justify-start md:gap-1 lg:px-2")}>
      <span className="sr-only">
        {`Pick ${c.label}, still to come`}
        {c.ownerName ? `, ${c.ownerName}` : ""}
        {c.traded ? ", traded" : ""}
      </span>
      <span aria-hidden className="type-label bg-paper px-1 text-ink-muted">
        {c.label}
      </span>
      {/* Phones list who holds each pick. The grid shows it only when the pick changed hands. */}
      <span aria-hidden className={cx("type-label min-w-0 truncate bg-paper px-1", c.traded ? "text-ink" : "text-ink-muted lg:hidden")}>
        {c.traded ? `To ${c.ownerName}` : (c.ownerName ?? "")}
      </span>
    </div>
  );
}

function Cell({ c, paused }: { c: BoardCell; paused: boolean }) {
  return (
    <li
      id={`pick-${c.pickNo}`}
      data-pick={c.pickNo}
      className={s.cell}
      style={{ "--r": c.round, "--c": c.slot + 1 } as Vars}
    >
      {c.state === "made" ? <MadeCell c={c} /> : c.state === "clock" ? <ClockCell c={c} paused={paused} /> : <FutureCell c={c} />}
    </li>
  );
}

/** A filler of unlit bulbs that closes a short last row (phones: sm, tablets: md). */
function Filler({ span, at }: { span: number; at: "sm" | "md" }) {
  if (span <= 0) return null;
  return <li aria-hidden className={at === "sm" ? s.fillSm : s.fillMd} style={{ "--span": span } as Vars} />;
}

function RoundLists({ r, paused }: { r: BoardRound; paused: boolean }) {
  const made = r.cells.filter((c) => c.state !== "future");
  const todo = r.cells.filter((c) => c.state === "future");
  return (
    <>
      {made.length ? (
        <ol className={s.made}>
          {made.map((c) => (
            <Cell key={c.pickNo} c={c} paused={paused} />
          ))}
          <Filler span={made.length % 2} at="md" />
        </ol>
      ) : null}
      {todo.length ? (
        <ol className={s.todo}>
          {todo.map((c) => (
            <Cell key={c.pickNo} c={c} paused={paused} />
          ))}
          <Filler span={todo.length % 2} at="sm" />
          <Filler span={(5 - (todo.length % 5)) % 5} at="md" />
        </ol>
      ) : null}
    </>
  );
}

/* ------------------------------ round jump + legend ------------------------------ */

export function RoundJump({ board }: { board: BoardModel }) {
  return (
    <nav aria-label="Jump to a round" className="no-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ol className="m-0 flex list-none gap-1 p-0 lg:flex-wrap">
        {board.roundRows.map((r) => {
          const done = r.made === board.teams;
          const current = r.round === board.currentRound && board.made > 0 && board.made < board.total;
          return (
            <li key={r.round} className="flex">
              <a
                href={`#round-${r.round}`}
                aria-current={current ? "location" : undefined}
                aria-label={`Round ${r.round}${done ? ", done" : current ? ", current round" : ""}`}
                className={cx(
                  "type-label relative flex size-8 items-center justify-center border-2 border-ink no-underline hover:bg-ink hover:text-paper",
                  done ? "bg-ink text-paper" : "bg-paper text-ink",
                  current && "bg-paper text-ink shadow-hard",
                )}
              >
                {r.round}
                {current ? <LiveSquare size={8} className="absolute -right-1 -top-1" /> : null}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function BoardLegend({ board }: { board: BoardModel }) {
  const items = [
    { key: "reach", mark: <LiveSquare size={10} />, text: "Reach: taken ahead of FantasyCalc" },
    { key: "steal", mark: <span aria-hidden className="inline-block size-2.5 bg-ink" />, text: "Steal: taken after" },
    { key: "clock", mark: <span aria-hidden className="inline-block h-2.5 w-4 bg-ink" />, text: "On the clock" },
    {
      key: "dir",
      mark: <PixelArrow className="size-3" />,
      text: board.reversalRound > 0 ? `Pick order. Round ${board.reversalRound} runs like round ${board.reversalRound - 1}` : "Pick order",
    },
  ];
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
      {items.map((i) => (
        <li key={i.key} className="type-label flex items-center gap-2 text-ink-muted">
          {i.mark}
          {i.text}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ the board ------------------------------ */

export function DraftBoard({ board, placeholder, paused = false }: { board: BoardModel; placeholder: boolean; paused?: boolean }) {
  const cards = board.roundRows
    .flatMap((r) => r.cells)
    .map((c) => cardData(c, placeholder))
    .filter((x): x is PickCardData => x !== null);
  return (
    <div style={{ "--teams": board.teams } as Vars}>
      <a
        href="#board-end"
        className="type-label sr-only focus:not-sr-only focus:absolute focus:z-40 focus:m-2 focus:inline-block focus:border-2 focus:border-ink focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip past the board
      </a>
      <TeamHead columns={board.columns} />
      <div className={s.grid}>
        {board.roundRows.map((r) => (
          <section key={r.round} aria-labelledby={`round-${r.round}`} className={s.round}>
            <RoundHead r={r} teams={board.teams} />
            <RoundLists r={r} paused={paused} />
          </section>
        ))}
      </div>
      <div id="board-end" tabIndex={-1} className="outline-none" />
      <PickCardHost cards={cards} />
    </div>
  );
}
