/*
 * DIRECTION CONTRACT (/teams/[rosterId], inside the Jumbotron Specimen world, DESIGN.md)
 * THESIS: One team's file on the board: the manager shouted in pixel caps, the record and the
 *   dynasty value under it, then the roster that proves it and the rap sheet that roasts it.
 * FIRST VIEWPORT: The manager and team name, record, rank, points and value (8 columns); the
 *   latest thing written about them, or their startup picks before and during the draft (4 columns).
 * THEN: Starting lineup by slot with FantasyCalc value and age, team value by position, bench,
 *   taxi and IR, the rap sheet, the draft haul, and every other team one tap away.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Board } from "@/components/Panel";
import { Tag } from "@/components/Tag";
import { listRoasts } from "@/lib/archive";
import { getFantasyCalc } from "@/lib/fantasycalc";
import { draftFacts, shameEntries } from "@/lib/facts";
import { getLeagueContext, managerFor, rosterFor, standingsFromRosters } from "@/lib/league";
import { managerAndTeam } from "@/lib/names";
import { surfaceKeys } from "@/lib/roast";
import { getDraftTradedPicks, getPlayers, rosterPointsFor, rosterPotentialPoints } from "@/lib/sleeper";
import type { LeagueContext, PlayersMap, SeasonPhase } from "@/lib/types";
import { fmtInt, fmtPts, ordinal, record } from "../../_lib/format";
import { surfaceLinesFor } from "../../_lib/lines";
import { pagePhase, safe, type SearchParams } from "../../_lib/phase";
import { devSample } from "../../draft/_board/dev-sample";
import { buildBoard, picksFor, type BoardStage } from "../../draft/_board/model";
import { leagueValues, rosterRows } from "../_lib/roster";
import {
  BenchPanel,
  DraftHaulPanel,
  LatestRoastPanel,
  LineupPanel,
  PicksPanel,
  RapSheetPanel,
  ReservesPanel,
  RosterEmptyPanel,
  TeamLead,
  TeamsStrip,
  ValuePanel,
  type LeadStat,
} from "./_panels";

type Params = Promise<{ rosterId: string }>;

function parseId(raw: string): number | null {
  return /^\d{1,3}$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = parseId((await params).rosterId);
  try {
    const ctx = await getLeagueContext();
    if (id === null || !rosterFor(ctx, id)) return { title: "No such team" };
    const m = managerFor(ctx, id);
    return { title: managerAndTeam(m.name, m.teamName), description: `${m.name}'s roster, dynasty value and rap sheet in MSTP Dynasty.` };
  } catch {
    return { title: "Team" };
  }
}

function stageOf(phase: SeasonPhase, ctx: LeagueContext): BoardStage {
  if (phase === "pre_draft") return "pre";
  if (phase === "drafting") return ctx.draft?.status === "paused" ? "paused" : "live";
  return "done";
}

export default async function TeamPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const id = parseId((await params).rosterId);
  if (id === null) notFound();
  const ctx = await getLeagueContext();
  const roster = rosterFor(ctx, id);
  if (!roster) notFound();
  const phase = await pagePhase(ctx, searchParams);
  const manager = managerFor(ctx, id);
  const draft = ctx.draft;
  const sampleParam = process.env.NODE_ENV === "development" ? (await searchParams).sample : undefined;

  const [players, fc, shame, roasts, realFacts, realTraded, sample, teamLines, shameLines, pickLines] = await Promise.all([
    safe(getPlayers(), {} as PlayersMap, "players"),
    safe(getFantasyCalc(), null, "fantasycalc"),
    safe(shameEntries(ctx), null, "shame"),
    safe(listRoasts(ctx.leagueId), [], "roasts"),
    draft ? safe(draftFacts(ctx), null, "draft facts") : Promise.resolve(null),
    draft ? safe(getDraftTradedPicks(draft.draft_id), [], "traded picks") : Promise.resolve([]),
    draft ? safe(devSample(ctx, draft, Array.isArray(sampleParam) ? sampleParam[0] : sampleParam), null, "dev sample") : Promise.resolve(null),
    surfaceLinesFor(ctx, "team", surfaceKeys.team(ctx.season)),
    surfaceLinesFor(ctx, "shame", surfaceKeys.shame(ctx.season)),
    draft ? surfaceLinesFor(ctx, "draft", surfaceKeys.draft(draft.draft_id)) : Promise.resolve({}),
  ]);

  const facts = sample?.facts ?? realFacts;
  const stage: BoardStage = sample ? (facts?.status === "complete" ? "done" : "live") : stageOf(phase, ctx);
  const board = draft ? buildBoard({ ctx, draft, facts, roasts, tradedPicks: sample?.traded ?? realTraded, stage }) : null;
  const myPicks = board ? picksFor(board, id) : [];
  const tradedAway = board ? board.roundRows.flatMap((r) => r.cells).filter((c) => c.columnRosterId === id && c.ownerRosterId !== id && !c.pick) : [];
  const grade = facts?.grades?.find((g) => g.team.rosterId === id) ?? null;

  const standings = standingsFromRosters(ctx);
  const standing = standings.find((s) => s.team.rosterId === id) ?? null;
  const played = standing ? standing.wins + standing.losses + standing.ties > 0 : false;
  const hasRoster = roster.players.length > 0;
  const values = hasRoster ? leagueValues(ctx, players, fc) : [];
  const mine = values.find((v) => v.rosterId === id);
  const valueRank = mine ? [...values].sort((a, b) => b.total - a.total).findIndex((v) => v.rosterId === id) + 1 : null;
  const groups = hasRoster ? rosterRows(ctx, roster, players, fc) : null;
  const benchLeft = played ? rosterPotentialPoints(roster) - rosterPointsFor(roster) : 0;

  // Sample shame entries mean nothing before games exist.
  const preGames = phase === "pre_draft" || phase === "drafting";
  const shameUsable = shame && !(preGames && shame.placeholder) ? shame : null;
  const myShame = shameUsable ? shameUsable.entries.filter((e) => e.team.rosterId === id) : [];
  const myRoasts = roasts.filter((r) => r.rosterIds.includes(id)).sort((a, b) => b.createdAt - a.createdAt);
  const draftStage = stage === "pre" || stage === "live" || stage === "paused";
  const slot = board?.columns.find((c) => c.rosterId === id)?.slot ?? null;

  const showSlot = Boolean(slot && hasRoster);
  const kicker =
    showSlot || manager.isCommissioner || (standing && played) ? (
      <>
        {showSlot ? <Tag>Draft slot {slot}</Tag> : null}
        {manager.isCommissioner ? <Tag tone="outline">Commissioner</Tag> : null}
        {standing && played ? <span className="type-label">{ordinal(standing.rank)} place</span> : null}
      </>
    ) : null;

  let stats: LeadStat[];
  if (played && standing) {
    stats = [
      { label: "Record", value: record(standing.wins, standing.losses, standing.ties) },
      { label: "Place", value: `${standing.rank}/${standings.length}`, alarm: standing.rank === standings.length },
      { label: "Points for", value: fmtPts(standing.pointsFor) },
      benchLeft > 0.005
        ? { label: "Left on bench", value: fmtPts(benchLeft), alarm: true }
        : { label: "Dynasty value", value: mine ? fmtInt(mine.total) : null },
    ];
  } else if (hasRoster) {
    stats = [
      { label: "Dynasty value", value: mine ? fmtInt(mine.total) : null },
      { label: "Value rank", value: valueRank ? `${valueRank}/${values.length}` : null },
      { label: "Players", value: roster.players.length },
      grade ? { label: "Draft grade", value: grade.grade, kind: "text" } : { label: "Record", value: "0-0" },
    ];
  } else if (stage === "live" || stage === "paused") {
    const made = myPicks.filter((c) => c.pick);
    const next = myPicks.find((c) => !c.pick);
    stats = [
      { label: "Draft slot", value: slot },
      { label: "Picks made", value: `${made.length}/${myPicks.length}` },
      { label: "Next pick", value: next?.label ?? null },
      { label: "Draft value", value: made.length ? fmtInt(made.reduce((a, c) => a + (c.pick?.player.value ?? 0), 0)) : null },
    ];
  } else {
    stats = [
      { label: "Draft slot", value: slot },
      { label: "Picks held", value: myPicks.length || null },
      { label: "First pick", value: myPicks[0]?.label ?? null },
      { label: "Last pick", value: myPicks[myPicks.length - 1]?.label ?? null },
    ];
  }

  const madePicks = myPicks.filter((c) => c.pick);
  const nextPick = myPicks.find((c) => !c.pick);
  const reaches = madePicks.filter((c) => c.pick?.verdict === "reach").length;
  const steals = madePicks.filter((c) => c.pick?.verdict === "steal").length;
  const count = (n: number, one: string, many: string) => `${n === 0 ? "no" : n} ${n === 1 ? one : many}`;
  const note = !hasRoster && (stage === "live" || stage === "paused") ? (
    <p className="m-0">
      {manager.name} has made {madePicks.length} of {myPicks.length} picks: {count(reaches, "reach", "reaches")} and {count(steals, "steal", "steals")} by
      FantasyCalc&apos;s rankings.{nextPick ? ` Next up at ${nextPick.label}, ${ordinal(nextPick.pickNo)} overall.` : ""}
    </p>
  ) : !hasRoster && phase === "pre_draft" ? (
    <p className="m-0">
      No roster yet. {manager.name} builds one from scratch in the startup draft
      {myPicks[0] ? `, starting at ${myPicks[0].label}` : ""}.
    </p>
  ) : null;

  const order = board?.orderSet && draftStage ? board.columns.map((c) => c.rosterId).filter((x): x is number => x !== null) : standings.map((s) => s.team.rosterId);

  return (
    <Board>
      <h1 className="sr-only">
        {managerAndTeam(manager.name, manager.teamName, ": ")}
      </h1>

      <TeamLead manager={manager} kicker={kicker} stats={stats} note={note} line={teamLines[String(id)] ?? null} />
      {draftStage && board ? (
        <PicksPanel rosterId={id} cells={myPicks} away={tradedAway} live={stage === "live"} span={4} />
      ) : (
        <LatestRoastPanel roast={myRoasts[0] ?? null} shame={myShame[0] ?? null} span={4} />
      )}

      {groups ? (
        <>
          <LineupPanel rows={groups.starters} alarms={phase === "in_season"} span={8} />
          <ValuePanel rosterId={id} values={values} roster={[...groups.starters, ...groups.bench, ...groups.taxi, ...groups.ir]} span={4} />
          <BenchPanel rows={groups.bench} span={8} />
          <ReservesPanel
            taxi={groups.taxi}
            ir={groups.ir}
            taxiSlots={ctx.league.settings.taxi_slots ?? groups.taxi.length}
            irSlots={ctx.league.settings.reserve_slots ?? groups.ir.length}
            span={4}
          />
        </>
      ) : null}

      {stage === "live" || stage === "paused" ? <DraftHaulPanel cells={myPicks} grade={grade} placeholder={facts?.placeholder ?? false} lines={pickLines} /> : null}
      {groups ? (
        <RapSheetPanel manager={manager} shame={myShame} roasts={myRoasts.slice(0, 8)} shamePlaceholder={shameUsable?.placeholder ?? false} lines={shameLines} />
      ) : (
        <>
          <RosterEmptyPanel manager={manager} drafting={stage === "live" || stage === "paused"} span={8} />
          <RapSheetPanel
            manager={manager}
            shame={myShame}
            roasts={myRoasts.slice(0, 4)}
            shamePlaceholder={shameUsable?.placeholder ?? false}
            lines={shameLines}
            span={4}
          />
        </>
      )}
      {stage === "done" ? <DraftHaulPanel cells={myPicks} grade={grade} placeholder={facts?.placeholder ?? false} lines={pickLines} /> : null}

      <TeamsStrip ctx={ctx} current={id} order={order} standings={standings} />
    </Board>
  );
}
