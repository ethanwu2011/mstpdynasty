/**
 * How a team is named on the page. A team with no custom Sleeper name is called by its manager's
 * first name (lib/league.ts), so its "team name" line would just repeat the first name. Pure and
 * client-safe: no data access.
 */

/** The team's own name, or null when it is only the manager's first name (or empty). */
export function teamSubtitle(teamName: string | null | undefined, managerName: string | null | undefined): string | null {
  const t = teamName?.trim();
  if (!t) return null;
  const m = managerName?.trim();
  return m && t.toLowerCase() === m.toLowerCase() ? null : t;
}

/** "Carlos" when the team has no name of its own, else "Carlos, Pot Roast". */
export function managerAndTeam(managerName: string, teamName: string | null | undefined, sep = ", "): string {
  const sub = teamSubtitle(teamName, managerName);
  return sub ? `${managerName}${sep}${sub}` : managerName;
}
