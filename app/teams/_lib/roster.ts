/**
 * Roster layout and FantasyCalc totals for the team pages. Display math only: it groups the
 * Sleeper roster by slot and adds up FantasyCalc values. Unranked players count as unranked,
 * never as zero value.
 */
import { valueOf } from "@/lib/fantasycalc";
import { playerInfo } from "@/lib/sleeper";
import type { FantasyCalcSnapshot, FantasyCalcValue, LeagueContext, PlayerInfo, PlayersMap, SleeperRoster } from "@/lib/types";

export type RosterGroup = "starter" | "bench" | "taxi" | "ir";

export interface RosterRow {
  key: string;
  group: RosterGroup;
  /** Starting slot ("QB", "FLEX") for starters, the player's position otherwise. */
  slot: string;
  playerId: string | null;
  info: PlayerInfo | null;
  value: FantasyCalcValue | null;
}

export const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
export const VALUE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const SLOT_NAMES: Record<string, string> = {
  SUPER_FLEX: "SF",
  REC_FLEX: "W/T",
  WRRB_FLEX: "W/R",
  IDP_FLEX: "IDP",
};

export function slotName(slot: string): string {
  return SLOT_NAMES[slot] ?? slot;
}

function row(group: RosterGroup, slot: string, id: string | null, players: PlayersMap, fc: FantasyCalcSnapshot | null, key: string): RosterRow {
  if (!id || id === "0") return { key, group, slot, playerId: null, info: null, value: null };
  return { key, group, slot, playerId: id, info: playerInfo(players, id), value: fc ? valueOf(fc, id) : null };
}

const byPosThenValue = (a: RosterRow, b: RosterRow) => {
  const pa = POSITION_ORDER.indexOf(a.info?.pos ?? "");
  const pb = POSITION_ORDER.indexOf(b.info?.pos ?? "");
  return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || (b.value?.value ?? -1) - (a.value?.value ?? -1) || (a.info?.name ?? "").localeCompare(b.info?.name ?? "");
};

/** The roster split into starters (in slot order), bench, taxi and IR. */
export function rosterRows(ctx: LeagueContext, roster: SleeperRoster, players: PlayersMap, fc: FantasyCalcSnapshot | null) {
  const starters = ctx.starterSlots.map((slot, i) => row("starter", slotName(slot), roster.starters[i] ?? null, players, fc, `s-${i}`));
  const used = new Set([...roster.starters, ...roster.taxi, ...roster.reserve]);
  const reserves = (group: RosterGroup, ids: string[]) =>
    ids
      .map((id) => row(group, "", id, players, fc, `${group}-${id}`))
      .map((r) => ({ ...r, slot: r.info?.pos || "--" }))
      .sort(byPosThenValue);
  const bench = reserves("bench", roster.players.filter((id) => !used.has(id)));
  const taxi = reserves("taxi", roster.taxi);
  const ir = reserves("ir", roster.reserve);
  return { starters, bench, taxi, ir };
}

export interface TeamValue {
  rosterId: number;
  total: number;
  ranked: number;
  unranked: number;
  byPos: Record<string, number>;
}

/** FantasyCalc value of every roster, summed per team and per position. */
export function leagueValues(ctx: LeagueContext, players: PlayersMap, fc: FantasyCalcSnapshot | null): TeamValue[] {
  return ctx.rosters.map((r) => {
    const byPos: Record<string, number> = {};
    let total = 0;
    let ranked = 0;
    let unranked = 0;
    for (const id of new Set(r.players)) {
      const v = fc ? valueOf(fc, id) : null;
      if (!v) {
        unranked++;
        continue;
      }
      ranked++;
      total += v.value;
      const pos = playerInfo(players, id).pos || v.position;
      byPos[pos] = (byPos[pos] ?? 0) + v.value;
    }
    return { rosterId: r.roster_id, total, ranked, unranked, byPos };
  });
}

/** 1-based rank of `rosterId` by `pick(value)` among all teams (highest first). */
export function rankOf(values: TeamValue[], rosterId: number, pick: (v: TeamValue) => number): number {
  const sorted = [...values].sort((a, b) => pick(b) - pick(a));
  return sorted.findIndex((v) => v.rosterId === rosterId) + 1;
}

const INJURY: Record<string, string> = {
  Questionable: "Q",
  Doubtful: "D",
  Out: "Out",
  IR: "IR",
  PUP: "PUP",
  Sus: "Susp",
  NA: "NA",
  COV: "COV",
};

export function injuryTag(info: PlayerInfo | null): string | null {
  const s = info?.injury_status;
  if (!s) return null;
  return INJURY[s] ?? s;
}

/** A starter who will not play: an empty slot, or someone ruled out. */
export function isAlarm(r: RosterRow): boolean {
  if (r.group !== "starter") return false;
  if (!r.playerId) return true;
  const s = r.info?.injury_status;
  return s === "Out" || s === "IR" || s === "Doubtful" || s === "Sus" || s === "PUP";
}
