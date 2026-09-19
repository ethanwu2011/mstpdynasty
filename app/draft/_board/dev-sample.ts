/**
 * DEVELOPMENT ONLY. `/draft?sample=137` (or `?sample=full`) fills the first N picks of the
 * real draft shape with FantasyCalc players in a seeded, wobbly order, so the board can be
 * checked mid-draft (snake, reversal, reaches, steals, traded picks) and after it (grades)
 * before a single real pick exists. Production ignores it. Everything it returns is marked
 * `placeholder: true`, so the page shows the sample data marker.
 */
import { getFantasyCalc } from "@/lib/fantasycalc";
import { teamRef } from "@/lib/league";
import type { DraftFacts, DraftGrade, DraftPickFact, LeagueContext, LetterGrade, SleeperDraft, SleeperTradedPick } from "@/lib/types";
import { pickAt } from "../../_lib/draft";

function noise(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const LETTERS: LetterGrade[] = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"];

export async function devSample(
  ctx: LeagueContext,
  draft: SleeperDraft,
  raw: string | undefined,
): Promise<{ facts: DraftFacts; traded: SleeperTradedPick[] } | null> {
  if (process.env.NODE_ENV !== "development" || !raw) return null;
  const { teams, rounds } = draft.settings;
  const total = teams * rounds;
  const n = raw === "full" ? total : Math.max(0, Math.min(total, Number.parseInt(raw, 10) || 0));
  const fc = await getFantasyCalc().catch(() => null);
  const pool = fc ? Object.values(fc.bySleeperId).filter((v) => v.position !== "PICK") : [];
  if (!pool.length || !draft.slot_to_roster_id) return null;

  const order = pool
    .map((v) => ({ v, key: v.overallRank + (noise(v.sleeperId) - 0.5) * (6 + v.overallRank * 0.5) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.v);

  const slotRoster = (slot: number) => draft.slot_to_roster_id?.[String(slot)] ?? 1;
  const traded: SleeperTradedPick[] = [
    [2, 3, 8],
    [4, 1, 10],
    [6, 5, 2],
    [9, 7, 4],
  ].map(([round, from, to]) => ({
    season: draft.season,
    round,
    roster_id: slotRoster(from),
    owner_id: slotRoster(to),
    previous_owner_id: slotRoster(from),
  }));
  const held = new Map(traded.map((t) => [`${t.round}:${t.roster_id}`, t.owner_id]));

  const now = Date.now();
  const picks: DraftPickFact[] = [];
  for (let pickNo = 1; pickNo <= Math.min(n, order.length); pickNo++) {
    const v = order[pickNo - 1];
    const at = pickAt(draft, pickNo);
    const rosterId = held.get(`${at.round}:${at.rosterId}`) ?? at.rosterId ?? 1;
    const reach = pickNo - v.overallRank;
    const band = Math.max(3, Math.round(pickNo * 0.2));
    picks.push({
      kind: "draft_pick",
      draftId: draft.draft_id,
      pickNo,
      round: at.round,
      pickInRound: at.pickInRound,
      team: teamRef(ctx, rosterId),
      player: { playerId: v.sleeperId, name: v.name, position: v.position, nflTeam: v.team, age: v.age, value: v.value, overallRank: v.overallRank },
      fcRank: v.overallRank,
      fcPositionRank: v.positionRank,
      reach,
      verdict: reach >= band ? "reach" : reach <= -band ? "steal" : "fair",
      pickedAt: now - (n - pickNo) * 9 * 60_000,
      positionRun: 1,
    });
  }

  let grades: DraftGrade[] | null = null;
  if (n >= total) {
    const byTeam = new Map<number, DraftPickFact[]>();
    for (const p of picks) byTeam.set(p.team.rosterId, [...(byTeam.get(p.team.rosterId) ?? []), p]);
    grades = [...byTeam.entries()]
      .map(([rosterId, ps]) => ({
        team: teamRef(ctx, rosterId),
        totalValue: ps.reduce((a, p) => a + (p.player.value ?? 0), 0),
        best: [...ps].sort((a, b) => (a.reach ?? 0) - (b.reach ?? 0))[0] ?? null,
        worst: [...ps].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0] ?? null,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .map((g, i) => ({ team: g.team, grade: LETTERS[i] ?? "F", totalValue: g.totalValue, valueRank: i + 1, bestPick: g.best, worstPick: g.worst }));
  }

  const next = n < total ? pickAt(draft, n + 1) : null;
  const nextRoster = next ? (held.get(`${next.round}:${next.rosterId}`) ?? next.rosterId ?? 1) : null;
  return {
    traded,
    facts: {
      draftId: draft.draft_id,
      status: n >= total ? "complete" : n > 0 ? "drafting" : "pre_draft",
      startTime: draft.start_time,
      rounds,
      teams,
      picks,
      onTheClock: next && nextRoster !== null ? { pickNo: n + 1, round: next.round, team: teamRef(ctx, nextRoster) } : null,
      resumesAt: null,
      positionRuns: [],
      grades,
      placeholder: true,
    },
  };
}
