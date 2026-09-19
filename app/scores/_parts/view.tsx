/** The scores page for any week and any league phase. Data comes only through the contract functions. */
import type { CSSProperties, ReactNode } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Button, PixelArrow } from "@/components/Button";
import { cx } from "@/components/cx";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { PageHead } from "@/components/PageHead";
import { Board, Panel } from "@/components/Panel";
import { SampleMark, Tag } from "@/components/Tag";
import { weeklyFacts } from "@/lib/facts";
import { getWinProbabilities } from "@/lib/models";
import { getSchedule, getWinnersBracket } from "@/lib/sleeper";
import type { LeagueContext, MatchupFact, NflGame, SeasonPhase, SleeperBracketMatch, TeamWeekFact, WinProb, WinProbWeek } from "@/lib/types";
import { WeekInNumbers } from "../../_home/season";
import { formatEt } from "@/lib/time";
import { etStamp } from "../../_lib/format";
import { safe } from "../../_lib/phase";
import { MatchupPanel } from "./matchup";
import { WeekRail } from "./rail";

/* ------------------------------ week math ------------------------------ */

export function startWeekOf(ctx: LeagueContext): number {
  const s = ctx.league.settings.start_week;
  return typeof s === "number" && s >= 1 ? s : 1;
}

/** The week /scores opens on, or null when there are no teams to score yet. */
export function defaultWeek(ctx: LeagueContext, phase: SeasonPhase): number | null {
  if (phase === "pre_draft" || phase === "drafting") return null;
  if (ctx.week >= 1) return Math.min(ctx.week, ctx.lastWeek);
  return startWeekOf(ctx);
}

/** Weeks with final results: everything before the current week in season, all of them after. */
function playedThrough(ctx: LeagueContext, phase: SeasonPhase): number {
  if (phase === "in_season") return ctx.week;
  if (phase === "complete") return ctx.lastWeek;
  return ctx.week >= 1 ? ctx.lastWeek : 0;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Sep 4 to Sep 8" from the NFL schedule. */
function weekDates(schedule: NflGame[], week: number): string | null {
  const dates = schedule
    .filter((g) => g.week === week && /^\d{4}-\d{2}-\d{2}$/.test(g.date))
    .map((g) => g.date)
    .sort();
  if (!dates.length) return null;
  const f = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return DAY.format(Date.UTC(y, m - 1, day));
  };
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? f(first) : `${f(first)} to ${f(last)}`;
}

/** Playoff game names from the winners bracket (one week per round). */
function bracketTag(bracket: SleeperBracketMatch[], ctx: LeagueContext, week: number, m: WinProb): string | null {
  if (week < ctx.playoffWeekStart || !bracket.length) return null;
  const round = week - ctx.playoffWeekStart + 1;
  const ids = new Set([m.home.team.rosterId, m.away.team.rosterId]);
  const match = bracket.find((x) => x.r === round && x.t1 !== null && x.t2 !== null && ids.has(x.t1) && ids.has(x.t2));
  if (!match) return null;
  if (match.p === 1) return "Title game";
  if (match.p === 3) return "Third place game";
  if (match.p === 5) return "Fifth place game";
  return "Playoffs";
}

function matchupFactFor(facts: MatchupFact[] | undefined, m: WinProb): MatchupFact | undefined {
  const ids = new Set([m.home.team.rosterId, m.away.team.rosterId]);
  return facts?.find((f) => ids.has(f.home.team.rosterId) && ids.has(f.away.team.rosterId));
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);

/* ------------------------------ pre-draft and drafting ------------------------------ */

function UnlitScore({ className }: { className?: string }) {
  // Bulbs off: every segment of "888.88" in paper shade. Decorative; the copy says what is missing.
  return (
    <span aria-hidden className={cx("type-numeral whitespace-nowrap text-paper-shade", className)}>
      888<span className="numeral-point" />
      88
    </span>
  );
}

function UnlitGame({ n }: { n: number }) {
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 bg-paper px-4 py-3 sm:flex sm:flex-col sm:items-stretch sm:gap-3 sm:py-5 md:px-5">
      <span className="type-label text-ink-muted">Game {n}</span>
      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start sm:gap-1">
        <UnlitScore className="text-d30 lg:text-d40 xl:text-d60" />
        <UnlitScore className="text-d30 lg:text-d40 xl:text-d60" />
      </div>
      <span aria-hidden className="col-span-2 mt-1 grid gap-[2px] sm:mt-auto" style={{ gridTemplateColumns: "repeat(20, minmax(0, 1fr))" }}>
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className="block aspect-square bg-paper-shade" />
        ))}
      </span>
    </li>
  );
}

export function DarkBoard({ ctx, phase }: { ctx: LeagueContext; phase: "pre_draft" | "drafting" }) {
  const games = Math.floor((ctx.league.total_rosters || ctx.rosters.length) / 2);
  const start = ctx.draft?.start_time ?? null;
  const drafting = phase === "drafting";
  return (
    <Board>
      <PageHead
        bar="Scoreboard"
        span={8}
        title={drafting ? "Drafting, not scoring" : "The board is dark"}
        meta={
          drafting ? (
            <>
              {ctx.draft?.status === "paused" ? <Tag>Draft paused</Tag> : <Tag square="blink">Draft live</Tag>}
              <span>{ctx.draft ? `${ctx.draft.settings.rounds} rounds` : "Startup draft"}</span>
            </>
          ) : (
            <span>Startup draft · {start ? etStamp(start) : "start time not set"}</span>
          )
        }
      >
        <p className="measure m-0 text-body md:text-lede">
          {drafting
            ? "Rosters are still being built, so there is nothing to score. Matchups post when the last pick is in, and this board lights up at the first kickoff after that."
            : "Nobody has a roster yet, so nobody has a score. Matchups post when the startup draft ends, and this board lights up at the first kickoff after that."}
        </p>
        <div className="mt-auto">
          <Button href="/draft" variant="secondary">
            {drafting ? "Watch the draft" : "The draft board"}
            <PixelArrow />
          </Button>
        </div>
      </PageHead>

      <Panel label="What lights up here" span={4}>
        <ul className="m-0 list-none border-t-2 border-ink p-0">
          {[
            ["Scores", `All ${inWords(games)} matchups, refreshed every minute while games are on.`],
            ["Win odds", "A 20-dot bar per game that moves as the points come in."],
            ["Box scores", "Every starter's points, and who you left on the bench."],
            ["Bench left", "What the best legal lineup would have scored over yours."],
          ].map(([k, v]) => (
            <li key={k} className="flex flex-col gap-1 border-b border-ink py-3">
              <span className="type-label">{k}</span>
              <span className="text-data">{v}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel label="Scoreboard · Lights off" labelRight={<span className="hidden text-paper-shade sm:inline">{inWords(games)} games a week</span>} pad={false}>
        <ol
          aria-label={`${games} matchups, no scores yet`}
          className="m-0 grid list-none grid-cols-1 gap-px bg-ink p-0 sm:grid-cols-[repeat(var(--games),minmax(0,1fr))]"
          style={{ "--games": Math.max(1, games) } as CSSProperties}
        >
          {Array.from({ length: games }, (_, i) => (
            <UnlitGame key={i} n={i + 1} />
          ))}
        </ol>
      </Panel>
    </Board>
  );
}

/* ------------------------------ filler tile ------------------------------ */

function Legend({ half }: { half: boolean }) {
  const items: Array<{ key: string; mark: ReactNode; text: string }> = [
    {
      key: "dots",
      mark: (
        <span aria-hidden className="flex gap-[2px]">
          <span className="block size-3 bg-ink" />
          <span className="block size-3 bg-ink" />
          <span className="block size-3 border-2 border-ink" />
        </span>
      ),
      text: "Twenty dots per game, 5% each. Filled dots are the first team's chance, hollow dots the second's.",
    },
    { key: "live", mark: <Tag square="blink">Live</Tag>, text: "Games in progress. The page refreshes itself every minute." },
    { key: "final", mark: <Tag>Final</Tag>, text: "Every starter's game is over. The winner is set in bold." },
    { key: "proj", mark: <Tag tone="outline">Proj</Tag>, text: "No kickoff yet, so scores are projected points." },
    { key: "bench", mark: <span className="type-label">Bench left</span>, text: "Points the best legal lineup would have added to yours." },
  ];
  return (
    <Panel label="How to read the board" className={half ? "xl:col-span-6" : undefined}>
      <dl className={cx("m-0 grid border-t-2 border-ink md:grid-cols-2 md:gap-x-8", half && "xl:grid-cols-1")}>
        {items.map((i) => (
          <div key={i.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 border-b border-ink py-3">
            <dt className="flex items-center">{i.mark}</dt>
            <dd className="m-0 text-data">{i.text}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/* ------------------------------ the week ------------------------------ */

const BASIS: Record<WinProbWeek["basis"], string> = {
  projections: "Projected",
  live: "Live",
  final: "Final",
  none: "No games",
};

export async function WeekScores({ ctx, phase, week }: { ctx: LeagueContext; phase: SeasonPhase; week: number }) {
  const through = playedThrough(ctx, phase);
  const factsWanted = week <= through;
  const [wp, facts, bracket, schedule] = await Promise.all([
    safe(getWinProbabilities(week, ctx), null, "win probabilities"),
    factsWanted ? safe(weeklyFacts(week, ctx), null, "weekly facts") : Promise.resolve(null),
    week >= ctx.playoffWeekStart ? safe(getWinnersBracket(ctx.leagueId), [] as SleeperBracketMatch[], "bracket") : Promise.resolve([]),
    safe(getSchedule(ctx.season), [] as NflGame[], "schedule"),
  ]);

  const basis = wp?.basis ?? "none";
  const live = basis === "live";
  // Bench points only mean something once games have been played.
  const showFacts = Boolean(facts) && (basis === "live" || basis === "final");
  const teamFacts = new Map<number, TeamWeekFact>(showFacts && facts ? facts.teams.map((t) => [t.team.rosterId, t]) : []);
  const dates = weekDates(schedule, week);
  const round = week >= ctx.playoffWeekStart ? week - ctx.playoffWeekStart + 1 : 0;
  const matchups = wp?.matchups ?? [];
  const odd = matchups.length % 2 === 1;

  return (
    <Board>
      <AutoRefresh enabled={live} seconds={60} />
      <PageHead
        bar={`Scoreboard · ${ctx.season}`}
        barRight={wp?.placeholder || (showFacts && facts?.placeholder) ? <SampleMark onInk /> : null}
        live={live}
        title={`Week ${week}`}
        meta={
          <>
            {wp ? (
              basis === "live" ? (
                <Tag square="blink">Live</Tag>
              ) : basis === "final" ? (
                <Tag>Final</Tag>
              ) : (
                <Tag tone="outline">{BASIS[basis]}</Tag>
              )
            ) : null}
            {round ? <span className="text-ink">Playoffs, round {round}</span> : null}
            {dates ? <span>{dates}</span> : null}
            {live && wp ? <span>Updated {formatEt(wp.generatedAt, { hour: "numeric", minute: "2-digit" })} ET</span> : null}
          </>
        }
        aside={
          <WeekRail
          startWeek={startWeekOf(ctx)}
          playoffWeekStart={ctx.playoffWeekStart}
          lastWeek={ctx.lastWeek}
          selected={week}
          current={phase === "in_season" ? ctx.week : 0}
          playedThrough={through}
            live={live && week === ctx.week}
          />
        }
      />

      {!wp ? (
        <Panel label={`Week ${week}`}>
          <DotMatrixFill label="Scores did not load. Sleeper or ESPN did not answer. Refresh in a minute." rows={8} density={0.3} />
        </Panel>
      ) : matchups.length === 0 ? (
        <Panel label={`Week ${week}`}>
          <DotMatrixFill
            label={week < startWeekOf(ctx) ? `The league starts in Week ${startWeekOf(ctx)}. Nothing was played here.` : `No matchups on the board for Week ${week}.`}
            rows={8}
          />
        </Panel>
      ) : (
        <>
          {matchups.map((m) => (
            <MatchupPanel
              key={m.matchupId}
              wp={m}
              basis={basis}
              facts={teamFacts}
              matchupFact={showFacts ? matchupFactFor(facts?.matchups, m) : undefined}
              tag={bracketTag(bracket, ctx, week, m)}
              pair
            />
          ))}
          {showFacts && facts ? (
            <Panel label={`Week ${week} by the numbers`} className={odd ? "xl:col-span-6" : undefined}>
              <WeekInNumbers facts={facts} bare />
            </Panel>
          ) : (
            <Legend half={odd} />
          )}
        </>
      )}
    </Board>
  );
}
