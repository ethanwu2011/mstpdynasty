/**
 * The team-name line under a manager's first name, rendered only when the team has a Sleeper
 * name of its own. A team with no custom name is called by the first name already, so the line
 * would only repeat it ("Carlos / Carlos").
 */
import { teamSubtitle } from "@/lib/names";

export function TeamSub({
  team,
  manager,
  className,
  as: El = "span",
}: {
  team: string | null | undefined;
  manager: string | null | undefined;
  className?: string;
  as?: "span" | "p";
}) {
  const sub = teamSubtitle(team, manager);
  return sub ? <El className={className}>{sub}</El> : null;
}
