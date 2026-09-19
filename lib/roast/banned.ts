/**
 * One list of banned language, shared by the prompt (persona.ts renders it into BANNED) and
 * the post-check (postcheck.ts drops any sentence that uses it). Editing a list changes the
 * system prompt, so update the pinned hash in tests/roast-prompt.test.ts in the same change.
 */

export interface BannedTerm {
  /** How the term is named in the prompt and in drop logs. */
  label: string;
  re: RegExp;
}

/** Escape a literal phrase for a regex; spaces match any whitespace, apostrophes match ' or ’. */
function phrase(p: string): string {
  return p
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
    .replace(/'/g, "['’]");
}

/** Whole-word, case-insensitive match of a literal phrase (or a regex source when `raw`). */
export function term(label: string, source?: string, flags = "i"): BannedTerm {
  const body = source ?? phrase(label);
  return { label, re: new RegExp(`(?<![A-Za-z0-9&])(?:${body})(?![A-Za-z0-9&])`, flags) };
}

/**
 * Filler and AI tells, banned outright (no FACTS exemption). The prompt lists every label.
 * ("absolutely" is not here on purpose: "Holloway absolutely fucks Rory" is a house headline.)
 * ("clinic" is in THEME_TERMS: banned too, but a team named after one can still be named.)
 */
export const BANNED_FILLER: BannedTerm[] = [
  term("folks"),
  term("buckle up"),
  term("let's dive in"),
  term("without further ado"),
  term("let that sink in"),
  term("it's giving"),
  term("certainly"),
  term("talk about"),
  term("yikes"),
  term("oof"),
  term("in a stunning turn of events"),
  term("masterclass", "master\\s*-?class"),
  term("chef's kiss"),
  term("the audacity"),
  term("bold strategy"),
  term("a choice was made"),
  term("no notes"),
  term("rent-free", "rent[\\s-]+free"),
  term("plot twist"),
  term("spoiler alert"),
  term("RIP", "RIP|R\\.I\\.P\\.?", ""),
  term("pour one out"),
  term("in this economy"),
];

/**
 * Words that announce the joke instead of making it (docs/SITE_SPEC.md DECISIONS ROUND 2:
 * never announce the roast). Dropped unless FACTS or LORE uses the same word, so a team that
 * is really called "Pot Roast" can still be named. The prompt lists every label.
 */
export const ANNOUNCE_TERMS: BannedTerm[] = [
  term("roast", "roast(?:s|ed|ing|er)?"),
  term("savage"),
  term("no offense"),
  term("sick burn"),
  term("shots fired"),
  term("no mercy"),
];

/**
 * Calling a manager cooked or burned (the persona's rule 9, which says it in words). Checked by
 * the post-check only and never listed in the prompt, so the pinned system prompt does not
 * change. Dropped unless FACTS or LORE uses the same words. "Burned his first on a kicker"
 * (spent a pick) stays legal: only the passive "got burned" labels the manager.
 */
export const SELF_LABEL_TERMS: BannedTerm[] = [
  term("cooked"),
  term("burned", "(?:got|gets|get|getting|was|were|is|are|been|be|being)\\s+(?:(?:so|absolutely|completely|badly|thoroughly)\\s+)?(?:burned|burnt)"),
];

/**
 * Slurs and slur-adjacent insults. Never allowed, whatever FACTS or LORE says, and never
 * printed in the prompt (the persona states the rule in words). Logged as "slur" only.
 * Covers group slurs and sexual orientation used as an insult; crude insults about a
 * manager's decisions (clown, fraud, dumbass, bitch) are a different thing and stay legal.
 */
export const SLUR_TERMS: BannedTerm[] = [
  "n[i1!]gg(?:a|as|az|er|ers|uh)",
  "f[a@4]g(?:s|g[oi]ts?|gy)?",
  "homos?",
  "no\\s+homo",
  "gay(?:s|er|est)?",
  "quee?rs?",
  "d[y]kes?",
  "tr[a@]nn(?:y|ies)",
  "shemales?",
  "retard(?:s|ed)?",
  "tards?",
  "sp[a@]z(?:z|zes|tic)?",
  "midgets?",
  "sp[i1]cs?",
  "ch[i1]nks?",
  "g[o0]{2}ks?",
  "k[i1]kes?",
  "wetbacks?",
  "beaners?",
  "rag\\s*heads?",
  "towel\\s*heads?",
  "coons?",
  "japs?",
  "gyp(?:p?ed|sy|sies)",
  "wops?",
  "dagos?",
].map((source) => term("slur", source));

/**
 * Claims about how long someone took to pick. The site only knows when it noticed a pick,
 * not when it was made, so FACTS has no pick times and any such claim is invented. The
 * league's pick clock (clockLimitHours) is a real setting and stays legal ("four hours per pick").
 */
export const CLOCK_CLAIMS: RegExp[] = [
  // A duration needs a quantity in front of the unit, so "the second round" or "a second receiver" never counts.
  /\b(?:took|takes|taking|spent|spends|sat|sits|sitting|burned|burnt|burns|wasted|wastes|needed|needs|used|uses|killed|ran)\b[^.!?]{0,40}?\b(?:\d[\d.,]*|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|forty|fifty|few|several|many|all|half\s+an?)\s+(?:hours?|minutes?|mins?|seconds?|secs?)\b(?!\s+(?:round|rounder|pick|overall|place|receiver|running|quarterback|tight|string|team|option|year|straight))/i,
  /\b(?:hours?|minutes?|mins?|seconds?|secs?|all\s+(?:day|night))\s+(?:on|off)\s+the\s+clock\b/i,
  /\bon\s+the\s+clock\s+for\s+(?:\S+\s+){0,3}?(?:hours?|minutes?|seconds?|days?)\b/i,
];

/**
 * Sentence shapes that read as machine-written humor. Checked per sentence.
 */
export const BANNED_SHAPES: BannedTerm[] = [
  // "He was not outbid, he was out-cared." / "That is not a win, that is a clerical error." / "It's not X, it's Y."
  {
    label: "not X, it is Y",
    re: /(?:\bnot\b|n['’]t\b)[^.!?;:]{1,80}?[,;]\s*(?:but\s+)?(?:it|that|this|he|she|they|we|you|his|her|their)(?:['’](?:s|re)\b|\s+(?:is|was|are|were|just)\b)/i,
  },
  // "not just bad, but historic"
  { label: "not X but Y", re: /\bnot\s+(?:just\s+|only\s+|even\s+)?[^.!?;:,]{1,50},?\s+but\b/i },
  { label: "Somewhere, X is...", re: /^\W*somewhere,/i },
  { label: "X called, they want their Y back", re: /\bcalled[,.;:]?\s+(?:and\s+)?(?:they|he|she|it)\s+want(?:s|ed)?\b/i },
  { label: "a sentence that starts with Imagine", re: /^\W*imagine\b/i },
];

/**
 * The medical / school theme Ethan ruled out (docs/SITE_SPEC.md DECISIONS). A sentence using
 * one is dropped unless the same word is in FACTS or LORE (a team literally named "Code Blue"
 * or a lore callback still works). "class", "chart" and "rounds" are left alone on purpose:
 * rookie class, depth chart and draft rounds are football.
 */
export const THEME_TERMS: BannedTerm[] = [
  // the old persona
  term("attending"),
  term("autopsy", "autops(?:y|ies)"),
  term("morbidity"),
  term("m&m", "m\\s*&\\s*m"),
  term("code blue"),
  term("dnr"),
  term("prognosis"),
  term("on rounds"),
  term("grand rounds"),
  term("bedside"),
  // medicine
  term("doctor", "doctors?|doc"),
  term("patient", "patients?"),
  term("clinic", "clinics?|clinical(?:ly)?"),
  term("nurse", "nurses?|nursing"),
  term("hospital", "hospitals?|hospitali[sz]\\w*"),
  term("life support"),
  term("flatline", "flatlin\\w*"),
  term("pulse", "pulses?"),
  term("vital signs"),
  term("ER", "ER", ""),
  term("emergency room"),
  term("ambulance"),
  term("stretcher"),
  term("DOA", "DOA", ""),
  term("dead on arrival"),
  term("time of death"),
  term("pronounced dead"),
  term("post-mortem", "post[\\s-]?mortems?"),
  term("morgue"),
  term("coroner"),
  term("toe tag"),
  term("prescription", "prescri\\w*"),
  term("dose", "doses?|dosage"),
  term("symptom", "symptom\\w*"),
  term("diagnosis", "diagnos\\w*"),
  term("surgery", "surger(?:y|ies)|surgeons?|surgical(?:ly)?"),
  term("operating table"),
  term("intensive care"),
  term("ICU", "icu"),
  term("triage", "triag\\w*"),
  term("malpractice"),
  term("second opinion"),
  term("resuscitate", "resuscitat\\w*"),
  term("CPR", "cpr"),
  term("defibrillator", "defibrillat\\w*"),
  term("paramedic", "paramedics?"),
  term("anesthesia", "anesthe\\w*|anaesthe\\w*"),
  term("scalpel"),
  term("stitches"),
  term("rehab"),
  term("white coat"),
  term("pager"),
  term("intern", "interns?"),
  // Not plain "resident": "the residents fled the city" is history, not the theme.
  term("residency"),
  term("chief resident"),
  term("med school"),
  term("medical school"),
  term("med student"),
  term("MD", "MD|M\\.D\\.", ""),
  term("MD/PhD", "md\\s*/\\s*phd"),
  term("PhD", "phd"),
  term("MSTP", "mstp"),
  term("step 1"),
  term("board exam"),
  term("thesis"),
  term("dissertation"),
  // school
  term("homework"),
  term("extra credit"),
  term("on a curve"),
  term("honor roll"),
  term("dean's list"),
  term("summer school"),
  term("held back"),
  term("flunk", "flunk\\w*"),
  term("detention"),
  term("report card"),
  term("teacher", "teachers?"),
  term("professor", "professors?"),
  term("lecture", "lectur\\w*"),
  term("semester"),
  term("GPA", "gpa"),
  term("valedictorian"),
  term("pop quiz"),
  term("exam", "exams?"),
];

/**
 * Box-score words. FACTS carries fantasy points only, never stat lines, so a sentence with one
 * of these is an invented stat unless FACTS or LORE uses the same word.
 */
export const BOX_SCORE_TERMS: BannedTerm[] = [
  term("touchdown", "touchdowns?"),
  term("TD", "TDs?", ""),
  term("yards", "yards?|yardage"),
  term("interception", "interceptions?"),
  term("pick-six", "picks?[\\s-]six"),
  term("fumble", "fumbl\\w*"),
  term("sack", "sack(?:s|ed)?"),
  term("reception", "receptions?"),
  term("rushing", "rushing(?!\\s+(?:to|into|back|out|off)\\b)"),
  term("passing", "passing(?!\\s+(?:on|over|up|by|through|him|her|them|it|the|a|an)\\b)"),
  term("receiving", "receiving(?!\\s+end\\b)"),
];

/** "<number> catches" style counts (only with a number in front: "targets" alone is a verb). */
export const COUNTED_STATS = ["catches", "carries", "targets", "snaps", "touches", "completions"];

/**
 * Words that make a nearby number a league stat (postcheck.ts `isLeagueStat`). The prompt lists
 * every label, so the writer can see each word that turns a history number into a checked one.
 * "straight", "minutes" and "place" are left out on purpose: streaks and pick times have their
 * own checks, digit ordinals ("10th place") are stats anyway, and "took place in 1854" is history.
 */
export const STAT_WORDS: Array<{ label: string; source: string }> = [
  { label: "points", source: "points?" },
  { label: "pts", source: "pts" },
  { label: "score", source: "scor(?:e|es|ed|ing)" },
  { label: "put up", source: "put\\s+up" },
  { label: "posted", source: "posted" },
  { label: "projected", source: "projected" },
  { label: "projection", source: "projections?" },
  { label: "optimal", source: "optimal" },
  { label: "bench", source: "bench(?:ed)?" },
  { label: "pick", source: "picks?" },
  { label: "picked", source: "picked" },
  { label: "spot", source: "spots?" },
  { label: "reach", source: "reach(?:ed|es)?" },
  { label: "steal", source: "steals?" },
  { label: "rank", source: "rank(?:s|ed|ing)?" },
  { label: "overall", source: "overall" },
  { label: "round", source: "rounds?" },
  { label: "record", source: "record" },
  { label: "win", source: "wins?" },
  { label: "loss", source: "loss(?:es)?" },
  { label: "lost by", source: "lost\\s+by" },
  { label: "won by", source: "won\\s+by" },
  { label: "game", source: "games?" },
  { label: "streak", source: "streak" },
  { label: "in a row", source: "in\\s+a\\s+row" },
  { label: "week", source: "weeks?" },
  { label: "season", source: "seasons?" },
  { label: "all-play", source: "all-play" },
  { label: "FAAB", source: "faab" },
  { label: "dollars", source: "dollars?" },
  { label: "bucks", source: "bucks?" },
  { label: "bid", source: "bids?" },
  { label: "paid", source: "paid" },
  { label: "pay", source: "pays?" },
  { label: "overpay", source: "overpa\\w*" },
  { label: "spent", source: "spent" },
  { label: "cost", source: "costs?" },
  { label: "worth", source: "worth" },
  { label: "value", source: "value[sd]?" },
  { label: "FantasyCalc", source: "fantasycalc" },
  { label: "net", source: "net" },
  { label: "grade", source: "grade" },
  { label: "age", source: "age[sd]?" },
  { label: "year-old", source: "year-olds?" },
  { label: "years old", source: "years?\\s+old" },
  { label: "QB", source: "qbs?" },
  { label: "RB", source: "rbs?" },
  { label: "WR", source: "wrs?" },
  { label: "TE", source: "tes?" },
  { label: "FLEX", source: "flex" },
  { label: "quarterback", source: "quarterbacks?" },
  { label: "running back", source: "running\\s+backs?" },
  { label: "receiver", source: "receivers?" },
  { label: "wideout", source: "wideouts?" },
  { label: "tight end", source: "tight\\s+ends?" },
  { label: "percent", source: "percent" },
  { label: "odds", source: "odds" },
  { label: "playoffs", source: "playoffs?" },
  { label: "title", source: "title" },
  { label: "margin", source: "margin" },
  { label: "hours", source: "hours?" },
  { label: "clock", source: "clock" },
];

/** All-caps words (3+ letters) that are ordinary league shorthand, not shouting. */
export const CAPS_ALLOWED = new Set(["FAAB", "PPR", "NFL", "TNF", "MNF", "SNF", "ADP", "IDP", "FLEX", "IR"]);
