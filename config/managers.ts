/**
 * The ten MSTP Dynasty managers. First name = what the site and the roasts call them.
 * `username` is the Sleeper display name; lib/league.ts matches it case-insensitively
 * against /league/<id>/users at runtime to find each user_id and roster.
 */
import type { ManagerConfig } from "@/lib/types";

export const MANAGERS: readonly ManagerConfig[] = [
  { key: "alex", firstName: "Alex", username: "AK742" },
  { key: "anish", firstName: "Anish", username: "agk100" },
  { key: "brandon", firstName: "Brandon", username: "bgong99" },
  { key: "carlos", firstName: "Carlos", username: "KomicalKomodo" },
  { key: "devante", firstName: "Devante", username: "DBanner12" },
  { key: "ethan", firstName: "Ethan", username: "ZachWilsonFan5", isCommissioner: true },
  { key: "justin", firstName: "Justin", username: "Justin919" },
  { key: "matthew", firstName: "Matthew", username: "mattsolo20" },
  { key: "navid", firstName: "Navid", username: "navidx2" },
  { key: "peter", firstName: "Peter", username: "Peteros" },
] as const;

export function managerByKey(key: string): ManagerConfig | undefined {
  return MANAGERS.find((m) => m.key === key);
}

export function managerByUsername(username: string): ManagerConfig | undefined {
  const u = username.trim().toLowerCase();
  return MANAGERS.find((m) => m.username.toLowerCase() === u);
}
