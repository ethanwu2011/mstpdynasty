/**
 * Named model constants. Change them here, never inline.
 */

/** Per-starter score sd = VARIANCE_COEF x projection (scaled by fraction of the game left). */
export const VARIANCE_COEF = 0.6;

/** Prior weekly team-score sd (points) before a team has observed games. */
export const PRIOR_SD = 25;

/**
 * Shrinkage for the team weekly mean: weight on the observed mean = g / (g + MEAN_PRIOR_GAMES).
 * About 4: a projection is worth roughly four weeks of observed scores (weekly team sd ~25
 * points vs roughly 12 points of projection error between teams).
 */
export const MEAN_PRIOR_GAMES = 4;

/** Same shrinkage for the team sd (a sd needs more games than a mean to settle). */
export const SD_PRIOR_GAMES = 6;

/** Default Monte Carlo runs. */
export const DEFAULT_RUNS = 10_000;

/** Weekly mean used when nothing at all is known (no rosters, no games): only relative strength matters. */
export const EMPTY_TEAM_MEAN = 100;

/** Power ranking weights (sum to 1) once games exist. */
export const POWER_WEIGHTS = { allPlay: 0.4, pointsPerGame: 0.3, projected: 0.3 } as const;

/**
 * Fraction of a game treated as still left while it is in overtime (or sitting at 0:00 of the
 * 4th quarter before overtime starts): the regulation clock says 0, but the score can still
 * move. One 10-minute overtime period out of a 60-minute game.
 */
export const OT_FRACTION = 600 / 3600;

/** Live win probabilities are clamped to this band until every game is final (never a fake 0 or 1). */
export const LIVE_PROB_FLOOR = 0.0001;

/** Sleeper injury statuses that mean the player will not play. */
export const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "Suspended", "NA", "DNR", "COV"]);
