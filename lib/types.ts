/**
 * Shared types for mstpdynasty.com. FROZEN after the foundation step: agents that
 * need a change here note it in their report instead of editing this file.
 *
 * Sections:
 *   1. Sleeper API shapes (raw, lightly normalized)
 *   2. Undocumented Sleeper + ESPN + FantasyCalc shapes (normalized)
 *   3. League context
 *   4. Models (win probability, season sim, power rankings)
 *   5. Facts (weekly, transactions, draft, TNF, shame)
 *   6. Roasts and issues (newsletters)
 *   7. Jobs and email
 *   8. Engine surface, round 3: stat-surface one-liners, trades in hindsight, draft odds, recipients
 *
 * Conventions:
 *   - Timestamps are epoch milliseconds (`number`) unless the name ends in `Iso`.
 *   - Points are rounded to 2 decimals; percentages are 0..100 (never 0..1) unless the
 *     name ends in `Prob` (0..1).
 *   - Every model / facts / roast result carries `placeholder: boolean`. The real modules
 *     always return `false`; `true` only ever meant foundation-stub sample data, and jobs
 *     refuse to build or send anything from a placeholder.
 *   - Team names, display names and player nicknames come from Sleeper and are
 *     user-controlled: always escape them in HTML and email.
 */

/* ------------------------------------------------------------------ */
/* 1. Sleeper v1 API                                                   */
/* ------------------------------------------------------------------ */

export type PlayerId = string;
export type RosterId = number;
export type UserId = string;

export type SleeperLeagueStatus = "pre_draft" | "drafting" | "in_season" | "complete";

/** Weight per stat key, e.g. { rec: 1, pass_td: 6, bonus_rec_te: 0.5 }. */
export type ScoringSettings = Record<string, number>;

export interface SleeperLeagueSettings {
  num_teams?: number;
  playoff_teams?: number;
  playoff_week_start?: number;
  /** 0 = one week per round. */
  playoff_round_type?: number;
  /** 0 = default seeding, 1 = reseed. */
  playoff_seed_type?: number;
  trade_deadline?: number;
  waiver_budget?: number;
  /** 2 = FAAB. */
  waiver_type?: number;
  taxi_slots?: number;
  reserve_slots?: number;
  last_scored_leg?: number;
  leg?: number;
  type?: number;
  [key: string]: number | undefined;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  status: SleeperLeagueStatus;
  sport: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: ScoringSettings;
  settings: SleeperLeagueSettings;
  draft_id: string | null;
  previous_league_id: string | null;
  avatar: string | null;
  metadata: Record<string, string> | null;
}

export interface SleeperUser {
  user_id: UserId;
  display_name: string;
  avatar: string | null;
  is_owner?: boolean | null;
  metadata: { team_name?: string; avatar?: string; [key: string]: string | undefined } | null;
}

export interface SleeperRosterSettings {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_decimal?: number;
  fpts_against?: number;
  fpts_against_decimal?: number;
  ppts?: number;
  ppts_decimal?: number;
  waiver_budget_used?: number;
  waiver_position?: number;
  total_moves?: number;
  [key: string]: number | undefined;
}

export interface SleeperRoster {
  roster_id: RosterId;
  owner_id: UserId | null;
  co_owners: UserId[] | null;
  league_id: string;
  /** Normalized: never null (empty array when Sleeper sends null). */
  players: PlayerId[];
  /** Starter ids in roster_positions order; "0" means an empty slot. */
  starters: PlayerId[];
  reserve: PlayerId[];
  taxi: PlayerId[];
  settings: SleeperRosterSettings;
  /** Includes `record` ("WLLW..."), `streak` ("2W") and `p_nick_<playerId>` nicknames (untrusted). */
  metadata: Record<string, string> | null;
}

export interface SleeperMatchup {
  roster_id: RosterId;
  /** null for teams without a game that week (e.g. eliminated in playoffs). */
  matchup_id: number | null;
  points: number;
  custom_points: number | null;
  starters: PlayerId[];
  starters_points: number[];
  players: PlayerId[];
  players_points: Record<PlayerId, number>;
}

export type SleeperTransactionType = "trade" | "waiver" | "free_agent" | "commissioner";
export type SleeperTransactionStatus = "complete" | "failed" | "pending" | string;

export interface SleeperTradedPickRef {
  season: string;
  round: number;
  /** Original owner's roster id (whose pick it is). */
  roster_id: RosterId;
  /** Roster that owns it after this move. */
  owner_id: RosterId;
  previous_owner_id: RosterId;
  league_id?: string | null;
}

export interface SleeperWaiverBudgetMove {
  sender: RosterId;
  receiver: RosterId;
  amount: number;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: SleeperTransactionType;
  status: SleeperTransactionStatus;
  /** Week ("leg") the transaction belongs to. */
  leg: number;
  created: number;
  status_updated: number;
  creator: UserId;
  roster_ids: RosterId[];
  consenter_ids: RosterId[] | null;
  /** player id -> roster id that added the player. */
  adds: Record<PlayerId, RosterId> | null;
  /** player id -> roster id that dropped the player. */
  drops: Record<PlayerId, RosterId> | null;
  draft_picks: SleeperTradedPickRef[];
  waiver_budget: SleeperWaiverBudgetMove[];
  /** waiver_bid (FAAB) and seq for waivers. */
  settings: { waiver_bid?: number; seq?: number; [key: string]: number | undefined } | null;
  metadata: { notes?: string; [key: string]: string | undefined } | null;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: RosterId;
  owner_id: RosterId;
  previous_owner_id: RosterId;
  draft_id?: string | number;
}

export type SleeperDraftStatus = "pre_draft" | "drafting" | "paused" | "complete";

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  season_type: string;
  type: "snake" | "linear" | "auction" | string;
  status: SleeperDraftStatus;
  start_time: number | null;
  last_picked: number | null;
  created: number;
  /** user id -> draft slot. null until the order is set. */
  draft_order: Record<UserId, number> | null;
  /** draft slot (as string) -> roster id. */
  slot_to_roster_id: Record<string, RosterId> | null;
  settings: {
    rounds: number;
    teams: number;
    pick_timer?: number;
    reversal_round?: number;
    autopause_enabled?: number;
    autopause_start_time?: number;
    autopause_end_time?: number;
    autostart?: number;
    [key: string]: number | undefined;
  };
  metadata: { name?: string; scoring_type?: string; description?: string; [key: string]: string | undefined } | null;
}

export interface SleeperDraftPick {
  draft_id: string;
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: RosterId;
  picked_by: UserId;
  player_id: PlayerId;
  is_keeper: boolean | null;
  metadata: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    years_exp?: string;
    injury_status?: string;
    status?: string;
    [key: string]: string | undefined;
  } | null;
}

export interface SleeperBracketMatch {
  /** Match id. */
  m: number;
  /** Round. */
  r: number;
  t1: RosterId | null;
  t2: RosterId | null;
  w: RosterId | null;
  l: RosterId | null;
  /** Place this match decides (1 = title game, 3 = third place...). */
  p?: number;
  t1_from?: { w?: number; l?: number } | null;
  t2_from?: { w?: number; l?: number } | null;
}

export interface NflState {
  week: number;
  display_week: number;
  season: string;
  previous_season: string;
  league_season: string;
  season_type: "pre" | "regular" | "post" | "off" | string;
  season_start_date: string | null;
  leg: number;
}

/** Trimmed player record kept from /players/nfl. */
export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** Primary position ("QB", "RB", "WR", "TE", "K", "DEF"). */
  pos: string;
  /** Sleeper fantasy_positions; used for slot eligibility. */
  positions: string[];
  team: string | null;
  age: number | null;
  years_exp: number | null;
  injury_status: string | null;
  /** "Active", "Inactive", "Injured Reserve"... */
  status: string | null;
}

export type PlayersMap = Record<PlayerId, PlayerInfo>;

/* ------------------------------------------------------------------ */
/* 2. Undocumented Sleeper, ESPN, FantasyCalc (normalized)             */
/* ------------------------------------------------------------------ */

export type StatLine = Record<string, number>;

/** One row of /stats or /projections, normalized. */
export interface PlayerWeekStats {
  playerId: PlayerId;
  week: number;
  season: string;
  /** Position at the time of the stat line (from the embedded player object). */
  position: string | null;
  team: string | null;
  opponent: string | null;
  gameId: string | null;
  /** Game date "YYYY-MM-DD". */
  date: string | null;
  stats: StatLine;
}

/** playerId -> stat line for one week. */
export type WeekStats = Record<PlayerId, PlayerWeekStats>;

export interface NflGame {
  gameId: string;
  week: number;
  /** "YYYY-MM-DD" (local game date, no kickoff time). */
  date: string;
  home: string;
  away: string;
  /** "pre_game" | "in_game" | "complete" (Sleeper values). */
  status: string;
}

/** Live game clock from ESPN, team abbreviations normalized to Sleeper's. */
export interface NflGameClock {
  espnId: string;
  week: number | null;
  home: string;
  away: string;
  kickoff: number;
  state: "pre" | "in" | "post";
  period: number;
  /** Seconds left in the current period. */
  clockSeconds: number;
  /** 1 before kickoff, 0 when final. Overtime counts as 0. */
  fractionRemaining: number;
  homeScore: number;
  awayScore: number;
  detail: string;
}

export interface FantasyCalcValue {
  /** Sleeper player id, or a FantasyCalc pick id like "FP_2027_early_0". */
  sleeperId: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  value: number;
  overallRank: number;
  positionRank: number;
  redraftValue: number;
  trend30Day: number;
}

export interface FantasyCalcSnapshot {
  fetchedAt: number;
  /** "YYYY-MM-DD" in America/New_York. */
  date: string;
  /** Includes draft picks under their FantasyCalc ids. */
  bySleeperId: Record<string, FantasyCalcValue>;
  picks: FantasyCalcValue[];
}

/* ------------------------------------------------------------------ */
/* 3. League context                                                   */
/* ------------------------------------------------------------------ */

export type SeasonPhase = "pre_draft" | "drafting" | "in_season" | "offseason" | "complete";

export interface ManagerConfig {
  /** Stable key used in URLs, e.g. "ethan". */
  key: string;
  firstName: string;
  /** Sleeper username / display_name. */
  username: string;
  isCommissioner?: boolean;
}

export interface Manager {
  rosterId: RosterId;
  userId: UserId | null;
  /** managers.ts key when matched, else a slug of the display name. */
  key: string;
  /** First name from config/managers.ts, else the Sleeper display name. */
  name: string;
  username: string | null;
  teamName: string;
  avatarUrl: string | null;
  isCommissioner: boolean;
  /** false when the roster's owner is not in config/managers.ts (e.g. fixture league). */
  matched: boolean;
}

/** Compact team reference used inside every fact / model row. */
export interface TeamRef {
  rosterId: RosterId;
  teamName: string;
  managerName: string;
  managerKey: string;
}

export interface LeagueContext {
  leagueId: string;
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  /** One per roster, ordered by roster id. */
  managers: Manager[];
  state: NflState;
  draft: SleeperDraft | null;
  phase: SeasonPhase;
  season: string;
  /** Current league week (1-based) or 0 before week 1 / when nothing has been played. */
  week: number;
  playoffWeekStart: number;
  lastRegularSeasonWeek: number;
  /** Last week of the playoffs. */
  lastWeek: number;
  scoring: ScoringSettings;
  rosterPositions: string[];
  /** Starting slots only (roster_positions minus BN/IR/TAXI). */
  starterSlots: string[];
  /** True when DATA_SOURCE=fixtures. */
  isFixture: boolean;
  /** True when this is not the real MSTP league (LEAGUE_ID override). Never email about it. */
  isDevLeague: boolean;
  loadedAt: number;
}

export interface StandingRow {
  rank: number;
  team: TeamRef;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** "3W", "1L" or "" before any games. */
  streak: string;
  /** Rank one week earlier (weekly facts fill it); null or absent when there is no earlier week. */
  previousRank?: number | null;
}

/* ------------------------------------------------------------------ */
/* 4. Models                                                           */
/* ------------------------------------------------------------------ */

export type PlayerGameStatus = "pre" | "live" | "final" | "bye" | "out" | "empty";

export interface StarterLine {
  playerId: PlayerId;
  name: string;
  position: string;
  slot: string;
  nflTeam: string | null;
  actual: number;
  projected: number;
  /** 1 = game not started, 0 = final. */
  fractionRemaining: number;
  /** actual + projected x fractionRemaining. */
  expected: number;
  status: PlayerGameStatus;
}

export interface TeamWinProb {
  team: TeamRef;
  actual: number;
  projected: number;
  /** Expected final score (mean). */
  mean: number;
  sd: number;
  /** 0..1 */
  winProb: number;
  starters: StarterLine[];
}

export interface WinProb {
  week: number;
  matchupId: number;
  home: TeamWinProb;
  away: TeamWinProb;
  /** true when every starter's game is final: winProb is then exactly 0 or 1 (0.5 on a tie). */
  isFinal: boolean;
}

export interface WinProbWeek {
  week: number;
  season: string;
  generatedAt: number;
  /** "projections" before any kickoff, "live" during games, "final" when all games are done. */
  basis: "projections" | "live" | "final" | "none";
  matchups: WinProb[];
  placeholder: boolean;
}

export interface SimOptions {
  /** Default 10_000. */
  runs?: number;
  /** Default: a fixed seed derived from the league id and week, so reruns match. */
  seed?: number;
  /** First week to simulate (default: next unplayed week). */
  fromWeek?: number;
  /** Store the result as this week's odds snapshot (default false). */
  persist?: boolean;
  ctx?: LeagueContext;
  /**
   * Where projected team strength comes from: "week" (default) = Sleeper's projections for the
   * next two league weeks; "season" = Sleeper's season projections per projected game, falling
   * back to the weekly ones for players without a season line (draft odds use this).
   */
  strength?: "week" | "season";
}

export interface SimTeamOdds {
  team: TeamRef;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Mean weekly points used by the sim. */
  meanPoints: number;
  sdPoints: number;
  expectedWins: number;
  /** 0..100 */
  playoffPct: number;
  byePct: number;
  titlePct: number;
  lastPlacePct: number;
  /** Approximate chance of holding the 1.01 (lowest Max PF among the teams that miss the playoffs). Label it approximate in UI. */
  firstPickPct: number;
}

export interface SimResult {
  season: string;
  /** Last completed week the sim conditions on (0 before the season). */
  asOfWeek: number;
  runs: number;
  seed: number;
  generatedAt: number;
  teams: SimTeamOdds[];
  placeholder: boolean;
}

export interface OddsSnapshot {
  week: number;
  generatedAt: number;
  teams: Array<{ rosterId: RosterId; playoffPct: number; titlePct: number; byePct: number; lastPlacePct: number; expectedWins: number }>;
}

export interface OddsHistory {
  season: string;
  snapshots: OddsSnapshot[];
  placeholder: boolean;
}

export interface PowerRow {
  rank: number;
  previousRank: number | null;
  team: TeamRef;
  score: number;
  /** 0..1 */
  allPlayWinPct: number;
  allPlayWins: number;
  allPlayLosses: number;
  pointsPerGame: number;
  /** Projected weekly points of the optimal lineup (draft-based before games exist). */
  projectedStrength: number;
  wins: number;
  losses: number;
  /** Actual wins minus all-play expected wins. */
  luck: number;
}

export interface PowerRankings {
  season: string;
  asOfWeek: number;
  /** One plain sentence explaining the formula, shown on the page. */
  formula: string;
  rows: PowerRow[];
  placeholder: boolean;
}

/* ------------------------------------------------------------------ */
/* 5. Facts                                                            */
/* ------------------------------------------------------------------ */

export type LetterGrade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "D-" | "F";

/** A player as it appears in a fact. `value` is FantasyCalc dynasty value (null if unranked). */
export interface PlayerAsset {
  playerId: PlayerId;
  name: string;
  position: string;
  nflTeam: string | null;
  age: number | null;
  value: number | null;
  overallRank: number | null;
}

export interface PickAsset {
  season: string;
  round: number;
  /** Roster whose pick it originally is. */
  originalRosterId: RosterId;
  /** "2027 1st (via Team X)" */
  label: string;
  value: number | null;
}

export interface TradeSide {
  team: TeamRef;
  playersIn: PlayerAsset[];
  playersOut: PlayerAsset[];
  picksIn: PickAsset[];
  picksOut: PickAsset[];
  faabIn: number;
  faabOut: number;
  valueIn: number;
  valueOut: number;
  /** valueIn - valueOut. */
  net: number;
  grade: LetterGrade;
}

export interface TradeFact {
  kind: "trade";
  transactionId: string;
  week: number;
  createdAt: number;
  sides: TradeSide[];
  /** Roster with the highest net, null when within the "fair" band. */
  winnerRosterId: RosterId | null;
  /** Absolute value gap between the best and worst side. */
  valueGap: number;
}

export interface LosingBid {
  team: TeamRef;
  bid: number;
  /** Why the claim failed (from Sleeper's transaction note): outbid, roster full, or other. */
  reason?: "outbid" | "roster_full" | "other";
}

export interface WaiverFact {
  kind: "waiver";
  transactionId: string;
  /** "waiver" = processed claim, "free_agent" = instant add/drop. */
  type: "waiver" | "free_agent";
  week: number;
  createdAt: number;
  team: TeamRef;
  added: PlayerAsset[];
  dropped: PlayerAsset[];
  /** FAAB bid for waivers, null for free agents. */
  bid: number | null;
  isZeroBid: boolean;
  /** Failed competing claims for the same player in the same run. */
  losingBids: LosingBid[];
  /** Winning bid minus the second-highest bid (null when uncontested). */
  overpayBy: number | null;
  /** A dropped player with meaningful FantasyCalc value. */
  notableDrop: boolean;
  /** Groups claims processed in the same waiver run (for batch roasts). */
  batchId: string;
}

export interface TransactionFacts {
  sinceMs: number;
  untilMs: number;
  trades: TradeFact[];
  waivers: WaiverFact[];
  placeholder: boolean;
}

export interface DraftPickFact {
  kind: "draft_pick";
  draftId: string;
  /** Overall pick number (1-based). */
  pickNo: number;
  round: number;
  pickInRound: number;
  team: TeamRef;
  player: PlayerAsset;
  /** FantasyCalc overall rank at the time the fact was computed. */
  fcRank: number | null;
  fcPositionRank: number | null;
  /** fcRank - pickNo (expected pick minus actual). Positive = reach, negative = steal. */
  reach: number | null;
  verdict: "reach" | "steal" | "fair" | "unranked";
  /**
   * When the site first noticed the pick (tick timestamps), not when it was made. Only good for
   * ordering and "noticed at" stamps: never a time on the clock.
   */
  pickedAt: number | null;
  /** Length of the position run this pick belongs to (1 = no run). */
  positionRun: number;
}

export interface DraftGrade {
  team: TeamRef;
  grade: LetterGrade;
  totalValue: number;
  /** Rank of totalValue among teams (1 = best). */
  valueRank: number;
  bestPick: DraftPickFact | null;
  worstPick: DraftPickFact | null;
}

export interface DraftFacts {
  draftId: string;
  status: SleeperDraftStatus;
  startTime: number | null;
  rounds: number;
  teams: number;
  picks: DraftPickFact[];
  /** Next pick when the draft is live. */
  onTheClock: { pickNo: number; round: number; team: TeamRef } | null;
  /** When picks resume ("8 AM ET", config/draft.ts), only while the draft is paused. */
  resumesAt: string | null;
  positionRuns: Array<{ position: string; startPick: number; length: number }>;
  /** Only once the draft is complete. */
  grades: DraftGrade[] | null;
  placeholder: boolean;
}

export interface ZeroStarterFact {
  team: TeamRef;
  playerId: PlayerId;
  name: string;
  position: string;
  slot: string;
  reason: "bye" | "out" | "ir" | "inactive" | "empty_slot" | "played_zero";
}

export interface SwapFact {
  team: TeamRef;
  benchPlayer: PlayerAsset & { points: number };
  starter: PlayerAsset & { points: number };
  slot: string;
  /** Points the swap would have added. */
  gain: number;
}

export interface TeamWeekFact {
  team: TeamRef;
  points: number;
  projected: number | null;
  optimalPoints: number;
  benchPointsLeft: number;
  opponentRosterId: RosterId | null;
  result: "W" | "L" | "T" | null;
  allPlayWins: number;
  allPlayLosses: number;
  /** Rank of this week's score (1 = highest). */
  scoreRank: number;
  /** Lost with a top-3 score. */
  robbed: boolean;
  /** Won with a bottom-3 score. */
  fraud: boolean;
  zeroStarters: ZeroStarterFact[];
  streak: string;
  /** The best single bench-for-starter swap, whether or not it would have flipped the result. */
  benchMistake?: SwapFact | null;
  /** The starter who scored the most. */
  topStarter?: StarterPerformance | null;
  /** The starter furthest below his projection (null without projections). */
  worstStarter?: StarterPerformance | null;
  /** The highest-scoring bench player. */
  boomBench?: StarterPerformance | null;
}

/** One player's week in a weekly fact. */
export interface StarterPerformance {
  playerId: PlayerId;
  name: string;
  position: string;
  points: number;
  /** Sleeper projection in league scoring, null when there is none. */
  projected: number | null;
}

export interface MatchupFact {
  matchupId: number;
  home: TeamWeekFact;
  away: TeamWeekFact;
  margin: number;
  winnerRosterId: RosterId | null;
  /** The single bench/starter swap that would have flipped the loss, if one exists. */
  flipSwap: SwapFact | null;
}

export interface WeeklyFacts {
  week: number;
  season: string;
  matchups: MatchupFact[];
  teams: TeamWeekFact[];
  highest: TeamWeekFact | null;
  lowest: TeamWeekFact | null;
  loserOfTheWeek: TeamWeekFact | null;
  standings: StandingRow[];
  placeholder: boolean;
}

export interface TnfPlayerFact {
  player: PlayerAsset;
  points: number;
  projected: number | null;
  /** null when the player is on no roster. */
  team: TeamRef | null;
  started: boolean;
}

export interface TnfFacts {
  week: number;
  games: NflGame[];
  players: TnfPlayerFact[];
  /** Per fantasy team: points already banked from the Thursday game vs projection. */
  teams: Array<{ team: TeamRef; banked: number; projected: number; delta: number }>;
  placeholder: boolean;
}

export interface InjuryFact {
  team: TeamRef;
  player: PlayerAsset;
  status: string;
  previousStatus: string | null;
  isStarter: boolean;
}

export interface LineupAlertFact {
  team: TeamRef;
  player: PlayerAsset;
  slot: string;
  reason: "bye" | "out" | "ir" | "doubtful" | "empty_slot";
  /** Kickoff of the player's game, when known. */
  kickoff: number | null;
}

export type ShameKind =
  | "bench_points"
  | "zero_starter"
  | "bad_trade"
  | "zero_bid_lost"
  | "overpay"
  | "lineup_negligence"
  | "draft_reach";

export interface ShameEntry {
  /** Stable id, e.g. "bench_points:2025:7:3". */
  id: string;
  kind: ShameKind;
  team: TeamRef;
  season: string;
  week: number | null;
  /** Magnitude used for sorting (points, dollars or FantasyCalc value). */
  amount: number;
  unit: "pts" | "$" | "value" | "picks";
  /** Deterministic one-liner, e.g. "Left 41.2 points on the bench". */
  headline: string;
  detail: string | null;
  /** transaction id, player id or pick id this entry is about. */
  refId: string | null;
  occurredAt: number | null;
}

export interface ShameBoard {
  /** Sorted worst first within each kind; the UI groups by kind. */
  entries: ShameEntry[];
  placeholder: boolean;
}

/* ------------------------------------------------------------------ */
/* 6. Roasts and issues                                                */
/* ------------------------------------------------------------------ */

export type RoastItemKind = "trade" | "waiver" | "draft_pick";
export type RoastItemFact = TradeFact | WaiverFact | WaiverFact[] | DraftPickFact;

export interface RoastUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export type RoastSource = "llm" | "facts_only" | "placeholder";

export interface Roast {
  /** "trade:<txId>", "waiver:<batchId>", "pick:<draftId>:<pickNo>". Also the store key suffix. */
  id: string;
  kind: RoastItemKind;
  leagueId: string;
  rosterIds: RosterId[];
  /** 1-3 sentences, plain text. */
  text: string;
  facts: RoastItemFact;
  source: RoastSource;
  model: string | null;
  createdAt: number;
  usage: RoastUsage | null;
}

/**
 * The four newsletters: "The Daily", "Thursday Night Fallout", "Week N Recap", "Draft Grades"
 * (titles in `ISSUE_TITLES` / `issueTitle()` from lib/roast). The kind is also the slug suffix
 * ("2026-09-19-daily", "2026-09-29-weekly-recap").
 */
export type IssueKind = "daily" | "thursday_fallout" | "weekly_recap" | "draft_grades";

/**
 * Kinds stored before the 2026-09-18 rename. `lib/archive` upgrades them on read
 * ("daily_roast" -> "daily", "weekly_roast" -> "weekly_recap"), so nothing else ever sees one.
 */
export type LegacyIssueKind = "daily_roast" | "weekly_roast";

/** Structured body so the web page and the email render the same content. Text is plain (no HTML). */
export type IssueBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; caption?: string; columns: string[]; rows: Array<Array<string | number>> }
  /** Short aside, e.g. "The writer called in sick. Facts only today." */
  | { type: "note"; text: string };

export interface IssueSection {
  heading: string;
  blocks: IssueBlock[];
}

export type IssueStatus = "draft" | "approved" | "sent" | "skipped";

export interface Issue {
  id: string;
  /** URL slug, e.g. "2026-09-19-daily". Unique per league. */
  slug: string;
  kind: IssueKind;
  leagueId: string;
  season: string;
  week: number | null;
  /** "YYYY-MM-DD" in America/New_York. */
  date: string;
  title: string;
  /** One-line subtitle. */
  dek: string;
  /** Who wrote the dek: "model" (it is also the email subject) or "code" (a fact line). Absent on older issues. */
  dekSource?: "model" | "code";
  sections: IssueSection[];
  /** true when written without the LLM (not configured, refusal or API error). */
  factsOnly: boolean;
  /** e.g. "The writer called in sick. Facts only today." when factsOnly because of a failure. */
  note: string | null;
  status: IssueStatus;
  createdAt: number;
  sentAt: number | null;
  recipientCount: number | null;
  model: string | null;
  usage: RoastUsage | null;
  /** Loser of the Week image (phase 2), null for now. */
  imageUrl: string | null;
  placeholder: boolean;
  /**
   * What the writer used, never printed: the cold open's history, the closer and the short
   * lines, so later issues are told not to repeat them (lib/roast/index.ts PREVIOUS). Absent on
   * facts-only and older issues.
   */
  writerNotes?: { allusion: string | null; closer: string | null; lines: string[] };
}

export interface DailyFacts {
  kind: "daily";
  date: string;
  sinceMs: number;
  trades: TradeFact[];
  waivers: WaiverFact[];
  injuries: InjuryFact[];
  lineupAlerts: LineupAlertFact[];
  draftPicks: DraftPickFact[];
  /** false = quiet day, nothing gets sent. */
  hasMaterial: boolean;
}

export interface ThursdayFalloutFacts {
  kind: "thursday_fallout";
  week: number;
  tnf: TnfFacts;
  winProbs: WinProbWeek;
}

export interface WeeklyRecapFacts {
  kind: "weekly_recap";
  week: number;
  weekly: WeeklyFacts;
  odds: SimResult;
  power: PowerRankings;
}

export interface DraftGradesFacts {
  kind: "draft_grades";
  draft: DraftFacts;
  odds: SimResult;
}

export type IssueFacts = DailyFacts | ThursdayFalloutFacts | WeeklyRecapFacts | DraftGradesFacts;

/** @deprecated Renamed to DailyFacts (kind "daily"). */
export type DailyRoastFacts = DailyFacts;
/** @deprecated Renamed to WeeklyRecapFacts (kind "weekly_recap"). */
export type WeeklyRoastFacts = WeeklyRecapFacts;

/* ------------------------------------------------------------------ */
/* 7. Jobs and email                                                   */
/* ------------------------------------------------------------------ */

export interface JobOutcome {
  job: IssueKind | "roast_trades" | "roast_waivers" | "roast_picks" | "sim_snapshot" | "players_refresh" | string;
  status: "ran" | "skipped" | "error";
  detail: string;
  issueSlug?: string;
}

export interface JobRunReport {
  kind: "daily" | "tick";
  startedAt: number;
  finishedAt: number;
  /** true when a tick was skipped because the cooldown lock was held. */
  locked: boolean;
  outcomes: JobOutcome[];
}

export type NewsletterMode = "review" | "auto";

export interface SendResult {
  /** "test_sent": a test copy went to COMMISSIONER_EMAIL only (sendTest). */
  status: "sent" | "review_sent" | "test_sent" | "not_configured" | "skipped" | "error";
  recipients: number;
  messageIds: string[];
  error?: string;
}

/**
 * A record the old public sign-up form stored (keys.subscriber). Nothing creates new ones: the
 * public sign-up is gone. Confirmed ones are league recipients until they opt out.
 */
export interface Subscriber {
  email: string;
  managerKey: string;
  createdAt: number;
  confirmed: boolean;
}

export interface UnsubscribeResult {
  ok: boolean;
  /** "not_found" is kept for compatibility; unsubscribing is idempotent and answers "unsubscribed". */
  status: "unsubscribed" | "not_found" | "bad_signature" | "error";
}

/* ------------------------------------------------------------------ */
/* 8. Engine surface (round 3)                                         */
/* ------------------------------------------------------------------ */

/**
 * Stat surfaces that carry a one-liner per row. Row ids per surface (always strings):
 *   standings, odds, power, team   String(rosterId)
 *   matchups                       String(matchupId)
 *   trades                         transactionId
 *   shame                          ShameEntry.id
 *   draft                          String(pickNo)
 */
export type RoastSurface = "standings" | "odds" | "power" | "matchups" | "team" | "trades" | "shame" | "draft";

/** One row handed to the line writer: its id, who it is about, and the only facts the line may use. */
export interface SurfaceRow {
  /** Row id, see RoastSurface. */
  id: string;
  /** Manager first names the row is about (lore lookup and name checks). */
  managers: string[];
  /** Facts for this row. Every number in the line must appear here (or in another row of the same batch, next to its owner). */
  facts: Record<string, unknown>;
  /**
   * Optional: what decides whether the line must be rewritten, instead of the facts. Pick rows
   * use who took whom, so a pick's line is written once even though its live FantasyCalc rank
   * moves every day.
   */
  hashKey?: string;
}

/** A row whose line failed the checks: it backs off until `at + ROW_RETRY_AFTER_MS`, and gives up after MAX_ROW_ATTEMPTS (until its facts change). */
export interface SurfaceRowFailure {
  /** Row hash the failures are for. */
  hash: string;
  at: number;
  n: number;
}

/** rowId -> one mean line, or null when there is none (no API key, a failed check, a new row). Never a canned joke. */
export type SurfaceLineMap = Record<string, string | null>;

/** What the store keeps per surface and key (`keys.surfaceLines`). Pages read it with getSurfaceLines. */
export interface StoredSurfaceLines {
  surface: RoastSurface;
  /** Surface key, see `surfaceKeys` in lib/roast. */
  key: string;
  /** Fingerprint of the whole batch the lines were last written from. */
  factsHash: string;
  /** rowId -> hash of the facts its line was written from; only rows whose hash changes are rewritten. */
  rowHashes: Record<string, string>;
  /** rowId -> when its line was written (a line is rewritten at most once per SURFACE_MAX_AGE_MS). */
  rowAt?: Record<string, number>;
  /** Rows whose last attempts failed the checks. */
  failures?: Record<string, SurfaceRowFailure>;
  /** Last time any line of this batch was written. */
  generatedAt: number;
  model: string | null;
  usage: RoastUsage | null;
  lines: SurfaceLineMap;
}

/** FantasyCalc values of one stored day, compact (about 10 KB): what hindsight and value charts read. */
export interface FantasyCalcValues {
  /** ET date "YYYY-MM-DD". */
  date: string;
  /** Sleeper id -> dynasty value. */
  values: Record<string, number>;
  /** Rookie picks by FantasyCalc name ("2027 1st (Mid)") -> value. */
  picks: Record<string, number>;
}

/** One dot on a trade's value-over-time chart. */
export interface TradeValuePoint {
  /** ET date of the FantasyCalc snapshot. */
  date: string;
  /** FantasyCalc value of everything this side received, on that date. */
  valueIn: number;
  /** valueIn minus the value of everything it gave, on that date. */
  net: number;
}

export interface TradeHindsightSide {
  team: TeamRef;
  /** Assets valued NOW (`value` = today's FantasyCalc value, null = unranked). */
  playersIn: PlayerAsset[];
  playersOut: PlayerAsset[];
  picksIn: PickAsset[];
  picksOut: PickAsset[];
  faabIn: number;
  faabOut: number;
  /** Values on the snapshot nearest the trade (`thenDate`); null when no stored snapshot is close enough. */
  valueInThen: number | null;
  valueOutThen: number | null;
  netThen: number | null;
  gradeThen: LetterGrade | null;
  /** Values today. */
  valueInNow: number;
  valueOutNow: number;
  netNow: number;
  gradeNow: LetterGrade;
  /** netNow - netThen: how far the trade moved for this side since it happened (null without a "then"). */
  delta: number | null;
  /** One point per sampled stored snapshot from the trade to today, oldest first. */
  series: TradeValuePoint[];
}

export interface TradeHindsight {
  transactionId: string;
  season: string;
  week: number;
  createdAt: number;
  /** ET date of the trade. */
  date: string;
  /** Snapshot date used as "at the time" (null: none within HINDSIGHT_THEN_WINDOW_DAYS of the trade). */
  thenDate: string | null;
  /** Snapshot date used as "now" (null: FantasyCalc unavailable). */
  nowDate: string | null;
  sides: TradeHindsightSide[];
  /** Side ahead by today's values, null inside the fair band. */
  winnerNowRosterId: RosterId | null;
  /** Side furthest behind by today's values, null when nobody is behind. */
  loserNowRosterId: RosterId | null;
  /**
   * Value the losing side has given away as of today: valueOutNow - valueInNow of the loser
   * (what it would hold had it said no, minus what it holds). 0 when nobody is behind.
   * The worst-trade leaderboard sorts by this.
   */
  valueLost: number;
  /** How much of valueLost piled up after the trade: loser's netThen - netNow (null without a "then"). */
  lostSinceTrade: number | null;
}

export interface TradeHindsightBoard {
  /** Newest trade first. */
  trades: TradeHindsight[];
  /** Stored daily FantasyCalc snapshots available (history accrues forward from 2026-09-18). */
  snapshots: { count: number; first: string | null; last: string | null };
  placeholder: boolean;
}

/** "If the season started today": season odds from the drafted rosters. */
export interface DraftOddsTeam {
  team: TeamRef;
  /** Players on the roster (drafted so far while the draft is live). */
  playersDrafted: number;
  /**
   * Projected weekly points of the best legal lineup from those players, in league scoring:
   * each player's Sleeper season projection divided by his projected games (his weekly
   * projection when Sleeper has no season line for him). An unfilled slot scores 0.
   */
  projectedPoints: number;
  /** Rank of projectedPoints, 1 = best. */
  projectedRank: number;
  /** 0..100. The two headline numbers. */
  playoffPct: number;
  titlePct: number;
  byePct: number;
  lastPlacePct: number;
  expectedWins: number;
}

export interface DraftOdds {
  season: string;
  /** false outside the draft and preseason, or before anyone has a player: `teams` is then empty. */
  available: boolean;
  /** "drafting" while picks come in, "preseason" after the draft until the first league game is final. */
  basis: "drafting" | "preseason" | null;
  draftId: string | null;
  picksMade: number;
  /** rounds x teams, 0 without a draft. */
  totalPicks: number;
  runs: number;
  seed: number;
  generatedAt: number;
  /** Sorted by titlePct, then playoffPct. */
  teams: DraftOddsTeam[];
  placeholder: boolean;
}

/** POST /api/admin/test-email: what went to COMMISSIONER_EMAIL. */
export interface TestEmailResult extends SendResult {
  /** Slug of the issue sent (a stored one), null for a sample built on the spot or nothing sent. */
  issueSlug: string | null;
  /** true when no issue was stored yet and a sample Daily was built from current facts (not saved). */
  sample: boolean;
}

/** Who gets the league email, without exposing any address (safe to render). */
export interface RecipientSummary {
  /** LEAGUE_EMAILS is set and has at least one valid address. */
  configured: boolean;
  /** Addresses that get the next league send (env list minus opt-outs). */
  count: number;
  /** Env addresses that unsubscribed. */
  optedOut: number;
}
