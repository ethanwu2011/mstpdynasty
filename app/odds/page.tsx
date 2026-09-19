import type { Metadata } from "next";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";
import { type Shout, ShoutList } from "@/components/ShoutList";
import { SampleMark, Tag } from "@/components/Tag";
import { getLeagueContext, playoffRounds } from "@/lib/league";
import { getOddsHistory, runSeasonSim } from "@/lib/models";
import type { LeagueContext, OddsHistory, OddsSnapshot, SimResult } from "@/lib/types";
import { etStamp } from "../_lib/format";
import { pagePhase, safe, type SearchParams } from "../_lib/phase";
import { METRICS, MetricSwitch, OddsChart, type OddsMetric, type OddsSeries } from "./_parts/chart";
import { OddsTable, pctText } from "./_parts/table";

export const metadata: Metadata = {
  title: "Odds",
  description: "Playoff, bye, title and last-place odds for every team, from 10,000 simulated seasons, and how they moved week to week.",
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

function parseMetric(raw: string | string[] | undefined): OddsMetric {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "title" || v === "last" ? v : "playoff";
}

/** One series per team: the stored weekly snapshots, plus this run when its week is not stored yet. */
function buildSeries(ctx: LeagueContext, history: OddsHistory | null, sim: SimResult | null, metric: OddsMetric): OddsSeries[] {
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
  const preWeek = startWeekOf(ctx) - 1;
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

function shouts(sim: SimResult): Shout[] {
  if (sim.teams.length < 2) return [];
  const byTitle = [...sim.teams].sort((a, b) => b.titlePct - a.titlePct);
  const byLast = [...sim.teams].sort((a, b) => b.lastPlacePct - a.lastPlacePct);
  const fav = byTitle[0];
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

function HowItWorks({ ctx, sim, future }: { ctx: LeagueContext; sim: SimResult | null; future: boolean }) {
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
        <p className="m-0 text-data">
          {future ? "Once there are rosters, the" : "The"} rest of the season {future ? "gets" : "is"} played out {runs} times. Each simulated week draws
          every team&apos;s score from a blend of its projected lineup and what it has actually scored, then the league&apos;s tiebreaks and{" "}
          {teams || "playoff"}-team bracket settle the rest.
        </p>
        <p className="m-0 text-fine text-ink-muted">
          <span aria-hidden>* </span>1.01 odds are approximate: they assume the worst record picks first in next year&apos;s rookie draft.
        </p>
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

  const [sim, history] = noTeams
    ? [null, null]
    : await Promise.all([safe(runSeasonSim({ ctx }), null, "season sim"), safe(getOddsHistory(ctx), null, "odds history")]);

  const series = buildSeries(ctx, history, sim, metric);
  const { weeks, preWeek } = chartWeeks(ctx, series);
  const preseason = sim ? sim.asOfWeek <= preWeek : false;
  const hrefFor = (m: OddsMetric) => (m === "playoff" ? "/odds#over-time" : `/odds?show=${m}#over-time`);
  const start = ctx.draft?.start_time ?? null;
  const sample = Boolean(sim?.placeholder || history?.placeholder);

  return (
    <Board>
      <PageHead
        bar={`Season simulator · ${ctx.season}`}
        barRight={sim?.placeholder ? <SampleMark onInk /> : null}
        span={8}
        title={noTeams ? (phase === "drafting" ? "Odds after the draft" : "No odds yet") : "Odds"}
        meta={
          noTeams ? (
            phase === "drafting" ? (
              <Tag square="blink">Draft live</Tag>
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
        {noTeams ? (
          <p className="measure m-0 text-body md:text-lede">
            {phase === "drafting"
              ? "Rosters are still filling up. The first odds post when the last pick is in, then they move every week."
              : "The simulator needs rosters to simulate. The first odds post when the draft ends: playoff, bye, title and last-place chances for every team, plus who is headed for the 1.01. Then they move every week."}
          </p>
        ) : sim ? (
          <ShoutList items={shouts(sim)} />
        ) : (
          <p className="measure m-0 text-body">The simulator did not finish this time. Refresh in a minute.</p>
        )}
      </PageHead>
      <HowItWorks ctx={ctx} sim={sim} future={noTeams} />

      {noTeams ? null : (
        <Panel label="The odds" labelRight={sim?.placeholder ? <SampleMark onInk /> : null} pad={!sim}>
          {sim && sim.teams.length ? (
            <OddsTable sim={sim} />
          ) : (
            <DotMatrixFill label={sim ? "No teams to simulate." : "The simulator did not answer. Refresh in a minute."} rows={8} density={0.3} />
          )}
        </Panel>
      )}

      <Panel
        id="over-time"
        label={noTeams ? "Odds over time · Lights off" : `${METRICS[metric].label} odds over time`}
        labelRight={sample && !noTeams ? <SampleMark onInk /> : null}
        pad={false}
        className="scroll-mt-4"
      >
        <div className="flex flex-col gap-4 px-4 pb-5 pt-6 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="m-0 max-w-[52ch] text-data">
            {noTeams
              ? "One board per team, one column per week, 5% per dot. The columns light up as the weeks are played."
              : "One board per team, one column per week, 5% per dot. The big number is the latest run. Unlit columns are weeks still to come."}
          </p>
          {noTeams ? null : <MetricSwitch metric={metric} hrefFor={hrefFor} />}
        </div>
        <OddsChart series={series} weeks={weeks} preWeek={preWeek} metric={metric} />
      </Panel>
    </Board>
  );
}
