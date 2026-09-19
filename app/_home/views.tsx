/** The home page for each league phase. Data comes only through the contract functions. */
import { AutoRefresh } from "@/components/AutoRefresh";
import { DotMatrixFill } from "@/components/DotMatrixFill";
import { Board, Panel } from "@/components/Panel";
import { listIssues, listRoasts } from "@/lib/archive";
import { draftFacts, shameEntries, weeklyFacts } from "@/lib/facts";
import { standingsFromRosters } from "@/lib/league";
import { getWinProbabilities } from "@/lib/models";
import { getWinnersBracket } from "@/lib/sleeper";
import type { LeagueContext } from "@/lib/types";
import { safe } from "../_lib/phase";
import { lastPlaceFallback, latestLead, pickFallback, roastToBlock, weeklyFallback } from "../_lib/roast-view";
import { BoardStrip, DraftCountdownLead, DraftOrderPanel, EarlierRoastsPanel, LeagueRulesPanel, OnTheClockPanel } from "./draft";
import { FinalStandings, Scoreboard, StandingsStrip, WeekInNumbers } from "./season";
import { IssuesPanel, LeadPanel, ShamePanel } from "./shared";

/** The last week with final scores: Sleeper's last scored leg when it is not ahead of the league week. */
function lastScoredWeek(ctx: LeagueContext): number {
  const scored = ctx.league.settings.last_scored_leg ?? 0;
  return scored > 0 && scored <= ctx.week ? scored : ctx.week - 1;
}

function EmptyLead({ line }: { line: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <p className="type-display m-0 text-j3 md:text-j4">No roast yet</p>
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
  // A pick trade can get roasted before the draft. If one exists it leads; otherwise the clock does.
  const lead = latestLead(roasts[0], issues[0]);
  return (
    <Board>
      {lead ? (
        <LeadPanel data={lead} />
      ) : (
        <Panel label="The latest roast" labelRight={<span className="text-paper-shade">None yet</span>} span={8} id="latest-roast">
          <DraftCountdownLead ctx={ctx} serverNow={ctx.loadedAt} />
        </Panel>
      )}
      <DraftOrderPanel ctx={ctx} span={4} />
      <LeagueRulesPanel ctx={ctx} span={4} />
      <IssuesPanel issues={issues} span={4} mdSpan={6} />
      <ShamePanel board={shame} span={4} mdSpan={6} limit={3} hideSample />
    </Board>
  );
}

/* ------------------------------ drafting ------------------------------ */

export async function HomeDrafting({ ctx }: { ctx: LeagueContext }) {
  const [facts, pickRoasts, issues, shame] = await Promise.all([
    safe(draftFacts(ctx), null, "draft facts"),
    safe(listRoasts(ctx.leagueId, "draft_pick", 400), [], "pick roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(shameEntries(ctx), null, "shame"),
  ]);
  const latestPick = facts?.picks.length ? [...facts.picks].sort((a, b) => b.pickNo - a.pickNo)[0] : null;
  // Order by pick number, not by when the line was written (older picks get rewritten too).
  const pickNoOf = (r: { id: string }) => Number(r.id.split(":").pop()) || 0;
  const byPick = [...pickRoasts].sort((a, b) => pickNoOf(b) - pickNoOf(a));
  const newestRoast = latestPick ? byPick.find((r) => pickNoOf(r) === latestPick.pickNo) : undefined;
  const lead = newestRoast ? roastToBlock(newestRoast) : latestPick ? pickFallback(latestPick, facts?.placeholder) : null;
  const earlier = byPick.filter((r) => r !== newestRoast).slice(0, 4);
  const live = ctx.draft?.status === "drafting";
  return (
    <Board>
      <AutoRefresh enabled={live} seconds={30} />
      <LeadPanel data={lead} empty={<EmptyLead line="The draft is open and nobody has picked yet. Pick 1.01 is up." />} />
      <OnTheClockPanel ctx={ctx} facts={facts} span={4} />
      <BoardStrip facts={facts} />
      {earlier.length ? <EarlierRoastsPanel roasts={earlier} span={8} /> : <ShamePanel board={shame} span={8} hideSample />}
      <IssuesPanel issues={issues} span={4} />
    </Board>
  );
}

/* ------------------------------ in season ------------------------------ */

export async function HomeInSeason({ ctx }: { ctx: LeagueContext }) {
  const week = Math.max(1, ctx.week);
  const scored = lastScoredWeek(ctx);
  const [roasts, issues, wp, shame, weekly] = await Promise.all([
    safe(listRoasts(ctx.leagueId, undefined, 1), [], "roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(getWinProbabilities(week, ctx), null, "win probabilities"),
    safe(shameEntries(ctx), null, "shame"),
    scored >= 1 ? safe(weeklyFacts(scored, ctx), null, "weekly facts") : Promise.resolve(null),
  ]);
  const lead = latestLead(roasts[0], issues[0]) ?? (weekly ? weeklyFallback(weekly) : null);
  return (
    <Board>
      <AutoRefresh enabled={wp?.basis === "live"} seconds={60} />
      <LeadPanel
        data={lead}
        below={weekly ? <WeekInNumbers facts={weekly} className="hidden lg:flex" /> : null}
        empty={<EmptyLead line="Nothing to roast yet this season. The first one lands after the first bad decision." />}
      />
      <Scoreboard wp={wp} week={week} span={4} />
      {weekly ? (
        <Panel label={`Week ${weekly.week} by the numbers`} className="lg:hidden">
          <WeekInNumbers facts={weekly} bare />
        </Panel>
      ) : null}
      <StandingsStrip rows={standingsFromRosters(ctx)} />
      <ShamePanel board={shame} span={8} />
      <IssuesPanel issues={issues} span={4} />
    </Board>
  );
}

/* ------------------------------ offseason and complete ------------------------------ */

export async function HomeOffseason({ ctx }: { ctx: LeagueContext }) {
  const rows = standingsFromRosters(ctx);
  const [roasts, issues, shame, bracket] = await Promise.all([
    safe(listRoasts(ctx.leagueId, undefined, 1), [], "roasts"),
    safe(listIssues(ctx.leagueId, { limit: 1 }), [], "issues"),
    safe(shameEntries(ctx), null, "shame"),
    safe(getWinnersBracket(ctx.leagueId), [], "winners bracket"),
  ]);
  const championId = bracket.find((m) => m.p === 1)?.w ?? null;
  const lead = latestLead(roasts[0], issues[0]) ?? lastPlaceFallback(rows, ctx.season);
  return (
    <Board>
      <LeadPanel data={lead} empty={<EmptyLead line="The season is over and nothing got roasted. That will not happen again." />} />
      <FinalStandings rows={rows} championId={championId} season={ctx.season} span={4} />
      <ShamePanel board={shame} span={8} />
      <IssuesPanel issues={issues} span={4} />
    </Board>
  );
}
