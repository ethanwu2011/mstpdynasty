import type { Metadata } from "next";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";
import { type Shout, ShoutList } from "@/components/ShoutList";
import { SampleMark, Tag } from "@/components/Tag";
import { getLeagueContext, playoffRounds } from "@/lib/league";
import { draftOdds, draftOddsBasis, getOddsHistory, runSeasonSim } from "@/lib/models";
import { surfaceKeys } from "@/lib/roast";
import type { DraftOdds, LeagueContext, OddsHistory, OddsSnapshot, SimResult } from "@/lib/types";
import { etStamp, fmtInt, record } from "../_lib/format";
import { surfaceLinesFor } from "../_lib/lines";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { METRICS, MetricSwitch, OddsChart, type OddsMetric, type OddsSeries } from "./_parts/chart";
import { OddsTable, pctText, type OddsTableRow } from "./_parts/table";

export const metadata: Metadata = {
  title: "Odds",
  description: "Playoff and title odds for every team from 10,000 simulated seasons, plus bye and last-place odds and how they moved week to week.",
};

const FIELD: Record<OddsMetric, "playoffPct" | "titlePct" | "lastPlacePct"> = {
  playoff: "playoffPct",
  title: "titlePct",
  last: "lastPlacePct",
};

function startWeekOf(ctx: LeagueContext): number {
  const s = ctx.league.settings.start_week;
  return typeof s === "number" && s >= 1 ? s : 1;
}

/** Snapshots at or before this week are preseason. */
const preWeekOf = (ctx: LeagueContext) => startWeekOf(ctx) - 1;

function parseMetric(raw: string | string[] | undefined): OddsMetric {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "title" || v === "last" ? v : "playoff";
}

/**
 * One series per team: the stored weekly snapshots, plus this run when its week is not stored
 * yet. Before the first week is played, the drafted-roster odds light the preseason column.
 */
function buildSeries(
  ctx: LeagueContext,
  history: OddsHistory | null,
  sim: SimResult | null,
  metric: OddsMetric,
  drafted: DraftOdds | null,
  preWeek: number,
): OddsSeries[] {
  const snaps: OddsSnapshot[] = [...(history?.snapshots ?? [])];
  if (sim && !snaps.some((s) => s.week === sim.asOfWeek)) {
    snaps.push({
      week: sim.asOfWeek,
      generatedAt: sim.generatedAt,
      teams: sim.teams.map((t) => ({
        rosterId: t.team.rosterId,
        playoffPct: t.playoffPct,
        titlePct: t.titlePct,
        byePct: t.byePct,
        lastPlacePct: t.lastPlacePct,
        expectedWins: t.expectedWins,
      })),
    });
  }
  if (drafted && !snaps.some((s) => s.week <= preWeek)) {
    snaps.push({
      week: preWeek,
      generatedAt: drafted.generatedAt,
      teams: drafted.teams.map((t) => ({
        rosterId: t.team.rosterId,
        playoffPct: t.playoffPct,
        titlePct: t.titlePct,
        byePct: t.byePct,
        lastPlacePct: t.lastPlacePct,
        expectedWins: t.expectedWins,
      })),
    });
  }
  const field = FIELD[metric];
  return ctx.managers.map((m) => {
    const values = new Map<number, number>();
    for (const s of snaps) {
      const t = s.teams.find((x) => x.rosterId === m.rosterId);
      if (t && Number.isFinite(t[field])) values.set(s.week, t[field]);
    }
    return { rosterId: m.rosterId, name: m.name, teamName: m.teamName, values };
  });
}

function chartWeeks(ctx: LeagueContext, series: OddsSeries[]): { weeks: number[]; preWeek: number } {
  const preWeek = preWeekOf(ctx);
  let hi = ctx.lastWeek;
  let lo = preWeek;
  for (const s of series)
    for (const w of s.values.keys()) {
      hi = Math.max(hi, w);
      lo = Math.min(lo, w);
    }
  const weeks: number[] = [];
  for (let w = lo; w <= hi; w++) weeks.push(w);
  return { weeks, preWeek };
}

/** The headline numbers, shouted: who wins it, who is safest to get in, who finishes last. */
function shouts(rows: OddsTableRow[]): Shout[] {
  if (rows.length < 2) return [];
  const byTitle = [...rows].sort((a, b) => b.titlePct - a.titlePct);
  const byPlayoff = [...rows].sort((a, b) => b.playoffPct - a.playoffPct);
  const byLast = [...rows].sort((a, b) => b.lastPlacePct - a.lastPlacePct);
  const fav = byTitle[0];
  const safest = byPlayoff[0];
  const doomed = byLast[0];
  const decided = fav.titlePct >= 100 && doomed.lastPlacePct >= 100;
  const out: Shout[] = [];
  // A tie at the top means nobody is the favorite: say nothing rather than pick a name.
  if (fav.titlePct > 0 && fav.titlePct > byTitle[1].titlePct) {
    out.push({
      label: decided ? "Champion" : "Title favorite",
      name: fav.team.managerName,
      value: pctText(fav.titlePct),
      unit: "%",
      valueLabel: `${pctText(fav.titlePct)} percent to win the title`,
    });
  }
  if (!decided && safest.playoffPct > 0 && safest.playoffPct > byPlayoff[1].playoffPct && safest !== fav) {
    out.push({
      label: "Safest playoff spot",
      name: safest.team.managerName,
      value: pctText(safest.playoffPct),
      unit: "%",
      valueLabel: `${pctText(safest.playoffPct)} percent to make the playoffs`,
    });
  }
  if (doomed.lastPlacePct > 0 && doomed.lastPlacePct > byLast[1].lastPlacePct) {
    out.push({
      label: decided ? "Last place" : "Likeliest last",
      name: doomed.team.managerName,
      value: pctText(doomed.lastPlacePct),
      unit: "%",
      valueLabel: `${pctText(doomed.lastPlacePct)} percent to finish last`,
      alarm: true,
    });
  }
  return out;
}

function simRows(sim: SimResult): OddsTableRow[] {
  return sim.teams.map((t) => ({
    team: t.team,
    playoffPct: t.playoffPct,
    titlePct: t.titlePct,
    byePct: t.byePct,
    lastPlacePct: t.lastPlacePct,
    expectedWins: t.expectedWins,
    record: record(t.wins, t.losses, t.ties),
    firstPickPct: t.firstPickPct,
  }));
}

function draftRows(odds: DraftOdds): OddsTableRow[] {
  return odds.teams.map((t) => ({
    team: t.team,
    playoffPct: t.playoffPct,
    titlePct: t.titlePct,
    byePct: t.byePct,
    lastPlacePct: t.lastPlacePct,
    expectedWins: t.expectedWins,
    projectedPoints: t.projectedPoints,
    playersDrafted: t.playersDrafted,
  }));
}

function HowItWorks({ ctx, sim, future, drafting }: { ctx: LeagueContext; sim: Pick<SimResult, "runs" | "seed"> | null; future: boolean; drafting: boolean }) {
  const runs = (sim?.runs ?? 10_000).toLocaleString("en-US");
  const teams = ctx.league.settings.playoff_teams ?? 0;
  const byes = teams > 1 ? 2 ** playoffRounds(teams) - teams : 0;
  const receipt: Array<[string, string]> = [
    ["Seasons simulated", runs],
    ["Playoff spots", teams ? String(teams) : "--"],
    ["First-round byes", String(byes)],
  ];
  if (sim) receipt.push(["Seed", String(sim.seed)]);
  return (
    <Panel label="How the odds work" span={4} className="max-lg:order-last">
      <div className="flex flex-1 flex-col gap-5">
        {drafting ? (
          <p className="m-0 text-data">
            The whole season is played out {runs} times with the rosters as drafted so far. Each team scores its best legal lineup from the
            players it has, by projection, and a starting spot it has not filled counts as the best player nobody has drafted. The
            league&apos;s tiebreaks and {teams || "playoff"}-team bracket settle the rest.
          </p>
        ) : (
          <p className="m-0 text-data">
            {future ? "Once there are rosters, the" : "The"} rest of the season {future ? "gets" : "is"} played out {runs} times. Each simulated week
            draws every team&apos;s score from a blend of its projected lineup and what it has actually scored, then the league&apos;s tiebreaks
            and {teams || "playoff"}-team bracket settle the rest.
          </p>
        )}
        {drafting ? null : (
          <p className="m-0 text-fine text-ink-muted">
            <span aria-hidden>* </span>1.01 odds are approximate: next year&apos;s first rookie pick goes to the lowest Max PF among the teams that miss the playoffs.
          </p>
        )}
        <dl className="m-0 mt-auto border-t-2 border-ink">
          {receipt.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 border-b border-ink py-2">
              <dt className="type-label">{k}</dt>
              <dd className="m-0 text-right text-data font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

export default async function OddsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getLeagueContext();
  const [phase, sp] = await Promise.all([pagePhase(ctx, searchParams), searchParams]);
  const metric = parseMetric(sp.show);
  const noTeams = phase === "pre_draft" || phase === "drafting";
  // "If the season started today" while the draft runs and after it until the league's first week
  // is final: the same numbers /draft and the home page show, never a second set from the season sim.
  const basis = phase === "drafting" ? "drafting" : phase === "pre_draft" ? null : await safe(draftOddsBasis(ctx), null, "draft odds basis");

  const [sim, history, draft] = await Promise.all([
    noTeams || basis ? Promise.resolve(null) : safe(runSeasonSim({ ctx }), null, "season sim"),
    noTeams ? Promise.resolve(null) : safe(getOddsHistory(ctx), null, "odds history"),
    basis ? safe(draftOdds(ctx), null, "draft odds") : Promise.resolve(null),
  ]);
  const drafted = draft?.available && draft.teams.length ? draft : null;
  const rows = drafted ? draftRows(drafted) : sim ? simRows(sim) : [];
  const lines = drafted
    ? await surfaceLinesFor(ctx, "odds", surfaceKeys.odds(ctx.season, 0))
    : sim && sim.asOfWeek >= 1
      ? await surfaceLinesFor(ctx, "odds", surfaceKeys.odds(ctx.season, sim.asOfWeek))
      : {};

  const series = buildSeries(ctx, history, sim, metric, drafted, preWeekOf(ctx));
  const { weeks, preWeek } = chartWeeks(ctx, series);
  const preseason = sim ? sim.asOfWeek <= preWeek : false;
  const hrefFor = (m: OddsMetric) => (m === "playoff" ? "/odds#over-time" : `/odds?show=${m}#over-time`);
  const start = ctx.draft?.start_time ?? null;
  const sample = Boolean(sim?.placeholder || history?.placeholder);

  return (
    <Board>
      <PageHead
        bar={`Season simulator · ${ctx.season}`}
        barRight={sim?.placeholder || drafted?.placeholder ? <SampleMark onInk /> : null}
        span={8}
        title={drafted ? "If the season started today" : noTeams ? (phase === "drafting" ? "Odds after the first pick" : "No odds yet") : "Odds"}
        meta={
          drafted ? (
            drafted.basis === "drafting" ? (
              <>
                {ctx.draft?.status === "paused" ? <Tag>Draft paused</Tag> : <Tag square="blink">Draft live</Tag>}
                <span className="text-ink">
                  After {fmtInt(drafted.picksMade)} of {fmtInt(drafted.totalPicks)} picks
                </span>
              </>
            ) : (
              <span className="text-ink">Drafted rosters, before the first game</span>
            )
          ) : noTeams ? (
            phase === "drafting" ? (
              ctx.draft?.status === "paused" ? <Tag>Draft paused</Tag> : <Tag square="blink">Draft live</Tag>
            ) : (
              <span>Startup draft · {start ? etStamp(start) : "start time not set"}</span>
            )
          ) : sim ? (
            <>
              <span className="text-ink">{preseason ? "Preseason, projections only" : `As of Week ${sim.asOfWeek}`}</span>
              <span>Run {etStamp(sim.generatedAt)}</span>
            </>
          ) : null
        }
      >
        {rows.length ? (
          <ShoutList items={shouts(rows)} />
        ) : noTeams ? (
          <p className="measure m-0 text-body md:text-lede">
            {phase === "drafting"
              ? "The odds post with the first pick and move with every one after it: playoff and title chances for every team, from the players it has drafted so far."
              : "The simulator needs rosters to simulate. The first odds post with the first pick of the draft: playoff and title chances for every team, then they move every week."}
          </p>
        ) : (
          <p className="measure m-0 text-body">The simulator did not finish this time. Refresh in a minute.</p>
        )}
      </PageHead>
      <HowItWorks ctx={ctx} sim={sim ?? drafted} future={noTeams && !drafted} drafting={Boolean(drafted)} />

      {rows.length || !noTeams ? (
        <Panel
          label={
            drafted ? (
              <>
                <span className="sm:hidden">Odds, drafted rosters</span>
                <span className="hidden sm:inline">Playoff and title odds, drafted rosters</span>
              </>
            ) : (
              "Playoff and title odds"
            )
          }
          id="odds-table"
          labelRight={sim?.placeholder || drafted?.placeholder ? <SampleMark onInk /> : null}
          pad={!rows.length}
        >
          {rows.length ? (
            <OddsTable rows={rows} runs={sim?.runs ?? drafted?.runs ?? 10_000} lines={lines} />
          ) : (
            <DotMatrixFill label={sim ? "No teams to simulate." : "The simulator did not answer. Refresh in a minute."} rows={8} density={0.3} />
          )}
        </Panel>
      ) : null}

      <Panel
        id="over-time"
        label={noTeams && !drafted ? "Odds over time" : `${METRICS[metric].long.replace(/^./, (c) => c.toUpperCase())} over time`}
        labelRight={sample && !noTeams ? <SampleMark onInk /> : null}
        pad={false}
        className="scroll-mt-4"
      >
        <div className="flex flex-col gap-4 px-4 pb-5 pt-6 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="m-0 max-w-[52ch] text-data">
            {drafted
              ? "One board per team, one column per week, 5% per dot. Pre is the drafted-roster odds; the week columns light up as the weeks are played."
              : noTeams
                ? "One board per team, one column per week, 5% per dot. Nothing is lit until the first pick."
                : "One board per team, one column per week, 5% per dot. The big number is the latest run. Unlit columns are weeks still to come."}
          </p>
          {noTeams && !drafted ? null : <MetricSwitch metric={metric} hrefFor={hrefFor} />}
        </div>
        {noTeams && !drafted ? (
          <div className="border-t-2 border-ink px-4 pb-6 pt-6 md:px-6">
            <DotMatrixFill label="No odds yet. The first ones post with the first pick." rows={6} />
          </div>
        ) : (
          <OddsChart series={series} weeks={weeks} preWeek={preWeek} metric={metric} />
        )}
      </Panel>
    </Board>
  );
}
