/** The panels around the board: the pre-draft lead, the order explainer, the latest pick, grades. */
import Link from "next/link";
import { PixelArrow } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { cx } from "@/components/cx";
import { DataTable } from "@/components/DataTable";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { BarLink } from "@/components/HeaderBar";
import { Numeral } from "@/components/Numeral";
import { Panel, type PanelSpan } from "@/components/Panel";
import { Receipt, RoastBlock, type RoastBlockData } from "@/components/RoastBlock";
import { lineOf, RowLine } from "@/components/RowLine";
import { LiveSquare, SampleMark } from "@/components/Tag";
import type { DraftGrade, DraftPickFact, Issue, LeagueContext, SleeperDraft, SurfaceLineMap } from "@/lib/types";
import { clockLength, etStamp, fmtInt, ordinal, pickLabel } from "../_lib/format";
import { slotPicks } from "../_lib/draft";
import { issueToBlock, pickFallback, roastToBlock } from "../_lib/roast-view";
import { Verdict } from "./_board/DraftBoard";
import { pickFacts } from "./_board/card";
import { orderName, type BoardModel } from "./_board/model";

/* ------------------------------ pre-draft ------------------------------ */

export function PreDraftLead({ ctx, board, draft }: { ctx: LeagueContext; board: BoardModel; draft: SleeperDraft }) {
  const clock = clockLength(draft.settings.pick_timer);
  const start = draft.start_time;
  const commish = ctx.managers.find((m) => m.isCommissioner)?.name ?? "the commissioner";
  const autostart = Boolean(draft.settings.autostart);
  return (
    <Panel label="Startup draft" labelRight={<span className="text-paper-shade">{start ? etStamp(start) : "No start time"}</span>} span={8} id="startup-draft">
      <div className="flex flex-1 flex-col gap-6 md:gap-7">
        <p className="type-label m-0">
          {orderName(board)} · {board.rounds} rounds{clock ? ` · ${clock} pick clock` : ""}
        </p>
        <h3 className="type-display m-0 text-j3 md:text-j4">
          <span className="board-wipe block">{fmtInt(board.total)} picks.</span>
          <span className="board-wipe block">Zero made.</span>
        </h3>

        {start ? (
          <Countdown
            target={start}
            serverNow={ctx.loadedAt}
            digitClassName="text-d60 sm:text-d80"
            label={`Draft scheduled for ${etStamp(start)}`}
            expired={
              <div className="flex flex-col gap-3">
                <Numeral value="00:00:00" label="Zero" className="text-d60 sm:text-d80" />
                <p className="type-label m-0 flex items-center gap-2">
                  <LiveSquare blink size={10} />
                  {autostart ? "Starting any second" : `Past the scheduled start. The draft opens when ${commish} hits start.`}
                </p>
              </div>
            }
          />
        ) : (
          <DotMatrixFill label="Sleeper has no start time for the draft yet." rows={4} />
        )}

        <p className="measure m-0 text-body md:text-lede">
          All {fmtInt(board.total)} picks land here as they are made, with each player&apos;s FantasyCalc rank. Take a player too early and his
          square turns red. Tap a pick to open it.
        </p>

        <Receipt
          items={[
            { label: "Picks", value: fmtInt(board.total) },
            { label: "Rounds", value: board.rounds },
            { label: "Pick clock", value: clock ?? "None" },
            { label: "Grades", value: "When it ends" },
          ]}
        />
      </div>
    </Panel>
  );
}

/** How the snake and the reversal round run, drawn on the first rounds, with the names it affects. */
export function OrderPanel({ board, draft, span = 4 }: { board: BoardModel; draft: SleeperDraft; span?: PanelSpan }) {
  const shown = board.roundRows.slice(0, Math.min(board.rounds, Math.max(4, board.reversalRound + 1)));
  const first = board.columns[0];
  const last = board.columns[board.teams - 1];
  const firstPicks = slotPicks({ ...draft, settings: { ...draft.settings, teams: board.teams } }, 1, 3).map((p) => p.label);
  const lastPicks = slotPicks({ ...draft, settings: { ...draft.settings, teams: board.teams } }, board.teams, 3).map((p) => p.label);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

  return (
    <Panel label="How the order runs" labelRight={<span className="text-paper-shade">{orderName(board)}</span>} span={span}>
      <div className="flex flex-1 flex-col gap-6">
        <figure className="m-0 flex flex-col gap-3">
          <div role="img" aria-label={shown.map((r) => `Round ${r.round}: slot ${r.forward ? 1 : board.teams} picks first`).join(". ")} className="flex flex-col gap-1.5">
            {shown.map((r) => (
              <div key={r.round} className="grid grid-cols-[2.25rem_minmax(0,1fr)_1rem] items-center gap-2">
                <span className="type-label">R{r.round}</span>
                <span className="grid gap-[2px] border-2 border-ink bg-ink" style={{ gridTemplateColumns: `repeat(${board.teams}, minmax(0, 1fr))` }}>
                  {r.cells
                    .slice()
                    .sort((a, b) => a.slot - b.slot)
                    .map((c) => (
                      <span
                        key={c.pickNo}
                        className={cx(
                          "type-label flex aspect-square items-center justify-center leading-none",
                          c.pickInRound === 1 ? "bg-ink text-paper" : "bg-paper text-ink",
                        )}
                      >
                        {c.pickInRound}
                      </span>
                    ))}
                </span>
                <PixelArrow className={cx(!r.forward && "rotate-180")} />
              </div>
            ))}
          </div>
          <figcaption className="text-data text-ink-muted">Columns are draft slots. Numbers are the pick in each round.</figcaption>
        </figure>

        <div className="flex flex-col gap-3 text-body">
          {board.type === "snake" && board.reversalRound > 0 ? (
            <p className="m-0">
              Round {board.reversalRound} runs the same way as round {board.reversalRound - 1}, then the snake picks back up.
            </p>
          ) : board.type === "snake" ? (
            <p className="m-0">Every round runs back the other way.</p>
          ) : (
            <p className="m-0">Every round runs in the same order.</p>
          )}
          {board.orderSet && board.type === "snake" ? (
            <dl className="m-0 border-t-2 border-ink">
              {[
                { who: last, picks: lastPicks },
                { who: first, picks: firstPicks },
              ].map(({ who, picks }) => (
                <div key={who.slot} className="flex items-baseline justify-between gap-4 border-b border-ink py-2.5">
                  <dt className="flex min-w-0 flex-col">
                    <span className="font-bold">{who.manager}</span>
                    <span className="type-label text-ink-muted">Slot {who.slot}</span>
                  </dt>
                  <dd className="type-data m-0 text-right">{list(picks)}</dd>
                </div>
              ))}
            </dl>
          ) : !board.orderSet ? (
            <p className="m-0 text-ink-muted">Sleeper has not set the draft order yet. The names land in the columns when it does.</p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ drafting ------------------------------ */

export function LatestPickPanel({
  board,
  placeholder,
  lines,
  span = 8,
}: {
  board: BoardModel;
  placeholder: boolean;
  /** One-liners by pick number (the draft surface). */
  lines?: SurfaceLineMap;
  span?: PanelSpan;
}) {
  const cell = board.latest;
  const earlier = cell
    ? board.roundRows
        .flatMap((r) => r.cells)
        .filter((c) => c.pick && c.pickNo < cell.pickNo)
        .slice(-4)
        .reverse()
    : [];
  const data: RoastBlockData | null = cell?.pick
    ? cell.roast
      ? roastToBlock(cell.roast)
      : { ...pickFallback(cell.pick, placeholder), text: pickFacts(cell.pick) }
    : null;
  return (
    <Panel
      label={cell ? `Pick ${cell.label}` : "Pick 1.01"}
      labelRight={cell ? <BarLink href={`#pick-${cell.pickNo}`}>On the board</BarLink> : null}
      span={span}
      id="latest-pick"
    >
      {data ? (
        <div className="flex flex-1 flex-col gap-8">
          <RoastBlock
            {...data}
            href={null}
            lede={cell ? lineOf(lines, cell.pickNo) : null}
            eventInPanel
            size="hero"
            animate
            headingLevel={3}
          />
          {earlier.length ? (
            <section aria-labelledby="picks-before" className="mt-auto flex flex-col gap-2">
              <h4 id="picks-before" className="type-label m-0 text-ink-muted">
                Before that
              </h4>
              <ol className="m-0 list-none border-t-2 border-ink p-0">
                {earlier.map((c) => (
                  <li key={c.pickNo} className="border-b border-ink">
                    <a href={`#pick-${c.pickNo}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 no-underline hover:bg-paper-shade">
                      <span className="type-label">{c.label}</span>
                      <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                        <b className="truncate">{c.pick?.player.name}</b>
                        <span className="truncate text-data text-ink-muted">
                          {c.pick?.player.position} · {c.ownerName}
                        </span>
                      </span>
                      {c.pick ? <Verdict pick={c.pick} /> : null}
                      {lineOf(lines, c.pickNo) ? <RowLine text={lineOf(lines, c.pickNo)} className="col-start-2 col-end-4 pt-1" /> : null}
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-6">
          <p className="type-display m-0 text-j3">No picks yet</p>
          <DotMatrixFill label="The draft is open and nobody has picked." rows={6} />
        </div>
      )}
    </Panel>
  );
}

/** Who is on the clock, how long they have sat there, and the next three up. */
export function ClockPanel({ ctx, board, draft, stage, placeholder, span = 4 }: { ctx: LeagueContext; board: BoardModel; draft: SleeperDraft; stage: "live" | "paused"; placeholder: boolean; span?: PanelSpan }) {
  const c = board.clock;
  const cells = board.roundRows.flatMap((r) => r.cells);
  const upcoming = c ? cells.filter((x) => x.pickNo > c.pickNo).slice(0, 3) : [];
  // Before the first pick Sleeper's last_picked can be stale, so the clock runs from the start.
  const firstUp = board.made === 0;
  const since = firstUp ? (draft.start_time ?? null) : (draft.last_picked ?? draft.start_time ?? null);
  const clock = clockLength(draft.settings.pick_timer);
  const doneRounds = Math.floor(board.made / Math.max(1, board.teams));
  return (
    <Panel label="On the clock" live={stage === "live" && Boolean(c)} labelRight={placeholder ? <SampleMark onInk /> : clock ? <span className="text-paper-shade">{clock} clock</span> : null} span={span}>
      {c ? (
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="type-label text-ink-muted">
              Pick {c.label} · {ordinal(c.pickNo)} overall
            </span>
            <span className="type-display break-words text-j3">{c.ownerName ?? "--"}</span>
            {c.traded && c.columnName ? <span className="text-fine text-ink-muted">Pick acquired from {c.columnName}</span> : null}
          </div>

          {stage === "paused" ? (
            <p className="type-label m-0 flex items-center gap-2">
              <LiveSquare size={10} />
              Draft paused. The clock is stopped.
            </p>
          ) : since ? (
            <div className="flex flex-col gap-2">
              <span className="type-label text-ink-muted">{firstUp ? "Since the scheduled start" : "On the clock for"}</span>
              <Countdown target={since} serverNow={ctx.loadedAt} mode="up" size="d40" label="Time on the clock" />
            </div>
          ) : null}

          {upcoming.length ? (
            <div className="flex flex-col gap-1">
              <span className="type-label text-ink-muted">Up next</span>
              <ol className="m-0 list-none border-t-2 border-ink p-0">
                {upcoming.map((u) => (
                  <li key={u.pickNo} className="flex items-center justify-between gap-3 border-b border-ink py-2">
                    <span className="type-label">{u.label}</span>
                    <span className="truncate font-semibold">{u.ownerName ?? "--"}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="type-label text-ink-muted">
                Round {c.round} of {board.rounds}
              </span>
              <span className="type-data text-fine text-ink-muted">
                {fmtInt(board.made)} of {fmtInt(board.total)} picks
              </span>
            </div>
            <div role="img" aria-label={`${doneRounds} of ${board.rounds} rounds complete`} className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${Math.min(board.rounds, 17)}, minmax(0, 1fr))` }}>
              {board.roundRows.map((r, i) => (
                <span key={r.round} className={cx("block aspect-square", i < doneRounds ? "bg-ink" : i === doneRounds ? "border-2 border-ink bg-paper-shade" : "border border-ink")} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-6">
          <span className="type-display text-j3">{board.made >= board.total ? "Board full" : "Waiting"}</span>
          <DotMatrixFill label={board.made >= board.total ? `All ${fmtInt(board.total)} picks are in.` : "No pick is on the clock right now."} rows={5} />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ after the draft ------------------------------ */

function gradeLead(g: DraftGrade, teams: number, picks: number, placeholder: boolean): RoastBlockData {
  const w = g.worstPick;
  const lines = [`${g.team.managerName} drafted ${fmtInt(g.totalValue)} in FantasyCalc value${picks ? ` across ${picks} ${picks === 1 ? "pick" : "picks"}` : ""}, ${ordinal(g.valueRank)} of ${teams}.`];
  if (w && w.reach && w.reach > 0) lines.push(`The worst of them: ${w.player.name} at ${pickLabel(w.round, w.pickInRound)}, ${fmtInt(w.reach)} spots ahead of FantasyCalc.`);
  return {
    event: "Draft grades",
    kicker: "The worst draft",
    victim: g.team.managerName,
    stat: `Grade ${g.grade}`,
    text: lines.join(" "),
    receipt: [
      { label: "Grade", value: g.grade },
      { label: "Draft value", value: fmtInt(g.totalValue) },
      { label: "Value rank", value: `${ordinal(g.valueRank)} of ${teams}` },
      { label: "Worst pick", value: w ? `${pickLabel(w.round, w.pickInRound)} ${w.player.name}` : "--" },
    ],
    href: `/teams/${g.team.rosterId}`,
    tags: placeholder ? <SampleMark /> : null,
  };
}

export function GradesLead({ grades, issue, board, placeholder }: { grades: DraftGrade[]; issue: Issue | null; board: BoardModel; placeholder: boolean }) {
  const worst = [...grades].sort((a, b) => b.valueRank - a.valueRank)[0];
  const picks = worst ? board.roundRows.flatMap((r) => r.cells).filter((c) => c.pick && c.ownerRosterId === worst.team.rosterId).length : 0;
  const data = issue ? issueToBlock(issue) : worst ? gradeLead(worst, grades.length, picks, placeholder) : null;
  return (
    <Panel label="Draft grades" labelRight={issue ? <BarLink href={`/newsletter/${issue.slug}`}>Full issue</BarLink> : null} span={8} id="draft-grades-lead">
      {data ? <RoastBlock {...data} eventInPanel size="hero" animate headingLevel={3} /> : null}
    </Panel>
  );
}

export function BestDraftPanel({ grades, span = 4 }: { grades: DraftGrade[]; span?: PanelSpan }) {
  const best = [...grades].sort((a, b) => a.valueRank - b.valueRank)[0];
  if (!best) return null;
  const b = best.bestPick;
  return (
    <Panel label="Best draft" span={span}>
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="type-display truncate text-j3">{best.team.managerName}</span>
            <span className="truncate text-fine text-ink-muted">{best.team.teamName}</span>
          </div>
          <span className="type-display text-j5 leading-none" aria-label={`Grade ${best.grade}`}>
            {best.grade}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="type-label text-ink-muted">Draft value</span>
          <Numeral value={best.totalValue} size="d40" />
        </div>
        {b ? (
          <div className="flex flex-col gap-1 border-t-2 border-ink pt-3">
            <span className="type-label text-ink-muted">Best pick</span>
            <span className="font-bold">
              {b.player.name} at {pickLabel(b.round, b.pickInRound)}
            </span>
            <Verdict pick={b} className="mt-1" />
          </div>
        ) : null}
        <Link href={`/teams/${best.team.rosterId}`} className="link-ink type-label hit-area mt-auto self-start px-0.5">
          Team page
        </Link>
      </div>
    </Panel>
  );
}

function PickLine({ p }: { p: DraftPickFact | null }) {
  if (!p) return <span className="text-ink-muted">--</span>;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <Verdict pick={p} compact />
      <span>
        <span className="font-semibold">{p.player.name}</span>
        <span className="text-ink-muted"> · {pickLabel(p.round, p.pickInRound)}</span>
      </span>
    </span>
  );
}

export function GradesTable({ grades, placeholder }: { grades: DraftGrade[]; placeholder: boolean }) {
  const rows = [...grades].sort((a, b) => a.valueRank - b.valueRank);
  return (
    <Panel label="Draft grades" labelRight={placeholder ? <SampleMark onInk /> : <span className="text-paper-shade">FantasyCalc value</span>} pad={false} id="grades">
      <DataTable
        caption="Draft grades by team, best draft first"
        rows={rows}
        rowKey={(g) => String(g.team.rosterId)}
        mark={(_, i) => (i === 0 ? "leader" : i === rows.length - 1 ? "last" : null)}
        minWidth={760}
        columns={[
          {
            key: "team",
            header: "Team",
            cell: (g) => (
              <Link href={`/teams/${g.team.rosterId}`} className="flex flex-col no-underline hover:underline">
                <span className="font-bold">{g.team.managerName}</span>
                <span className="text-fine font-normal text-ink-muted">{g.team.teamName}</span>
              </Link>
            ),
          },
          { key: "grade", header: "Grade", cell: (g) => <span className="type-display text-j2 leading-none">{g.grade}</span> },
          { key: "value", header: "Value", align: "right", cell: (g) => fmtInt(g.totalValue) },
          { key: "rank", header: "Rank", align: "right", hideOnPhone: true, cell: (g) => ordinal(g.valueRank) },
          { key: "best", header: "Best pick", className: "w-1/3", cell: (g) => <PickLine p={g.bestPick} /> },
          { key: "worst", header: "Worst pick", className: "w-1/3", cell: (g) => <PickLine p={g.worstPick} /> },
        ]}
      />
    </Panel>
  );
}

export function GradesPending({ board }: { board: BoardModel }) {
  return (
    <Panel label="Draft grades" labelRight={<span className="text-paper-shade">Pending</span>}>
      <div className="flex flex-col gap-4">
        <p className="type-display m-0 text-j3">{board.made >= board.total ? "Board full" : "Board closed"}</p>
        <DotMatrixFill label={`${fmtInt(board.made)} of ${fmtInt(board.total)} picks are in. Grades post once every pick has a FantasyCalc value.`} rows={4} />
      </div>
    </Panel>
  );
}
