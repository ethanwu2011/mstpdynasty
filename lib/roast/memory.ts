/**
 * League memory for the newsletter writer: facts from outside the issue itself that make a joke specific
 * to this league (each manager's rap sheet, Loser of the Week crowns, where a player was
 * drafted, how the odds moved, who is on the clock). Everything is computed by code; the
 * model only sees it inside FACTS. Loaded only when the roast writer is configured (facts-only
 * issues never show it) and never throws: a part that fails is simply left out.
 */
import { listOddsSnapshots } from "@/lib/archive";
import { draftFacts, loserOfTheWeekCounts, shameEntries } from "@/lib/facts";
import { getFantasyCalc } from "@/lib/fantasycalc";
import { getWinProbabilities } from "@/lib/models";
import type { DraftPickFact, FantasyCalcValue, IssueFacts, LeagueContext, ShameEntry } from "@/lib/types";
import { pickLabel, r1 } from "./format";
import { EMPTY_MEMORY, starterCounts, type DraftContext, type PayloadMemory } from "./memory-shape";

export { EMPTY_MEMORY, starterCounts, type DraftContext, type PayloadMemory } from "./memory-shape";

const RAP_SHEET_SIZE = 2;

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[roast] memory: ${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

/** Two headlines per roster from the Wall of Shame (board order = worst first), one per kind. */
export function rapSheets(entries: ShameEntry[], season: string): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const kinds: Record<number, Set<string>> = {};
  for (const e of entries) {
    if (e.season !== season) continue;
    const rid = e.team.rosterId;
    const list = (out[rid] ??= []);
    const seen = (kinds[rid] ??= new Set());
    if (list.length >= RAP_SHEET_SIZE || seen.has(e.kind)) continue;
    seen.add(e.kind);
    list.push(e.week ? `${e.headline} (week ${e.week})` : e.headline);
  }
  return out;
}

function slotsOf(picks: DraftPickFact[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of picks) if (p.player.playerId && !(p.player.playerId in out)) out[p.player.playerId] = pickLabel(p);
  return out;
}

/** FantasyCalc player values by overall rank (draft picks excluded). */
export async function rankedValues(): Promise<FantasyCalcValue[] | null> {
  return safe(
    "FantasyCalc",
    async () =>
      Object.values((await getFantasyCalc()).bySleeperId)
        .filter((v) => v.position !== "PICK")
        .sort((a, b) => a.overallRank - b.overallRank),
    null,
  );
}

/** Draft context for pick payloads (the league's current draft). */
export async function draftContext(ctx: LeagueContext, picks?: DraftPickFact[]): Promise<DraftContext> {
  const d = ctx.draft;
  const all = picks ?? (await safe("draft picks", async () => (await draftFacts(ctx)).picks, [] as DraftPickFact[]));
  return {
    picks: all,
    fc: await rankedValues(),
    pickTimerSeconds: d?.settings.pick_timer ?? null,
    rookieOnly: d?.settings.player_type === 1,
  };
}

/** Everything an issue's FACTS can use beyond the issue facts themselves. */
export async function issueMemory(facts: IssueFacts, ctx: LeagueContext): Promise<PayloadMemory> {
  const mem: PayloadMemory = { ...EMPTY_MEMORY };
  mem.commissioner = ctx.managers.find((m) => m.isCommissioner)?.name ?? null;
  const df = await safe("draft", () => draftFacts(ctx), null);
  const picks = df?.picks ?? [];
  mem.draftSlots = slotsOf(picks);

  if (facts.kind === "weekly_roast" || facts.kind === "thursday_fallout") {
    const week = facts.week;
    mem.rapSheet = await safe("rap sheets", async () => rapSheets((await shameEntries(ctx)).entries, ctx.season), {});
    // Crowns before this week, plus this week's when the recap has one.
    const crowns = await safe("loser crowns", () => loserOfTheWeekCounts(week - 1, ctx), {} as Record<number, number>);
    if (facts.kind === "weekly_roast" && facts.weekly.loserOfTheWeek) {
      const rid = facts.weekly.loserOfTheWeek.team.rosterId;
      crowns[rid] = (crowns[rid] ?? 0) + 1;
    }
    mem.loserCrowns = crowns;
  }

  if (facts.kind === "weekly_roast" && facts.odds.teams.length) {
    const prevWeek = facts.odds.asOfWeek - 1;
    mem.playoffPctLastWeek = await safe(
      "odds history",
      async () => {
        const snap = (await listOddsSnapshots(ctx.leagueId, ctx.season)).find((s) => s.week === prevWeek);
        return Object.fromEntries((snap?.teams ?? []).map((t) => [t.rosterId, r1(t.playoffPct)]));
      },
      {} as Record<number, number>,
    );
  }

  if (facts.kind === "thursday_fallout") {
    mem.winPctBefore = await safe(
      "pre-game odds",
      async () => {
        const pre = await getWinProbabilities(facts.week, ctx, { pregame: true });
        const out: Record<number, number> = {};
        for (const m of pre.matchups) {
          out[m.home.team.rosterId] = r1(m.home.winProb * 100);
          out[m.away.team.rosterId] = r1(m.away.winProb * 100);
        }
        return out;
      },
      {} as Record<number, number>,
    );
  }

  if (facts.kind === "daily_roast" || facts.kind === "draft_grades") {
    mem.draft = await draftContext(ctx, facts.kind === "draft_grades" ? facts.draft.picks : picks);
    mem.starters = starterCounts(ctx.starterSlots);
  }

  const d = ctx.draft;
  const o = df?.onTheClock;
  if (facts.kind === "daily_roast" && d && (d.status === "drafting" || d.status === "paused") && df && o) {
    const teams = Math.max(1, df.teams);
    mem.onTheClock = {
      manager: o.team.managerName,
      team: o.team.teamName,
      pick: pickLabel({ round: o.round, pickInRound: ((o.pickNo - 1) % teams) + 1 }),
      roundsLeft: Math.max(0, df.rounds - o.round + 1),
      ...(df.resumesAt ? { resumesAt: df.resumesAt } : {}),
    };
  }
  return mem;
}
