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
 *         the same sentence as, or right after, a name from the same part of FACTS)
 *       claims a streak nobody named there has
 *       writes a score-like pair ("28-6") that FACTS does not contain word for word
 *       uses a box-score word FACTS never carries (touchdowns, yards, "7 catches"...)
 *       claims how long someone took to pick (FACTS has no pick times)
 *       uses the medical / school theme, a slur, banned filler, a word that announces the joke,
 *         a banned joke shape, or shouts in caps
 *   Profanity is allowed. Callers decide what a flagged sentence means (issues and items
 *   reject the whole slot).
 */
import { ANNOUNCE_TERMS, BANNED_FILLER, BANNED_SHAPES, BOX_SCORE_TERMS, CAPS_ALLOWED, CLOCK_CLAIMS, COUNTED_STATS, SLUR_TERMS, THEME_TERMS, type BannedTerm } from "./banned";
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

/**
 * Words that make a nearby number a league stat. Hyperbole never needs them: "six hundred
 * thousand men", "200,000 miles", "in 1812".
 */
const STAT_WORDS = [
  "points?",
  "pts",
  "scor(?:e|es|ed|ing)",
  "put\\s+up",
  "posted",
  "projected",
  "projections?",
  "optimal",
  "bench(?:ed)?",
  "picks?",
  "picked",
  "spots?",
  "reach(?:ed|es)?",
  "steals?",
  "rank(?:s|ed|ing)?",
  "overall",
  "place",
  "rounds?",
  "record",
  "wins?",
  "loss(?:es)?",
  "lost\\s+by",
  "won\\s+by",
  "games?",
  "straight",
  "streak",
  "in\\s+a\\s+row",
  "weeks?",
  "seasons?",
  "all-play",
  "faab",
  "dollars?",
  "bucks?",
  "bids?",
  "paid",
  "pays?",
  "overpa\\w*",
  "spent",
  "costs?",
  "worth",
  "value[sd]?",
  "fantasycalc",
  "net",
  "grade",
  "age[sd]?",
  "year-olds?",
  "years?\\s+old",
  "qbs?",
  "rbs?",
  "wrs?",
  "tes?",
  "flex",
  "quarterbacks?",
  "running\\s+backs?",
  "receivers?",
  "wideouts?",
  "tight\\s+ends?",
  "percent",
  "odds",
  "playoffs?",
  "title",
  "margin",
  "hours?",
  "minutes?",
  "clock",
];
const STAT_CONTEXT_RE = new RegExp(`(?<![a-z0-9])(?:${STAT_WORDS.join("|")})(?![a-z0-9])`, "i");

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
    const here = own.length ? [...chain, ...own] : chain;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && (NAME_KEYS.has(k) || REF_KEYS.has(k))) continue;
      if (k === "streak" && typeof v === "string") {
        const m = /^(\d+)[WLT]$/.exec(v);
        if (m) this.streaks.push({ count: Number(m[1]), names: here });
      }
      this.walk(v, here, names, surnames);
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
    const scope = `${previous}\n${sentence}`.toLowerCase().replace(/\u2019/g, "'");
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
    const scope = `${previous}\n${sentence}`.toLowerCase().replace(/\u2019/g, "'");
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
/* words                                                               */
/* ------------------------------------------------------------------ */

const hits = (terms: BannedTerm[], text: string, exempt?: string) =>
  terms.filter((t) => t.re.test(text) && (exempt === undefined || !t.re.test(exempt))).map((t) => t.label);

/** Theme words and joke-announcing words (unless FACTS/LORE uses them), slurs and banned filler. */
export function bannedWordsIn(text: string, exempt = ""): string[] {
  return [...hits(THEME_TERMS, text, exempt), ...hits(ANNOUNCE_TERMS, text, exempt), ...new Set(hits(SLUR_TERMS, text)), ...hits(BANNED_FILLER, text)];
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
}

/** Flag every sentence that fails a check; `text` holds only the ones that passed. */
export function checkText(text: string, allowed: AllowedNumbers, exempt = ""): CheckedText {
  const paragraphs = sanitize(text).split(/\n{2,}/);
  const keptParas: string[] = [];
  const dropped: Dropped[] = [];
  const wordsExempt = exempt || allowed.text;
  let kept = 0;
  let total = 0;
  let previous = "";
  for (const p of paragraphs) {
    const keep: string[] = [];
    for (const s of splitSentences(p.replace(/\n/g, " "), allowed.names)) {
      total++;
      const unknownNumbers = allowed.unknownIn(s);
      const bannedWords = bannedWordsIn(s, wordsExempt);
      const problems = [
        ...allowed.unboundIn(s, previous).map((n) => `${n} next to the wrong name`),
        ...allowed.badStreaksIn(s, previous).map((n) => `a streak of ${n} that nobody named there has`),
        ...pairsNotIn(s, allowed.text).map((x) => `${x} is not in FACTS`),
        ...boxScoreIn(s, wordsExempt).map((w) => `box-score word "${w}"`),
        ...clockClaimsIn(s),
        ...shapesIn(s).map((x) => `the shape "${x}"`),
        ...shoutingIn(s, wordsExempt).map((w) => `all caps "${w}"`),
      ];
      if (unknownNumbers.length || bannedWords.length || problems.length) dropped.push({ sentence: s, unknownNumbers, bannedWords, problems });
      else keep.push(s);
      previous = s;
    }
    kept += keep.length;
    if (keep.length) keptParas.push(keep.join(" "));
  }
  return { text: keptParas.join("\n\n"), kept, dropped, sentences: total };
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
