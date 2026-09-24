# Contracts for the parallel agents

Read `docs/SITE_SPEC.md` first (the product contract; its DECISIONS blocks win). This file is the code
contract: who owns which files, the shared modules you consume, and the functions you implement. Types
live in `lib/types.ts`. The round 3 surface (one-liners, hindsight, draft odds, recipients, test email,
issue rename) is in "Engine surface, round 3" below; all of it is real (no stubs left). Every function listed under "Functions each agent implements" is implemented (integrated
2026-09-18) and returns `placeholder: false`. `placeholder: true` only ever marked foundation-stub sample
data; jobs refuse to build or send anything from it, and the UI shows a "sample data" marker if it ever sees it.

## File ownership (round 3, two agents in parallel, from 2026-09-18)

| Owner | Files |
|---|---|
| ENGINE agent | `lib/**`, `app/api/**`, `proxy.ts`, `tests/**` |
| UI agent | `app/**` except `app/api/**`; plus `components/**`, `public/**`, `app/globals.css` |

- Everything else (`config/**`, `docs/**`, `scripts/**`, `package.json`, `next.config.ts`, `vercel.json`,
  `vitest.config.mts`, `.env.example`, `DESIGN.md`, `PRODUCT.md`): neither agent edits it without saying so
  in its report. ENGINE updates `docs/CONTRACTS.md`, `docs/DEV.md` and `.env.example` when it changes a
  signature or an env var.
- `lib/types.ts` is ENGINE's now. UI never edits it: if a page needs a field, put the exact change in
  the report. UI imports only the public entry points (`@/lib/models`, `@/lib/facts`, `@/lib/roast`,
  `@/lib/email`, `@/lib/jobs`, `@/lib/league`, `@/lib/archive`, `@/lib/time`, `@/lib/env`) plus the two
  documented direct imports (`@/lib/email/require-gate`, `@/lib/jobs/draft-seen`), never another file
  inside an agent folder.
- Subscribe removal is split: ENGINE deleted `app/api/subscribe/**` and the sign-up code in
  `lib/email` (done); UI deletes `app/subscribe/**` and every subscribe link, button and nav item.
- The round 1 table (models / roast / ops / UI agents) is retired. Signatures below still hold.

Keep the public signatures below exactly. You may add optional trailing parameters.

## Rules every agent follows

- Code computes facts; the LLM only writes jokes about facts it is handed.
- No em dashes in any user-facing copy (UI text, issue text, emails, prompts that produce copy).
- Never announce the roast: no "roast", "roasting", "burn", "cooked" (or the like) about the site itself
  in any UI copy, label, issue name, byline, email or job detail a person can read. Labels name the event
  ("PICK 3.01", "WEEK 5 FINAL", "TRADE, SEP 21"). Code identifiers (`roastItem`, `lib/roast`) may keep
  the word; nothing a reader sees does.
- Email addresses never go in a tracked file, test, fixture, doc or log. Recipients live only in the
  private env (`LEAGUE_EMAILS`, `COMMISSIONER_EMAIL`); tests build placeholder `example.com` addresses at
  run time; opt-outs are stored by HMAC ref. Never render, return or log what `recipients()` returns.
- Time zone for anything user-facing: America/New_York (`lib/time.ts`).
- Team names, display names and `p_nick_*` nicknames come from Sleeper and are user-controlled:
  React escapes them, but email HTML and anything built with strings must escape them.
- Never hardcode scoring. Use `ctx.scoring` (the league's `scoring_settings`) with `lib/scoring.ts`.
- `ctx.isDevLeague === true` (any LEAGUE_ID other than MSTP) means: never email, never publish.
- Everything runs with no keys. Check `configured.*` in `lib/env.ts` and show "not configured yet".
- Every public function takes an optional `ctx?: LeagueContext` as its last argument. Pages load one
  context with `getLeagueContext()` and pass it down (it is also request-deduped with React `cache`).
- Tests never hit the network: `vitest.config.mts` sets `DATA_SOURCE=fixtures` and a memory store,
  and blanks every API key. Use the RT fixture league (`tests/helpers/fixtures.ts`).
- One heavy process at a time on this machine (next build or a dev server). Kill dev servers you start.
- The repo is PUBLIC. Never commit secrets, `fixtures/`, `.data/`, `.review/`, `docs/samples/`, or
  anything generated from the RT league. No league ids other than MSTP's in committed files
  (tests read them from `fixtures/manifest.json`). Roast lore comes only from env `ROAST_NOTES`
  (`roastNotesFromEnv()`) and the store key `keys.roastNotes()`; env wins.

## Shared modules you consume

### `lib/league.ts`
```ts
getLeagueContext(opts?: { leagueId?: string }): Promise<LeagueContext>
standingsFromRosters(ctx): StandingRow[]           // wins (ties half), then points for, then fewer points against
teamRef(ctx, rosterId): TeamRef                    // { rosterId, teamName, managerName, managerKey }
// teamName is the manager's first name when the team has no custom Sleeper name. Pages print the
// team-name line only through teamSubtitle(teamName, managerName) (lib/names.ts, <TeamSub>), which
// is null when the two are the same: never "Carlos / Carlos", never a Sleeper username.
managerFor(ctx, rosterId): Manager
rosterFor(ctx, rosterId): SleeperRoster | undefined
rosterIdForUser(ctx, userId): number | null
computePhase(league, draft, state, lastWeek): SeasonPhase
seasonWeeks(league): { playoffWeekStart, lastRegularSeasonWeek, lastWeek }
playoffRounds(playoffTeams): number
```
`LeagueContext` fields: `leagueId, league, users, rosters, managers, state, draft, phase, season, week,
playoffWeekStart, lastRegularSeasonWeek, lastWeek, scoring, rosterPositions, starterSlots, isFixture,
isDevLeague, loadedAt`. `phase` is `'pre_draft' | 'drafting' | 'in_season' | 'offseason' | 'complete'`.
`week` is the current league week (for a complete league, the last scored week).

### `lib/sleeper.ts`
```ts
getLeague(id)  getUsers(id)  getRosters(id)  getMatchups(id, week)  getTransactions(id, week)
getTradedPicks(id)  getWinnersBracket(id)  getLosersBracket(id)
getDrafts(leagueId)  getDraft(draftId)  getDraftPicks(draftId)  getDraftTradedPicks(draftId)
getNflState()  getUserLeagues(userId, season)
getWeekStats(season, week): Promise<WeekStats>        // playerId -> { stats, position, team, opponent, gameId, date }
getWeekProjections(season, week): Promise<WeekStats>  // QB/RB/WR/TE only
getSeasonProjections(season): Promise<WeekStats>      // season totals with `gp` (draft odds); cached 12 h
getSchedule(season): Promise<NflGame[]>               // { gameId, week, date "YYYY-MM-DD", home, away, status }
byeTeams(schedule, week): string[]
getPlayers(): Promise<PlayersMap>                     // trimmed, fetched at most once a day
playerInfo(players, id, hint?): PlayerInfo            // never undefined; handles "KC" defenses and unknown ids
rosterPointsFor(r)  rosterPointsAgainst(r)  rosterPotentialPoints(r)
sleeperUrl.*  REVALIDATE  TRIMMED_TTL  FANTASY_POSITIONS
```
Normalization: roster `players/starters/reserve/taxi` are never null; starters use `"0"` for an empty
slot; matchups sorted by roster id with `players_points` never null; transactions sorted by
`status_updated` with `adds/drops` possibly null, `draft_picks` and `waiver_budget` always arrays.

### `lib/scoring.ts`
```ts
pointsFromStats(stats, scoring, position?): number     // verified = Sleeper players_points on every fixture player-week
roundPoints(n)
SLOT_ELIGIBILITY  isEligible(slot, positions)  isFlexSlot(slot)  starterSlots(rosterPositions)
optimalLineup(slots, candidates): { total, slots: { slot, playerId | null, points }[] }   // exact (Hungarian)
```
Use `PlayerInfo.positions` (Sleeper `fantasy_positions`) for eligibility.

### `lib/fantasycalc.ts`
```ts
getFantasyCalc(): Promise<FantasyCalcSnapshot>   // today's values; daily snapshot kept in the store
getFantasyCalcOn(date): Promise<FantasyCalcSnapshot | null>   // value on a past ET date, if stored
valueOf(snap, sleeperId): FantasyCalcValue | null
pickValue(snap, season, round, tier?): FantasyCalcValue | null  // "2027 1st (Early|Mid|Late)" or generic
listFantasyCalcDates(): Promise<string[]>                   // stored snapshot dates, oldest first ([] in fixture mode)
getFantasyCalcValuesOn(date): Promise<FantasyCalcValues | null>   // compact day (id -> value, pick name -> value)
compactValues(snap): FantasyCalcValues
ensureDailySnapshot(now?): Promise<DailySnapshotResult>      // the cron and the tick: today's snapshot, one fetch a day
```
The day's first `getFantasyCalc()` fetches FantasyCalc fresh and stores the full snapshot (400 days)
and a compact copy (5 years, `keys.fantasyCalcValues(date)`). The cron and the tick call
`ensureDailySnapshot()` so no day is skipped. History starts 2026-09-18 and accrues forward.
Only about 400 players have a value. Everyone else is `null`: treat as "unranked", never as 0 value
without saying so.

### `lib/espn.ts`
```ts
getGameClocks(opts?: { season?, week? }): Promise<NflGameClock[]>  // no args = current week
fractionRemainingByTeam(clocks): Record<team, number>              // Sleeper abbreviations (WSH -> WAS)
fractionRemaining(state, period, clockSeconds)
```
Use ESPN only for status, period, clock and kickoff time.

### `lib/store.ts`
```ts
get<T>(key)  set(key, value, { ttlSeconds? })  del(key)  list(prefix): string[]  lock(key, ttlSeconds): boolean  unlock(key)
incr(key, ttlSeconds): number   // atomic counter; the first hit starts the window (rate limits, keys.rate(name))
keys.*   // the shared key convention; league data is always under `league:<leagueId>:`
         // round 3: keys.surfaceLines(leagueId, surface, key), keys.surfacePrefix(leagueId, surface?),
         // keys.optOut(leagueId, ref), keys.optOutPrefix(leagueId), keys.fantasyCalcValues(date), keys.fantasyCalcPrefix(),
         // keys.fantasyCalcFetchLock(date), keys.seasonProjections(season), keys.subscriber(leagueId, email) / keys.subscriberPrefix(leagueId) (read-only records of the old sign-up form)
```
Backends: Upstash when KV env is set, memory under Vitest, else JSON files in `.data/`.
`lock` is a cooldown: it returns false while held and expires by itself.

### `lib/archive.ts` (implemented, shared)
```ts
saveIssue(issue)  getIssue(leagueId, slug)  listIssues(leagueId, { limit?, includeUnsent? })
saveRoast(roast)  getRoast(leagueId, roastId)  listRoasts(leagueId, kind?, limit?)
roastIds.trade(txId) | roastIds.waiver(batchId) | roastIds.pick(draftId, pickNo)
saveOddsSnapshot(leagueId, season, snap)  listOddsSnapshots(leagueId, season)
upgradeIssue(issue): Issue   // legacy kinds/titles read as current ("daily_roast" -> "daily", "The Weekly Roast" -> "Week 5 Recap")
```
`listIssues` returns only `sent` / `approved` issues unless `includeUnsent`. `getIssue` and `listIssues`
upgrade legacy issues on read; their old slugs keep working.

### `lib/env.ts`, `lib/time.ts`
`leagueId()`, `MSTP_LEAGUE_ID`, `isDevLeague()`, `newsletterMode()`, `siteUrl()`, `emailFrom()` (default
`DEFAULT_EMAIL_FROM`, "MSTP Dynasty" at the league's own address), `roastNotesFromEnv()`,
`configured.{anthropic, resend, commissionerEmail, leagueEmails, kv, password, cron, admin, image}()`.
`etDate(ms)`, `etParts(ms)`, `formatEt(ms, opts)`, `etToMs(y, m, d, h, min)`, `weekdayOfDate("YYYY-MM-DD")`.

## Functions each agent implements

### Models agent: `lib/models/index.ts`
```ts
getWinProbabilities(week: number, ctx?, opts?: { pregame? }): Promise<WinProbWeek>   // pregame forces the pre-kickoff view (backtests)
runSeasonSim(opts?: SimOptions): Promise<SimResult>      // opts: { runs?, seed?, fromWeek?, persist?, ctx? }
getPowerRankings(ctx?, opts?: { asOfWeek? }): Promise<PowerRankings>
getOddsHistory(ctx?, opts?: { backfill?, runs? }): Promise<OddsHistory>   // backfill defaults on only for fixture data
backfillOddsHistory(ctx?, opts?: { runs?, force? }): Promise<OddsSnapshot[]>  // computes only weeks with no stored snapshot
```
- In `WinProb`, `home` is the lower roster id of the pair (not an NFL-style home team).
- `runSeasonSim({ fromWeek: w + 1, persist: true })` stores the snapshot for week `w` (`asOfWeek = fromWeek - 1`).
  Only jobs persist: Week N Recap stores its week and backfills gaps, Draft Grades stores the preseason one.
- The sim reads `playoff_seed_type` at runtime: MSTP is currently 0 (fixed bracket), so it simulates a fixed
  bracket until the league switches to reseeding. Median games (`league_average_match`) are not modeled.
- Win prob per spec: starter mean = actual + projection x fraction remaining; variance =
  (VARIANCE_COEF x projection)^2 x fraction remaining with `VARIANCE_COEF = 0.6` as a named constant;
  P = Phi(diff / sd). `isFinal` games give exactly 0 or 1 (0.5 on a tie). `basis` tells the UI which
  mode it is in. `StarterLine.status` drives UI badges.
- Sim: 10,000 seeded runs, shrinkage blends per spec, record then PF, 6-team reseeded playoff (see the
  note on `playoff_seed_type` below). Percentages are 0..100. `firstPickPct` is labeled approximate.
  `persist: true` writes `saveOddsSnapshot`. Tests: playoff % sums to 600, title % to 100, same seed
  same result.
- Power rankings: `formula` is one plain sentence shown on the page. `luck` = actual wins minus all-play
  expected wins. Before games exist, use draft-based projected strength.

### Roast agent: `lib/facts/index.ts`, `lib/roast/index.ts`
```ts
weeklyFacts(week: number, ctx?): Promise<WeeklyFacts>
transactionFacts(sinceMs: number, ctx?, untilMs?): Promise<TransactionFacts>
draftFacts(ctx?): Promise<DraftFacts>
tnfFacts(week: number, ctx?): Promise<TnfFacts>
shameEntries(ctx?): Promise<ShameBoard>
standingsAsOf(week: number, ctx?): Promise<StandingRow[]>   // regular-season standings at the end of a week (record, PF, fewer PA)
loserOfTheWeekCounts(throughWeek: number, ctx?): Promise<Record<rosterId, number>>   // Loser of the Week crowns so far
lastCompletedWeek(ctx): number

isRoastConfigured(): boolean
roastIssue(kind: IssueKind, facts: IssueFacts, ctx?, opts?: { now? }): Promise<Issue>
roastItem(kind: RoastItemKind, fact: RoastItemFact, ctx?, opts?: { now?, draftPicks? }): Promise<Roast>
ISSUE_TITLES, FACTS_ONLY_NOTE, SYSTEM_PROMPT
```
- Facts are deterministic and unit tested on the RT fixture. `WaiverFact.batchId` groups claims from the
  same waiver run (`w-<processing time>`; each free-agent move is its own `fa-<txid>` batch);
  `roastItem("waiver", WaiverFact[])` roasts a batch. `LosingBid.reason` says why a competing claim failed.
- `DraftPickFact.reach = fcRank - pickNo` (positive = reach). For a rookie-only draft `fcRank` is the rank
  within the rookie class. `fcRank`, `fcPositionRank`, `reach` and `verdict` come from the ranks frozen when
  the tick first saw the pick (`keys.snapshot(leagueId, "draft-pick-ranks")`, `{ [draftId]: { [pickNo]:
  { fcRank, fcPositionRank } } }`, written by `freezeDraftPickRanks` in `lib/jobs/draft-seen.ts` from the
  pick's stored write-up when it has one), so the card heading, receipt, board chip, home strip and the
  write-up state one rank; a pick not frozen yet reads today's snapshot. There is no time on the clock: `pickedAt` is when the tick first noticed the pick,
  not when it was made, so it never becomes a pick-clock duration. `DraftFacts.resumesAt` is "8 AM ET"
  (`config/draft.ts`, set by the commissioner) while the draft is paused, never Sleeper's autopause window.
- `WeeklyFacts.standings[].previousRank` is the rank one week earlier (null in week 1).
- Pass `{ draftPicks }` to `roastItem` for a pick when you already have them (the tick does), to skip a
  `draftFacts()` call per pick.
- `roastIssue` never throws for LLM reasons: on no key, refusal or API error it returns a facts-only
  issue (`factsOnly: true`, `note: null`: the facts simply run, no word about the writer). Status starts as `"draft"`;
  ops decides sending. `slug` must be URL-safe and unique per league (`YYYY-MM-DD-kind`, the ET date the issue was written, kind with hyphens: `2026-09-19-daily`, `2026-09-29-weekly-recap`).
- `IssueBlock` is plain text (no HTML, no markdown) so web and email render the same content.
- Issue titles: "The Daily", "Thursday Night Fallout", "Week N Recap" ("Week 5 Recap"), "Draft Grades"
  (`ISSUE_TITLES`, `issueTitle(kind, week?)` in `lib/roast`). Kinds: `daily | thursday_fallout |
  weekly_recap | draft_grades`. The writer's headline (the dek) is the email subject and the H1.
- `config/roast-notes.ts`: empty defaults only (one empty string per manager) and a comment explaining
  that real lore comes from env `ROAST_NOTES` (JSON, manager first name -> text) and/or the store key
  `roast-notes`, env winning. Lore never goes in the repo.

### Ops agent: `lib/jobs/index.ts`, `lib/email/index.ts`, routes
```ts
runDaily(now?: Date): Promise<JobRunReport>
runTick(now?: Date): Promise<JobRunReport>        // `locked: true` when the cooldown or an in-flight run is held
sendIssue(issue: Issue, mode?: NewsletterMode): Promise<SendResult>
unsubscribe(token: string): Promise<UnsubscribeResult>         // token from the signed link; stores an opt-out by ref
```
Routes: `/api/cron/daily`, `/api/tick`, `/api/admin/approve`, `POST /api/admin/test-email`,
`/api/unsubscribe`, `/api/enter`, `/enter`, `/api/health`, `proxy.ts` (Next 16 renamed middleware to proxy).
There is no public sign-up: `/api/subscribe`, `/api/subscribe/confirm` and `subscribe()` are gone. Jobs
persist issues and roasts through `lib/archive.ts` and write a run log under `keys.jobRun`.
- Draft pick first-seen timestamps: `keys.snapshot(leagueId, "draft-pick-seen")` as
  `{ [draftId]: { [pickNo]: epochMs } }`. When several picks land between ticks only the newest gets a time.
  Read them with `readDraftPickTimes(leagueId, draftId)` from `@/lib/jobs/draft-seen` (import that file
  directly: `lib/jobs` imports `lib/facts`, so the barrel would make a cycle).
- The Daily's injuries and lineup alerts are built in `lib/jobs/daily-facts.ts` (facts has no public
  function for them). Its transactions run from the last Daily up to the job's clock, minus plain
  cuts (a drop with no add, of a player who is not a notable drop).
- The tick writes up transactions from the last 7 days and picks of a draft that is live or ended in the
  last 7 days, at most 6 write-ups per tick, so a wiped store cannot trigger hundreds of LLM calls. It
  takes the cooldown lock before loading the league, holds an in-flight lock until the run ends, claims
  each item before its model call, and merges the index before writing it. Then it takes the day's
  FantasyCalc snapshot if nobody has (`ensureDailySnapshot`, one fetch a day at most) and refreshes the
  one-liners (`tickLines`: trades, picks and draft odds every run, every table at most hourly). A tick
  outcome for the snapshot or the lines appears only when it did something or failed.
- `runDaily` stores the day's FantasyCalc snapshot first, then the issues, then refreshes every
  surface's one-liners (`refreshLines(ctx, { scope: "all" })`) until 150 s into the run. Outcomes:
  `fantasycalc_snapshot`, `lines`.
- The password gate allows 10 attempts per IP and 100 overall per 15 minutes. `/api/tick` needs the gate
  cookie or the cron bearer when the gate is on. Without `CRON_SECRET`, `/api/cron/daily` runs in dev only
  while no RESEND/ANTHROPIC key is set. Admin bearer attempts (right or wrong) are counted before the
  compare: 10 per IP and 30 overall per 15 minutes.
- Writer spend guards (`lib/roast/llm.ts`): on Vercel the writer only runs with the shared store
  (`sharedStoreMissing()`: `VERCEL` set and the backend is not Upstash makes `hasRoastClient()` and
  `isRoastConfigured()` false, so a tick or the daily job makes no model call), and every call counts
  against `MAX_WRITER_CALLS_PER_DAY` (400 per Eastern day, store-backed, fails closed) and a dollar
  budget per Eastern day (`WRITER_DAILY_BUDGET_USD`, default $1.50, priced from each reply's usage):
  stat lines stop at 40% of it, items at 85%, issues at 100%. Issues go to claude-opus-5; items and
  lines go to claude-sonnet-5 at lower effort. /api/health shows `writerModels` and `writerSpendToday`. League sends
  and approve links refuse (`not_configured`) on Vercel while the store is the per-instance file store.
- Job details a person can read never call anything a roast ("Wrote up 1 trade."). Job ids
  (`roast_trades`, `roast_picks`...) are code identifiers and keep their names.
- Week N Recap pins odds and power rankings to the recapped week (`runSeasonSim({ fromWeek: week + 1,
  persist: true })`, `getPowerRankings(ctx, { asOfWeek: week })`), then `backfillOddsHistory(ctx)`.
- Also exported from `lib/jobs`: `listJobRuns`, `planDaily`, `recapWeekFor`, `earlyGamesWeekFor`,
  `TICK_COOLDOWN_SECONDS`, `MAX_ROASTS_PER_TICK`, `sendTestEmail`, `refreshLines`, `tickLines`,
  `TABLE_SWEEP_SECONDS` (30 minutes), `DRAFT_ODDS_LINES_STALE_MS`. Job keys: `daily:<date>`,
  `thursday_fallout:<season>:<week>`, `weekly_recap:<season>:<week>`, `draft_grades:<draftId>`. `runDaily`/`runTick` take an optional second argument
  `{ ctx?, schedule? }` / `{ ctx?, ignoreCooldown? }`.
- Pages that trigger the tick with `after(() => runTick())` run it inside their own time limit: give them
  a generous `maxDuration`.
- Vercel Hobby allows one daily cron, so every issue goes out at 12:00 UTC (8 AM EDT, 7 AM EST, and Vercel
  may fire any time within that hour).

### UI agent: pages
Consume only the public functions above plus the shared modules. Render all three states
(pre-draft, drafting, in-season, plus offseason/complete). When a result has `placeholder: true`,
show a small "sample data" marker. Home page may trigger the tick with `after()` from `next/server`
by calling `runTick()`; ENGINE owns what it does.
- Password gate, second line: call `await requireGate("/the/path")` from `@/lib/email/require-gate` at the
  top of every page that shows league data (or in a route-group layout that does not wrap `/enter`).
  `proxy.ts` alone is not enough (Next advisories on proxy bypass). It is a no-op without SITE_PASSWORD.
- `lib/env`, `lib/email`, `lib/roast` and `lib/jobs` import `server-only`: importing them from a
  `"use client"` component fails the build. Pass plain data to client components instead.

## Engine surface, round 3 (2026-09-18)

All real. Types are in `lib/types.ts` section 8.

### One mean line per stat row: `lib/roast` (real)
```ts
type RoastSurface = "standings" | "odds" | "power" | "matchups" | "team" | "trades" | "shame" | "draft"
interface SurfaceRow { id: string; managers: string[]; facts: Record<string, unknown>; hashKey?: string }
type SurfaceLineMap = Record<string, string | null>          // rowId -> line, null = absent

getSurfaceLines(surface: RoastSurface, key: string, ctx?: LeagueContext): Promise<SurfaceLineMap>   // what pages call
getStoredSurfaceLines(surface: RoastSurface, key: string, ctx?: LeagueContext): Promise<StoredSurfaceLines | null>
surfaceLines(surface: RoastSurface, rows: SurfaceRow[], ctx?: LeagueContext, opts?: { context?, deadline? }): Promise<SurfaceLineMap>
refreshSurfaceLines(surface: RoastSurface, key: string, rows: SurfaceRow[], ctx?: LeagueContext,
  opts?: { now?; maxAgeMs?; force?; maxRows?; deadline?; context?; claim? }): Promise<RefreshResult>
  // RefreshResult { status: "fresh" | "throttled" | "written" | "skipped" | "busy"; lines; asked; written?; failed?; pending? }
surfaceKeys.standings(season, week) | .odds(season, asOfWeek) | .power(season, asOfWeek) | .matchups(season, week)
  | .team(season) | .trades() | .shame(season) | .draft(draftId)
SURFACES, SURFACE_MAX_AGE_MS, MAX_ROWS_PER_CALL (25), ROW_RETRY_AFTER_MS, MAX_ROW_ATTEMPTS, rowHash(row), surfaceFactsHash(rows)
checkLine(raw, row, allowed, exempt), parseLinesReply(reply), linesMessage(surface, rows, lore, opts?)
// rows from facts (pure, lib/roast/surface-rows.ts):
standingsRows(rows, lastWeek?)  oddsRows(sim)  draftOddsRows(draftOdds)  powerRows(power)
finalMatchupRows(weekly, draftSlots?)  pregameMatchupRows(winProbs)  teamRows(TeamPageInput[])
tradeRows(TradeHindsight[])  shameRows(ShameEntry[])  draftRows(picks, draftContext?)
```
| Surface | Key | Row id | Page |
|---|---|---|---|
| standings | `surfaceKeys.standings(ctx.season, lastCompletedWeek(ctx))` | `String(rosterId)` | /standings, home |
| odds | `surfaceKeys.odds(ctx.season, sim.asOfWeek)`; draft odds use asOfWeek `0` | `String(rosterId)` | /odds, home |
| power | `surfaceKeys.power(ctx.season, power.asOfWeek)` | `String(rosterId)` | /standings |
| matchups | `surfaceKeys.matchups(ctx.season, week)` | `String(matchupId)` | /scores, home |
| team | `surfaceKeys.team(ctx.season)` | `String(rosterId)` | /teams/[rosterId] |
| trades | `surfaceKeys.trades()` | `transactionId` | /trades |
| shame | `surfaceKeys.shame(ctx.season)` | `ShameEntry.id` | /shame |
| draft | `surfaceKeys.draft(draftId)` | `String(pickNo)` | /draft, home |

- Pages call only `getSurfaceLines` (a store read; a render never waits on the model). It returns only
  rows that have a line; render a row's line only when it is there. No placeholder, no "line coming
  soon", no canned fallback.
- The writer: rows go out in batches of `MAX_ROWS_PER_CALL` through `callRoastModel` (the same frozen
  system prompt as every issue and item, unchanged, and the spec's exact call shape). The user message
  is a `LINES:` request with one slot per row (`r1`..`rN`, each naming the row's manager), a TASK that
  says what a row is and the one-sentence shape of a line, a `KEYS` block (`LINES_GLOSSARY`: the FACTS
  keys only table rows carry; the persona's glossary covers the rest) and FACTS keyed by slot. The reply
  uses the persona's `@@slot` format (a JSON object, slot -> line, is read too). A line is kept only if
  it is one sentence, at most about 30 words, names the row's manager by first name, and passes the same
  post-check as every issue and item (every number in FACTS and next to its owner, exact claims, no
  slurs, no theme words, no joke-announcing `ANNOUNCE_TERMS` word unless FACTS uses it). Failed rows get
  one retry in one call with a note saying what failed. Without `ANTHROPIC_API_KEY`, or on a refusal or
  API error, the row has no line.
- The refresh policy: a row with no line (a new trade, a new pick, a new week's table) is written at
  once. A row that has a line is rewritten when its facts hash changes: at most once per
  `SURFACE_STALE_REWRITE_MS` (20-30 minutes) when a number in its line drifted past `currentLines`'
  tolerance (the page already hides it), otherwise at most once per `SURFACE_MAX_AGE_MS` (6 hours for
  odds, power and team pages, a day elsewhere; a final week's matchups at once). A voice bump rewrites
  only the newest `REVOICE_NEWEST` (10) items per kind. Pick rows hash only who took whom (`hashKey`), so a pick's line is written once even
  though its live FantasyCalc rank moves. The jobs pass `voice: ROAST_VOICE`, folded into every row hash,
  so a new voice makes every stored line due again at that pace, pick lines included. One cuck chair per
  table (`CUCK_CHAIR_PER_TABLE`): the allowance is shared by every batch of a refresh and counts the
  lines already stored on the table. A row whose line fails the checks waits `ROW_RETRY_AFTER_MS`
  (30 min) and is given up on after `MAX_ROW_ATTEMPTS` (3) until its facts change; an API outage backs
  off the same way but never counts toward giving up. The store record keeps, per row, the hash of the
  facts its current line was written from (kept until a new line replaces it, so facts that change and
  change back cost no call), write times and failures. Draft odds rows carry only what their hash covers
  (rank, playoff, title and last-place odds, projected rank): numbers that move with every pick stay out.
- The jobs (`lib/jobs/lines.ts`): `refreshLines(ctx, { scope, deadline? })` builds each surface's rows
  from facts and models and refreshes them, three surfaces at a time, with a per-surface claim (taken only
  when a row is due, and the stored batch re-read under it) so the tick and the daily job never write
  the same rows, at most 80 rows per surface per run (the Wall of
  Shame can hold 100+; the rest go next run). Surfaces with no data are skipped: standings, odds and
  power only once a week is final; matchups for the last final week (results) and the week being played
  (pre-kickoff projections); team pages from rosters, or from the draft picks while the startup draft
  fills empty rosters; draft odds (`odds`, asOfWeek 0) while `draftOddsBasis` is set. `tickLines` runs the
  instant surfaces (trades, picks, draft odds) every tick and every table at most hourly.

### Trades in hindsight: `lib/facts` (real)
```ts
tradeHindsight(ctx?: LeagueContext): Promise<TradeHindsightBoard>     // newest trade first
worstTrades(limit = 10, ctx?: LeagueContext): Promise<TradeHindsight[]>   // most value lost as of today
HINDSIGHT_THEN_WINDOW_DAYS = 3, MAX_SERIES_POINTS = 40
```
- `TradeHindsight { transactionId, season, week, createdAt, date, thenDate, nowDate, sides, winnerNowRosterId,
  loserNowRosterId, valueLost, lostSinceTrade }`.
- `TradeHindsightSide { team, playersIn, playersOut, picksIn, picksOut, faabIn, faabOut, valueInThen,
  valueOutThen, netThen, gradeThen, valueInNow, valueOutNow, netNow, gradeNow, delta, series }`;
  `series: TradeValuePoint[] = { date, valueIn, net }[]`, oldest first, for the dot chart.
- "Then" is the stored FantasyCalc snapshot nearest the trade within 3 days; before snapshots existed it
  is null (and so are `netThen`, `gradeThen`, `delta`, `lostSinceTrade`). Show "not recorded", never a guess.
- `valueLost` = the losing side's `valueOutNow - valueInNow` (what it would hold had it said no, minus
  what it holds). The leaderboard sorts by it and leaves out trades nobody is losing.
- FantasyCalc only (KeepTradeCut has no public API: never scrape it). Current league only.
- Snapshots: `ensureDailySnapshot(now?)` in `lib/fantasycalc` stores the day's values (full snapshot for
  400 days, compact copy for 5 years). The daily cron calls it first thing and the tick calls it every run,
  so a day is never skipped: at most one FantasyCalc fetch a day (fresh, bypassing the Next data cache),
  and after a failure at most one try every 30 minutes. `DailySnapshotResult.status`: `stored | present |
  waiting | fixture | error`. Fixture mode never stores snapshots.

### "If the season started today": `lib/models` (real)
```ts
draftOdds(ctx?: LeagueContext, opts?: { runs?: number; seed?: number; fresh?: boolean }): Promise<DraftOdds>
draftOddsBasis(ctx): Promise<"drafting" | "preseason" | null>
DRAFT_ODDS_CACHE_SECONDS = 21600
```
- `DraftOdds { season, available, basis, draftId, picksMade, totalPicks, runs, seed, generatedAt, teams, placeholder }`,
  `DraftOddsTeam { team, playersDrafted, projectedPoints, projectedRank, playoffPct, titlePct, byePct,
  lastPlacePct, expectedWins }`, teams sorted by title % then playoff %.
- `basis: "drafting"` while the startup draft is live, `"preseason"` after it until the first league week
  is final, else `available: false` with no teams (then use `runSeasonSim`).
- The model: the season simulator (10,000 seeded runs by default, record then points for, the league's own
  bracket rule from `playoff_seed_type`: 1 reseeds every round, anything else is a fixed bracket) with no
  games played. Each team's weekly mean is the best legal lineup of the players it has so far
  (`optimalLineup` over the league's starter slots; a starting spot the team has not filled is rated at
  replacement level, the best player at that position on nobody's roster, so mid-draft odds do not
  swing with who picked last). Each player is rated by his Sleeper season projection
  (`/projections/nfl/<season>`, league scoring from `scoring_settings`) divided by his projected games
  `gp`, at most 17 (Sleeper reports 18, the weeks with the bye); a player with no season line falls back to his weekly projections
  for the next league weeks. `runSeasonSim({ strength: "season" })` is the same switch. Cached per draft
  and pick count, so the page recomputes once per new pick. Tests: playoff % sums to 600 and title % to
  100 at 10,000 runs, same seed same odds, and flipping `playoff_seed_type` changes the title odds.
- Playoff % and title % are the headline numbers wherever odds appear (in season: `runSeasonSim`'s
  `playoffPct` and `titlePct`). While `draftOddsBasis(ctx)` returns a basis, /draft, /odds and the home
  page all show `draftOdds` with the lines at `surfaceKeys.odds(season, 0)`, and the season-odds line job
  is skipped, so the site never shows two sets of headline odds.

### Recipients and the test email: `lib/email`, `lib/jobs` (real)
```ts
recipients(leagueId?: string): Promise<string[]>              // LEAGUE_EMAILS plus confirmed subscribers, minus opt-outs. Server-only data
recipientSummary(leagueId?: string): Promise<RecipientSummary> // { configured, count, optedOut }: safe to render
leagueEmailsFromEnv(): string[]
sendTest(opts?: { issue?: Issue | null; counted?: boolean }): Promise<SendResult>  // "test_sent": COMMISSIONER_EMAIL only
testSendPreflight(leagueId?): Promise<SendResult | null>      // every check plus the hourly count, before anything is built
sendTestCopy(issue: Issue): Promise<SendResult>               // GET /api/admin/send-test: one [Test] copy, COMMISSIONER_EMAIL only
sendTestEmail(now?: Date, opts?: { ctx? }): Promise<TestEmailResult>   // lib/jobs: newest stored issue, else a sample Daily
listSubscribers(leagueId?): Promise<Subscriber[]>              // records the old sign-up form stored (nothing writes new ones)
readEmailStatus(): Promise<unknown>                            // last send outcome for /api/health: counts, scrubbed error
scrubAddresses(text): string                                   // blanks any address in error text
MAX_TEST_SENDS_PER_HOUR = 10, MAX_RECIPIENTS = 30
```
- No subscribe button, page or API. `recipients()` is the only recipient list in the codebase:
  `LEAGUE_EMAILS` plus the confirmed subscribers the old sign-up form stored, minus opt-outs, each
  address once. League sends go to `recipients()` (capped at `MAX_RECIPIENTS`);
  review mode sends every issue to `COMMISSIONER_EMAIL` only, with the approve link, and the approve
  link then sends to `recipients()`. `inspectApproveLink` reports `recipients` as a count.
- `unsubscribe(token)` stores an opt-out under `keys.optOut(leagueId, subscriberRef(address))`: an HMAC
  ref, never the address, and deletes the matching subscriber record if there is one. It is idempotent:
  a second click writes nothing new and answers "unsubscribed" again. An address that opted out stays
  out even if it is added to LEAGUE_EMAILS again. Refs and unsubscribe links are keyed by `OPTOUT_SECRET` (set once, never rotated) or else
  `ADMIN_SECRET`; links signed with either verify, and `recipients()` checks refs under both. A store
  error while reading opt-outs is thrown (the send fails and its claim is released), never read as
  "not opted out". Nothing new in the store holds an address; provider errors are scrubbed before they
  reach a result, the job log or `lastEmail`.
- `sendTest` renders the issue as a marked test copy ("[Test]" subject, "Test copy" banner, no approve
  link), marks nothing sent, skips dev leagues, and allows 10 per hour. `sendTestEmail` runs
  `testSendPreflight` first, so a refused or capped request never builds a sample (a model call).
- `POST /api/admin/test-email`: `Authorization: Bearer <ADMIN_SECRET>` (constant-time compare via
  `checkAdminAuth` in `lib/email/gate`; the same 401 "Unauthorized." when the bearer is missing or wrong
  and while ADMIN_SECRET is unset or shorter than 32 characters, logged on the server; every bearer
  attempt is counted first, 429 past 10 per IP or 30 overall in 15 minutes). Body ignored. Calls `sendTestEmail()`, answers
  `{ status, recipients, issueSlug, sample, error? }` with no address in it (200 on `test_sent`, 409
  skipped, 503 not configured, 502 error). The proxy lets it through the password gate.
- `GET /api/admin/send-test` (no secret): checks COMMISSIONER_EMAIL and the email settings first (nothing
  is built or sent without them), then takes a 15-minute lock, builds today's Daily from live data without
  committing the daily cursor, and sends one "[Test]" copy through `sendTestCopy` to COMMISSIONER_EMAIL
  only. The league list is never read.
- `/api/health` is public and returns `store`, `writerConfigured`, `emailConfigured`, `lastWriterCall`,
  `lastEmail` (status, count, scrubbed error), `envPresent` (setting names only) and `deployedAt`: no
  secret and no address. With the CRON_SECRET or ADMIN_SECRET bearer it adds `writerRunning`,
  `commissionerEmailConfigured`, the `RecipientSummary` counts as `recipients`, and `adminSecret` ("ok"
  or what is wrong with it). Bearer attempts go through the admin limiter.

### Issue rename, sender, and the writer's voice
- `IssueKind = "daily" | "thursday_fallout" | "weekly_recap" | "draft_grades"` (was `daily_roast`,
  `weekly_roast`; `LegacyIssueKind` names the old ones and `lib/archive` upgrades them on read). A job
  whose old key is done (`daily_roast:DATE`, `weekly_roast:S:W`, see `legacyJobKey`) is skipped, so a
  deploy on a day the old cron already ran never builds and sends that issue a second time.
- Titles: "The Daily", "Thursday Night Fallout", "Week N Recap" (`issueTitle("weekly_recap", 5)` =
  "Week 5 Recap"), "Draft Grades". Slugs: `2026-09-19-daily`, `2026-09-29-weekly-recap`.
- Email from `MSTP Dynasty` (`DEFAULT_EMAIL_FROM`, override with `EMAIL_FROM`), no byline: the meta line
  is the date (and the week when the title does not carry it); the footer says who it is sent to.
- `FACTS_ONLY_NOTE` = `null`: a facts-only issue has no note (older stored issues lose the old one on read).
- The system prompt (`lib/roast/persona.ts`, SHA-256 pinned in `tests/roast-prompt.test.ts`) is the
  approved voice (a punchline headline, a fake-epic cold open, a hit on every manager, a closer). It is
  unnamed and unsigned, and hard rule 9 forbids announcing anything. `persona.ts`, `plan.ts`,
  `postcheck.ts`, `banned.ts`, `items.ts`, `index.ts` and `memory.ts` are the live voice; the stat-table
  lines (`surfaces.ts`, `surface-rows.ts`, `lib/jobs/lines.ts`) go through the same prompt and the same
  post-check. The post-check drops any sentence with an `ANNOUNCE_TERMS` word unless FACTS or LORE uses
  it, any slur always, and a second cuck chair in one issue (`CUCK_CHAIR_PER_ISSUE`, the persona's rule;
  only a FACTS team or player name with the word in it is exempt, never LORE). It also drops "cooked" and
  the passive "got burned" (`SELF_LABEL_TERMS`, rule 9), a post-check-only list the prompt does not print.
- `ROAST_VOICE` in `lib/jobs/tick.ts` is bumped whenever the voice changes, so every stored item is
  written again in the current voice.

## Data shapes (see `lib/types.ts` for every field)

- `WinProbWeek { week, season, generatedAt, basis, matchups: WinProb[], placeholder }`,
  `WinProb { week, matchupId, home: TeamWinProb, away: TeamWinProb, isFinal }`,
  `TeamWinProb { team, actual, projected, mean, sd, winProb (0..1), starters: StarterLine[] }`.
- `SimResult { season, asOfWeek, runs, seed, generatedAt, teams: SimTeamOdds[], placeholder }`.
- `PowerRankings { season, asOfWeek, formula, rows: PowerRow[], placeholder }`.
- `OddsHistory { season, snapshots: OddsSnapshot[], placeholder }`.
- `WeeklyFacts { week, season, matchups: MatchupFact[], teams: TeamWeekFact[], highest, lowest, loserOfTheWeek, standings, placeholder }`.
  `TeamWeekFact` also carries `benchMistake` (best single swap, flip or not), `topStarter`, `worstStarter`
  (furthest below projection) and `boomBench`.
- `TransactionFacts { sinceMs, untilMs, trades: TradeFact[], waivers: WaiverFact[], placeholder }`.
- `DraftFacts { draftId, status, startTime, rounds, teams, picks: DraftPickFact[], onTheClock, positionRuns, grades, placeholder }`.
- `TnfFacts { week, games, players: TnfPlayerFact[], teams, placeholder }`.
- `ShameBoard { entries: ShameEntry[], placeholder }`.
- `Issue { id, slug, kind, leagueId, season, week, date, title, dek, dekSource?, sections: IssueSection[], factsOnly, note, status, createdAt, sentAt, recipientCount, model, usage, imageUrl, placeholder, writerNotes? }`.
  `writerNotes { allusion, closer, lines }` is never rendered: it tells later issues which history, closer and short lines not to reuse.
  `dekSource: "model"` means the dek is also the email subject; a `"code"` dek gets "Title, week N:" in front.
- `Roast { id, kind, leagueId, rosterIds, text, facts, source, model, createdAt, usage }`.
- `IssueFacts = DailyFacts | ThursdayFalloutFacts | WeeklyRecapFacts | DraftGradesFacts`
  (`DailyRoastFacts` / `WeeklyRoastFacts` remain as deprecated aliases).

## Fixtures and dev leagues

- `npm run fixtures` downloads everything into `fixtures/` (gitignored). `fixtures/manifest.json` has the ids.
- Dev fixture league: `manifest.rt.leagueId` (a completed 2025 season; which league it is stays out
  of the repo, see `docs/DEV.md`). Read its settings at runtime like any league. Its only draft is a
  rookie draft, not a startup draft.
- Scoring-check league: `manifest.scoringCheck` (MSTP's slots and headline scoring, TE bonus), used
  only by `tests/scoring.test.ts`.
- Run the site on fixtures: `npm run dev:rt`. Add `LEAGUE_WEEK_OVERRIDE=9` to treat it as in season
  at week 9, and `-- -p 3200` for another port.
- In tests: `import { rtLeagueId, loadManifest, hasFixtures } from "./helpers/fixtures"`, then
  `getLeagueContext({ leagueId: rtLeagueId() })`. Wrap fixture tests in `describe.skipIf(!hasFixtures())`.

## API facts that differ from what you might assume

- `/stats` and `/projections` return an ARRAY of rows `{ player_id, stats, player: { position, ... }, team,
  opponent, game_id, date }`, about 2 MB each, so they bypass the Next data cache (2 MB cap) and are
  cached trimmed by `lib/sleeper.ts`.
- Stat lines already include derived keys (`bonus_rec_te`, `pts_allow_*`, `fgm_*` buckets), so scoring
  is a dot product. `pointsFromStats` derives the TE bonus from position only when the key is missing.
- Failed waiver claims come back from `/transactions/<week>` with `status: "failed"` and their
  `settings.waiver_bid`, so losing bids are real data. Trade picks are in `draft_picks` with
  `roster_id` = original owner, `owner_id` = new owner.
- In playoff weeks every team still has a `matchup_id` (consolation games). Use the brackets to find
  the real playoff games.
- Draft picks carry no timestamps. Time on the clock only exists if the tick records first-seen times.
- The schedule has dates, not kickoff times. ESPN has kickoff times.
- MSTP league settings as of 2026-09-18: `waiver_type: 0` (not FAAB yet, though `waiver_budget: 100`),
  `trade_review_days: 2` (not instant), `playoff_seed_type: 0` (likely not reseeded). Read settings at
  runtime; do not assume the spec values.
