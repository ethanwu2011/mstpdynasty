/*
 * DIRECTION CONTRACT (/draft, inside the Jumbotron Specimen world, DESIGN.md)
 * THESIS: The startup draft as a stadium board. Every pick lights a cell; the reaches light red.
 * STORY: What is happening (the countdown, the latest pick and its roast, or the grades), then
 *   the whole board, then one tap on any pick for the roast that proves it.
 * FIRST VIEWPORT: Pre-draft: the countdown lead and how the snake and reversal round run.
 *   Live: the latest pick roasted and who is on the clock. After: the worst draft roasted, the
 *   best draft, the grades. The board follows at full width with a sticky row of teams.
 * PHONES: The board becomes a list in pick order with a sticky bar per round.
 */
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";
import { SampleMark } from "@/components/Tag";
import { listIssues, listRoasts } from "@/lib/archive";
import { draftFacts } from "@/lib/facts";
import { getLeagueContext } from "@/lib/league";
import { getDraftTradedPicks } from "@/lib/sleeper";
import type { DraftFacts, SeasonPhase, SleeperDraft } from "@/lib/types";
import { fmtInt } from "../_lib/format";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { fireTick } from "../_lib/tick";
import { devSample } from "./_board/dev-sample";
import { BoardLegend, DraftBoard, RoundJump } from "./_board/DraftBoard";
import { buildBoard, type BoardModel, type BoardStage } from "./_board/model";
import { BestDraftPanel, ClockPanel, GradesLead, GradesPending, GradesTable, LatestPickPanel, OrderPanel, PreDraftLead } from "./_panels";

export const metadata: Metadata = {
  title: "Draft board",
  description: "The MSTP Dynasty startup draft, pick by pick, with every reach and steal called out.",
};

function stageFor(phase: SeasonPhase, draft: SleeperDraft, facts: DraftFacts | null, sample: boolean): BoardStage {
  const status = facts?.status ?? draft.status;
  if (sample) return status === "complete" ? "done" : status === "drafting" ? "live" : "pre";
  if (phase === "pre_draft") return "pre";
  if (phase === "drafting") return draft.status === "paused" ? "paused" : "live";
  if (status === "complete") return "done";
  if (status === "paused") return "paused";
  if (status === "drafting") return "live";
  return (facts?.picks.length ?? 0) > 0 ? "done" : "pre";
}

function BoardPanel({ board, stage, placeholder, factsMissing }: { board: BoardModel; stage: BoardStage; placeholder: boolean; factsMissing: boolean }) {
  const count = (
    <>
      <span className="sm:hidden">
        {fmtInt(board.made)}/{fmtInt(board.total)}
      </span>
      <span className="hidden sm:inline">
        {fmtInt(board.made)} of {fmtInt(board.total)} picks
      </span>
    </>
  );
  return (
    <Panel
      label="The board"
      id="board"
      live={stage === "live"}
      labelRight={
        <>
          {placeholder && board.made > 0 ? <SampleMark onInk /> : null}
          <span className="text-paper-shade">{count}</span>
        </>
      }
      pad={false}
    >
      <div className="flex flex-col gap-4 border-b-2 border-ink px-4 pb-4 pt-5 md:px-6">
        <BoardLegend board={board} />
        <RoundJump board={board} />
        {factsMissing ? (
          <p className="type-label m-0 flex items-center gap-2">
            Sleeper did not send the picks just now. The order is below. Try again in a minute.
          </p>
        ) : null}
        {!board.orderSet ? <p className="type-label m-0 text-ink-muted">Sleeper has not set the draft order. The team columns fill in when it does.</p> : null}
      </div>
      <DraftBoard board={board} placeholder={placeholder} paused={stage === "paused"} />
    </Panel>
  );
}

export default async function DraftPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const phase = await pagePhase(ctx, searchParams);
  await fireTick();
  const draft = ctx.draft;

  if (!draft) {
    return (
      <Board>
        <h1 className="sr-only">The startup draft board</h1>
        <Panel label="The board">
          <div className="flex flex-col gap-6">
            <p className="type-display m-0 text-j3 md:text-j4">No draft yet</p>
            <DotMatrixFill label="Sleeper has no startup draft for this league. The board appears as soon as the commissioner creates one." rows={8} />
          </div>
        </Panel>
      </Board>
    );
  }

  const sampleParam = process.env.NODE_ENV === "development" ? (await searchParams).sample : undefined;
  const [realFacts, roasts, realTraded, issues, sample] = await Promise.all([
    safe(draftFacts(ctx), null, "draft facts"),
    safe(listRoasts(ctx.leagueId, "draft_pick"), [], "pick roasts"),
    safe(getDraftTradedPicks(draft.draft_id), [], "traded picks"),
    safe(listIssues(ctx.leagueId, { limit: 20 }), [], "issues"),
    safe(devSample(ctx, draft, Array.isArray(sampleParam) ? sampleParam[0] : sampleParam), null, "dev sample"),
  ]);
  const facts = sample?.facts ?? realFacts;
  const stage = stageFor(phase, draft, facts, Boolean(sample));
  const board = buildBoard({ ctx, draft, facts, roasts, tradedPicks: sample?.traded ?? realTraded, stage });
  const placeholder = facts?.placeholder ?? false;
  const factsMissing = !facts && stage !== "pre";
  const gradesIssue = issues.find((i) => i.kind === "draft_grades") ?? null;
  const grades = facts?.grades?.length ? facts.grades : null;

  return (
    <Board>
      <h1 className="sr-only">The startup draft board</h1>
      <AutoRefresh enabled={stage === "live"} seconds={30} />

      {stage === "pre" ? (
        <>
          <PreDraftLead ctx={ctx} board={board} draft={draft} />
          <OrderPanel board={board} draft={draft} span={4} />
        </>
      ) : stage === "live" || stage === "paused" ? (
        <>
          <LatestPickPanel board={board} placeholder={placeholder} span={8} />
          <ClockPanel ctx={ctx} board={board} draft={draft} stage={stage} placeholder={placeholder} span={4} />
        </>
      ) : grades ? (
        <>
          <GradesLead grades={grades} issue={gradesIssue} board={board} placeholder={placeholder} />
          <BestDraftPanel grades={grades} span={4} />
          <GradesTable grades={grades} placeholder={placeholder} />
        </>
      ) : (
        <>
          <LatestPickPanel board={board} placeholder={placeholder} span={8} />
          <OrderPanel board={board} draft={draft} span={4} />
          <GradesPending board={board} />
        </>
      )}

      <BoardPanel board={board} stage={stage} placeholder={placeholder} factsMissing={factsMissing} />
    </Board>
  );
}
