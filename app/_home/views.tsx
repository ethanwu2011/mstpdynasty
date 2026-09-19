/** The home page for each league phase. Data comes only through the contract functions. */
import { Suspense } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";
import { lineOf } from "@/components/RowLine";
import { listIssues, listRoasts } from "@/lib/archive";
import { draftFacts, lastCompletedWeek, shameEntries, weeklyFacts } from "@/lib/facts";
import { ensurePickRoast } from "@/lib/jobs";
import { standingsFromRosters } from "@/lib/league";
import { draftOdds, draftOddsBasis, getWinProbabilities, runSeasonSim } from "@/lib/models";
import { currentLines, draftOddsRows, oddsRows, surfaceKeys } from "@/lib/roast";
import { getWinnersBracket } from "@/lib/sleeper";
import type { DraftPickFact, LeagueContext, Roast, SurfaceLineMap } from "@/lib/types";
import { record } from "../_lib/format";
import { surfaceLinesFor } from "../_lib/lines";
import { DRAFT_ODDS_NOTE, OddsBoard, StartedToday } from "../_lib/odds-board";
import { safe } from "../_lib/phase";
import { lastPlaceFallback, latestLead, pickFallback, roastToBlock, weeklyFallback } from "../_lib/roast-view";
import { recapWeek } from "../newsletter/issue-kinds";
import { BoardStrip, DraftCountdownLead, DraftOrderPanel, EarlierRoastsPanel, LeagueRulesPanel, OnTheClockPanel } from "./draft";
import { FinalStandings, Scoreboard, StandingsStrip, WeekInNumbers } from "./season";
import { IssuesPanel, LeadPanel, ShamePanel } from "./shared";

/** The last week with final scores: Sleeper's last scored leg when it is not ahead of the league week. */
function lastScoredWeek(ctx: LeagueContext): number {
  const scored = ctx.league.settings.last_scored_leg ?? 0;
  return scored > 0 && scored <= ctx.week ? scored : ctx.week - 1;
}

/** The one-liner for whatever leads the page: a pick or a trade. */
function leadLine(roast: Roast | undefined, maps: { draft?: SurfaceLineMap; trades?: SurfaceLineMap }): string | null {
  const f = roast?.facts;
  if (!f || Array.isArray(f)) return null;
  if (f.kind === "draft_pick") return lineOf(maps.draft, f.pickNo);
  if (f.kind === "trade") return lineOf(maps.trades, f.transactionId);
  return null;
}

/**
 * The newest pick's lead, written on the spot if nobody has written it yet. The page streams:
 * the facts-only card shows at once and the written line replaces it when it lands.
 */
async function LivePickLead({
  ctx,
  pick,
  picks,
  pickLines,
  placeholder,
}: {
  ctx: LeagueContext;
  pick: DraftPickFact;
  picks: DraftPickFact[];
  pickLines: SurfaceLineMap;
  placeholder?: boolean;
}) {
  const r = await ensurePickRoast(ctx, pick, picks);
  const data = r ? roastToBlock(r) : pickFallback(pick, placeholder);
  const line = r ? leadLine(r, { draft: pickLines }) : lineOf(pickLines, pick.pickNo);
  return <LeadPanel data={data} line={line} emptyLabel="Pick 1.01" empty={<EmptyLead line="The draft is open and nobody has picked." />} />;
}

/** Picks with no stat-table line yet borrow the first sentence of their written post. */
function withWrittenLines(lines: SurfaceLineMap, roasts: Roast[]): SurfaceLineMap {
  const out: SurfaceLineMap = { ...lines };
  for (const r of roasts) {
    if (r.source !== "llm") continue;
    const n = pickNoOf(r);
    if (!n || out[String(n)]) continue;
    const first = r.text.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? r.text;
    out[String(n)] = first.trim();
  }
  return out;
}

function pickNoOf(r: Roast): number {
  return !Array.isArray(r.facts) && r.facts.kind === "draft_pick" ? r.facts.pickNo : 0;
}

function EmptyLead({ line }: { line: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <p className="type-display m-0 text-j3 md:text-j4">Nothing yet</p>
      <DotMatrixFill label={line} rows={8} />
    </div>
  );
}

/* ------------------------------ pre-draft ------------------------------ */

export async function HomePreDraft({ ctx }: { ctx: LeagueContext }) {
  const [roasts, issues, shame] = await Promise.all([
    safe(listRoasts(ctx.leagueId, undefined, 1), [], "roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(shameEntries(ctx), null, "shame"),
  ]);
  // A pick trade can land before the draft. If one exists it leads; otherwise the clock does.
  const lead = latestLead(roasts[0], issues[0]);
  return (
    <Board>
      {lead ? (
        <LeadPanel data={lead} />
      ) : (
        <Panel label="Startup draft" span={8} id="latest">
          <DraftCountdownLead ctx={ctx} serverNow={ctx.loadedAt} />
        </Panel>
      )}
      <DraftOrderPanel ctx={ctx} span={4} />
      <LeagueRulesPanel ctx={ctx} span={4} />
      <IssuesPanel issues={issues} recapWeek={recapWeek(ctx, issues)} span={4} mdSpan={6} />
      <ShamePanel board={shame} span={4} mdSpan={6} limit={3} hideSample />
    </Board>
  );
}

/* ------------------------------ drafting ------------------------------ */

export async function HomeDrafting({ ctx }: { ctx: LeagueContext }) {
  const draftId = ctx.draft?.draft_id ?? "";
  const [facts, pickRoasts, issues, shame, odds, pickLines, oddsLines, shameLines] = await Promise.all([
    safe(draftFacts(ctx), null, "draft facts"),
    safe(listRoasts(ctx.leagueId, "draft_pick"), [], "pick roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(shameEntries(ctx), null, "shame"),
    safe(draftOdds(ctx), null, "draft odds"),
    draftId ? surfaceLinesFor(ctx, "draft", surfaceKeys.draft(draftId)) : Promise.resolve({} as SurfaceLineMap),
    surfaceLinesFor(ctx, "odds", surfaceKeys.odds(ctx.season, 0)),
    surfaceLinesFor(ctx, "shame", surfaceKeys.shame(ctx.season)),
  ]);
  const latestPick = facts?.picks.length ? [...facts.picks].sort((a, b) => b.pickNo - a.pickNo)[0] : null;
  // Picks written in the same tick share a timestamp, so order them by pick number, newest first.
  // (listRoasts reads every stored pick either way, so asking for all of them costs nothing more.)
  const byPick = [...pickRoasts].sort((a, b) => pickNoOf(b) - pickNoOf(a) || b.createdAt - a.createdAt);
  const leadRoast = latestPick ? byPick.find((r) => pickNoOf(r) === latestPick.pickNo) : byPick[0];
  const lead = leadRoast ? roastToBlock(leadRoast) : latestPick ? pickFallback(latestPick, facts?.placeholder) : null;
  const line = leadRoast ? leadLine(leadRoast, { draft: pickLines }) : latestPick ? lineOf(pickLines, latestPick.pickNo) : null;
  const earlier = byPick.filter((r) => r !== leadRoast).slice(0, 4);
  const live = ctx.draft?.status === "drafting";
  const oddsReady = Boolean(odds?.available && odds.teams.length > 0);
  return (
    <Board>
      <AutoRefresh enabled={live} seconds={30} />
      {latestPick && facts && leadRoast?.source !== "llm" ? (
        <Suspense
          fallback={
            <LeadPanel
              data={lead}
              line={line}
              emptyLabel="Pick 1.01"
              empty={<EmptyLead line="The draft is open and nobody has picked." />}
              below={<p className="type-label text-ink-muted">Writing this pick up. It lands in a few seconds.</p>}
            />
          }
        >
          <LivePickLead ctx={ctx} pick={latestPick} picks={facts.picks} pickLines={pickLines} placeholder={facts.placeholder} />
        </Suspense>
      ) : (
        <LeadPanel
          data={lead}
          line={line}
          emptyLabel="Pick 1.01"
          empty={<EmptyLead line="The draft is open and nobody has picked." />}
        />
      )}
      <OnTheClockPanel ctx={ctx} facts={facts} span={4} />
      <BoardStrip facts={facts} lines={withWrittenLines(pickLines, byPick)} />
      {oddsReady && odds ? (
        <OddsBoard
          label={<StartedToday />}
          note={DRAFT_ODDS_NOTE}
          rows={odds.teams.map((t) => ({
            team: t.team,
            playoffPct: t.playoffPct,
            titlePct: t.titlePct,
            lastPlacePct: t.lastPlacePct,
            detail: `${t.playersDrafted} ${t.playersDrafted === 1 ? "player" : "players"}, ${t.projectedPoints.toFixed(1)} pts`,
          }))}
          lines={currentLines(oddsLines, draftOddsRows(odds))}
          more={{ href: "/odds", label: "Full odds" }}
          id="odds"
          span={8}
        />
      ) : null}
      <IssuesPanel issues={issues} recapWeek={recapWeek(ctx, issues)} span={oddsReady ? 4 : 12} />
      {earlier.length ? (
        <EarlierRoastsPanel roasts={earlier} lines={pickLines} span={12} />
      ) : (
        <ShamePanel board={shame} lines={shameLines} span={12} hideSample />
      )}
    </Board>
  );
}

/* ------------------------------ in season ------------------------------ */

export async function HomeInSeason({ ctx }: { ctx: LeagueContext }) {
  const week = Math.max(1, ctx.week);
  const scored = lastScoredWeek(ctx);
  // Until the league's first week is final, the odds are the drafted-roster ones, the same numbers /draft and /odds show.
  const basis = await safe(draftOddsBasis(ctx), null, "draft odds basis");
  const [roasts, issues, wp, shame, weekly, sim, drafted, matchupLines, standingLines, shameLines, tradeLines] = await Promise.all([
    safe(listRoasts(ctx.leagueId, undefined, 1), [], "roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(getWinProbabilities(week, ctx), null, "win probabilities"),
    safe(shameEntries(ctx), null, "shame"),
    scored >= 1 ? safe(weeklyFacts(scored, ctx), null, "weekly facts") : Promise.resolve(null),
    basis ? Promise.resolve(null) : safe(runSeasonSim({ ctx }), null, "season sim"),
    basis ? safe(draftOdds(ctx), null, "draft odds") : Promise.resolve(null),
    surfaceLinesFor(ctx, "matchups", surfaceKeys.matchups(ctx.season, week)),
    surfaceLinesFor(ctx, "standings", surfaceKeys.standings(ctx.season, lastCompletedWeek(ctx))),
    surfaceLinesFor(ctx, "shame", surfaceKeys.shame(ctx.season)),
    surfaceLinesFor(ctx, "trades", surfaceKeys.trades()),
  ]);
  const draftBoard = drafted?.available && drafted.teams.length ? drafted : null;
  // Draft odds lines live at asOfWeek 0; a season sim's lines only exist once a week is final.
  const oddsLines = draftBoard
    ? currentLines(await surfaceLinesFor(ctx, "odds", surfaceKeys.odds(ctx.season, 0)), draftOddsRows(draftBoard))
    : sim && sim.asOfWeek >= 1
      ? currentLines(await surfaceLinesFor(ctx, "odds", surfaceKeys.odds(ctx.season, sim.asOfWeek)), oddsRows(sim))
      : {};
  const leadRoast = roasts[0];
  const lead = latestLead(leadRoast, issues[0]) ?? (weekly ? weeklyFallback(weekly) : null);
  const line = leadRoast && lead?.at === leadRoast.createdAt ? leadLine(leadRoast, { trades: tradeLines }) : null;
  const standings = standingsFromRosters(ctx);
  const recordOf = new Map(standings.map((r) => [r.team.rosterId, record(r.wins, r.losses, r.ties)]));
  return (
    <Board>
      <AutoRefresh enabled={wp?.basis === "live"} seconds={60} />
      <LeadPanel
        data={lead}
        line={line}
        below={weekly ? <WeekInNumbers facts={weekly} className="hidden lg:flex" /> : null}
        empty={<EmptyLead line="No bad decisions on the board this season." />}
      />
      <Scoreboard wp={wp} week={week} lines={matchupLines} span={4} />
      {weekly ? (
        <Panel label={`Week ${weekly.week} by the numbers`} className="lg:hidden">
          <WeekInNumbers facts={weekly} bare />
        </Panel>
      ) : null}
      <StandingsStrip rows={standings} lines={standingLines} />
      {draftBoard ? (
        <OddsBoard
          label="Playoff and title odds"
          labelRight={<span className="text-paper-shade">Drafted rosters</span>}
          note="From the drafted rosters, played out over 10,000 seasons, until the first week is played."
          rows={draftBoard.teams.map((t) => ({
            team: t.team,
            playoffPct: t.playoffPct,
            titlePct: t.titlePct,
            lastPlacePct: t.lastPlacePct,
            detail: `${t.projectedPoints.toFixed(1)} projected a week`,
          }))}
          lines={oddsLines}
          more={{ href: "/odds", label: "Full odds" }}
          id="odds"
          span={8}
        />
      ) : sim && sim.teams.length ? (
        <OddsBoard
          label="Playoff and title odds"
          labelRight={<span className="text-paper-shade">{sim.asOfWeek > 0 ? `Through Week ${sim.asOfWeek}` : "Preseason"}</span>}
          rows={sim.teams.map((t) => ({
            team: t.team,
            playoffPct: t.playoffPct,
            titlePct: t.titlePct,
            lastPlacePct: t.lastPlacePct,
            detail: `${recordOf.get(t.team.rosterId) ?? record(t.wins, t.losses, t.ties)}, ${t.expectedWins.toFixed(1)} expected wins`,
          }))}
          lines={oddsLines}
          more={{ href: "/odds", label: "Full odds" }}
          id="odds"
          span={8}
        />
      ) : null}
      <IssuesPanel issues={issues} recapWeek={recapWeek(ctx, issues)} span={draftBoard || (sim && sim.teams.length) ? 4 : 12} />
      <ShamePanel board={shame} lines={shameLines} span={12} />
    </Board>
  );
}

/* ------------------------------ offseason and complete ------------------------------ */

export async function HomeOffseason({ ctx }: { ctx: LeagueContext }) {
  const rows = standingsFromRosters(ctx);
  const [roasts, issues, shame, bracket, shameLines] = await Promise.all([
    safe(listRoasts(ctx.leagueId, undefined, 1), [], "roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(shameEntries(ctx), null, "shame"),
    safe(getWinnersBracket(ctx.leagueId), [], "winners bracket"),
    surfaceLinesFor(ctx, "shame", surfaceKeys.shame(ctx.season)),
  ]);
  const championId = bracket.find((m) => m.p === 1)?.w ?? null;
  const lead = latestLead(roasts[0], issues[0]) ?? lastPlaceFallback(rows, ctx.season);
  return (
    <Board>
      <LeadPanel data={lead} empty={<EmptyLead line="The season ended with nobody on the wall." />} />
      <FinalStandings rows={rows} championId={championId} season={ctx.season} span={4} />
      <ShamePanel board={shame} lines={shameLines} span={8} />
      <IssuesPanel issues={issues} recapWeek={recapWeek(ctx, issues)} span={4} />
    </Board>
  );
}
