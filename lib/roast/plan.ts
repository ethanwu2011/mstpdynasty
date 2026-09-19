/**
 * Plans for issues and item roasts. A plan is fully deterministic:
 *   - `sections`: the issue body with every table and fact line written by code, plus
 *     "slot" blocks where The Roast's prose goes (each slot has a facts-only fallback)
 *   - `slots`: what the model is asked to write
 *   - `facts`: the compact FACTS payload the model sees (keys match the glossary in persona.ts)
 * The same plan renders the LLM issue and the facts-only issue, so both look alike.
 */
import type {
  DailyRoastFacts,
  DraftFacts,
  DraftGradesFacts,
  DraftPickFact,
  IssueBlock,
  IssueKind,
  MatchupFact,
  SimResult,
  StarterPerformance,
  SwapFact,
  TeamRef,
  TeamWeekFact,
  ThursdayFalloutFacts,
  TradeFact,
  WaiverFact,
  WeeklyRoastFacts,
} from "@/lib/types";
import { label, money, num, para, pct, pickLabel, pts, r1, r2, sentences, signed, who } from "./format";
import { EMPTY_MEMORY, type DraftContext, type PayloadMemory } from "./memory";

export const ISSUE_TITLES: Record<IssueKind, string> = {
  daily_roast: "The Daily Roast",
  thursday_fallout: "Thursday Night Fallout",
  weekly_roast: "The Weekly Roast",
  draft_grades: "Draft Grades",
};

export interface SlotSpec {
  id: string;
  brief: string;
}

export type PlannedBlock = IssueBlock | { type: "slot"; slot: string; fallback: IssueBlock[] };

export interface PlannedSection {
  heading: string;
  blocks: PlannedBlock[];
}

export interface IssuePlan {
  kind: IssueKind;
  title: string;
  /** First line of the user message, e.g. "ISSUE: The Weekly Roast, week 7". */
  header: string;
  task: string;
  slots: SlotSpec[];
  facts: Record<string, unknown>;
  sections: PlannedSection[];
  fallbackDek: string;
  week: number | null;
  /** Managers the issue is about (for picking LORE). */
  managers: string[];
  placeholder: boolean;
}

const DEK_SLOT: SlotSpec = {
  id: "dek",
  brief: "At most 14 words. This is also the email subject: name a manager and make him regret opening it.",
};

/** How waiver claims are decided: FAAB bids, or waiver priority (then bids mean nothing). */
export type WaiverMode = "faab" | "priority";

/** Max trades that get their own slot in one daily issue (the rest are table-only). */
export const MAX_TRADE_SLOTS = 6;

const slot = (id: string, fallback: IssueBlock[]): PlannedBlock => ({ type: "slot", slot: id, fallback });

/* ------------------------------------------------------------------ */
/* shared fact payload pieces                                          */
/* ------------------------------------------------------------------ */

/** playerId -> draft slot, for "draftedAt" on every player object. */
type DraftSlots = Record<string, string>;

export function assetPayload(
  p: { playerId?: string; name: string; position: string; age: number | null; value: number | null; nflTeam?: string | null },
  slots: DraftSlots = {},
) {
  const out: Record<string, unknown> = { name: p.name, pos: p.position };
  if (p.nflTeam) out.nflTeam = p.nflTeam;
  if (p.age !== null) out.age = p.age;
  out.value = p.value;
  if (p.playerId && slots[p.playerId]) out.draftedAt = slots[p.playerId];
  return out;
}

/** A player's week in FACTS: points, projection when known, and where he was drafted. */
function performancePayload(x: StarterPerformance | null | undefined, slots: DraftSlots) {
  if (!x) return null;
  const out: Record<string, unknown> = { name: x.name, pos: x.position, points: x.points };
  if (x.projected !== null) out.projected = x.projected;
  if (slots[x.playerId]) out.draftedAt = slots[x.playerId];
  return out;
}

function swapPayload(sw: SwapFact, slots: DraftSlots) {
  const side = (x: SwapFact["benchPlayer"]) => {
    const out: Record<string, unknown> = { name: x.name, pos: x.position, points: x.points };
    if (slots[x.playerId]) out.draftedAt = slots[x.playerId];
    return out;
  };
  return { manager: sw.team.managerName, benched: side(sw.benchPlayer), started: side(sw.starter), slot: sw.slot, gain: sw.gain };
}

export function tradePayload(t: TradeFact, slots: DraftSlots = {}) {
  const winner = t.sides.find((s) => s.team.rosterId === t.winnerRosterId);
  return {
    week: t.week,
    sides: t.sides.map((s) => ({
      ...who(s.team),
      got: s.playersIn.map((x) => assetPayload(x, slots)),
      gotPicks: s.picksIn.map((p) => ({ label: p.label, value: p.value })),
      gave: s.playersOut.map((x) => assetPayload(x, slots)),
      gavePicks: s.picksOut.map((p) => ({ label: p.label, value: p.value })),
      ...(s.faabIn || s.faabOut ? { faabIn: s.faabIn, faabOut: s.faabOut } : {}),
      valueIn: s.valueIn,
      valueOut: s.valueOut,
      net: s.net,
      grade: s.grade,
    })),
    winner: winner ? winner.team.managerName : "nobody (fair by value)",
  };
}

type LosingBidLike = { team: TeamRef; bid: number; reason?: string };

/**
 * One claim. In a priority league (no FAAB) bids are meaningless, so none are sent: losing
 * claims lost to waiver priority, not to a "$0 bid".
 */
export function waiverPayload(w: WaiverFact, mode: WaiverMode = "faab", slots: DraftSlots = {}) {
  const faab = mode === "faab";
  return {
    ...who(w.team),
    type: w.type,
    added: w.added.map((x) => assetPayload(x, slots)),
    dropped: w.dropped.map((x) => assetPayload(x, slots)),
    ...(faab ? { bid: w.bid } : {}),
    ...(faab && w.isZeroBid ? { zeroBid: true } : {}),
    losingBids: (w.losingBids as LosingBidLike[]).map((l) =>
      faab ? { manager: l.team.managerName, bid: l.bid, why: l.reason ?? "outbid" } : { manager: l.team.managerName, why: l.reason === "roster_full" ? "roster_full" : "priority" },
    ),
    ...(faab ? { overpayBy: w.overpayBy } : {}),
    ...(w.notableDrop ? { notableDrop: true } : {}),
  };
}

/** The waiver block of FACTS: the mode, the budget only when bids are real, and the claims. */
export function waiversPayload(claims: WaiverFact[], faabBudget: number, mode: WaiverMode, slots: DraftSlots = {}) {
  return { waiverMode: mode, ...(mode === "faab" ? { faabBudget } : {}), claims: claims.map((w) => waiverPayload(w, mode, slots)) };
}

/** Time on the clock at the scale that reads right: seconds, minutes, or hours. */
function clockPayload(seconds: number | null): Record<string, number> {
  if (seconds === null) return {};
  if (seconds < 60) return { secondsOnClock: seconds };
  if (seconds < 3600) return { minutesOnClock: Math.round(seconds / 60) };
  return { hoursOnClock: r1(seconds / 3600) };
}

/** Players FantasyCalc ranks higher who were still on the board at this pick (top 2). */
export function passedOn(p: DraftPickFact, d: DraftContext | null | undefined): Array<{ name: string; pos: string; fcRank: number }> {
  if (!d?.fc || d.rookieOnly) return [];
  const taken = new Set(d.picks.filter((x) => x.draftId === p.draftId && x.pickNo <= p.pickNo).map((x) => x.player.playerId));
  taken.add(p.player.playerId);
  const limit = p.fcRank ?? Number.POSITIVE_INFINITY;
  return d.fc
    .filter((v) => !taken.has(v.sleeperId) && v.overallRank < limit)
    .slice(0, 2)
    .map((v) => ({ name: v.name, pos: v.position, fcRank: v.overallRank }));
}

/** This manager's picks at the pick's position so far, this one included. */
export function posCountForManager(p: DraftPickFact, d: DraftContext | null | undefined): number {
  const others = (d?.picks ?? []).filter(
    (x) => x.draftId === p.draftId && x.team.rosterId === p.team.rosterId && x.pickNo < p.pickNo && x.player.position === p.player.position,
  );
  return others.length + 1;
}

export function pickPayload(p: DraftPickFact, d: DraftContext | null = null) {
  const out: Record<string, unknown> = {
    pick: pickLabel(p),
    pickNo: p.pickNo,
    ...who(p.team),
    player: assetPayload(p.player),
    fcRank: p.fcRank,
    ...(p.fcPositionRank !== null ? { posRank: `${p.player.position}${p.fcPositionRank}` } : {}),
    reach: p.reach,
    verdict: p.verdict,
    ...(p.positionRun > 1 ? { positionRun: p.positionRun } : {}),
    ...clockPayload(p.secondsOnClock),
  };
  if (d) {
    if (d.pickTimerSeconds) out.clockLimitHours = r1(d.pickTimerSeconds / 3600);
    const skipped = passedOn(p, d);
    if (skipped.length) out.passedOn = skipped;
    out.posCountForManager = posCountForManager(p, d);
  }
  return out;
}

/** Season odds for FACTS, at the same one-decimal precision as the tables (never rounded into a certainty). */
function oddsPayload(odds: SimResult, mem: PayloadMemory) {
  return [...odds.teams]
    .sort((a, b) => b.playoffPct - a.playoffPct || a.team.rosterId - b.team.rosterId)
    .map((t) => ({
      manager: t.team.managerName,
      team: t.team.teamName,
      playoffPct: r1(t.playoffPct),
      ...(mem.playoffPctLastWeek[t.team.rosterId] !== undefined ? { playoffPctLastWeek: mem.playoffPctLastWeek[t.team.rosterId] } : {}),
      byePct: r1(t.byePct),
      titlePct: r1(t.titlePct),
      lastPct: r1(t.lastPlacePct),
      firstPickPct: r1(t.firstPickPct),
    }));
}

/** Per-manager league memory: Loser of the Week crowns and the Wall of Shame rap sheet. */
function historyPayload(teams: TeamRef[], mem: PayloadMemory) {
  return teams
    .map((t) => ({
      ...who(t),
      ...(mem.loserCrowns[t.rosterId] ? { loserCrowns: mem.loserCrowns[t.rosterId] } : {}),
      ...(mem.rapSheet[t.rosterId]?.length ? { rapSheet: mem.rapSheet[t.rosterId] } : {}),
    }))
    .filter((h) => "loserCrowns" in h || "rapSheet" in h);
}

function oddsSection(odds: SimResult, heading: string, withSlot: boolean): PlannedSection {
  const rows = [...odds.teams].sort((a, b) => b.playoffPct - a.playoffPct || a.team.rosterId - b.team.rosterId);
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const blocks: PlannedBlock[] = [];
  if (withSlot && best && worst) {
    blocks.push(
      slot("odds", [para(`Best playoff odds: ${label(best.team)}, ${pct(best.playoffPct)}. Worst: ${label(worst.team)}, ${pct(worst.playoffPct)}.`)]),
    );
  }
  blocks.push({
    type: "table",
    columns: ["Team", "Manager", "Playoffs %", "Bye %", "Title %", "Last %"],
    rows: rows.map((t) => [t.team.teamName, t.team.managerName, r1(t.playoffPct), r1(t.byePct), r1(t.titlePct), r1(t.lastPlacePct)]),
  });
  blocks.push({ type: "note", text: `From ${num(odds.runs)} simulated seasons.` });
  return { heading, blocks };
}

/* ------------------------------------------------------------------ */
/* The Weekly Roast                                                    */
/* ------------------------------------------------------------------ */

function teamWeekPayload(t: TeamWeekFact, slots: DraftSlots = {}) {
  const out: Record<string, unknown> = {
    ...who(t.team),
    points: t.points,
    projected: t.projected,
    optimal: t.optimalPoints,
    benchLeft: t.benchPointsLeft,
    scoreRank: t.scoreRank,
    allPlay: `${t.allPlayWins}-${t.allPlayLosses}`,
    result: t.result,
  };
  if (t.robbed) out.robbed = true;
  if (t.fraud) out.fraud = true;
  if (t.streak) out.streak = t.streak;
  if (t.zeroStarters.length) {
    out.zeroStarters = t.zeroStarters.map((z) => ({ name: z.name, pos: z.position, slot: z.slot, why: z.reason, ...(slots[z.playerId] ? { draftedAt: slots[z.playerId] } : {}) }));
  }
  // Player stories, so five matchup slots are not five "left points on the bench" jokes.
  const top = performancePayload(t.topStarter, slots);
  if (top) out.topStarter = top;
  const worst = performancePayload(t.worstStarter, slots);
  if (worst) out.worstStarter = worst;
  const boom = performancePayload(t.boomBench, slots);
  if (boom) out.boomBench = boom;
  if (t.benchMistake) {
    const { manager: _m, ...mistake } = swapPayload(t.benchMistake, slots);
    void _m;
    out.benchMistake = mistake;
  }
  return out;
}

function matchupPayload(m: MatchupFact, slots: DraftSlots = {}) {
  const winner = m.winnerRosterId === m.home.team.rosterId ? m.home : m.winnerRosterId === m.away.team.rosterId ? m.away : null;
  const loser = winner === m.home ? m.away : winner === m.away ? m.home : null;
  const base: Record<string, unknown> =
    winner && loser
      ? { winner: teamWeekPayload(winner, slots), loser: teamWeekPayload(loser, slots) }
      : { tie: true, teams: [teamWeekPayload(m.home, slots), teamWeekPayload(m.away, slots)] };
  base.margin = m.margin;
  if (m.flipSwap) base.flipSwap = swapPayload(m.flipSwap, slots);
  return base;
}

function matchupFallback(m: MatchupFact): IssueBlock[] {
  const winner = m.winnerRosterId === m.home.team.rosterId ? m.home : m.winnerRosterId === m.away.team.rosterId ? m.away : null;
  const loser = winner === m.home ? m.away : winner === m.away ? m.home : null;
  const first =
    winner && loser
      ? `${label(winner.team)} beat ${label(loser.team)}, ${pts(winner.points)} to ${pts(loser.points)}.`
      : `${label(m.home.team)} and ${label(m.away.team)} tied at ${pts(m.home.points)}.`;
  const swap = m.flipSwap
    ? `Starting ${m.flipSwap.benchPlayer.name} (${pts(m.flipSwap.benchPlayer.points)}) over ${m.flipSwap.starter.name} (${pts(m.flipSwap.starter.points)}) would have won it.`
    : null;
  return [para(sentences(first, swap))];
}

function matchupFactLines(m: MatchupFact): string[] {
  const lines: string[] = [];
  for (const t of [m.home, m.away]) {
    const bits = [`${t.team.teamName}: ${pts(t.points)}`];
    if (t.projected !== null) bits.push(`projected ${pts(t.projected)}`);
    bits.push(`${pts(t.benchPointsLeft)} left on the bench`);
    if (t.robbed) bits.push("robbed (top-3 score, lost)");
    if (t.fraud) bits.push("fraud (bottom-3 score, won)");
    lines.push(bits.join(", "));
  }
  if (m.flipSwap) {
    lines.push(
      `The swap that flips it: ${m.flipSwap.benchPlayer.name} (${pts(m.flipSwap.benchPlayer.points)}) for ${m.flipSwap.starter.name} (${pts(m.flipSwap.starter.points)}) at ${m.flipSwap.slot}`,
    );
  }
  return lines;
}

export function planWeekly(f: WeeklyRoastFacts, mem: PayloadMemory = EMPTY_MEMORY): IssuePlan {
  const slotsOf = mem.draftSlots;
  const wk = f.weekly;
  const teams = wk.teams;
  const byBench = [...teams].sort((a, b) => b.benchPointsLeft - a.benchPointsLeft || a.team.rosterId - b.team.rosterId);
  const loser = wk.loserOfTheWeek;
  const loserOpp = loser ? teams.find((t) => t.team.rosterId === loser.opponentRosterId) : undefined;
  const loserMatchup = loser ? wk.matchups.find((m) => m.home.team.rosterId === loser.team.rosterId || m.away.team.rosterId === loser.team.rosterId) : undefined;

  const facts: Record<string, unknown> = {
    week: f.week,
    leagueSize: teams.length,
    highest: wk.highest ? { ...who(wk.highest.team), points: wk.highest.points } : null,
    lowest: wk.lowest ? { ...who(wk.lowest.team), points: wk.lowest.points } : null,
    mostBenchLeft: byBench[0] ? { ...who(byBench[0].team), benchLeft: byBench[0].benchPointsLeft } : null,
  };
  const slots: SlotSpec[] = [DEK_SLOT, { id: "cold-open", brief: "2 to 4 sentences. Open on the single best storyline of the week." }];
  if (loser) {
    facts.loserOfTheWeek = {
      ...teamWeekPayload(loser, slotsOf),
      lostTo: loserOpp ? loserOpp.team.managerName : null,
      margin: loserMatchup?.margin ?? null,
    };
    slots.push({ id: "loser", brief: "2 to 3 sentences crowning the Loser of the Week. No mercy." });
  }
  const matchupSlots = wk.matchups.map((m) => ({ id: `m-${m.matchupId}`, m }));
  for (const { id, m } of matchupSlots) {
    facts[id] = matchupPayload(m, slotsOf);
    slots.push({ id, brief: `3 to 6 sentences on matchup ${id}. Hit both managers. Use a player from topStarter, worstStarter, boomBench or benchMistake, not only team totals.` });
  }
  facts.standings = wk.standings.map((s) => ({
    rank: s.rank,
    ...who(s.team),
    record: s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`,
    pointsFor: s.pointsFor,
    pointsAgainst: s.pointsAgainst,
    streak: s.streak,
    ...(s.previousRank != null && s.previousRank !== s.rank ? { lastWeekRank: s.previousRank } : {}),
  }));
  facts.power = f.power.rows.map((r) => ({
    rank: r.rank,
    manager: r.team.managerName,
    luck: r1(r.luck),
    ...(r.previousRank !== null && r.previousRank !== r.rank ? { lastWeekRank: r.previousRank } : {}),
  }));
  facts.odds = oddsPayload(f.odds, mem);
  const history = historyPayload(teams.map((t) => t.team), mem);
  if (history.length) facts.history = history;
  slots.push({ id: "odds", brief: "1 to 3 sentences on the season odds and who is kidding themselves." });

  const sections: PlannedSection[] = [];
  const coldFallback = sentences(
    wk.highest ? `Highest score: ${label(wk.highest.team)}, ${pts(wk.highest.points)}.` : null,
    wk.lowest ? `Lowest: ${label(wk.lowest.team)}, ${pts(wk.lowest.points)}.` : null,
    byBench[0] && byBench[0].benchPointsLeft > 0 ? `Most points left on the bench: ${label(byBench[0].team)}, ${pts(byBench[0].benchPointsLeft)}.` : null,
  );
  sections.push({ heading: `Week ${f.week}`, blocks: [slot("cold-open", coldFallback ? [para(coldFallback)] : [])] });
  if (loser) {
    sections.push({
      heading: "Loser of the Week",
      blocks: [
        { type: "paragraph", text: `${label(loser.team)}: ${pts(loser.points)} points${loserOpp ? `, lost to ${label(loserOpp.team)}` : ""}.` },
        slot("loser", []),
      ],
    });
  }
  const matchupBlocks: PlannedBlock[] = [];
  for (const { id, m } of matchupSlots) {
    const [first, second] = m.winnerRosterId === m.away.team.rosterId ? [m.away, m.home] : [m.home, m.away];
    matchupBlocks.push({ type: "heading", text: `${first.team.teamName} ${pts(first.points)}, ${second.team.teamName} ${pts(second.points)}` });
    matchupBlocks.push(slot(id, matchupFallback(m)));
    matchupBlocks.push({ type: "list", items: matchupFactLines(m) });
  }
  if (matchupBlocks.length) sections.push({ heading: "The matchups", blocks: matchupBlocks });
  sections.push({
    heading: "Points left on the bench",
    blocks: [
      {
        type: "table",
        columns: ["Team", "Manager", "Scored", "Best possible", "Left on bench"],
        rows: byBench.map((t) => [t.team.teamName, t.team.managerName, r2(t.points), r2(t.optimalPoints), r2(t.benchPointsLeft)]),
      },
    ],
  });
  const zeros = teams.flatMap((t) => t.zeroStarters);
  if (zeros.length) {
    const why: Record<string, string> = {
      bye: "on a bye",
      out: "ruled out",
      ir: "on IR",
      inactive: "did not play",
      empty_slot: "empty slot",
      played_zero: "played, scored 0",
    };
    sections.push({
      heading: "Zero-point starters",
      blocks: [{ type: "list", items: zeros.map((z) => `${z.team.teamName} (${z.team.managerName}): ${z.name}, ${z.slot}, ${why[z.reason]}`) }],
    });
  }
  if (wk.standings.length) {
    sections.push({
      heading: "Standings",
      blocks: [
        {
          type: "table",
          columns: ["Rank", "Team", "Manager", "Record", "Points for", "Streak"],
          rows: wk.standings.map((s) => [s.rank, s.team.teamName, s.team.managerName, s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`, r2(s.pointsFor), s.streak]),
        },
      ],
    });
  }
  if (f.power.rows.length) {
    sections.push({
      heading: "Power rankings",
      blocks: [
        { type: "note", text: f.power.formula },
        {
          type: "table",
          columns: ["Rank", "Team", "Manager", "Score", "All-play", "Luck"],
          rows: f.power.rows.map((r) => [r.rank, r.team.teamName, r.team.managerName, r2(r.score), `${r.allPlayWins}-${r.allPlayLosses}`, r1(r.luck)]),
        },
      ],
    });
  }
  if (f.odds.teams.length) sections.push(oddsSection(f.odds, "Season odds", true));
  else slots.splice(slots.findIndex((s) => s.id === "odds"), 1);

  return {
    kind: "weekly_roast",
    title: ISSUE_TITLES.weekly_roast,
    header: `ISSUE: ${ISSUE_TITLES.weekly_roast}, week ${f.week}`,
    task: `Write The Weekly Roast for week ${f.week}, the full recap. Every matchup gets its own slot. Use bench points, the swap that flipped a result, robbed and fraud flags, zero-point starters and streaks where the facts have them. Spread the damage: every manager takes at least one hit somewhere in the issue.`,
    slots,
    facts,
    sections,
    // The email subject puts "The Weekly Roast, week N:" in front of a code-written dek.
    fallbackDek:
      wk.highest && wk.lowest
        ? `${wk.highest.team.teamName} put up ${pts(wk.highest.points)}, ${wk.lowest.team.teamName} managed ${pts(wk.lowest.points)}.`
        : "The recap.",
    week: f.week,
    managers: teams.map((t) => t.team.managerName),
    placeholder: wk.placeholder || f.odds.placeholder || f.power.placeholder,
  };
}

/* ------------------------------------------------------------------ */
/* Thursday Night Fallout                                              */
/* ------------------------------------------------------------------ */

const winBefore = (rosterId: number, mem: PayloadMemory) =>
  mem.winPctBefore[rosterId] !== undefined ? { winPctBefore: mem.winPctBefore[rosterId] } : {};

export function planThursday(f: ThursdayFalloutFacts, mem: PayloadMemory = EMPTY_MEMORY): IssuePlan {
  const tnf = f.tnf;
  const gameNames = tnf.games.map((g) => `${g.away} at ${g.home}`);
  const rostered = tnf.players.filter((p) => p.team !== null);
  const facts: Record<string, unknown> = {
    week: f.week,
    games: gameNames,
    players: tnf.players.map((p) => ({
      name: p.player.name,
      pos: p.player.position,
      nflTeam: p.player.nflTeam,
      points: p.points,
      projected: p.projected,
      manager: p.team ? p.team.managerName : null,
      ...(p.team ? { started: p.started } : { rostered: false }),
      ...(mem.draftSlots[p.player.playerId] ? { draftedAt: mem.draftSlots[p.player.playerId] } : {}),
    })),
    teams: tnf.teams.map((t) => ({ ...who(t.team), banked: t.banked, projected: t.projected, delta: t.delta })),
    // Win % at one decimal, like the table (99.6 is not "locked in"), with the pre-kickoff number to show the swing.
    matchups: f.winProbs.matchups.map((m) => ({
      home: { ...who(m.home.team), points: r2(m.home.actual), mean: r1(m.home.mean), winPct: r1(m.home.winProb * 100), ...winBefore(m.home.team.rosterId, mem) },
      away: { ...who(m.away.team), points: r2(m.away.actual), mean: r1(m.away.mean), winPct: r1(m.away.winProb * 100), ...winBefore(m.away.team.rosterId, mem) },
    })),
  };
  const history = historyPayload(tnf.teams.map((t) => t.team), mem);
  if (history.length) facts.history = history;
  const slots: SlotSpec[] = [
    DEK_SLOT,
    { id: "cold-open", brief: "2 to 4 sentences on what the Thursday game did to this league." },
    {
      id: "banked",
      brief:
        "2 to 4 sentences: who got carried, who got cooked, who benched the guy who went off, and any unrostered player (rostered:false) who went off on the waiver wire.",
    },
    { id: "odds", brief: "1 to 3 sentences on the matchups already decided in spirit: winPct now against winPctBefore." },
  ];
  const best = tnf.teams[0];
  const worst = tnf.teams[tnf.teams.length - 1];
  const sections: PlannedSection[] = [
    {
      heading: `Week ${f.week}, Thursday night`,
      blocks: [slot("cold-open", [para(gameNames.length ? `Thursday: ${gameNames.join(", ")}.` : "No Thursday game this week.")])],
    },
    {
      heading: "Banked",
      blocks: [
        slot(
          "banked",
          best && worst && best !== worst
            ? [para(`Best Thursday: ${label(best.team)}, ${signed(best.delta)} against projection. Worst: ${label(worst.team)}, ${signed(worst.delta)}.`)]
            : [],
        ),
        {
          type: "table",
          columns: ["Team", "Manager", "Banked", "Projected", "Difference"],
          rows: tnf.teams.map((t) => [t.team.teamName, t.team.managerName, r2(t.banked), r2(t.projected), r2(t.delta)]),
        },
      ],
    },
  ];
  if (tnf.players.length) {
    sections.push({
      heading: "The players",
      blocks: [
        {
          type: "table",
          columns: ["Player", "Pos", "Manager", "Started", "Points", "Projected"],
          rows: tnf.players.map((p) => [p.player.name, p.player.position, p.team ? p.team.managerName : "Free agent", p.team ? (p.started ? "Yes" : "No") : "", r2(p.points), p.projected === null ? "" : r2(p.projected)]),
        },
      ],
    });
  }
  if (f.winProbs.matchups.length) {
    sections.push({
      heading: "Where it stands",
      blocks: [
        slot("odds", []),
        {
          type: "table",
          columns: ["Team", "Win %", "Team", "Win %"],
          rows: f.winProbs.matchups.map((m) => [m.home.team.teamName, r1(m.home.winProb * 100), m.away.team.teamName, r1(m.away.winProb * 100)]),
        },
      ],
    });
  } else {
    slots.pop();
  }
  return {
    kind: "thursday_fallout",
    title: ISSUE_TITLES.thursday_fallout,
    header: `ISSUE: ${ISSUE_TITLES.thursday_fallout}, week ${f.week}`,
    task: `Write Thursday Night Fallout for week ${f.week}: who the Thursday game carried, who it cooked, and which matchups are already decided in spirit.`,
    slots,
    facts,
    sections,
    fallbackDek: rostered[0] ? `${rostered[0].player.name} put up ${pts(rostered[0].points)} for ${rostered[0].team?.managerName}.` : `Week ${f.week}, Thursday night.`,
    week: f.week,
    managers: tnf.teams.map((t) => t.team.managerName),
    placeholder: tnf.placeholder || f.winProbs.placeholder,
  };
}

/* ------------------------------------------------------------------ */
/* The Daily Roast                                                     */
/* ------------------------------------------------------------------ */

function tradeTable(t: TradeFact): IssueBlock {
  const names = (xs: Array<{ name?: string; label?: string }>) => xs.map((x) => x.name ?? x.label ?? "").join(", ");
  return {
    type: "table",
    columns: ["Team", "Got", "Gave", "Value in", "Value out", "Net", "Grade"],
    rows: t.sides.map((s) => [
      label(s.team),
      [names(s.playersIn), names(s.picksIn), s.faabIn ? money(s.faabIn) + " FAAB" : ""].filter(Boolean).join(", ") || "Nothing",
      [names(s.playersOut), names(s.picksOut), s.faabOut ? money(s.faabOut) + " FAAB" : ""].filter(Boolean).join(", ") || "Nothing",
      s.valueIn,
      s.valueOut,
      s.net,
      s.grade,
    ]),
  };
}

function tradeFallback(t: TradeFact): string {
  const winner = t.sides.find((s) => s.team.rosterId === t.winnerRosterId);
  if (!winner) return `${t.sides.map((s) => label(s.team)).join(" and ")} made a trade that is fair by FantasyCalc value.`;
  const losers = t.sides.filter((s) => s !== winner);
  return `${label(winner.team)} wins this trade by ${num(t.valueGap)} in FantasyCalc value (${winner.grade}; ${losers.map((s) => `${s.team.managerName} ${s.grade}`).join(", ")}).`;
}

/** A processed claim with no bid: the league runs on waiver priority, not FAAB. */
const byPriority = (w: WaiverFact) => w.type === "waiver" && w.bid === null;

export function waiverLine(w: WaiverFact): string {
  const added = w.added.map((p) => p.name).join(", ") || "nobody";
  const dropped = w.dropped.length ? `, dropped ${w.dropped.map((p) => p.name).join(", ")}` : "";
  const bid = w.bid !== null ? ` for ${money(w.bid)}` : "";
  const bids = w.losingBids as LosingBidLike[];
  const losing = !bids.length
    ? ""
    : byPriority(w)
      ? ` (also claimed by: ${bids.map((l) => `${l.team.managerName}${l.reason === "roster_full" ? ", roster full" : ""}`).join("; ")})`
      : ` (also bid: ${bids.map((l) => `${l.team.managerName} ${money(l.bid)}${l.reason === "roster_full" ? ", roster full" : ""}`).join("; ")})`;
  return `${label(w.team)} added ${added}${bid}${losing}${dropped}.`;
}

/**
 * The Daily Roast's code-written dek: the single worst thing since the last issue (a lopsided
 * trade, a $0 bid that lost, an overpay, a lineup hole, a reach), not the counts.
 */
export function dailyWorstFact(f: DailyRoastFacts): string | null {
  const trades = f.trades
    .filter((t) => t.winnerRosterId !== null)
    .sort((a, b) => b.valueGap - a.valueGap || a.createdAt - b.createdAt);
  const t = trades[0];
  if (t) {
    const winner = t.sides.find((s) => s.team.rosterId === t.winnerRosterId)!;
    const loser = [...t.sides].sort((a, b) => a.net - b.net)[0];
    if (loser && loser !== winner && loser.net < 0) return `${loser.team.managerName} gave ${winner.team.managerName} ${num(-loser.net)} in FantasyCalc value in one trade.`;
  }
  for (const w of f.waivers) {
    const zero = (w.losingBids as LosingBidLike[]).find((l) => l.bid === 0 && (l.reason ?? "outbid") === "outbid");
    if (w.type === "waiver" && w.bid !== null && zero) return `${zero.team.managerName} bid $0 on ${w.added.map((p) => p.name).join(" and ") || "a player"} and lost him to a ${money(w.bid)} bid.`;
  }
  const over = [...f.waivers].filter((w) => w.bid !== null && (w.overpayBy ?? 0) > 0).sort((a, b) => (b.overpayBy ?? 0) - (a.overpayBy ?? 0))[0];
  if (over && over.bid !== null) {
    return `${over.team.managerName} paid ${money(over.bid)} for ${over.added.map((p) => p.name).join(" and ") || "a player"} when the next bid was ${money(over.bid - (over.overpayBy ?? 0))}.`;
  }
  const alert = f.lineupAlerts[0];
  if (alert) {
    const why = { bye: "on a bye", out: "ruled out", ir: "on IR", doubtful: "doubtful" } as const;
    return alert.reason === "empty_slot"
      ? `${alert.team.managerName} has nobody in his ${alert.slot} slot.`
      : `${alert.team.managerName} is starting ${alert.player.name}, who is ${why[alert.reason]}.`;
  }
  const reach = [...f.draftPicks].filter((p) => p.verdict === "reach").sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0];
  if (reach) return `${reach.team.managerName} took ${reach.player.name} at pick ${reach.pickNo}, ${reach.reach} spots before his FantasyCalc rank.`;
  const injury = f.injuries.find((i) => i.isStarter) ?? f.injuries[0];
  if (injury) return `${injury.player.name} (${injury.team.managerName}) went from ${injury.previousStatus ?? "healthy"} to ${injury.status}.`;
  return null;
}

function draftPickTable(picks: DraftPickFact[]): IssueBlock {
  return {
    type: "table",
    columns: ["Pick", "Team", "Player", "Pos", "FC rank", "Verdict"],
    rows: picks.map((p) => [pickLabel(p), p.team.teamName, p.player.name, p.player.position, p.fcRank ?? "", p.verdict === "unranked" ? "Unranked" : p.verdict === "fair" ? "Fair" : `${p.verdict === "reach" ? "Reach" : "Steal"} (${Math.abs(p.reach ?? 0)})`]),
  };
}

export function planDaily(f: DailyRoastFacts, faabBudget: number, mem: PayloadMemory = EMPTY_MEMORY, waiverMode: WaiverMode = "faab"): IssuePlan {
  const facts: Record<string, unknown> = { date: f.date };
  const slots: SlotSpec[] = [DEK_SLOT, { id: "cold-open", brief: "1 to 3 sentences on the worst thing that happened since the last issue." }];
  const sections: PlannedSection[] = [];
  const managers = new Set<string>();
  const counts = sentences(
    f.trades.length ? `${f.trades.length} trade${f.trades.length === 1 ? "" : "s"}.` : null,
    f.waivers.length ? `${f.waivers.length} waiver move${f.waivers.length === 1 ? "" : "s"}.` : null,
    f.draftPicks.length ? `${f.draftPicks.length} draft pick${f.draftPicks.length === 1 ? "" : "s"}.` : null,
    f.lineupAlerts.length ? `${f.lineupAlerts.length} lineup alert${f.lineupAlerts.length === 1 ? "" : "s"}.` : null,
  );
  sections.push({ heading: "Since the last issue", blocks: [slot("cold-open", counts ? [para(counts)] : [])] });

  if (f.trades.length) {
    const blocks: PlannedBlock[] = [];
    f.trades.forEach((t, i) => {
      t.sides.forEach((s) => managers.add(s.team.managerName));
      blocks.push({ type: "heading", text: t.sides.map((s) => s.team.teamName).join(" and ") });
      if (i < MAX_TRADE_SLOTS) {
        const id = `t-${i + 1}`;
        facts[id] = tradePayload(t, mem.draftSlots);
        slots.push({ id, brief: `2 to 4 sentences on trade ${id}. Say who won it by value.` });
        blocks.push(slot(id, [para(tradeFallback(t))]));
      } else {
        blocks.push(para(tradeFallback(t)));
      }
      blocks.push(tradeTable(t));
    });
    sections.push({ heading: "Trades", blocks });
  }
  if (f.waivers.length) {
    f.waivers.forEach((w) => managers.add(w.team.managerName));
    facts.waivers = waiversPayload(f.waivers, faabBudget, waiverMode, mem.draftSlots);
    slots.push({
      id: "waivers",
      brief:
        waiverMode === "faab"
          ? "2 to 5 sentences on the waiver moves: $0 bids, overpays, losing bids, bad drops."
          : "2 to 5 sentences on the waiver moves: who lost a claim on waiver priority, roster-full misses, bad drops. There are no bids in this league.",
    });
    sections.push({
      heading: "Waivers",
      blocks: [
        slot("waivers", []),
        {
          type: "table",
          columns: ["Team", "Added", "Bid", "Other bids", "Dropped"],
          rows: f.waivers.map((w) => [
            label(w.team),
            w.added.map((p) => p.name).join(", "),
            byPriority(w) ? "Priority" : w.bid === null ? "Free agent" : money(w.bid),
            (w.losingBids as LosingBidLike[])
              .map((l) => `${l.team.managerName}${byPriority(w) ? "" : ` ${money(l.bid)}`}${l.reason === "roster_full" ? " (roster full)" : ""}`)
              .join(", "),
            w.dropped.map((p) => p.name).join(", "),
          ]),
        },
      ],
    });
  }
  if (f.lineupAlerts.length) {
    f.lineupAlerts.forEach((a) => managers.add(a.team.managerName));
    const why = { bye: "on a bye", out: "ruled out", ir: "on IR", doubtful: "doubtful", empty_slot: "nobody in the slot" } as const;
    facts.lineupAlerts = f.lineupAlerts.map((a) => ({ ...who(a.team), player: a.player.name, pos: a.player.position, slot: a.slot, why: a.reason }));
    slots.push({ id: "lineup", brief: "1 to 3 sentences shaming the lineup negligence below before kickoff." });
    sections.push({
      heading: "Fix your lineup",
      blocks: [
        slot("lineup", []),
        { type: "list", items: f.lineupAlerts.map((a) => `${label(a.team)}: ${a.reason === "empty_slot" ? `${a.slot} slot is empty` : `${a.player.name} (${a.slot}) is ${why[a.reason]}`}`) },
      ],
    });
  }
  if (f.injuries.length) {
    f.injuries.forEach((i) => managers.add(i.team.managerName));
    facts.injuries = f.injuries.map((i) => ({ ...who(i.team), player: i.player.name, pos: i.player.position, status: i.status, previous: i.previousStatus, starter: i.isStarter }));
    sections.push({
      heading: "Injury report",
      blocks: [{ type: "list", items: f.injuries.map((i) => `${i.player.name} (${label(i.team)}): ${i.previousStatus ?? "healthy"} to ${i.status}${i.isStarter ? ", starting" : ""}`) }],
    });
  }
  if (f.draftPicks.length) {
    f.draftPicks.forEach((p) => managers.add(p.team.managerName));
    facts.draftPicks = f.draftPicks.map((p) => pickPayload(p, mem.draft));
    if (mem.onTheClock) facts.onTheClock = mem.onTheClock;
    slots.push({
      id: "draft",
      brief: "2 to 5 sentences on the draft picks since the last issue: reaches, steals, who was passed on, runs, time on the clock, who is on the clock now.",
    });
    sections.push({ heading: "The draft", blocks: [slot("draft", []), draftPickTable(f.draftPicks)] });
  }
  return {
    kind: "daily_roast",
    title: ISSUE_TITLES.daily_roast,
    header: `ISSUE: ${ISSUE_TITLES.daily_roast}, ${f.date}`,
    task: "Write The Daily Roast: everything that happened in the league since the last issue. Only what is in FACTS.",
    slots,
    facts,
    sections,
    fallbackDek: dailyWorstFact(f) ?? (counts || "A quiet day."),
    week: null,
    managers: [...managers],
    placeholder: false,
  };
}

/* ------------------------------------------------------------------ */
/* Draft Grades                                                        */
/* ------------------------------------------------------------------ */

/** Roster-build summary for one team's draft (all computed, so the model never counts). */
export function draftSummary(own: DraftPickFact[]) {
  const byPosition: Record<string, number> = {};
  for (const p of own) byPosition[p.player.position || "?"] = (byPosition[p.player.position || "?"] ?? 0) + 1;
  const aged = own.filter((p) => p.player.age !== null);
  const oldest = [...aged].sort((a, b) => (b.player.age ?? 0) - (a.player.age ?? 0) || a.pickNo - b.pickNo)[0];
  const timed = own.filter((p) => p.secondsOnClock !== null);
  const slowest = [...timed].sort((a, b) => (b.secondsOnClock ?? 0) - (a.secondsOnClock ?? 0) || a.pickNo - b.pickNo)[0];
  return {
    byPosition,
    ...(aged.length ? { avgAge: r1(aged.reduce((s, p) => s + (p.player.age ?? 0), 0) / aged.length) } : {}),
    ...(oldest ? { oldestPick: { name: oldest.player.name, age: oldest.player.age, pick: pickLabel(oldest) } } : {}),
    unrankedCount: own.filter((p) => p.fcRank === null).length,
    ...(slowest ? { slowestPick: { name: slowest.player.name, pick: pickLabel(slowest), hoursOnClock: r1((slowest.secondsOnClock ?? 0) / 3600) } } : {}),
    ...(timed.length ? { totalHoursOnClock: r1(timed.reduce((s, p) => s + (p.secondsOnClock ?? 0), 0) / 3600) } : {}),
  };
}

export function planDraftGrades(f: DraftGradesFacts, mem: PayloadMemory = EMPTY_MEMORY): IssuePlan {
  const d: DraftFacts = f.draft;
  const grades = d.grades ?? [];
  const ranked = d.picks.filter((p) => p.reach !== null);
  const reaches = [...ranked].filter((p) => p.verdict === "reach").sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0) || a.pickNo - b.pickNo).slice(0, 5);
  const steals = [...ranked].filter((p) => p.verdict === "steal").sort((a, b) => (a.reach ?? 0) - (b.reach ?? 0) || a.pickNo - b.pickNo).slice(0, 5);
  const facts: Record<string, unknown> = { picks: d.picks.length, rounds: d.rounds, teams: d.teams };
  const slots: SlotSpec[] = [DEK_SLOT, { id: "cold-open", brief: "2 to 4 sentences on the draft as a whole: who won it, who should be embarrassed." }];
  const sections: PlannedSection[] = [];
  const top = grades[0];
  const bottom = grades[grades.length - 1];
  sections.push({
    heading: "The draft",
    blocks: [slot("cold-open", top && bottom ? [para(`Most value drafted: ${label(top.team)}, graded ${top.grade}. Least: ${label(bottom.team)}, graded ${bottom.grade}.`)] : [])],
  });
  if (grades.length) {
    sections.push({
      heading: "Grades",
      blocks: [
        { type: "note", text: "Grades compare each team's total FantasyCalc value drafted with the league average." },
        { type: "table", columns: ["Team", "Manager", "Grade", "Value drafted", "Rank"], rows: grades.map((g) => [g.team.teamName, g.team.managerName, g.grade, g.totalValue, g.valueRank]) },
      ],
    });
    const teamBlocks: PlannedBlock[] = [];
    for (const g of grades) {
      const id = `g-${g.team.rosterId}`;
      const own = d.picks.filter((p) => p.team.rosterId === g.team.rosterId);
      facts[id] = {
        ...who(g.team),
        grade: g.grade,
        totalValue: g.totalValue,
        valueRank: g.valueRank,
        firstPicks: own.slice(0, 6).map((p) => ({ pick: pickLabel(p), player: p.player.name, pos: p.player.position, age: p.player.age, fcRank: p.fcRank, reach: p.reach })),
        ...draftSummary(own),
        best: g.bestPick ? pickPayload(g.bestPick, mem.draft) : null,
        worst: g.worstPick ? pickPayload(g.worstPick, mem.draft) : null,
      };
      slots.push({ id, brief: `2 to 4 sentences grading ${g.team.managerName}'s draft. The grade is already decided: ${g.grade}.` });
      teamBlocks.push({ type: "heading", text: `${g.team.teamName} (${g.team.managerName}): ${g.grade}` });
      teamBlocks.push(slot(id, []));
      const lines = [
        g.bestPick ? `Best value: ${g.bestPick.player.name} at ${pickLabel(g.bestPick)}, FantasyCalc rank ${g.bestPick.fcRank}` : null,
        g.worstPick ? `Biggest reach: ${g.worstPick.player.name} at ${pickLabel(g.worstPick)}, FantasyCalc rank ${g.worstPick.fcRank}` : null,
      ].filter((x): x is string => Boolean(x));
      if (lines.length) teamBlocks.push({ type: "list", items: lines });
    }
    sections.push({ heading: "Team by team", blocks: teamBlocks });
  }
  facts.reaches = reaches.map((p) => pickPayload(p, mem.draft));
  facts.steals = steals.map((p) => pickPayload(p, mem.draft));
  facts.runs = d.positionRuns.map((r) => ({ pos: r.position, startPick: r.startPick, length: r.length }));
  if (reaches.length) sections.push({ heading: "Biggest reaches", blocks: [draftPickTable(reaches)] });
  if (steals.length) sections.push({ heading: "Biggest steals", blocks: [draftPickTable(steals)] });
  if (f.odds.teams.length) {
    facts.odds = oddsPayload(f.odds, mem);
    slots.push({ id: "odds", brief: "1 to 3 sentences on the projected season odds after the draft." });
    sections.push(oddsSection(f.odds, "Projected season odds", true));
  }
  return {
    kind: "draft_grades",
    title: ISSUE_TITLES.draft_grades,
    header: `ISSUE: ${ISSUE_TITLES.draft_grades}`,
    task: "Write Draft Grades for the draft that just finished: one verdict per team, using the grades and picks in FACTS.",
    slots,
    facts,
    sections,
    fallbackDek: top && bottom ? `Most value drafted: ${top.team.teamName} (${top.grade}). Least: ${bottom.team.teamName} (${bottom.grade}).` : `${d.picks.length} picks.`,
    week: null,
    managers: grades.map((g) => g.team.managerName),
    placeholder: d.placeholder || f.odds.placeholder,
  };
}
