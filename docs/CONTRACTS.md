# Contracts for the parallel agents

Read `docs/SITE_SPEC.md` first (the product contract). This file is the code contract: who owns
which files, the shared modules you consume, and the functions you implement. Types live in
`lib/types.ts`. Every function listed under "Functions each agent implements" already exists as a STUB that returns
correctly shaped placeholder data with `placeholder: true`, so the UI can be built right now.

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
standingsFromRosters(ctx): StandingRow[]           // wins (ties half), then points for
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
getWinProbabilities(week: number, ctx?): Promise<WinProbWeek>
runSeasonSim(opts?: SimOptions): Promise<SimResult>      // opts: { runs?, seed?, fromWeek?, persist?, ctx? }
getPowerRankings(ctx?): Promise<PowerRankings>
getOddsHistory(ctx?): Promise<OddsHistory>
```
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
transactionFacts(sinceMs: number, ctx?): Promise<TransactionFacts>
draftFacts(ctx?): Promise<DraftFacts>
tnfFacts(week: number, ctx?): Promise<TnfFacts>
shameEntries(ctx?): Promise<ShameBoard>

isRoastConfigured(): boolean
roastIssue(kind: IssueKind, facts: IssueFacts, ctx?): Promise<Issue>
roastItem(kind: RoastItemKind, fact: RoastItemFact, ctx?): Promise<Roast>
```
- Facts are deterministic and unit tested on the RT fixture. `WaiverFact.batchId` groups claims from the
  same waiver run; `roastItem("waiver", WaiverFact[])` roasts a batch.
- `roastIssue` never throws for LLM reasons: on no key, refusal or API error it returns a facts-only
  issue (`factsOnly: true`, `note: "The roast writer called in sick. Facts only today."`). Status starts as `"draft"`;
  ops decides sending. `slug` must be URL-safe and unique per league (the stub uses `YYYY-MM-DD-kind`).
- `IssueBlock` is plain text (no HTML, no markdown) so web and email render the same content.
- Issue titles: "The Daily Roast", "Thursday Night Fallout", "The Weekly Roast", "Draft Grades"
  (`ISSUE_TITLES` in `lib/roast`).
- `config/roast-notes.ts`: empty defaults only (one empty string per manager) and a comment explaining
  that real lore comes from env `ROAST_NOTES` (JSON, manager first name -> text) and/or the store key
  `roast-notes`, env winning. Lore never goes in the repo.

### Ops agent: `lib/jobs/index.ts`, `lib/email/index.ts`, routes
```ts
runDaily(now?: Date): Promise<JobRunReport>
runTick(now?: Date): Promise<JobRunReport>        // `locked: true` when the 2-minute cooldown is held
sendIssue(issue: Issue, mode?: NewsletterMode): Promise<SendResult>
subscribe(input: SubscribeInput): Promise<SubscribeResult>     // { email, managerKey }
unsubscribe(token: string): Promise<UnsubscribeResult>         // token from the signed link
```
Routes: `/api/cron/daily`, `/api/tick`, `/api/admin/approve`, `/api/unsubscribe`, `/enter`, `/subscribe`,
`proxy.ts` (Next 16 renamed middleware to proxy). Jobs persist issues and roasts through `lib/archive.ts`
and write a run log under `keys.jobRun`. Draft pick first-seen timestamps go under
`keys.snapshot(leagueId, "draft-pick-seen")` so facts can fill `DraftPickFact.pickedAt/secondsOnClock`.

### UI agent: pages
Consume only the public functions above plus the shared modules. Render all three states
(pre-draft, drafting, in-season, plus offseason/complete). When a result has `placeholder: true`,
show a small "sample data" marker. Home page may trigger the tick with `after()` from `next/server`
by calling `runTick()`; the ops agent owns what it does.

## Data shapes (see `lib/types.ts` for every field)

- `WinProbWeek { week, season, generatedAt, basis, matchups: WinProb[], placeholder }`,
  `WinProb { week, matchupId, home: TeamWinProb, away: TeamWinProb, isFinal }`,
  `TeamWinProb { team, actual, projected, mean, sd, winProb (0..1), starters: StarterLine[] }`.
- `SimResult { season, asOfWeek, runs, seed, generatedAt, teams: SimTeamOdds[], placeholder }`.
- `PowerRankings { season, asOfWeek, formula, rows: PowerRow[], placeholder }`.
- `OddsHistory { season, snapshots: OddsSnapshot[], placeholder }`.
- `WeeklyFacts { week, season, matchups: MatchupFact[], teams: TeamWeekFact[], highest, lowest, loserOfTheWeek, standings, placeholder }`.
- `TransactionFacts { sinceMs, untilMs, trades: TradeFact[], waivers: WaiverFact[], placeholder }`.
- `DraftFacts { draftId, status, startTime, rounds, teams, picks: DraftPickFact[], onTheClock, positionRuns, grades, placeholder }`.
- `TnfFacts { week, games, players: TnfPlayerFact[], teams, placeholder }`.
- `ShameBoard { entries: ShameEntry[], placeholder }`.
- `Issue { id, slug, kind, leagueId, season, week, date, title, dek, sections: IssueSection[], factsOnly, note, status, createdAt, sentAt, recipientCount, model, usage, imageUrl, placeholder }`.
- `Roast { id, kind, leagueId, rosterIds, text, facts, source, model, createdAt, usage }`.
- `IssueFacts = DailyRoastFacts | ThursdayFalloutFacts | WeeklyRoastFacts | DraftGradesFacts`.

## Fixtures and dev leagues

- `npm run fixtures` downloads everything into `fixtures/` (gitignored). `fixtures/manifest.json` has the ids.
- RT fixture league: `manifest.rt.leagueId` (Sleeper name "RT Dynasty Draft", 2025, complete,
  10 teams, 2QB, half PPR, 4-pt pass TD, K slot, FAAB $250). Its only draft is a 3-round linear
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
