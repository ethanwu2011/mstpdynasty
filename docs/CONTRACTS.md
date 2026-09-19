# Contracts for the parallel agents

Read `docs/SITE_SPEC.md` first (the product contract). This file is the code contract: who owns
which files, the shared modules you consume, and the functions you implement. Types live in
`lib/types.ts`. Every function listed under "Functions each agent implements" is implemented (integrated
2026-09-18) and returns `placeholder: false`. `placeholder: true` only ever marked foundation-stub sample
data; jobs refuse to build or send anything from it, and the UI shows a "sample data" marker if it ever sees it.

## File ownership

| Owner | Files |
|---|---|
| models agent | `lib/models/**`, `tests/models*` |
| roast agent | `lib/facts/**`, `lib/roast/**`, `config/roast-notes.ts`, `tests/facts*`, `tests/roast*` |
| ops agent | `lib/jobs/**`, `lib/email/**`, `app/api/**`, `proxy.ts` (password gate), `app/enter/**`, `app/subscribe/**`, `tests/ops*` |
| UI agent | `app/**` except `app/api`, `app/enter`, `app/subscribe`; plus `components/**`, `app/globals.css`, `public/**` |

**Frozen shared files** (the foundation step owns them; do not edit): `lib/types.ts`, `lib/sleeper.ts`,
`lib/store.ts`, `lib/league.ts`, `lib/scoring.ts`, `lib/fantasycalc.ts`, `lib/espn.ts`, `lib/http.ts`,
`lib/time.ts`, `lib/env.ts`, `lib/archive.ts`, `config/managers.ts`, `package.json`,
`vitest.config.mts`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `tests/helpers/**`,
`tests/scoring.test.ts`, `tests/foundation.test.ts`, `tests/contracts.test.ts`.
If you need a change in one of them (a new field, a new endpoint, a new dependency), do not edit it:
put the exact change in your report. Private helpers go inside your own folder
(for example `lib/facts/util.ts`, `lib/models/sim.ts`). Your own internal types go in your folder too.

Keep the public signatures below exactly. You may add optional trailing parameters.

## Rules every agent follows

- Code computes facts; the LLM only writes jokes about facts it is handed.
- No em dashes in any user-facing copy (UI text, issue text, emails, prompts that produce copy).
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
```
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
```
Backends: Upstash when KV env is set, memory under Vitest, else JSON files in `.data/`.
`lock` is a cooldown: it returns false while held and expires by itself.

### `lib/archive.ts` (implemented, shared)
```ts
saveIssue(issue)  getIssue(leagueId, slug)  listIssues(leagueId, { limit?, includeUnsent? })
saveRoast(roast)  getRoast(leagueId, roastId)  listRoasts(leagueId, kind?, limit?)
roastIds.trade(txId) | roastIds.waiver(batchId) | roastIds.pick(draftId, pickNo)
saveOddsSnapshot(leagueId, season, snap)  listOddsSnapshots(leagueId, season)
```
`listIssues` returns only `sent` / `approved` issues unless `includeUnsent`.

### `lib/env.ts`, `lib/time.ts`
`leagueId()`, `MSTP_LEAGUE_ID`, `isDevLeague()`, `newsletterMode()`, `siteUrl()`, `emailFrom()`, `roastNotesFromEnv()`,
`configured.{anthropic, resend, commissionerEmail, kv, password, cron, admin, image}()`.
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
  Only jobs persist: The Weekly Roast stores its week and backfills gaps, Draft Grades stores the preseason one.
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
  within the rookie class. There is no time on the clock: `pickedAt` is when the tick first noticed the pick,
  not when it was made, so it never becomes a pick-clock duration. `DraftFacts.resumesAt` is "8 AM ET"
  (`config/draft.ts`, set by the commissioner) while the draft is paused, never Sleeper's autopause window.
- `WeeklyFacts.standings[].previousRank` is the rank one week earlier (null in week 1).
- Pass `{ draftPicks }` to `roastItem` for a pick when you already have them (the tick does), to skip a
  `draftFacts()` call per pick.
- `roastIssue` never throws for LLM reasons: on no key, refusal or API error it returns a facts-only
  issue (`factsOnly: true`, `note: "The roast writer called in sick. Facts only today."`). Status starts as `"draft"`;
  ops decides sending. `slug` must be URL-safe and unique per league (`YYYY-MM-DD-kind`, the ET date the issue was written, kind with hyphens).
- `IssueBlock` is plain text (no HTML, no markdown) so web and email render the same content.
- Issue titles: "The Daily", "Thursday Night Fallout", "Week N Recap", "Draft Grades" (`issueTitle(kind, week)`).
  The writer's headline (the dek) is the email subject and the H1.
  (`ISSUE_TITLES` in `lib/roast`).
- `config/roast-notes.ts`: empty defaults only (one empty string per manager) and a comment explaining
  that real lore comes from env `ROAST_NOTES` (JSON, manager first name -> text) and/or the store key
  `roast-notes`, env winning. Lore never goes in the repo.

### Ops agent: `lib/jobs/index.ts`, `lib/email/index.ts`, routes
```ts
runDaily(now?: Date): Promise<JobRunReport>
runTick(now?: Date): Promise<JobRunReport>        // `locked: true` when the cooldown or an in-flight run is held
sendIssue(issue: Issue, mode?: NewsletterMode): Promise<SendResult>
subscribe(input: SubscribeInput, now?, { ip? }): Promise<SubscribeResult>   // { email, managerKey }; ip for the per-IP limit
unsubscribe(token: string): Promise<UnsubscribeResult>         // token from the signed link
```
Routes: `/api/cron/daily`, `/api/tick`, `/api/admin/approve`, `/api/unsubscribe`, `/api/subscribe`,
`/api/subscribe/confirm`, `/api/enter`, `/enter`, `/subscribe`, `proxy.ts` (Next 16 renamed middleware to
proxy). Jobs persist issues and roasts through `lib/archive.ts` and write a run log under `keys.jobRun`.
- Draft pick first-seen timestamps: `keys.snapshot(leagueId, "draft-pick-seen")` as
  `{ [draftId]: { [pickNo]: epochMs } }`. When several picks land between ticks only the newest gets a time.
  Read them with `readDraftPickTimes(leagueId, draftId)` from `@/lib/jobs/draft-seen` (import that file
  directly: `lib/jobs` imports `lib/facts`, so the barrel would make a cycle).
- The Daily Roast's injuries and lineup alerts are built in `lib/jobs/daily-facts.ts` (facts has no public
  function for them). Its transactions run from the last Daily Roast up to the job's clock, minus plain
  cuts (a drop with no add, of a player who is not a notable drop).
- The tick roasts transactions from the last 7 days and picks of a draft that is live or ended in the last
  7 days, at most 6 roasts per tick, so a wiped store cannot trigger hundreds of LLM calls. It takes the
  cooldown lock before loading the league, holds an in-flight lock until the run ends, claims each item
  before its model call, and merges the roast index before writing it.
- Subscriptions: at most 30 confirmed and 10 pending; a pending address gets at most 2 confirmation emails
  and keeps its first 7-day expiry; 5 sign-ups per IP and 20 confirmation emails per hour site-wide
  (`lib/email/limits.ts`). A confirmed address gets the same "subscribed" answer as a new one. The password
  gate allows 10 attempts per IP and 100 overall per 15 minutes. `/api/tick` needs the gate cookie or the
  cron bearer when the gate is on. Without `CRON_SECRET`, `/api/cron/daily` runs in dev only while no
  RESEND/ANTHROPIC key is set.
- The Weekly Roast pins odds and power rankings to the recapped week (`runSeasonSim({ fromWeek: week + 1,
  persist: true })`, `getPowerRankings(ctx, { asOfWeek: week })`), then `backfillOddsHistory(ctx)`.
- Also exported from `lib/jobs`: `listJobRuns`, `planDaily`, `recapWeekFor`, `earlyGamesWeekFor`,
  `TICK_COOLDOWN_SECONDS`, `MAX_ROASTS_PER_TICK`. `runDaily`/`runTick` take an optional second argument
  `{ ctx?, schedule? }` / `{ ctx?, ignoreCooldown? }`.
- Pages that trigger the tick with `after(() => runTick())` run it inside their own time limit: give them
  a generous `maxDuration`.
- Vercel Hobby allows one daily cron, so every issue goes out at 12:00 UTC (8 AM EDT, 7 AM EST, and Vercel
  may fire any time within that hour).

### UI agent: pages
Consume only the public functions above plus the shared modules. Render all three states
(pre-draft, drafting, in-season, plus offseason/complete). When a result has `placeholder: true`,
show a small "sample data" marker. Home page may trigger the tick with `after()` from `next/server`
by calling `runTick()`; the ops agent owns what it does.
- Password gate, second line: call `await requireGate("/the/path")` from `@/lib/email/require-gate` at the
  top of every page that shows league data (or in a route-group layout that does not wrap `/enter`).
  `proxy.ts` alone is not enough (Next advisories on proxy bypass). It is a no-op without SITE_PASSWORD.
- `lib/env`, `lib/email`, `lib/roast` and `lib/jobs` import `server-only`: importing them from a
  `"use client"` component fails the build. Pass plain data to client components instead.

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
- `IssueFacts = DailyRoastFacts | ThursdayFalloutFacts | WeeklyRoastFacts | DraftGradesFacts`.

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
