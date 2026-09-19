/**
 * Download dev fixtures into fixtures/ (gitignored). Run: npm run fixtures [-- --force]
 *
 * - RT Dynasty (Ethan's other league, full completed 2025 season): league, users, rosters,
 *   matchups 1-17, transactions 1-18, drafts + picks + draft traded picks, traded picks,
 *   brackets.
 * - NFL 2025: stats + projections weeks 1-17, schedule, ESPN scoreboards weeks 1-17.
 * - A scoring-check league: a completed 2025 league of Ethan's with MSTP's starting slots and
 *   MSTP's headline weights (full PPR, +0.5 TE reception bonus, 6-pt pass TD, yardage). Picked
 *   automatically, so no league name or id is committed. Used only by tests/scoring.test.ts,
 *   which checks it against its OWN scoring_settings.
 * - MSTP Dynasty: current league objects, draft, NFL state, 2026 schedule, current week data.
 * - /players/nfl (full, ~14 MB) and FantasyCalc current values.
 *
 * Files are written at fixtureRelPath(url) so DATA_SOURCE=fixtures replays them exactly.
 * Never publish or email anything about the RT league.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { espnScoreboardUrl } from "../lib/espn";
import { FANTASYCALC_URL } from "../lib/fantasycalc";
import { fetchJson, fixtureRelPath, fixturesDir } from "../lib/http";
import { sleeperUrl } from "../lib/sleeper";

delete process.env.DATA_SOURCE; // always hit the network here

const ETHAN_USER_ID = "866356317755973633";
const MSTP_LEAGUE_ID = "1406497799725424640";
const FIXTURE_SEASON = "2025";
const MATCHUP_WEEKS = range(1, 17);
const TRANSACTION_WEEKS = range(1, 18);
const STAT_WEEKS = range(1, 17);

const force = process.argv.includes("--force");
const dir = fixturesDir();

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let written = 0;
let skipped = 0;

/** Fetch url and save it. `always` refetches even without --force (for live objects). */
async function save(url: string, always = false): Promise<unknown> {
  const file = `${dir}/${fixtureRelPath(url)}`;
  if (!force && !always && (await exists(file))) {
    skipped++;
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(file, "utf8"));
  }
  const data = await fetchJson(url, { retries: 3, timeoutMs: 90_000 });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  written++;
  return data;
}

/** Run tasks with limited concurrency (be polite to Sleeper). */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

interface LeagueLite {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  draft_id: string | null;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
}

async function main() {
  console.log(`Writing fixtures to ${dir}${force ? " (force)" : ""}`);

  // 1. Find the RT league.
  const leagues = (await save(sleeperUrl.userLeagues(ETHAN_USER_ID, FIXTURE_SEASON), true)) as LeagueLite[];
  const rtCandidates = leagues.filter((l) => /^rt dynasty/i.test(l.name));
  const rt =
    rtCandidates.find((l) => /^rt dynasty league$/i.test(l.name)) ??
    rtCandidates.find((l) => l.total_rosters === 10) ??
    rtCandidates[0];
  if (!rt) throw new Error(`No league named "RT Dynasty..." in ${FIXTURE_SEASON}: ${leagues.map((l) => l.name).join(", ")}`);
  console.log(`RT league: ${rt.league_id} "${rt.name}" (${rt.season}, ${rt.status}, ${rt.total_rosters} teams)`);

  // Scoring-check league: same starting slots and headline weights as MSTP.
  const mstpNow = (await save(sleeperUrl.league(MSTP_LEAGUE_ID), true)) as LeagueLite;
  const HEADLINE_WEIGHTS = ["rec", "bonus_rec_te", "pass_td", "pass_yd", "rush_yd", "rec_yd", "rush_td", "rec_td"];
  const scoringKey = (l: LeagueLite) => JSON.stringify(HEADLINE_WEIGHTS.map((k) => l.scoring_settings?.[k] ?? 0));
  const slotsKey = (l: LeagueLite) => JSON.stringify((l.roster_positions ?? []).filter((s) => !["BN", "IR", "TAXI"].includes(s)));
  const scoringCheck = leagues
    .filter((l) => l.status === "complete" && l.league_id !== rt.league_id)
    .filter((l) => scoringKey(l) === scoringKey(mstpNow) && slotsKey(l) === slotsKey(mstpNow))
    .slice(0, 1);
  if (!scoringCheck.length) console.warn("No completed 2025 league with MSTP's headline scoring: the TE-bonus scoring test will fail.");

  // 2. RT league objects.
  const R = rt.league_id;
  const leagueUrls = [
    sleeperUrl.league(R),
    sleeperUrl.users(R),
    sleeperUrl.rosters(R),
    sleeperUrl.tradedPicks(R),
    sleeperUrl.winnersBracket(R),
    sleeperUrl.losersBracket(R),
    sleeperUrl.drafts(R),
    ...MATCHUP_WEEKS.map((w) => sleeperUrl.matchups(R, w)),
    ...TRANSACTION_WEEKS.map((w) => sleeperUrl.transactions(R, w)),
  ];
  await pool(leagueUrls, 4, (u) => save(u));
  const drafts = (await save(sleeperUrl.drafts(R))) as Array<{ draft_id: string }>;
  await pool(
    drafts.flatMap((d) => [sleeperUrl.draft(d.draft_id), sleeperUrl.draftPicks(d.draft_id), sleeperUrl.draftTradedPicks(d.draft_id)]),
    4,
    (u) => save(u),
  );

  // 3. NFL season data.
  const nflUrls = [
    sleeperUrl.schedule(FIXTURE_SEASON),
    ...STAT_WEEKS.map((w) => sleeperUrl.stats(FIXTURE_SEASON, w)),
    ...STAT_WEEKS.map((w) => sleeperUrl.projections(FIXTURE_SEASON, w)),
    ...STAT_WEEKS.map((w) => espnScoreboardUrl({ season: FIXTURE_SEASON, week: w })),
  ];
  await pool(nflUrls, 4, (u) => save(u));

  // 4. Scoring-check league(s).
  for (const l of scoringCheck) {
    console.log(`Scoring-check league: ${l.league_id}`);
    await pool(
      [sleeperUrl.league(l.league_id), sleeperUrl.users(l.league_id), sleeperUrl.rosters(l.league_id), ...MATCHUP_WEEKS.map((w) => sleeperUrl.matchups(l.league_id, w))],
      4,
      (u) => save(u),
    );
  }

  // 5. MSTP current objects (always refreshed).
  const M = MSTP_LEAGUE_ID;
  const state = (await save(sleeperUrl.state(), true)) as { season: string; week: number };
  const mstp = (await save(sleeperUrl.league(M), true)) as LeagueLite;
  const currentWeek = Math.max(1, state.week);
  const mstpUrls = [
    sleeperUrl.users(M),
    sleeperUrl.rosters(M),
    sleeperUrl.tradedPicks(M),
    sleeperUrl.drafts(M),
    sleeperUrl.matchups(M, currentWeek),
    sleeperUrl.transactions(M, currentWeek),
    sleeperUrl.schedule(state.season),
    sleeperUrl.stats(state.season, currentWeek),
    sleeperUrl.projections(state.season, currentWeek),
    espnScoreboardUrl(),
    ...(mstp.draft_id
      ? [sleeperUrl.draft(mstp.draft_id), sleeperUrl.draftPicks(mstp.draft_id), sleeperUrl.draftTradedPicks(mstp.draft_id)]
      : []),
  ];
  await pool(mstpUrls, 4, (u) => save(u, true));

  // 6. Players + FantasyCalc (players only once unless --force: it is 14 MB).
  await save(sleeperUrl.players());
  await save(FANTASYCALC_URL, true);

  // 7. Manifest.
  const manifest = {
    fetchedAt: new Date().toISOString(),
    rt: { leagueId: R, name: rt.name, season: rt.season, draftIds: drafts.map((d) => d.draft_id) },
    scoringCheck: scoringCheck.map((l) => ({ leagueId: l.league_id, season: l.season })),
    mstp: { leagueId: M, name: mstp.name, season: mstp.season, draftId: mstp.draft_id, currentWeek },
    weeks: { matchups: MATCHUP_WEEKS, transactions: TRANSACTION_WEEKS, stats: STAT_WEEKS, projections: STAT_WEEKS },
    nflState: state,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`Done: ${written} written, ${skipped} already present. Manifest at ${dir}/manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
