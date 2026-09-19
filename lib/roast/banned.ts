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
 * ("clinic" is in THEME_TERMS: banned too, but a team named after one can still be named.)
 */
export const BANNED_FILLER: BannedTerm[] = [
  term("folks"),
  term("buckle up"),
  term("let's dive in"),
  term("without further ado"),
  term("let that sink in"),
  term("it's giving"),
  term("absolutely"),
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
  term("resident", "residents?|residency"),
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
 * Self-reference (docs/SITE_SPEC.md DECISIONS ROUND 2: never announce the roast). The writer
 * never names the genre of what it writes or says anyone got roasted, burned or cooked: it
 * states the fact. A sentence using one is dropped unless FACTS or LORE uses the same word
 * (a team literally named "Burn Notice" can still be named). The prompt lists every label.
 */
export const SELF_TERMS: BannedTerm[] = [
  term("roast", "roast(?:s|ed|ing|er|ers)?"),
  term("burn", "burn(?:s|ed|t|ing)?"),
  term("cooked"),
  term("savage", "savage(?:ly|ry)?"),
  term("verdict", "verdicts?"),
  term("column", "columns?"),
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

/** All-caps words (3+ letters) that are ordinary league shorthand, not shouting. */
export const CAPS_ALLOWED = new Set(["FAAB", "PPR", "NFL", "TNF", "MNF", "SNF", "ADP", "IDP", "FLEX", "IR"]);
