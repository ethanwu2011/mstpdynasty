# Developing mstpdynasty.com

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4. Node 22. Vitest for tests.
Specs: `docs/SITE_SPEC.md` (product), `docs/CONTRACTS.md` (code contracts and file ownership).

## Run it

```sh
npm install
npm run fixtures     # once: downloads test/dev data into fixtures/ (about 85 MB, gitignored)
npm run dev          # http://localhost:3000, live Sleeper data for MSTP Dynasty
```

Checks (all must pass before handing off):

```sh
npm run typecheck    # tsc --noEmit
npm test             # vitest run (offline: replays fixtures/)
npm run lint
npm run build        # next build (fetches live Sleeper data for prerendering)
```

Be kind to the machine: one heavy process at a time (a build or a dev server), and stop dev
servers when done.

## Dev modes

| Want | Command |
|---|---|
| Real league, live data | `npm run dev` |
| Dev fixture league (completed season), offline | `npm run dev:rt` (reads its id from `fixtures/manifest.json`) |
| Dev fixture league as if it were week 9 | `LEAGUE_WEEK_OVERRIDE=9 npm run dev:rt` |
| Another port | `npm run dev:rt -- -p 3200` |

`LEAGUE_ID` other than MSTP makes `ctx.isDevLeague` true: nothing is ever emailed or published
about it. Never publish anything about the dev fixture league.

## Jobs by hand

The daily job and the tick are plain routes, so under `next dev` with no `CRON_SECRET` and no paid
keys (`RESEND_API_KEY`, `ANTHROPIC_API_KEY`):

```sh
curl localhost:3000/api/cron/daily   # plans by today's ET date and league phase; JSON report
curl localhost:3000/api/tick         # instant roasts, 2-minute cooldown; statuses only
```

`next dev` listens on every network interface, so once a paid key is in `.env.local` the cron route
needs `CRON_SECRET` in dev too. Under `npm run build && npm start` (NODE_ENV=production) always set
`CRON_SECRET=x` and send `-H "Authorization: Bearer x"`. With `SITE_PASSWORD` set, `/api/tick` also
needs the gate cookie or that bearer.

On a dev league (`npm run dev:rt`) nothing is emailed or published: issues are saved as drafts.
Use a scratch store (`DATA_DIR=/some/tmp/dir`) if you do not want runs to touch `.data/`.
In production Vercel fires `/api/cron/daily` once a day at 12:00 UTC (8 AM EDT, 7 AM EST;
Hobby allows one daily cron), so every issue goes out then.

## Public repo

The GitHub repo is public. Never commit secrets, `fixtures/`, `.data/`, `.review/`, `docs/samples/`
(all gitignored), or anything generated from the dev fixture league (sample issues, roasts,
screenshots). Keep league ids, user ids and league names other than MSTP's out of committed files:
code reads them from `fixtures/manifest.json`, and `npm run fixtures` finds the fixture league from
`FIXTURE_USER_ID` + `FIXTURE_LEAGUE_NAME` (env) or the untracked `fixtures/config.json`
(`{"userId":"...","leagueName":"..."}`).

## Roast lore

Per-manager running jokes never live in the repo. `config/roast-notes.ts` ships empty defaults.
Real lore is read at runtime from env `ROAST_NOTES` (JSON object: manager first name -> text,
parsed by `roastNotesFromEnv()` in `lib/env.ts`) and/or the store key `roast-notes`
(`keys.roastNotes()` in `lib/store.ts`). Env wins.

```sh
ROAST_NOTES='{"Ethan":"drafted a kicker in a league with no kickers","Peter":"..."}'
```

## Fixtures

`scripts/fetch-fixtures.ts` (`npm run fixtures`, add `-- --force` to refetch everything) writes each
response to `fixtures/<host>/<url path>@<sorted query>.json`, the same path `lib/http.ts` reads in
fixture mode, so `DATA_SOURCE=fixtures` replays the exact API responses. Contents:

- The dev fixture league (2025, complete; found among `FIXTURE_USER_ID`'s 2025 leagues by
  `FIXTURE_LEAGUE_NAME`): league, users, rosters, matchups weeks 1-17, transactions weeks 1-18,
  drafts + picks + draft traded picks, traded picks, brackets.
- NFL 2025: stats and projections weeks 1-17, schedule, ESPN scoreboards weeks 1-17.
- Scoring-check league (picked automatically: a completed 2025 league of Ethan's with MSTP's slots
  and headline scoring, including the TE bonus): league, users, rosters, matchups 1-17. Used only
  by `tests/scoring.test.ts`.
- MSTP Dynasty current objects (league, users, rosters, draft, picks, traded picks, current week
  matchups and transactions), NFL state, 2026 schedule and current-week stats/projections, ESPN
  current scoreboard. These are refetched on every run.
- `/players/nfl` (full, 14 MB, fetched once unless `--force`) and FantasyCalc current values.
- `fixtures/manifest.json`: ids and weeks (read it via `tests/helpers/fixtures.ts`).

## Storage

`lib/store.ts` uses Upstash Redis when `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or the `UPSTASH_*`
pair) are set; otherwise JSON files in `.data/` (gitignored). Tests use an in-memory store. Delete
`.data/` to reset local state. On Vercel without KV the file store falls back to `/tmp`, which is
per-instance and temporary: configure KV before relying on issues, roasts or subscribers there.

## Caching

- Small Sleeper payloads use the Next data cache with per-endpoint `revalidate` (`REVALIDATE` in
  `lib/sleeper.ts`: rosters and matchups 60 s, draft picks 30 s, league 120 s, schedule 6 h...).
- Weekly stats, projections and `/players/nfl` exceed the 2 MB Next cache limit, so they are fetched
  uncached, trimmed, and cached in memory plus the store (`TRIMMED_TTL`). Players refresh at most
  once per 24 h.
- FantasyCalc is cached per Eastern date, with one snapshot kept per day for historical trade grades.

## Environment variables

All optional. See `.env.example` for the full list with comments. With none set the site renders,
models run, and roast/email features report "not configured yet".

| Variable | Purpose |
|---|---|
| `LEAGUE_ID` | League override for dev (default MSTP 1406497799725424640) |
| `LEAGUE_WEEK_OVERRIDE` | Dev: force in-season at week N |
| `DATA_SOURCE`, `FIXTURES_DIR` | `fixtures` replays `fixtures/` instead of the network |
| `ANTHROPIC_API_KEY` | The Roast (roasts, newsletters) |
| `ROAST_NOTES` | Roast lore JSON (manager first name -> text); never commit it |
| `RESEND_API_KEY`, `EMAIL_FROM`, `COMMISSIONER_EMAIL` | Email |
| `NEWSLETTER_MODE` | `review` (default) or `auto` |
| `SITE_PASSWORD` | Gate the whole site behind `/enter`. Use a long passphrase: guesses are rate limited (10 per IP and 100 overall per 15 minutes), but the password is shared |
| `GATE_VERSION` | Optional. Change it to sign everyone out of the gate without changing the password |
| `CRON_SECRET` | Bearer token for `/api/cron/daily` (and `/api/tick` when the gate is on). Unset: the cron route runs under `next dev` only while no paid key is set, and returns 503 under `next start` / Vercel |
| `ADMIN_SECRET` | HMAC key for approve and unsubscribe links |
| `SITE_URL` | Public base URL for links in emails. Set it before any email goes out |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | KV store |
| `STORE_BACKEND`, `STORE_PREFIX`, `DATA_DIR` | Store overrides (`upstash`, `file`, `memory`; key prefix; file dir) |
| `IMAGE_PROVIDER`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Loser of the Week images (phase 2, default `none`) |
| `FIXTURE_USER_ID`, `FIXTURE_LEAGUE_NAME` | `npm run fixtures` only: which league is the dev fixture (or `fixtures/config.json`). Never commit them |

## Layout

```
app/                 pages (UI agent), app/api (ops agent)
components/          UI components (UI agent)
config/managers.ts   the ten managers (first name <-> Sleeper username)
lib/                 shared data layer (frozen) + agent folders: models/, facts/, roast/, jobs/, email/
scripts/             fetch-fixtures.ts
tests/               vitest; tests/helpers/fixtures.ts for fixture access
docs/                SITE_SPEC.md, CONTRACTS.md, DEV.md
```
