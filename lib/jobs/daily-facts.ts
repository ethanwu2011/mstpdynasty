/**
 * Assembles DailyFacts for The Daily.
 *
 *   trades, waivers   lib/facts transactionFacts(since the last Daily), minus plain cuts
 *                     (a drop with no add, of a player who is not a notable drop)
 *   draft picks       lib/facts draftFacts, picks after the last reported pick number
 *   injuries          rostered players whose status turned serious since yesterday's snapshot
 *                     (starters, or anyone in FantasyCalc's top 100)
 *   lineup alerts     in season: a starter on bye / out / IR / doubtful, or an empty slot,
 *                     whose game is today or tomorrow and has not kicked off (shame them
 *                     BEFORE kickoff), each reported once per week
 *
 * Nothing is written until commit() runs, which the caller does only after the issue is
 * safely stored (or the day turned out quiet), so a failed run loses no material.
 */
import { getGameClocks } from "@/lib/espn";
import { draftFacts, transactionFacts } from "@/lib/facts";
import { getFantasyCalc, valueOf } from "@/lib/fantasycalc";
import { teamRef } from "@/lib/league";
import { getWinProbabilities } from "@/lib/models";
import { byeTeams, getPlayers, playerInfo } from "@/lib/sleeper";
import * as store from "@/lib/store";
import { etDate } from "@/lib/time";
import type {
  DailyFacts,
  DraftPickFact,
  FantasyCalcSnapshot,
  InjuryFact,
  LeagueContext,
  LineupAlertFact,
  NflGame,
  PlayerAsset,
  PlayerInfo,
  PlayersMap,
} from "@/lib/types";
import { addDays, DAY_MS, firstDateOfWeek, mainDateOfWeek, upcomingWeekFor } from "./schedule";

/** Injury statuses worth a line in The Daily. "Questionable" is too noisy. */
export const SERIOUS_INJURY = new Set(["Doubtful", "Out", "IR", "PUP", "Sus", "COV"]);
/** Bench players still count as news when FantasyCalc ranks them this high. */
export const NOTABLE_RANK = 100;
/** Never look back further than this, even after downtime. */
const MAX_LOOKBACK_MS = 7 * DAY_MS;

export interface DailyCursor {
  sinceMs: number;
  picks: { draftId: string; lastPickNo: number } | null;
}

/** Store name kept from before the rename, so the cursor survives it. */
const CURSOR = "daily-roast-cursor";
const INJURIES = "injury-status";
const alertsKey = (season: string, week: number) => `lineup-alerts:${season}:${week}`;

export interface DailyBuild {
  facts: DailyFacts;
  /** true when any facts source is still a placeholder stub: never build an issue from it. */
  placeholder: boolean;
  /** Persist cursors and snapshots. Call only after the issue is stored (or the day is quiet). */
  commit(): Promise<void>;
}

export function injuryStatusOf(info: PlayerInfo): string | null {
  if (info.injury_status) return info.injury_status;
  return info.status === "Injured Reserve" ? "IR" : null;
}

function asset(players: PlayersMap, fc: FantasyCalcSnapshot | null, id: string): PlayerAsset {
  const info = playerInfo(players, id);
  const v = fc ? valueOf(fc, id) : null;
  return { playerId: id, name: info.name, position: info.pos, nflTeam: info.team, age: info.age, value: v?.value ?? null, overallRank: v?.overallRank ?? null };
}

function emptySlot(slot: string): PlayerAsset {
  return { playerId: "0", name: "Empty slot", position: slot, nflTeam: null, age: null, value: null, overallRank: null };
}

/** New serious injuries since the previous snapshot. First run: baseline only, no news. */
export function diffInjuries(
  ctx: LeagueContext,
  players: PlayersMap,
  fc: FantasyCalcSnapshot | null,
  previous: Record<string, string | null> | null,
): { injuries: InjuryFact[]; snapshot: Record<string, string | null> } {
  const snapshot: Record<string, string | null> = {};
  const injuries: InjuryFact[] = [];
  for (const r of ctx.rosters) {
    const starters = new Set(r.starters.filter((id) => id && id !== "0"));
    for (const id of r.players) {
      const info = players[id];
      if (!info) continue;
      const status = injuryStatusOf(info);
      snapshot[id] = status;
      if (!previous || !(id in previous)) continue;
      const was = previous[id] ?? null;
      if (!status || status === was || !SERIOUS_INJURY.has(status)) continue;
      const a = asset(players, fc, id);
      const isStarter = starters.has(id);
      if (!isStarter && (a.overallRank === null || a.overallRank > NOTABLE_RANK)) continue;
      injuries.push({ team: teamRef(ctx, r.roster_id), player: a, status, previousStatus: was, isStarter });
    }
  }
  injuries.sort((a, b) => Number(b.isStarter) - Number(a.isStarter) || (a.player.overallRank ?? 9999) - (b.player.overallRank ?? 9999));
  return { injuries, snapshot };
}

export interface KickoffInfo {
  kickoff: number;
  started: boolean;
}

/**
 * Lineup negligence for `week`: starters who will score zero, flagged on the morning of their
 * game day or the day before, never after kickoff. Returns alerts plus their dedupe ids.
 */
export function lineupAlerts(
  ctx: LeagueContext,
  players: PlayersMap,
  fc: FantasyCalcSnapshot | null,
  schedule: NflGame[],
  week: number,
  date: string,
  kickoffs: Record<string, KickoffInfo>,
  alreadyReported: Set<string>,
): { alerts: LineupAlertFact[]; ids: string[] } {
  const byes = new Set(byeTeams(schedule, week));
  const mainDate = mainDateOfWeek(schedule, week);
  const gameDate: Record<string, string> = {};
  for (const g of schedule) {
    if (g.week !== week) continue;
    gameDate[g.home] = g.date;
    gameDate[g.away] = g.date;
  }
  const tomorrow = addDays(date, 1);
  const alerts: LineupAlertFact[] = [];
  const ids: string[] = [];

  for (const r of ctx.rosters) {
    if (r.players.length === 0) continue;
    ctx.starterSlots.forEach((slot, i) => {
      const id = r.starters[i] ?? "0";
      let reason: LineupAlertFact["reason"] | null = null;
      let team: string | null = null;
      if (!id || id === "0") reason = "empty_slot";
      else {
        const info = playerInfo(players, id);
        team = info.team;
        const inj = injuryStatusOf(info);
        if (!team) reason = "out";
        else if (byes.has(team)) reason = "bye";
        else if (inj === "IR") reason = "ir";
        else if (inj === "Out" || inj === "Sus" || inj === "PUP" || inj === "COV") reason = "out";
        else if (inj === "Doubtful") reason = "doubtful";
      }
      if (!reason) return;
      const hasGame = Boolean(team && gameDate[team]);
      const day = hasGame && reason !== "bye" ? gameDate[team as string] : mainDate;
      if (!day || day < date || day > tomorrow) return;
      const k = team ? kickoffs[team] : undefined;
      if (hasGame && k?.started) return;
      const alertId = `${r.roster_id}:${id === "0" ? `slot${i}` : id}:${reason}`;
      if (alreadyReported.has(alertId)) return;
      ids.push(alertId);
      alerts.push({
        team: teamRef(ctx, r.roster_id),
        player: id === "0" ? emptySlot(slot) : asset(players, fc, id),
        slot,
        reason,
        kickoff: hasGame ? (k?.kickoff ?? null) : null,
      });
    });
  }
  return { alerts, ids };
}

export async function buildDailyFacts(ctx: LeagueContext, now: number, schedule: NflGame[]): Promise<DailyBuild> {
  const l = ctx.leagueId;
  const date = etDate(now);
  const cursor = await store.get<DailyCursor>(store.keys.snapshot(l, CURSOR));
  const sinceMs = Math.max(cursor?.sinceMs ?? now - DAY_MS, now - MAX_LOOKBACK_MS);

  // Up to `now`, not the fetch time: the cursor moves to `now`, so nothing lands in two issues.
  const tx = await transactionFacts(sinceMs, ctx, now);
  let placeholder = tx.placeholder;
  // A plain cut of a nobody is not news (rookie drafts bring dozens): keep adds and notable drops.
  const waivers = tx.waivers.filter((w) => w.added.length > 0 || w.notableDrop || w.type === "waiver");

  // Draft picks since the last Daily.
  let draftPicks: DraftPickFact[] = [];
  let nextPicks = cursor?.picks ?? null;
  const draft = ctx.draft;
  if (draft && draft.status !== "pre_draft") {
    const df = await draftFacts(ctx);
    placeholder ||= df.placeholder;
    const maxPick = df.picks.reduce((m, p) => Math.max(m, p.pickNo), 0);
    const sameDraft = cursor?.picks && cursor.picks.draftId === draft.draft_id;
    // First look at a draft that is already over: nothing is "since yesterday".
    const last = sameDraft ? cursor!.picks!.lastPickNo : draft.status === "complete" ? maxPick : 0;
    draftPicks = df.picks.filter((p) => p.pickNo > last).sort((a, b) => a.pickNo - b.pickNo);
    nextPicks = { draftId: draft.draft_id, lastPickNo: Math.max(maxPick, last) };
  }

  // Injuries and lineup alerts need the players map; skip them (not the issue) if it fails.
  let players: PlayersMap | null = null;
  let fc: FantasyCalcSnapshot | null = null;
  if (ctx.phase !== "pre_draft") {
    players = await getPlayers().catch(() => null);
    fc = await getFantasyCalc().catch(() => null);
  }

  let injuries: InjuryFact[] = [];
  let injurySnapshot: Record<string, string | null> | null = null;
  if (players) {
    const prev = await store.get<Record<string, string | null>>(store.keys.snapshot(l, INJURIES));
    const d = diffInjuries(ctx, players, fc, prev);
    injuries = d.injuries;
    injurySnapshot = d.snapshot;
  }

  let alerts: LineupAlertFact[] = [];
  let slate: DailyFacts["slate"] = null;
  let alertIds: string[] = [];
  let alertWeek: number | null = null;
  let reported: string[] = [];
  if (players && ctx.phase === "in_season" && schedule.length) {
    const week = upcomingWeekFor(schedule, date);
    const startWeek = Math.max(1, ctx.league.settings.start_week ?? 1);
    if (week && week >= startWeek && week <= ctx.lastWeek) {
      alertWeek = week;
      reported = (await store.get<string[]>(store.keys.snapshot(l, alertsKey(ctx.season, week)))) ?? [];
      const clocks = await getGameClocks({ season: ctx.season, week }).catch(() => []);
      const kickoffs: Record<string, KickoffInfo> = {};
      for (const c of clocks) {
        const k = { kickoff: c.kickoff, started: c.state !== "pre" };
        kickoffs[c.home] = k;
        kickoffs[c.away] = k;
      }
      const a = lineupAlerts(ctx, players, fc, schedule, week, date, kickoffs, new Set(reported));
      alerts = a.alerts;
      alertIds = a.ids;
      // The morning the week's first game is played: preview every matchup before kickoff.
      if (firstDateOfWeek(schedule, week) === date) {
        try {
          const wp = await getWinProbabilities(week, ctx, { pregame: true });
          if (wp && !wp.placeholder && wp.matchups.length) slate = { week, first: week === startWeek, matchups: wp.matchups };
        } catch {
          // No slate is a smaller issue, not a failed one.
        }
      }
    }
  }

  const facts: DailyFacts = {
    kind: "daily",
    date,
    sinceMs,
    trades: tx.trades,
    waivers,
    injuries,
    lineupAlerts: alerts,
    draftPicks,
    slate,
    hasMaterial: tx.trades.length + waivers.length + injuries.length + alerts.length + draftPicks.length + (slate ? 1 : 0) > 0,
  };

  return {
    facts,
    placeholder,
    async commit() {
      await store.set<DailyCursor>(store.keys.snapshot(l, CURSOR), { sinceMs: Math.max(now, sinceMs), picks: nextPicks });
      if (injurySnapshot) await store.set(store.keys.snapshot(l, INJURIES), injurySnapshot);
      if (alertWeek !== null && alertIds.length) {
        await store.set(store.keys.snapshot(l, alertsKey(ctx.season, alertWeek)), [...reported, ...alertIds], { ttlSeconds: 30 * 24 * 3600 });
      }
    },
  };
}

/** @deprecated Renamed to buildDailyFacts. */
export const buildDailyRoastFacts = buildDailyFacts;
