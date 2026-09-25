/** Which page a /scores/[week] URL gets. */
export type WeekRoute = { kind: "week"; week: number } | { kind: "not_found" } | { kind: "before_start" };

/**
 * A week in the URL: a league week renders; a week before the league's start week (never played,
 * though Sleeper still returns it, every team 0-0 with nobody started) goes to the current
 * scoreboard; anything else is not found.
 */
export function weekRoute(raw: string, startWeek: number, lastWeek: number): WeekRoute {
  if (!/^\d{1,2}$/.test(raw)) return { kind: "not_found" };
  const n = Number(raw);
  if (n < 1 || n > lastWeek) return { kind: "not_found" };
  if (n < startWeek) return { kind: "before_start" };
  return { kind: "week", week: n };
}
