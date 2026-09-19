/**
 * Post-checks on model output. Code, not the model, has the last word:
 *   - parseSlots: split the "@@slot-id" reply into slots
 *   - sanitize: plain text only, no markdown, no emoji, no em/en dashes or spaced hyphens
 *   - checkText: flag every sentence that
 *       states a league stat that is not in FACTS/LORE (rounding to fewer decimals ok). A number
 *         is a league stat when it has decimals (41.26, a pick label like 2.05), carries $ or %,
 *         is a digit ordinal (10th), or sits within a few words of a stat word (points, pick,
 *         spots, rank, round, record, streak, FAAB, value, age...) or of a manager, team or
 *         player name. Any other number is history or hyperbole ("1812", "six hundred thousand
 *         men", "200,000 miles") and is free.
 *       ties a FACTS number to the wrong person (decimals and numbers of 20 or more must sit in
 *         the same sentence as, or right after, a name from the same part of FACTS; "the
 *         commissioner" counts as naming him)
 *       makes an exact claim that is not that value: "17 spots early" or "a steal of 12" (that
 *         pick's reach), "age 29", "the 11th guy on the board" (fcRank), "has no quarterback"
 *         (his count at the position), "30 picks left" (his picksLeft), a time of day
 *         (onTheClock.resumesAt) or "round 5 opens" (the round in onTheClock.pick)
 *       claims a streak nobody named there has
 *       writes a score-like pair ("28-6") that FACTS does not contain word for word
 *       uses a box-score word FACTS never carries (touchdowns, yards, "7 catches"...)
 *       claims how long someone took to pick (FACTS has no pick times)
 *       uses the medical / school theme, a slur, banned filler, a word that announces the joke,
 *         a banned joke shape, or shouts in caps (an issue may pass one short all-caps rant
 *         sentence through CheckOptions.caps)
 *       brings out the cuck chair a second time (once per issue at most, CheckOptions.cuck)
 *   Profanity is allowed. Callers decide what a flagged sentence means (issues and items
 *   reject the whole slot).
 */
import {
  ANNOUNCE_TERMS,
  BANNED_FILLER,
  BANNED_SHAPES,
  BOX_SCORE_TERMS,
  CAPS_ALLOWED,
  CLOCK_CLAIMS,
  COUNTED_STATS,
  SELF_LABEL_TERMS,
  SLUR_TERMS,
  STAT_WORDS,
  THEME_TERMS,
  type BannedTerm,
} from "./banned";
import { noLongDashes } from "./format";

/* ------------------------------------------------------------------ */
/* numbers                                                             */
/* ------------------------------------------------------------------ */

/** Numeric tokens: "1,800", "41.26", "7", "$38" -> 1800, 41.26, 7, 38. Signs are ignored. */
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** A number a sentence states, with where it sits (character offsets into that text). */
export interface NumberHit {
  n: number;
  start: number;
  end: number;
}

function digitHits(text: string): NumberHit[] {
  const out: NumberHit[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const n = Number(m[0].replace(/,/g, ""));
    const start = m.index ?? 0;
    if (Number.isFinite(n)) out.push({ n, start, end: start + m[0].length });
  }
  return out;
}

export function numbersIn(text: string): number[] {
  return digitHits(text).map((h) => h.n);
}

const UNIT_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TEN_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL_WORDS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];
const UNITS = new Map(UNIT_WORDS.map((w, i) => [w, i + 1]));
const TENS = new Map(TEN_WORDS.map((w, i) => [w, (i + 2) * 10]));
const ORDINALS = new Map(ORDINAL_WORDS.map((w, i) => [w, i + 1]));
const MULTIPLES = new Map([
  ["twice", 2],
  ["thrice", 3],
]);
/** "six hundred thousand", "a million": scales multiply the number in front of them. */
const SCALES = new Map([
  ["thousand", 1_000],
  ["million", 1_000_000],
  ["billion", 1_000_000_000],
]);

/** "one" as a pronoun ("no one", "the one guy", "one of"), not a count. */
const ONE_PRONOUN_BEFORE = new Set(["no", "the", "any", "every", "some", "each", "which", "that", "this"]);
const ONE_PRONOUN_AFTER = new Set(["of", "another", "day", "way", "thing", "hand", "by"]);

/** The number a word (or word pair) spells, with how many tokens it used. */
function wordNumber(tokens: string[], i: number): { n: number; used: number } | null {
  const w = tokens[i];
  const next = tokens[i + 1];
  const prev = tokens[i - 1];
  if (TENS.has(w)) {
    const unit = next ? UNITS.get(next) : undefined;
    if (unit !== undefined && unit < 10) return { n: TENS.get(w)! + unit, used: 2 };
    return { n: TENS.get(w)!, used: 1 };
  }
  if (UNITS.has(w)) {
    const n = UNITS.get(w)!;
    if (next === "hundred") return { n: n * 100, used: 2 };
    if (next === "dozen") return { n: n * 12, used: 2 };
    if (w === "one" && ((prev && ONE_PRONOUN_BEFORE.has(prev)) || (next && ONE_PRONOUN_AFTER.has(next)))) return null;
    return { n, used: 1 };
  }
  if (w === "hundred") return { n: 100, used: 1 };
  if (w === "dozen") return { n: 12, used: 1 };
  if (SCALES.has(w)) return { n: SCALES.get(w)!, used: 1 };
  if (ORDINALS.has(w)) {
    // "a second" / "split second" is time; "second-guess" is a verb.
    if (w === "second" && (prev === "a" || prev === "split" || next === "guess" || next === "guessing" || next === "guessed")) return null;
    return { n: ORDINALS.get(w)!, used: 1 };
  }
  if (MULTIPLES.has(w)) return { n: MULTIPLES.get(w)!, used: 1 };
  return null;
}

function wordHits(text: string): NumberHit[] {
  const tokens = [...text.matchAll(/[A-Za-z’']+/g)].map((m) => ({
    w: m[0].toLowerCase().replace(/['’]s$/, ""),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const words = tokens.map((t) => t.w);
  const out: NumberHit[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = wordNumber(words, i);
    if (!hit) {
      i++;
      continue;
    }
    let { n, used } = hit;
    // "six hundred thousand": a scale after the number multiplies it (not after a lone scale).
    while (!SCALES.has(words[i]) && SCALES.has(words[i + used])) {
      n *= SCALES.get(words[i + used])!;
      used++;
    }
    out.push({ n, start: tokens[i].start, end: tokens[i + used - 1].end });
    i += used;
  }
  return out;
}

/** Numbers spelled out in words: "three", "twenty-four", "a dozen", "third", "twice". */
export function numberWordsIn(text: string): number[] {
  return wordHits(text).map((h) => h.n);
}

/** Every number a sentence states, in digits or in words, in reading order. */
function numberHits(text: string): NumberHit[] {
  return [...digitHits(text), ...wordHits(text)].sort((a, b) => a.start - b.start);
}

/** Every number a sentence states, in digits or in words. */
export function statedNumbers(text: string): number[] {
  return [...numbersIn(text), ...numberWordsIn(text)];
}

/* ------------------------------------------------------------------ */
/* league stats versus history and hyperbole                           */
/* ------------------------------------------------------------------ */

/** Stands in for a FACTS name (manager, team, player) while a sentence is checked. */
const NAME_MARK = "\u0001";
/** How many words on each side of a number decide whether it is a league stat. */
export const STAT_WINDOW = 5;

/** A stat word (lib/roast/banned.ts STAT_WORDS; the prompt lists the same words). Hyperbole never needs one. */
const STAT_CONTEXT_RE = new RegExp(`(?<![a-z0-9])(?:${STAT_WORDS.map((w) => w.source).join("|")})(?![a-z0-9])`, "i");

/**
 * Whether the number at `h` in `text` (names already replaced by NAME_MARK) reads as a league
 * stat: decimals (41.26, pick 2.05), $ or %, "No. 5" or "#5", a digit ordinal (10th), or a stat
 * word or a name within STAT_WINDOW words.
 */
function isLeagueStat(text: string, h: NumberHit): boolean {
  if (text.slice(h.start, h.end).includes(".")) return true;
  const before = text.slice(Math.max(0, h.start - 4), h.start);
  const after = text.slice(h.end, h.end + 8);
  if (/(?:[$#]|\bno\.)\s*$/i.test(before)) return true;
  if (/^\s*%/.test(after) || /^(?:st|nd|rd|th)(?![a-z])/i.test(after)) return true;
  const words = [...text.matchAll(/\S+/g)];
  const first = words.findIndex((w) => (w.index ?? 0) + w[0].length > h.start);
  if (first < 0) return false;
  let last = first;
  while (last + 1 < words.length && (words[last + 1].index ?? 0) < h.end) last++;
  const around = words
    .slice(Math.max(0, first - STAT_WINDOW), last + STAT_WINDOW + 1)
    .map((w) => w[0])
    .join(" ");
  return around.includes(NAME_MARK) || STAT_CONTEXT_RE.test(around);
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const roundings = (n: number) => [n, Math.round(n * 10) / 10, Math.round(n)];
const key = (n: number) => String(Math.round(n * 1e6) / 1e6);

/* ------------------------------------------------------------------ */
/* names and bindings from the FACTS payload                           */
/* ------------------------------------------------------------------ */

/** Keys whose string value names the manager, team or player an object is about. */
const NAME_KEYS = new Set(["manager", "team", "name", "player"]);
/** Other keys whose string value is a name (used for masking only, never as an owner). */
const REF_KEYS = new Set(["lostTo", "winner"]);
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

interface NameRef {
  /** Lowercased full name. */
  full: string;
  /** Lowercased surname of a player ("brown" for "A.J. Brown"), when it is distinctive. */
  short: string | null;
}

function nameRef(value: string, isPlayer: boolean): NameRef {
  const full = value.trim().toLowerCase();
  let short: string | null = null;
  if (isPlayer) {
    const parts = full.split(/\s+/).filter(Boolean);
    while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last && last.replace(/[^a-z]/g, "").length >= 3) short = last;
  }
  return { full, short };
}

function contains(textLower: string, s: string): boolean {
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(textLower);
}

function mentions(textLower: string, n: NameRef): boolean {
  return (n.full.length > 0 && contains(textLower, n.full)) || (n.short !== null && contains(textLower, n.short));
}

interface Streak {
  count: number;
  names: NameRef[];
}

/** FACTS keys whose values a specific claim shape must match exactly (see `badClaimsIn`). */
type ClaimKey = "reach" | "fcRank" | "age" | "picksLeft" | "roundsLeft" | "posCount";

/** One FACTS value a claim can be checked against. */
interface ClaimRecord {
  key: ClaimKey;
  /** Absolute value (a steal of 12 is written "12 spots late"). */
  n: number;
  /** Who the value is about: the player for reach, fcRank and age; the manager for counts. */
  subject: NameRef | null;
  /** Every name the value sits under in FACTS, the subject included. */
  chain: NameRef[];
  /** Position, for position counts ("QB"). */
  pos?: string;
}

const COUNT_POSITIONS = ["QB", "RB", "WR", "TE"];

/**
 * Everything the checks need from FACTS and LORE: the allowed numbers (with their roundings),
 * which names each number belongs to, every name (to keep "A.J. Brown" in one sentence), and
 * the streaks. JSON sources are walked; anything else only contributes numbers.
 */
export class AllowedNumbers {
  private readonly values: number[];
  /** Numbers that appear somewhere with no owner (a margin, a week): allowed anywhere. */
  private readonly free = new Set<string>();
  /** Numbers owned by names: allowed only next to one of them. */
  private readonly bound = new Map<string, NameRef[][]>();
  private readonly nameList: string[];
  /** Player surnames as written ("Brown" for "A.J. Brown"), matched case-sensitively. */
  private readonly surnames: string[];
  private readonly streaks: Streak[] = [];
  /** Values that claim shapes ("17 spots early", "age 29", "30 picks left") must match exactly. */
  private readonly claims: ClaimRecord[] = [];
  /** The round in onTheClock.pick: the only round that "resumes" or "opens". */
  private readonly clockRounds: number[] = [];
  /** Times of day FACTS/LORE states ("8 AM ET"), normalized like "8:00am". */
  private readonly times: Set<string>;
  /** The commissioner's first name (FACTS "commissioner"): "the commissioner" in a sentence names him. */
  private commissioner: string | null = null;
  /** FACTS and LORE text, for word-for-word checks. */
  readonly text: string;

  constructor(sources: string[]) {
    const set = new Set<number>();
    for (const s of sources) for (const n of numbersIn(s)) for (const r of roundings(n)) set.add(r);
    this.values = [...set];
    this.text = sources.join("\n");
    const names = new Set<string>();
    const surnames = new Set<string>();
    for (const s of sources) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(s);
      } catch {
        for (const n of numbersIn(s)) this.record(n, []);
        continue;
      }
      this.walk(parsed, [], names, surnames);
    }
    this.nameList = [...names].sort((a, b) => b.length - a.length);
    this.surnames = [...surnames].filter((x) => !names.has(x)).sort((a, b) => b.length - a.length);
    this.times = new Set(clockTimesIn(this.text).map((t) => t.norm));
  }

  /** `text` lowercased for name matching, with "the commissioner" standing for his first name. */
  private scope(text: string): string {
    const t = text.toLowerCase().replace(/\u2019/g, "'");
    return this.commissioner ? t.replace(/\b(?:the\s+)?commissioner\b/g, this.commissioner.toLowerCase()) : t;
  }

  /** The claimable values on one FACTS object (a pick, a player, a manager's draft so far). */
  private recordClaims(obj: Record<string, unknown>, chain: NameRef[]): void {
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const nested = obj.player && typeof obj.player === "object" ? (obj.player as Record<string, unknown>) : null;
    const playerName = str(obj.player) ?? str(nested?.name) ?? str(obj.name);
    const player = playerName ? nameRef(playerName, true) : null;
    const managerName = str(obj.manager);
    const manager = managerName ? nameRef(managerName, false) : null;
    const withPlayer = player && !chain.some((r) => r.full === player.full) ? [...chain, player] : chain;
    const add = (key: ClaimKey, v: unknown, subject: NameRef | null, pos?: string) => {
      if (typeof v === "number" && Number.isFinite(v)) this.claims.push({ key, n: Math.abs(v), subject, chain: key === "roundsLeft" ? [] : withPlayer, ...(pos ? { pos } : {}) });
    };
    add("reach", obj.reach, player);
    add("fcRank", obj.fcRank, player);
    add("age", obj.age, player);
    add("picksLeft", obj.picksLeft, manager);
    add("roundsLeft", obj.roundsLeft, null);
    const pos = str(nested?.pos) ?? str(obj.pos);
    if (manager && pos) add("posCount", obj.posCountForManager, manager, pos.toUpperCase());
    const byPos = obj.byPosition;
    if (manager && byPos && typeof byPos === "object" && !Array.isArray(byPos)) {
      const counts = byPos as Record<string, unknown>;
      for (const p of new Set([...COUNT_POSITIONS, ...Object.keys(counts)])) add("posCount", typeof counts[p] === "number" ? counts[p] : 0, manager, p.toUpperCase());
    }
  }

  /**
   * The FACTS values a claim in `sentence` can be about: values on a player named there whose
   * manager or team is named too, else anything about a player or manager named there, else
   * the same in the sentence before. Null when FACTS has no such values at all (nothing to
   * check), [] when no name is in reach (history, or a claim floating free of its owner).
   */
  private claimCandidates(key: ClaimKey, sentence: string, previous: string, pos?: string): ClaimRecord[] | null {
    const recs = this.claims.filter((r) => r.key === key && (pos === undefined || r.pos === pos));
    if (!recs.length) return null;
    // A count (picks left, players at a position) belongs to one manager: only his own name counts.
    const managerOnly = key === "posCount" || key === "picksLeft";
    for (const scope of [sentence, previous]) {
      const t = this.scope(scope);
      if (!t.trim()) continue;
      const named = (r: ClaimRecord) => r.subject !== null && mentions(t, r.subject);
      if (managerOnly) {
        const own = recs.filter(named);
        if (own.length) return own;
        continue;
      }
      const owner = (r: ClaimRecord) => r.chain.some((ref) => ref !== r.subject && ref.full !== r.subject?.full && mentions(t, ref));
      const both = recs.filter((r) => named(r) && owner(r));
      if (both.length) return both;
      const loose = recs.filter((r) => named(r) || r.chain.some((ref) => mentions(t, ref)));
      if (loose.length) return loose;
    }
    return [];
  }

  /**
   * Claims whose exact value FACTS pins down, checked against the value itself rather than
   * "the number is somewhere in FACTS": spot counts must be that pick's reach, ages that
   * player's age, FantasyCalc ranks that player's rank, picks or rounds left that manager's
   * picksLeft (or onTheClock.roundsLeft), position counts that manager's count, a time of day
   * onTheClock.resumesAt, and a round that opens or resumes the round in onTheClock.pick.
   */
  badClaimsIn(sentence: string, previous = ""): string[] {
    const out: string[] = [];
    const check = (what: string, n: number, key: ClaimKey, extra: number[] = [], pos?: string) => {
      const c = this.claimCandidates(key, sentence, previous, pos);
      if (c === null || !c.length) return;
      const ok = [...new Set([...c.map((r) => r.n), ...extra])];
      if (!ok.some((v) => eq(v, n))) out.push(`"${what}" does not match FACTS (${ok.sort((a, b) => a - b).join(" or ")})`);
    };
    for (const m of claimMatches(sentence, SPOT_CLAIMS)) check(m.text, m.n, "reach");
    for (const m of claimMatches(sentence, AGE_CLAIMS)) check(m.text, m.n, "age");
    for (const m of claimMatches(sentence, RANK_CLAIMS)) check(m.text, m.n, "fcRank");
    for (const m of claimMatches(sentence, POS_CLAIMS)) {
      const pos = positionCode(m.extra ?? "");
      if (!pos) continue;
      check(m.text, m.n, "posCount", [], pos);
    }
    for (const m of claimMatches(sentence, LEFT_CLAIMS)) {
      const rounds = this.claims.filter((r) => r.key === "roundsLeft").map((r) => r.n);
      const mine = this.claimCandidates("picksLeft", sentence, previous);
      if (mine === null && !rounds.length) continue;
      // A named manager's picks (or rounds) left are his own; with nobody named, the draft's rounds left.
      const ok = mine && mine.length ? mine.map((r) => r.n) : /round/i.test(m.extra ?? "") ? rounds : [];
      if (!ok.some((v) => eq(v, m.n))) out.push(`"${m.text}" does not match FACTS (${ok.length ? ok.join(" or ") : "no such count"})`);
    }
    for (const m of claimMatches(sentence, ROUND_CLAIMS)) {
      if (!this.clockRounds.some((r) => r === m.n)) out.push(`"${m.text}" is not the round on the clock (${this.clockRounds.join(" or ") || "none"})`);
    }
    const times = clockTimesIn(sentence);
    if (times.length && (this.markNames(sentence).includes(NAME_MARK) || DRAFT_TIME_CONTEXT.test(sentence))) {
      for (const t of times) {
        if (!this.times.has(t.norm)) out.push(`"${t.text}" is not a time FACTS gives${this.times.size ? "" : " (FACTS has none)"}`);
      }
    }
    return out;
  }

  /** Whether `text` names anyone in FACTS (a manager, team or player). */
  namesSomeone(text: string): boolean {
    return this.markNames(text).includes(NAME_MARK);
  }

  private record(n: number, chain: NameRef[]): void {
    // Signs are ignored everywhere (a net of -1830 is written "lost 1830").
    for (const r of roundings(Math.abs(n))) {
      const k = key(r);
      if (!chain.length) this.free.add(k);
      else this.bound.set(k, [...(this.bound.get(k) ?? []), chain]);
    }
  }

  private walk(node: unknown, chain: NameRef[], names: Set<string>, surnames: Set<string>): void {
    if (Array.isArray(node)) {
      for (const x of node) this.walk(x, chain, names, surnames);
      return;
    }
    if (typeof node === "number") return this.record(node, chain);
    if (typeof node === "string") {
      for (const n of numbersIn(node)) this.record(n, chain);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const own: NameRef[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (k === "commissioner" && !this.commissioner) this.commissioner = v.trim();
      if (NAME_KEYS.has(k)) {
        const isPlayer = k === "name" || k === "player";
        own.push(nameRef(v, isPlayer));
        names.add(v.trim());
        if (isPlayer) {
          const parts = v.trim().split(/\s+/);
          while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
          const last = parts[parts.length - 1];
          if (parts.length > 1 && last.replace(/[^A-Za-z]/g, "").length >= 3) surnames.add(last);
        }
      } else if (REF_KEYS.has(k)) names.add(v.trim());
    }
    // A pick's own numbers (its label, pick number, rank, reach) belong to the player it took too.
    const nested = obj.player && typeof obj.player === "object" && !Array.isArray(obj.player) ? (obj.player as Record<string, unknown>).name : undefined;
    if (typeof nested === "string" && nested.trim()) own.push(nameRef(nested, true));
    const here = own.length ? [...chain, ...own] : chain;
    this.recordClaims(obj, here);
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && (NAME_KEYS.has(k) || REF_KEYS.has(k))) continue;
      if (k === "onTheClock" && v && typeof v === "object") {
        const pick = (v as Record<string, unknown>).pick;
        const round = typeof pick === "string" ? Number(/^(\d+)\./.exec(pick)?.[1]) : NaN;
        if (Number.isInteger(round)) this.clockRounds.push(round);
      }
      if (k === "streak" && typeof v === "string") {
        const m = /^(\d+)[WLT]$/.exec(v);
        if (m) this.streaks.push({ count: Number(m[1]), names: here });
      }
      // Rounds left belong to the whole draft, not to the manager on the clock.
      this.walk(v, k === "roundsLeft" ? [] : here, names, surnames);
    }
  }

  has(n: number): boolean {
    return this.values.some((v) => eq(v, n));
  }

  /**
   * `text` with every FACTS name replaced by NAME_MARK, so a team called "Seven Seas" or
   * "Team 2" does not count as a number the sentence states, and so a number next to a name
   * reads as a league stat. Player surnames on their own ("Holloway") count as names too.
   */
  private markNames(text: string): string {
    const mark = ` ${NAME_MARK} `;
    let out = text.replace(/\u2019/g, "'");
    const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['\u2019]");
    for (const n of this.nameList) {
      if (n.length < 3) continue;
      out = out.replace(new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, "gi"), mark);
    }
    for (const n of this.surnames) out = out.replace(new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, "g"), mark);
    if (this.commissioner) out = out.replace(/(?<![A-Za-z0-9])(?:the\s+)?commissioner(?![A-Za-z0-9])/gi, mark);
    return out;
  }

  /**
   * The league stats `text` states (digits or words): numbers with decimals, $ or %, digit
   * ordinals, and numbers near a stat word or a name. History and hyperbole are left out.
   */
  statNumbersIn(text: string): number[] {
    const marked = this.markNames(text);
    return numberHits(marked)
      .filter((h) => isLeagueStat(marked, h))
      .map((h) => h.n);
  }

  /** League stats in `text` that FACTS/LORE does not have. */
  unknownIn(text: string): number[] {
    return this.statNumbersIn(text).filter((n) => !this.has(n));
  }

  /** Every name in FACTS, longest first (to keep periods inside names like "A.J. Brown"). */
  get names(): string[] {
    return this.nameList;
  }

  /**
   * League stats stated in `sentence` that belong to someone not named in it or in the
   * sentence before it. Only decimals and numbers of 20 or more are checked: small integers
   * (ranks, counts, weeks) are everywhere.
   */
  unboundIn(sentence: string, previous = ""): number[] {
    const scope = this.scope(`${previous}\n${sentence}`);
    const out: number[] = [];
    for (const n of this.statNumbersIn(sentence)) {
      if (Number.isInteger(n) && n < 20) continue;
      const k = key(n);
      if (this.free.has(k)) continue;
      const owners = this.bound.get(k);
      if (!owners) continue; // only inside a name or a key: nothing to bind it to
      if (!owners.some((chain) => chain.some((ref) => mentions(scope, ref)))) out.push(n);
    }
    return out;
  }

  /** Streak claims ("lost 4 straight", "third straight loss") no team named there has. */
  badStreaksIn(sentence: string, previous = ""): number[] {
    const scope = this.scope(`${previous}\n${sentence}`);
    return streakClaims(sentence).filter((n) => !this.streaks.some((s) => s.count === n && s.names.some((ref) => mentions(scope, ref))));
  }
}

/* ------------------------------------------------------------------ */
/* streaks, score pairs, caps                                          */
/* ------------------------------------------------------------------ */

const NUM_WORD = `\\d+|${[...UNIT_WORDS, ...TEN_WORDS, ...ORDINAL_WORDS].join("|")}`;
const STREAK_RES = [
  new RegExp(`\\b(${NUM_WORD})(?:\\s+|-)(?:game\\s+)?(?:straight|consecutive)\\b`, "gi"),
  new RegExp(`\\b(${NUM_WORD})\\s+(?:(?:losses|wins|games|weeks|ls|ws|l's|w's)\\s+)?in\\s+a\\s+row\\b`, "gi"),
  new RegExp(`\\b(${NUM_WORD})[-\\s]game\\s+(?:losing\\s+|winning\\s+)?(?:streak|skid|slide)\\b`, "gi"),
  new RegExp(`\\b(?:losing|winning)\\s+(?:streak|skid)\\s+(?:of|to|at)\\s+(${NUM_WORD})\\b`, "gi"),
];

function toNumber(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return UNITS.get(t) ?? TENS.get(t) ?? ORDINALS.get(t) ?? null;
}

/** Streak lengths a sentence claims. */
export function streakClaims(sentence: string): number[] {
  const out = new Set<number>();
  for (const re of STREAK_RES) {
    for (const m of sentence.matchAll(re)) {
      const n = toNumber(m[1]);
      if (n !== null) out.add(n);
    }
  }
  return [...out];
}

/** Score-like pairs such as "28-6" or "8-1-1" (not "30-year-old", not "-1830"). */
const PAIR_RE = /(?<![\d.,$-])\d+-\d+(?:-\d+)?(?![\d-]|\.\d)/g;

/** Score-like pairs in `sentence` that `factsText` does not contain word for word. */
export function pairsNotIn(sentence: string, factsText: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(PAIR_RE)) {
    const pair = m[0];
    if (!new RegExp(`(?<![\\d.-])${pair.replace(/-/g, "\\-")}(?![\\d-])`).test(factsText)) out.push(pair);
  }
  return out;
}

/** Words of 3+ letters in all caps that FACTS/LORE does not use (team abbreviations do). */
export function shoutingIn(sentence: string, exempt: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/(?<![A-Za-z0-9])[A-Z]{3,}(?![A-Za-z0-9])/g)) {
    const w = m[0];
    if (CAPS_ALLOWED.has(w) || new RegExp(`(?<![A-Za-z0-9])${w}(?![A-Za-z0-9])`).test(exempt)) continue;
    out.push(w);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* exact claims (spots, ages, ranks, counts, picks left, times, rounds) */
/* ------------------------------------------------------------------ */

const CARD_WORDS = [...TEN_WORDS.map((t) => `${t}(?:[-\\s](?:${UNIT_WORDS.slice(0, 9).join("|")}))?`), ...UNIT_WORDS, "zero"];
/** A cardinal as a claim writes it: "1,200", "17", "seventeen", "twenty-four" (never part of a decimal or pick label). */
const CARD = `\\d{1,3}(?:,\\d{3})+(?![\\d.])|\\d+(?!\\d|[.,]\\d)|(?:${CARD_WORDS.join("|")})(?![a-z])`;
/** An ordinal: "11th", "eleventh". */
const ORD = `\\d+(?:st|nd|rd|th)(?![a-z])|(?:${ORDINAL_WORDS.join("|")})(?![a-z])`;
const POS_WORDS = "quarterbacks?|qbs?|running\\s+backs?|rbs?|(?:wide\\s+)?receivers?|wideouts?|wrs?|tight\\s+ends?|tes?";
const NOT_A_POSITION = "(?!\\s*(?:quarterback|qb|running|rb|receiver|wr|wide|tight|te)s?\\b)";
const HIS = "(?:his|her|their|fantasycalc(?:['’]s)?)";

interface ClaimShape {
  re: RegExp;
  /** Capture groups that may hold the number (the first one that matched is used). */
  groups: number[];
  /** Capture group with the thing counted (a position, "picks" or "rounds"). */
  extra?: number;
}

/** "17 spots early", "an 11-spot reach", "reached 11 spots", "a steal of 12": a pick's reach. */
const SPOT_CLAIMS: ClaimShape[] = [
  {
    re: new RegExp(`\\b(${CARD})(?:\\s+|-)spots?\\s+(?:too\\s+)?(?:early|late|deep|high|higher|sooner|reach|steal|before\\s+${HIS}|ahead\\s+of\\s+${HIS}|past\\s+${HIS})\\b`, "gi"),
    groups: [1],
  },
  { re: new RegExp(`\\breach(?:ed|es|ing)?\\s+(?:of\\s+|by\\s+)?(${CARD})\\b`, "gi"), groups: [1] },
  { re: new RegExp(`\\bsteal\\s+of\\s+(${CARD})\\b`, "gi"), groups: [1] },
  { re: new RegExp(`\\bfell\\s+(${CARD})\\s+spots?\\b`, "gi"), groups: [1] },
];

/** "age 29", "a 30-year-old": that player's age. */
const AGE_CLAIMS: ClaimShape[] = [
  { re: new RegExp(`\\bage[sd]?\\s+(${CARD})\\b`, "gi"), groups: [1] },
  { re: new RegExp(`\\b(${CARD})(?:-|\\s+)years?(?:-|\\s+)old\\b`, "gi"), groups: [1] },
];

/** "the 11th guy on the board", "FantasyCalc's number one", "a receiver FantasyCalc ranks 31st": that player's fcRank. */
const RANK_CLAIMS: ClaimShape[] = [
  {
    re: new RegExp(`\\b(${ORD})[-\\s]+(?:best\\s+|ranked\\s+)?(?:guy|player|man|name|option)\\s+(?:on|in)\\s+(?:the|his|fantasycalc(?:['’]s)?)\\s+(?:big\\s+)?(?:board|list|rankings)\\b`, "gi"),
    groups: [1],
  },
  { re: new RegExp(`\\bfantasycalc(?:['’]s)?\\s+(?:number\\s+(${CARD})|no\\.\\s*(\\d+)|#\\s*(\\d+))${NOT_A_POSITION}`, "gi"), groups: [1, 2, 3] },
  { re: new RegExp(`\\bfantasycalc(?:['’]s)?\\s+(${ORD})[-\\s]best\\b${NOT_A_POSITION}`, "gi"), groups: [1] },
  { re: new RegExp(`\\bfantasycalc\\s+ranks?\\s+(?:him\\s+|them\\s+|it\\s+)?(${ORD}|${CARD})(?!\\s+(?:at|among|in)\\b)`, "gi"), groups: [1] },
  { re: new RegExp(`\\b(${ORD})-ranked\\b${NOT_A_POSITION}`, "gi"), groups: [1] },
  { re: new RegExp(`\\bnumber\\s+(${CARD})\\s+(?:player|overall|guy|name)\\b`, "gi"), groups: [1] },
];

/** "has no quarterback", "owns one quarterback", "his second running back": that manager's count at the position. */
const POS_CLAIMS: ClaimShape[] = [
  {
    re: new RegExp(
      `\\b(?:has|have|had|owns?|owned|holds?|held|rosters?|rostered|drafted|took|taken|picked|carries|carrying|got|gets)\\s+(?:only\\s+|just\\s+|exactly\\s+|now\\s+|still\\s+)?(${CARD}|no(?![a-z]))\\s+(?:more\\s+|other\\s+|real\\s+|starting\\s+|healthy\\s+)?(${POS_WORDS})\\b`,
      "gi",
    ),
    groups: [1],
    extra: 2,
  },
  { re: new RegExp(`\\bhis\\s+(${ORD})\\s+(${POS_WORDS})\\b`, "gi"), groups: [1], extra: 2 },
];

/** "30 picks left", "31 rounds to go": that manager's picksLeft, or the draft's roundsLeft. */
const LEFT_CLAIMS: ClaimShape[] = [
  { re: new RegExp(`\\b(${CARD})\\s+(?:more\\s+)?(picks?|rounds?|chances|tries|shots)\\s+(?:left|to\\s+go|remaining)\\b`, "gi"), groups: [1], extra: 2 },
];

/** "Round 5 opens", "resumes with round 4": only the round in onTheClock.pick opens or resumes. */
const ROUND_VERBS = "opens|open|starts|start|begins|begin|resumes|resume|restarts|restart|continues|kicks\\s+off|picks\\s+up|gets\\s+going|is\\s+back";
const ROUND_CLAIMS: ClaimShape[] = [
  { re: new RegExp(`\\bround\\s+(${CARD})\\s+(?:will\\s+)?(?:${ROUND_VERBS})\\b`, "gi"), groups: [1] },
  { re: new RegExp(`\\b(?:${ROUND_VERBS})\\s+(?:with\\s+|at\\s+|in\\s+)?round\\s+(${CARD})\\b`, "gi"), groups: [1] },
  { re: new RegExp(`\\b(${ORD})\\s+round\\s+(?:will\\s+)?(?:${ROUND_VERBS})\\b`, "gi"), groups: [1] },
];

/** A sentence about the draft or a league member, so a time of day in it is a league claim, not history. */
const DRAFT_TIME_CONTEXT = /\b(?:picks?|draft(?:ing)?|resum\w*|rounds?|clock|opens?|starts?)\b/i;

/** The number a claim token spells: "17", "11th", "seventeen", "twenty-four", "no". */
function claimNumber(token: string): number | null {
  const t = token.toLowerCase().replace(/,/g, "").trim();
  if (/^\d+(?:st|nd|rd|th)?$/.test(t)) return parseInt(t, 10);
  if (t === "no" || t === "zero") return 0;
  const parts = t.split(/[-\s]+/);
  if (parts.length === 2 && TENS.has(parts[0]) && UNITS.has(parts[1])) return TENS.get(parts[0])! + UNITS.get(parts[1])!;
  return UNITS.get(t) ?? TENS.get(t) ?? ORDINALS.get(t) ?? null;
}

function claimMatches(sentence: string, shapes: ClaimShape[]): Array<{ text: string; n: number; extra?: string }> {
  const out: Array<{ text: string; n: number; extra?: string }> = [];
  for (const shape of shapes) {
    for (const m of sentence.matchAll(new RegExp(shape.re.source, shape.re.flags))) {
      const token = shape.groups.map((g) => m[g]).find((x) => x !== undefined);
      const n = token === undefined ? null : claimNumber(token);
      if (n !== null) out.push({ text: m[0].trim(), n, ...(shape.extra ? { extra: m[shape.extra] } : {}) });
    }
  }
  return out;
}

/** "quarterbacks" -> "QB". */
function positionCode(word: string): string | null {
  const w = word.toLowerCase();
  if (/^(?:quarterback|qb)/.test(w)) return "QB";
  if (/^(?:running|rb)/.test(w)) return "RB";
  if (/(?:receiver|wideout|^wr)/.test(w)) return "WR";
  if (/^(?:tight|te)/.test(w)) return "TE";
  return null;
}

/** Times of day ("8 AM", "10:30 p.m."), normalized like "8:00am". */
export function clockTimesIn(text: string): Array<{ text: string; norm: string }> {
  const out: Array<{ text: string; norm: string }> = [];
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/gi)) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) continue;
    out.push({ text: m[0].trim(), norm: `${h}:${m[2] ?? "00"}${m[3].toLowerCase()}m` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* words                                                               */
/* ------------------------------------------------------------------ */

const hits = (terms: BannedTerm[], text: string, exempt?: string) =>
  terms.filter((t) => t.re.test(text) && (exempt === undefined || !t.re.test(exempt))).map((t) => t.label);

/** Theme words, joke-announcing words and "cooked"/"got burned" (unless FACTS/LORE uses them), slurs and banned filler. */
export function bannedWordsIn(text: string, exempt = ""): string[] {
  return [
    ...hits(THEME_TERMS, text, exempt),
    ...hits(ANNOUNCE_TERMS, text, exempt),
    ...hits(SELF_LABEL_TERMS, text, exempt),
    ...new Set(hits(SLUR_TERMS, text)),
    ...hits(BANNED_FILLER, text),
  ];
}

/** Claims about how long a manager took to pick: FACTS has no pick times. */
export function clockClaimsIn(sentence: string): string[] {
  return CLOCK_CLAIMS.filter((re) => re.test(sentence)).length ? ["a claim about time on the clock (FACTS has no pick times)"] : [];
}

/** Box-score stat words FACTS/LORE never uses, and "<number> catches"-style counts. */
export function boxScoreIn(text: string, exempt = ""): string[] {
  const out = hits(BOX_SCORE_TERMS, text, exempt);
  const counted = new RegExp(`\\b(?:${NUM_WORD})\\s+(${COUNTED_STATS.join("|")})\\b`, "gi");
  for (const m of text.matchAll(counted)) {
    if (!new RegExp(`\\b${m[1]}\\b`, "i").test(exempt)) out.push(m[0].toLowerCase());
  }
  return out;
}

/** Banned joke shapes ("not X, it is Y", "Imagine..."). */
export function shapesIn(sentence: string): string[] {
  return hits(BANNED_SHAPES, sentence);
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

/** Plain text: strip markdown decoration, emoji and forbidden dashes; normalize whitespace. */
export function sanitize(text: string): string {
  let s = text.replace(/\r\n?/g, "\n");
  s = s.replace(/\p{Extended_Pictographic}️?/gu, "");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");
  s = s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  s = s.replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2");
  s = s.replace(/`+/g, "");
  s = noLongDashes(s);
  // The dash models fall back on once em dashes are gone: a hyphen with spaces around it.
  s = s.replace(/(\d)[ \t]+-{1,2}[ \t]+(\d)/g, "$1-$2").replace(/[ \t]+-{1,2}[ \t]+/g, ", ").replace(/,\s*,/g, ",");
  s = s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Abbreviations that never end a sentence ("St. Brown", "Mrs. Doubtfire", "vs. Kevin"). */
const NO_SPLIT_ABBR = /^\(?(?:St|Jr|Sr|Mr|Mrs|Ms|Dr|vs|Mt|Ft)\.$/;
/** Words before a lone capital letter that make it a grade ("gets a D."), not an initial. */
const GRADE_LEAD = new Set(["a", "an", "grade", "graded", "gets", "got", "earns", "earned", "the", "his", "her", "their"]);
const MASK = "\u0000";

/**
 * Split a paragraph into sentences. Keeps decimals (41.26), initials (A.J. Brown, C.J. Stroud),
 * abbreviations (Amon-Ra St. Brown, Mrs.), "No. 1" and every name in `names` in one piece.
 */
export function splitSentences(paragraph: string, names: string[] = []): string[] {
  let text = paragraph;
  for (const n of names) if (n.includes(".")) text = text.split(n).join(n.replace(/\./g, MASK));
  const parts: string[] = [];
  let start = 0;
  for (const m of text.matchAll(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9$])/g)) {
    const end = m.index ?? 0;
    const before = text.slice(start, end);
    const lastWord = /(\S+)$/.exec(before)?.[1] ?? "";
    if (NO_SPLIT_ABBR.test(lastWord)) continue;
    if (lastWord === "No." && /^\d/.test(text.slice(end + m[0].length))) continue;
    if (/^(?:[A-Z]\.){2,}$/.test(lastWord)) continue; // "A.J." "C.J."
    if (/^[A-Z]\.$/.test(lastWord)) {
      const prev = (/(\S+)\s+\S+$/.exec(before)?.[1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (!GRADE_LEAD.has(prev)) continue; // an initial ("D.J. Moore" written "D. Moore"), not "a D."
    }
    parts.push(text.slice(start, end));
    start = end + m[0].length;
  }
  parts.push(text.slice(start));
  return parts.map((s) => s.split(MASK).join(".").trim()).filter(Boolean);
}

export interface Dropped {
  sentence: string;
  /** League stats FACTS/LORE does not have. */
  unknownNumbers: number[];
  /** Theme words, slurs, joke-announcing words and banned filler. */
  bannedWords: string[];
  /** Everything else: numbers tied to the wrong person, invented streaks, scores or pick times, box-score words, shapes, caps. */
  problems: string[];
}

export interface CheckedText {
  /** Paragraphs that survived, joined by blank lines. */
  text: string;
  kept: number;
  dropped: Dropped[];
  /** Sentences in the sanitized text, kept or not. */
  sentences: number;
  /** Whether the text's last sentence (its punchline) was dropped. */
  lastDropped: boolean;
  /** All-caps sentences let through on the issue's caps allowance. */
  capsUsed: number;
  /** Cuck-chair sentences let through on the cuck allowance. */
  cuckUsed: number;
}

export interface CheckOptions {
  /**
   * The issue's all-caps allowance (one rant sentence per issue: at most CAPS_RANT_WORDS words,
   * naming someone in FACTS). Shared across an issue's slots in reading order; items and the
   * headline pass none, so caps always fail there. Decremented for each sentence it lets through.
   */
  caps?: { left: number };
  /**
   * The cuck chair allowance (the persona: at most once per issue). Shared across an issue's
   * slots in reading order like `caps`; without one, a single text gets one. A team or player
   * in FACTS whose own name has the word is exempt: saying that name is not the joke. LORE
   * mentioning it exempts nothing.
   */
  cuck?: { left: number };
}

/** The longest all-caps rant sentence the caps allowance lets through. */
export const CAPS_RANT_WORDS = 10;

/** The cuck chair, in any form ("cuck", "cucked", "cuckold"), never "cuckoo". */
export const CUCK_RE = /\bcuck(?!oo)/i;

/**
 * Whether `text` brings out the cuck chair, not counting a FACTS name (a team or player) that
 * really has the word in it.
 */
export function cuckChairIn(text: string, names: readonly string[] = []): boolean {
  if (!CUCK_RE.test(text)) return false;
  let t = text;
  for (const n of names) {
    if (!n.trim() || !CUCK_RE.test(n)) continue;
    t = t.replace(new RegExp(n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return CUCK_RE.test(t);
}

/** Flag every sentence that fails a check; `text` holds only the ones that passed. */
export function checkText(text: string, allowed: AllowedNumbers, exempt = "", opts: CheckOptions = {}): CheckedText {
  const paragraphs = sanitize(text).split(/\n{2,}/);
  const keptParas: string[] = [];
  const dropped: Dropped[] = [];
  const wordsExempt = exempt || allowed.text;
  let kept = 0;
  let total = 0;
  let previous = "";
  let lastDropped = false;
  let capsUsed = 0;
  let cuckUsed = 0;
  const cuck = opts.cuck ?? { left: 1 };
  for (const p of paragraphs) {
    const keep: string[] = [];
    for (const s of splitSentences(p.replace(/\n/g, " "), allowed.names)) {
      total++;
      const unknownNumbers = allowed.unknownIn(s);
      const bannedWords = bannedWordsIn(s, wordsExempt);
      const other = [
        ...allowed.unboundIn(s, previous).map((n) => `${n} next to the wrong name`),
        ...allowed.badStreaksIn(s, previous).map((n) => `a streak of ${n} that nobody named there has`),
        ...allowed.badClaimsIn(s, previous),
        ...pairsNotIn(s, allowed.text).map((x) => `${x} is not in FACTS`),
        ...boxScoreIn(s, wordsExempt).map((w) => `box-score word "${w}"`),
        ...clockClaimsIn(s),
        ...shapesIn(s).map((x) => `the shape "${x}"`),
      ];
      const cuckHere = cuckChairIn(s, allowed.names);
      if (cuckHere && cuck.left <= 0) other.push("the cuck chair a second time (once per issue at most)");
      let shout = shoutingIn(s, wordsExempt);
      const clean = !unknownNumbers.length && !bannedWords.length && !other.length;
      if (shout.length && clean && opts.caps && opts.caps.left > 0 && s.split(/\s+/).filter(Boolean).length <= CAPS_RANT_WORDS && allowed.namesSomeone(s)) {
        opts.caps.left--;
        capsUsed++;
        shout = [];
      }
      const problems = [...other, ...shout.map((w) => `all caps "${w}"`)];
      lastDropped = Boolean(unknownNumbers.length || bannedWords.length || problems.length);
      if (lastDropped) dropped.push({ sentence: s, unknownNumbers, bannedWords, problems });
      else {
        keep.push(s);
        if (cuckHere) {
          cuck.left--;
          cuckUsed++;
        }
      }
      previous = s;
    }
    kept += keep.length;
    if (keep.length) keptParas.push(keep.join(" "));
  }
  return { text: keptParas.join("\n\n"), kept, dropped, sentences: total, lastDropped, capsUsed, cuckUsed };
}

/** One entry per reason, for logs and the retry note. */
export function describeDrops(dropped: Dropped[]): string[] {
  const out = new Set<string>();
  for (const d of dropped) {
    for (const n of d.unknownNumbers) out.add(`${n} (not in FACTS)`);
    for (const w of d.bannedWords) out.add(`"${w}" (banned)`);
    for (const p of d.problems) out.add(p);
  }
  return [...out];
}

/** Keep the first `max` exclamation points across `texts` (in order); later ones become periods. */
export function limitExclamations(texts: string[], max = 1): string[] {
  let seen = 0;
  return texts.map((t) =>
    t.replace(/!/g, () => {
      seen++;
      return seen <= max ? "!" : ".";
    }),
  );
}

/**
 * Parse "@@slot-id" sections. Text before the first marker is ignored; a reply with no markers
 * at all is returned under `fallbackSlot` (item roasts ask for one slot and sometimes get
 * plain text).
 */
export function parseSlots(reply: string, fallbackSlot?: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^[ \t]*@@\s*([A-Za-z0-9_-]+)[ \t:]*$/gm;
  const marks = [...reply.matchAll(re)];
  if (!marks.length) {
    if (fallbackSlot && reply.trim()) out.set(fallbackSlot, reply.trim());
    return out;
  }
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? reply.length) : reply.length;
    const body = reply.slice(start, end).trim();
    const id = m[1].toLowerCase();
    if (body && !out.has(id)) out.set(id, body);
  });
  return out;
}
