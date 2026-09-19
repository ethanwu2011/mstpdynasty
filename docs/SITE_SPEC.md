# mstpdynasty.com: build spec

Single source of truth for the site and the roast agent. Every agent reads this first.

## DECISIONS FROM ETHAN (2026-09-18 20:10 ET), override anything below
- NO MED THEME AT ALL. No "Attending", no hospital/chart/rounds/M&M/autopsy language anywhere: not in the persona, issue names, page labels, or design. Straight fantasy roasting.
- Persona: an unnamed, merciless fantasy football columnist (sports-radio / roast-comic energy). Byline "The Roast". Email from "The Roast <roast@mstpdynasty.com>".
- Issue names: "The Daily Roast" (daily 8 AM ET, only when there is material), "Thursday Night Fallout" (Friday, in season), "The Weekly Roast" (Tuesday full recap), "Draft Grades" (once, after the startup draft).
- Home page in season: the LATEST ROAST leads, live scores and win odds come right after it.
- Audience: the 10 managers, equally on phones during games and on laptops reading during the week. Both layouts are first-class.
- Visual direction is being decided separately (PRODUCT.md / DESIGN.md at the repo root, written with the impeccable skill). If DESIGN.md exists, it overrides the "Design direction" section below.

## What it is
A live tracker and roast machine for the MSTP Dynasty fantasy league (10 MD/PhD students, Sleeper dynasty league). Commissioner: Ethan. The point is humor: brutal, specific roasts of fantasy decisions, built on real stats. Secondary point: genuinely good live data and models (win probability, season odds), because good numbers make roasts land.

Owner hates anything that looks AI-generated. No generic SaaS look, no gradient hero, no emoji, no "sparkle" icons, no rounded-card grids with drop shadows, no Inter-on-white template. It should look like a person with taste built it.

## Hard facts
- Sleeper league id: 1406497799725424640 (name "MSTP Dynasty", season 2026, status pre_draft as of 2026-09-18). Startup draft id 1406497801021427712: slow snake, 3rd-round reversal, 34 rounds, 4-hour clock, autopause, not yet started (scheduled 2026-09-18 21:00 ET, autostart off).
- Roster: QB, QB, RB, RB, WR, WR, WR, TE, FLEX x3 (RB/WR/TE), 20 bench, 3 taxi, 2 IR. No K, no DEF. Scoring: read `scoring_settings` from the league object at runtime (full PPR, +0.5 TE reception bonus, 6-pt pass TD). Never hardcode scoring.
- Playoffs: 6 teams, Weeks 15-17, reseeded. Tiebreak record then points for. Trades: instant, deadline Week 14. FAAB $100.
- Managers (first name = Sleeper username): Alex = AK742, Anish = agk100, Brandon = bgong99, Carlos = KomicalKomodo, Devante = DBanner12, Ethan = ZachWilsonFan5 (commissioner), Justin = Justin919, Matthew = mattsolo20, Navid = navidx2, Peter = Peteros. Map by Sleeper user_id at runtime (fetch /league/<id>/users, match display_name case-insensitively) and keep this table in `config/managers.ts`.
- Time zone for everything user-facing: America/New_York.
- Today is 2026-09-18 (NFL Week 2). The league has NO games yet. Everything must render sensibly in three states: pre-draft, drafting, in-season (plus offseason later).

## Data sources (all public, no auth)
- Sleeper v1 API: https://api.sleeper.app/v1 : /league/<id>, /league/<id>/users, /rosters, /matchups/<week>, /transactions/<week>, /traded_picks, /drafts, /draft/<id>, /draft/<id>/picks, /state/nfl, /players/nfl (14 MB: fetch at most once a day, trim to {id, name, pos, team, age, years_exp, injury_status, status} and cache).
- Sleeper undocumented (used widely, may change; wrap defensively): https://api.sleeper.app/projections/nfl/<season>/<week>?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE (per-player projected stat lines) and https://api.sleeper.app/stats/nfl/<season>/<week>?season_type=regular (actual stat lines), https://api.sleeper.app/schedule/nfl/regular/<season> (games with week, home, away, status, date).
- ESPN scoreboard for live game clocks: https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard (and ?week=N&seasontype=2). Use it only for game status, period and clock (fraction of game remaining per NFL team).
- FantasyCalc dynasty values: https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=10&ppr=1 (array of {player:{sleeperId,name,position,maybeAge,...}, value, overallRank, positionRank, redraftValue, trend30Day}). Use for trade grades, draft reach/steal, team value.
- Dev fixture league: Ethan's other league, "RT Dynasty League" (10-team 2QB dynasty). Find its 2025 league id via GET /v1/user/866356317755973633/leagues/nfl/2025. It has a full completed 2025 season: use it to test scoring, facts, models and roasts end to end. `scripts/fetch-fixtures.ts` downloads fixtures into `fixtures/` (gitignored). Never publish or email anything about the RT league. Env `LEAGUE_ID` overrides the league for local dev.

## Stack
Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, same as Ethan's personal site (/Users/ethanwu/Ethan_Personal_Website). Next 16 has breaking changes (for example middleware is now `proxy.ts`): before using a Next API, check the installed docs in node_modules/next/dist/docs (if present) or the official Next 16 docs. Vitest for tests. Deployed later on Vercel (Hobby). Node 22.

Packages: @anthropic-ai/sdk, resend, @upstash/redis, zod, vitest. Nothing else without a reason.

Storage: `lib/store.ts` = tiny KV interface (get/set/list/lock). Uses Upstash Redis when KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) are set, otherwise a JSON file store in `.data/` for local dev. Stored: trimmed players, issues (newsletters), roasts (trades, waivers, draft picks) keyed by transaction/pick id, sim history per week, subscribers, job run log, last-seen snapshots (injury status etc).

## Env vars (document all in .env.example, never commit values)
LEAGUE_ID, ANTHROPIC_API_KEY, RESEND_API_KEY, EMAIL_FROM ("The Attending <attending@mstpdynasty.com>"), COMMISSIONER_EMAIL, NEWSLETTER_MODE (review | auto, default review), SITE_PASSWORD (if set, whole site is gated), CRON_SECRET, ADMIN_SECRET (HMAC for approve/unsubscribe links), SITE_URL, KV_* / UPSTASH_*, IMAGE_PROVIDER (none | openai | gemini, default none) + OPENAI_API_KEY / GEMINI_API_KEY.
Everything must work with NO keys set: the site renders, models run, and roast/email features show a clear "not configured yet" state instead of crashing.

## Roast engine (the core feature)
Rule 1: code computes every fact; the LLM only writes jokes about facts it is handed. The prompt forbids inventing stats, and a post-check verifies every number in the output appears in the facts payload (drop or regenerate otherwise).

Persona: "The Attending", a malignant attending physician who writes the league's newsletter and pimps the managers on rounds. Med-school register used for flavor, not every line (presenting the patient, "this is a code", "your team is DNR", "see me after rounds", pimping questions). Toxic in the way a friend group is toxic: goes hard at fantasy decisions, bad luck, bad trades, cheap FAAB bids, lineup negligence, and whatever inside jokes are in `config/roast-notes.ts` (per-manager running jokes Ethan fills in; ship it with empty strings and a comment explaining it). Hard limits in the system prompt: nothing about race, ethnicity, religion, sexuality, gender, disability, bodies, family, or real academic/medical/personal failures unless it is in roast-notes. No slurs. It roasts decisions, not identities.

Issues (newsletters), all written by The Attending:
- "Morning Rounds" (daily, 8 AM ET): transactions since last run (trades with value-based grades, waiver claims with winning and losing bids, "$0 bid" and big-overpay callouts, notable drops), injuries to rostered starters, lineup negligence alerts (a starter on bye/out/IR for this week's games: shame them BEFORE kickoff), draft picks since last run while the startup draft is live. Only sends when there is material. Quiet days send nothing.
- "Thursday Night Autopsy" (Friday 8 AM ET, in season): who got cooked or carried by the Thursday game, matchups already decided in spirit, live win probabilities after TNF.
- "M&M Conference" (Tuesday 9 AM ET, after Monday night): the weekly recap. Every matchup, points left on the bench, the start/sit call that flipped a result, highest/lowest score, lost with a top-3 score (robbed) / won with a bottom-3 score (fraud), standings, updated season odds, power rankings, Loser of the Week.
- "Draft Report" (once, after the startup draft completes): grades for every team using FantasyCalc value, reaches and steals, and projected season odds.
- Instant roasts (site only, no email): each trade, waiver claim batch, and startup draft pick gets a 1-3 sentence roast shortly after it happens.

Facts engine (`lib/facts/*`), deterministic and unit tested on the RT fixture:
- Weekly: per matchup scores and margins; per team optimal lineup points from the actual roster and actual player points (respect slot eligibility) => bench points left; the single bench/starter swap that would have flipped a loss; starters who scored 0 with their status (bye, out, IR, inactive); projected vs actual; all-play record for the week; robbed/fraud flags; standings change; streaks.
- Transactions: trades with both sides' FantasyCalc value and delta; waiver claims with bid, failed competing bids, $0 bids; adds/drops of valuable players.
- Draft: each pick with overall pick number, FantasyCalc overall rank => reach (+) or steal (-), age, position, time on the clock if available from pick metadata, position runs.
- TNF: players in the Thursday game, their points, which teams they helped or hurt.

Claude API usage (from the claude-api skill, use exactly): `import Anthropic from "@anthropic-ai/sdk"; const client = new Anthropic();` model `claude-opus-5`. Use `client.beta.messages.create({ model: "claude-opus-5", max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", cache_control: { type: "ephemeral" }, system: <frozen persona + rules, byte-stable so it caches>, messages: [{ role: "user", content: <facts JSON + issue type> }] })`. Do not send temperature/top_p, budget_tokens, or an assistant prefill (all 400 on this model). Always check `stop_reason === "refusal"` before reading content; on refusal or any API error, publish a facts-only version with a one-line "The Attending is in a meeting" note. Narrow content blocks by `block.type === "text"`. If the installed SDK's types reject `fallbacks`, keep the call shape and cast narrowly, then note it. Log usage.cache_read_input_tokens.

Images (phase 2, behind IMAGE_PROVIDER): "Loser of the Week" cartoon of the losing team's NAME or mascot in misery. Never real faces (no managers, no NFL players). Build the interface and a no-op provider now; real providers get added once Ethan picks one.

## Models (`lib/models/*`), unit tested
- League scoring: fantasy points from a stat line using the league's scoring_settings (including bonus_rec_te for TEs). Test: recomputed points must equal Sleeper's own `players_points` in the RT fixture matchups within 0.01 for every player in every week.
- Live win probability per matchup: for each starter, actual points so far + remaining projection x fraction of his NFL game remaining; variance per player ~ (0.6 x projection)^2 x fraction remaining (make the coefficient a named constant); P(A wins) = Phi(mean diff / sd). Must be exactly 0 or 1 when all games are final. Pre-game it is just projections.
- Season simulator: 10,000 seeded Monte Carlo runs of the remaining schedule (Sleeper matchups for future weeks). Team weekly mean = shrinkage blend of projected optimal-lineup points and observed mean (weight grows with games played); team sd = shrinkage blend of observed sd and a 25-point prior. Standings with record then PF, 6-team reseeded playoff. Outputs per team: playoff %, bye %, title %, last place %, expected wins, and a clearly labeled approximate 1.01 odds. Store one snapshot per week so the site can show how odds moved. Sanity tests: playoff % sums to 600, title % sums to 100, same seed gives same result.
- Power rankings: blend of all-play win %, points per game, and projected strength. Show the formula on the page in one plain sentence.
- Pre-draft and during the draft there are no games: show draft-based projected strength once rosters exist.

## Pages
- `/` Home: whichever is live. Pre-draft/drafting: the draft board summary, latest pick roasts, countdown to draft start. In season: this week's scoreboard with win-probability bars that update (revalidate ~60 s during game windows), latest issue headline, top Wall of Shame entries, standings snippet.
- `/draft`: full startup draft board (10 teams x 34 rounds grid) with FantasyCalc rank, reach/steal, roast per pick. After completion, draft grades.
- `/scores` and `/scores/[week]`: all matchups for a week with win probability and bench points left.
- `/standings`: standings, power rankings, luck (actual wins minus all-play expected wins).
- `/odds`: season simulator table + a small hand-made odds-over-time chart (inline SVG, no chart library).
- `/teams/[rosterId]`: roster grouped by position with FantasyCalc values and ages, team value, rap sheet (their shame entries and roasts).
- `/shame`: Wall of Shame, all-time (bench points left, zero-point starters, worst trades by value lost, $0 bids that lost, biggest overpays).
- `/trades`: every trade with value delta and roast.
- `/newsletter` and `/newsletter/[slug]`: issue archive and issue pages (the same content as the email).
- `/subscribe`: pick your name from the 10 managers, enter email. Confirmation + unsubscribe link in every email.
- Password gate when SITE_PASSWORD is set (`/enter` page, httpOnly cookie).
- API: `/api/cron/daily` (Vercel cron, once a day, `Authorization: Bearer ${CRON_SECRET}`) decides by date and league state which jobs run (Morning Rounds every day, Autopsy on Fridays in season, M&M on Tuesdays in season, Draft Report once after draft completes). `/api/tick` is fired from page renders via Next's after() and, under a KV lock with a 2-minute cooldown, roasts any new trades, waiver results and draft picks (this is how roasts appear quickly on Vercel Hobby, which only allows daily cron). `/api/admin/approve?issue=...&sig=...` sends a reviewed issue. `/api/unsubscribe`.

## Email
Resend. One clean, text-first HTML email per issue (single column, readable serif body, the league name in small caps at the top, no stock header images, no big colored buttons) + a plain-text part. NEWSLETTER_MODE=review sends the draft only to COMMISSIONER_EMAIL with an "Approve and send to the league" link (HMAC-signed, single use); auto sends to all subscribers directly. Every email has an unsubscribe link ("in case you can't take it").

## Design direction
A hospital chart crossed with a sports tabloid. Paper-white background (#FBFAF7-ish), near-black ink, Pitt navy #003594 as the one accent (the league's Drive files use it), gold #FFB81C only for the champion / leader, one alarm red for shame. Tabular monospace numerals for scores. A readable serif for newsletter body text, a plain grotesk (not Inter) for UI. Dense tables over cards. Labels like a patient census where it is funny (standings as "Census", team pages with "Prognosis"), but never let the theme hurt readability. Mobile works at 375 px. Use the `impeccable` skill for design craft and run its anti-pattern / AI-slop checks.

## Public repo rules (repo is PUBLIC at github.com/ethanwu2011/mstpdynasty)
- Never commit secrets, fixtures/, .data/, .review/, or anything generated from the RT league. docs/samples/ must be gitignored.
- Roast lore must NOT live in the repo. config/roast-notes.ts only holds empty defaults. Real lore is read at runtime from env ROAST_NOTES (JSON object: manager first name -> text) and/or the store key "roast-notes"; env wins. Document this in .env.example and docs/DEV.md.

## Security
No secrets in client bundles. Cron and admin routes verify secrets with constant-time compare. Approve and unsubscribe links are HMAC signed. Rate-limit /api/tick with the KV lock. Escape all user-provided text (team names come from Sleeper and are user-controlled) in HTML and email. Subscribe endpoint validates email and caps subscribers at 30.

## Out of scope for now
Deploying, creating the GitHub repo, DNS, buying anything. Work locally in /Users/ethanwu/mstpdynasty only. Never touch /Users/ethanwu/Ethan_Personal_Website.
