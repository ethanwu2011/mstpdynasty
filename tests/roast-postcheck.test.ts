/** Post-checks on model output: the number check, banned words, sanitizing and slot parsing. */
import { describe, expect, it } from "vitest";
import {
  AllowedNumbers,
  bannedWordsIn,
  boxScoreIn,
  checkText,
  clockClaimsIn,
  describeDrops,
  limitExclamations,
  numbersIn,
  numberWordsIn,
  pairsNotIn,
  parseSlots,
  sanitize,
  shapesIn,
  splitSentences,
  streakClaims,
} from "@/lib/roast/postcheck";

const FACTS = JSON.stringify({ loser: { manager: "Rory", points: 97.14, benchLeft: 38.6 }, margin: 3.94, net: -1830, pick: "1.05", record: "5-2" });

describe("numbers", () => {
  it("finds numbers the way they are written", () => {
    expect(numbersIn("Paid $1,800 for 41.26 points in week 7, his 3rd straight, 10-4 record, 12, 14 and 18.")).toEqual([1800, 41.26, 7, 3, 10, 4, 12, 14, 18]);
  });

  it("allows fact numbers and their roundings only", () => {
    const allowed = new AllowedNumbers([FACTS]);
    for (const n of [97.14, 97.1, 97, 38.6, 39, 3.94, 3.9, 4, 1830, 1.05, 5, 2]) expect(allowed.has(n)).toBe(true);
    for (const n of [97.2, 98, 38.7, 1831, 150, 187.45]) expect(allowed.has(n)).toBe(false);
  });

  it("drops only the sentences with invented numbers", () => {
    const out = checkText(
      "Rory lost by 3.94 and left 38.6 on the bench. With a real lineup he scores 187.45. The 1.05 pick was a cry for help, and the 5-2 record is a lie.",
      new AllowedNumbers([FACTS]),
    );
    expect(out.text).toBe("Rory lost by 3.94 and left 38.6 on the bench. The 1.05 pick was a cry for help, and the 5-2 record is a lie.");
    expect(out.kept).toBe(2);
    expect(out.dropped).toEqual([{ sentence: "With a real lineup he scores 187.45.", unknownNumbers: [187.45], bannedWords: [], problems: [] }]);
  });

  it("keeps paragraphs and decimals intact when splitting", () => {
    expect(splitSentences("He scored 41.26. Then 2.1 happened! Why? Because.")).toEqual(["He scored 41.26.", "Then 2.1 happened!", "Why?", "Because."]);
    const out = checkText("Rory scored 97.14.\n\nHe left 38.6.", new AllowedNumbers([FACTS]));
    expect(out.text).toBe("Rory scored 97.14.\n\nHe left 38.6.");
  });
});

describe("splitting sentences around names", () => {
  const facts = JSON.stringify({
    loser: { manager: "Kevin", team: "Mrs. Doubtfire's Dynasty", points: 97.14 },
    margin: 3.94,
    benched: { name: "A.J. Brown", pos: "WR", points: 31.2 },
    started: { name: "Amon-Ra St. Brown", pos: "WR", points: 2.1 },
  });
  const allowed = new AllowedNumbers([facts]);

  it("never cuts a name with initials or an abbreviation in half", () => {
    expect(splitSentences("Kevin benched A.J. Brown, who scored 31.2, and lost by 3.94. He will blame the wind.", allowed.names)).toEqual([
      "Kevin benched A.J. Brown, who scored 31.2, and lost by 3.94.",
      "He will blame the wind.",
    ]);
    expect(splitSentences("Kevin started Amon-Ra St. Brown and got 2.1. Brutal.")).toEqual(["Kevin started Amon-Ra St. Brown and got 2.1.", "Brutal."]);
    expect(splitSentences("Mrs. Doubtfire's Dynasty lost again. Kevin runs it.", allowed.names)).toEqual(["Mrs. Doubtfire's Dynasty lost again.", "Kevin runs it."]);
    expect(splitSentences("C.J. Stroud and D.J. Moore both sat. So did T.J. Hockenson.")).toEqual(["C.J. Stroud and D.J. Moore both sat.", "So did T.J. Hockenson."]);
    expect(splitSentences("He took the No. 1 pick. It went badly.")).toEqual(["He took the No. 1 pick.", "It went badly."]);
    // A lone capital after "a" / "an" is a grade, not an initial.
    expect(splitSentences("FantasyCalc hands Dev a D. Kevin gets an A.")).toEqual(["FantasyCalc hands Dev a D.", "Kevin gets an A."]);
  });

  it("checks the whole sentence, so a roast naming A.J. Brown is not garbled", () => {
    const out = checkText("Kevin benched A.J. Brown, who scored 31.2, and lost by 3.94. He will blame the wind.", allowed);
    expect(out.dropped).toEqual([]);
    expect(out.text).toBe("Kevin benched A.J. Brown, who scored 31.2, and lost by 3.94. He will blame the wind.");
  });
});

describe("numbers the payload does not back", () => {
  const facts = JSON.stringify({
    teams: [
      { manager: "Kevin", team: "Kevin's Kitchen", benchLeft: 32.6, streak: "2W", scoreRank: 4 },
      { manager: "Wes", team: "Wes Side Story", benchLeft: 12.5, streak: "3L", scoreRank: 9 },
    ],
    record: "8-1",
    margin: 3.94,
  });
  const allowed = new AllowedNumbers([facts]);
  const reasons = (text: string) => checkText(text, allowed).dropped.flatMap((d) => [...d.unknownNumbers.map(String), ...d.bannedWords, ...d.problems]);

  it("reads numbers written as words", () => {
    expect(numberWordsIn("He fumbled twice, lost three, and burned twenty-four hours, a dozen picks and his third timeout.")).toEqual([2, 3, 24, 12, 3]);
    expect(numberWordsIn("No one wanted the one guy, one of the worst.")).toEqual([]);
    expect(checkText("Wes lost by three.", allowed).dropped).toEqual([]); // 3 is in FACTS ("3L")
    expect(checkText("Wes lost by seven.", allowed).dropped[0].unknownNumbers).toEqual([7]);
  });

  it("drops invented box-score stats", () => {
    expect(reasons("Case Whitfield fumbled twice and threw two picks.")).toContain('box-score word "fumble"');
    expect(boxScoreIn("He had 3 touchdowns and 112 yards.")).toEqual(["touchdown", "yards"]);
    expect(boxScoreIn("Seven catches for nothing.")).toEqual(["seven catches"]);
    expect(boxScoreIn("He targets Kevin every week and was passing on value.")).toEqual([]);
  });

  it("drops a real number tied to the wrong manager", () => {
    expect(reasons("Wes Side Story left 32.6 points on the bench.")).toEqual(["32.6 next to the wrong name"]);
    expect(reasons("Kevin left 32.6 points on the bench.")).toEqual([]);
    // The sentence right before can carry the name.
    expect(reasons("Kevin had a week. He left 32.6 on the bench.")).toEqual([]);
  });

  it("drops a streak nobody named has", () => {
    expect(streakClaims("Wes has now lost 4 straight, his fourth straight loss, a 4-game losing streak.")).toEqual([4]);
    expect(reasons("Wes has now lost 4 straight.")).toEqual(["a streak of 4 that nobody named there has"]);
    expect(reasons("Wes has now lost 3 straight.")).toEqual([]);
    expect(reasons("Kevin has won two in a row.")).toEqual([]);
  });

  it("drops a score-like pair that is not in FACTS word for word", () => {
    expect(pairsNotIn("It ended 28-6 and he is 8-1.", facts)).toEqual(["28-6"]);
    expect(pairsNotIn("A 30-year-old for a net of -1830.", facts)).toEqual([]);
  });
});

describe("banned words", () => {
  it("drops the medical theme unless FACTS or LORE set it up", () => {
    expect(bannedWordsIn("This lineup belongs in a hospital.")).toEqual(["hospital"]);
    expect(bannedWordsIn("Code Blue lost again.", '{"team":"Code Blue"}')).toEqual([]);
    expect(bannedWordsIn("Time for an autopsy on this roster.")).toEqual(["autopsy"]);
    expect(bannedWordsIn("Three rounds of reaches.")).toEqual([]); // draft rounds are fine
    const out = checkText("Rory lost by 3.94. The prognosis is grim.", new AllowedNumbers([FACTS]));
    expect(out.text).toBe("Rory lost by 3.94.");
  });

  it("drops filler the persona bans", () => {
    expect(bannedWordsIn("Well folks, that happened.")).toEqual(["folks"]);
    expect(bannedWordsIn("Buckle up.")).toEqual(["buckle up"]);
    expect(bannedWordsIn("A folksy take.")).toEqual([]);
    expect(bannedWordsIn("Absolutely a masterclass, chef\u2019s kiss, no notes.")).toEqual(["masterclass", "chef's kiss", "no notes"]);
    // "absolutely" is a headline intensifier here, not filler.
    expect(bannedWordsIn("Holloway Absolutely Fucks Rory From the Bench")).toEqual([]);
    expect(bannedWordsIn("RIP to his season.")).toEqual(["RIP"]);
    expect(bannedWordsIn("He will rip that trade up.")).toEqual([]);
  });

  it("catches the medical and school idioms sports writing is full of", () => {
    expect(bannedWordsIn("The doctor would call this a patient with no pulse.")).toEqual(["doctor", "patient", "pulse"]);
    expect(bannedWordsIn("His playoff odds are on life support and flatlined at 0.")).toEqual(["life support", "flatline"]);
    expect(bannedWordsIn("Kevin put on a clinic, surgical, a post-mortem nobody asked for.")).toEqual(["clinic", "post-mortem", "surgery"]);
    expect(bannedWordsIn("Graded on a curve, extra credit, summer school, report card.")).toEqual(["extra credit", "on a curve", "summer school", "report card"]);
    // Football words that look close stay legal.
    expect(bannedWordsIn("A late surge from the rookie class, the depth chart and three draft rounds.")).toEqual([]);
  });
});

describe("history and hyperbole versus league stats", () => {
  const facts = JSON.stringify({
    commissioner: "Hal",
    draftPicks: [
      { pick: "1.01", pickNo: 1, manager: "Theo", team: "Theo's Armada", player: { name: "Tavon Reyes", pos: "QB", age: 27 }, fcRank: 9, reach: 8, clockLimitHours: 4 },
      { pick: "4.03", pickNo: 33, manager: "Gus", team: "Gus Bus", player: { name: "Mack Pruitt", pos: "RB", age: 30 }, fcRank: 35, reach: 2, verdict: "fair" },
    ],
    waivers: { claims: [{ manager: "Priya", bid: 38, overpayBy: 34 }] },
    odds: [{ manager: "Wes", playoffPct: 12.5 }],
    streaks: [{ manager: "Wes", streak: "4L" }],
    onTheClock: { manager: "Sully", pick: "5.01", roundsLeft: 30, resumesAt: "8 AM ET" },
  });
  const allowed = new AllowedNumbers([facts]);
  const drops = (text: string) => describeDrops(checkText(text, allowed).dropped);

  it("lets history and hyperbole numbers through", () => {
    for (const text of [
      "The Grande Armee crossed the Neman in 1812 with six hundred thousand men and summer uniforms.",
      "That roster has 200,000 miles on it and one working headlight.",
      "In 1628 the Vasa left port with sixty-four bronze cannons and sank in front of the whole city.",
      "The Vasa sat on the bottom of the harbor for three hundred years before anyone came to get it.",
      "Rome burned for 6 days and nobody fetched water.",
      "Nobody in that tent had met Theo.",
    ]) {
      expect(drops(text), text).toEqual([]);
    }
  });

  it("still holds every league stat to FACTS", () => {
    // Real stats pass: the pick, the spots, the rank, the age, the dollars, the percent, the resume time.
    expect(drops("Theo took Tavon Reyes at 1.01, the 9th guy on the board, 8 spots early.")).toEqual([]);
    expect(drops("Gus took a 30-year-old Mack Pruitt at 4.03.")).toEqual([]);
    expect(drops("Priya paid $38 and overpaid by $34.")).toEqual([]);
    expect(drops("Wes has a 12.5 percent shot at the playoffs.")).toEqual([]);
    expect(drops("Picks resume at 8 AM ET, and Sully has 30 rounds left.")).toEqual([]);
    // Wrong ones fail: a pick label, a digit ordinal, spots, an age, dollars, a percent, points, rounds.
    expect(drops("Theo took Tavon Reyes at 1.02.")).toEqual(["1.02 (not in FACTS)"]);
    expect(drops("Theo took the 11th guy on the board.")).toEqual(["11 (not in FACTS)"]);
    expect(drops("Theo reached 14 spots for a quarterback.")).toEqual(["14 (not in FACTS)"]);
    expect(drops("Gus took a 31-year-old Mack Pruitt at 4.03.")).toEqual(["31 (not in FACTS)"]);
    expect(drops("Priya paid $39 for him.")).toEqual(["39 (not in FACTS)"]);
    expect(drops("Wes is at 17 percent.")).toEqual(["17 (not in FACTS)"]);
    expect(drops("Wes scored 61.3 on Sunday.")).toEqual(["61.3 (not in FACTS)"]);
    expect(drops("Sully has 29 rounds left.")).toEqual(["29 (not in FACTS)"]);
    // Anything next to a name is a stat, even with no stat word: hyperbole goes elsewhere.
    expect(drops("Theo has been wrong a thousand times.")).toEqual(["1000 (not in FACTS)"]);
    expect(drops("Napoleon lost fewer men than Theo lost 5,000 brain cells.")).toEqual(["5000 (not in FACTS)"]);
    // A real stat still has to sit next to its owner.
    expect(drops("Theo paid $38 for nothing.")).toEqual(["38 next to the wrong name"]);
    // Streaks are still checked.
    expect(drops("Wes has lost 5 straight.")).toContain("a streak of 5 that nobody named there has");
  });

  it("reads scales and hyphenated numbers in words", () => {
    expect(numberWordsIn("six hundred thousand men, a million reasons, twenty-four hours")).toEqual([600000, 1000000, 24]);
  });

  it("throws out any claim about time on the clock (FACTS has no pick times)", () => {
    for (const text of ["Theo took three hours to make that pick.", "Sam sat on the clock for 3.8 hours.", "Gus burned forty minutes on a kicker.", "Two hours on the clock for that."]) {
      expect(clockClaimsIn(text), text).toEqual(["a claim about time on the clock (FACTS has no pick times)"]);
    }
    // The pick clock itself is a rule, and fair to quote.
    expect(drops("Theo gets four hours per pick and still panics.")).toEqual([]);
  });
});

describe("safety and tone", () => {
  it("drops slurs whatever FACTS says, and logs them only as 'slur'", () => {
    expect(bannedWordsIn("That pick was gay.")).toEqual(["slur"]);
    expect(bannedWordsIn("A retarded reach.", '{"team":"retarded"}')).toEqual(["slur"]);
    expect(bannedWordsIn("No homo, but Theo drafts like a fool.")).toEqual(["slur"]);
    // Crude insults about a decision, profanity and innuendo stay legal.
    expect(bannedWordsIn("What the fuck was that, you dumbass. He reached so deep he should have bought dinner first.")).toEqual([]);
    expect(bannedWordsIn("He watched the whole thing from the cuck chair.")).toEqual([]);
    // Football words that contain a slur's letters stay legal.
    expect(bannedWordsIn("The Chinook, the spice, the homework-free Japan trip.")).toEqual(["homework"]);
  });

  it("drops words that announce the joke, unless a team is really named that", () => {
    expect(bannedWordsIn("Time to roast Theo.")).toEqual(["roast"]);
    expect(bannedWordsIn("A savage reach, no offense.")).toEqual(["savage", "no offense"]);
    expect(bannedWordsIn("Pot Roast lost again.", '{"team":"Pot Roast"}')).toEqual([]);
  });
});

describe("shapes, caps and punctuation", () => {
  const allowed = new AllowedNumbers([JSON.stringify({ manager: "Rory", nflTeam: "BAL" })]);

  it("drops the machine-humor shapes", () => {
    expect(shapesIn("He was not outbid, he was out-cared.")).toEqual(["not X, it is Y"]);
    expect(shapesIn("That is not a win, that is a clerical error.")).toEqual(["not X, it is Y"]);
    expect(shapesIn("It's not a rebuild, it's a hostage situation.")).toEqual(["not X, it is Y"]);
    expect(shapesIn("Somewhere, Rory is still refreshing.")).toEqual(["Somewhere, X is..."]);
    expect(shapesIn("Imagine being Rory.")).toEqual(["a sentence that starts with Imagine"]);
    expect(shapesIn("2019 called, they want their running back back.")).toEqual(["X called, they want their Y back"]);
    expect(shapesIn("Rory did not start him, and it cost him.")).toEqual([]);
  });

  it("drops shouting but not team abbreviations FACTS uses", () => {
    expect(checkText("Rory is DONE.", allowed).dropped[0].problems).toEqual(['all caps "DONE"']);
    expect(checkText("Rory started a BAL receiver with FAAB money.", allowed).dropped).toEqual([]);
  });

  it("turns spaced hyphens into commas and keeps one exclamation point per issue", () => {
    expect(sanitize("Rory - the man - lost 28 - 6 to nobody")).toBe("Rory, the man, lost 28-6 to nobody");
    expect(limitExclamations(["Wow! Again!", "Stop!"])).toEqual(["Wow! Again.", "Stop."]);
  });
});

describe("sanitize", () => {
  it("returns plain text without markdown, emoji or long dashes", () => {
    expect(sanitize("**Rory** \u2014 the man, the myth")).toBe("Rory, the man, the myth");
    expect(sanitize("Went 10\u20134 anyway")).toBe("Went 10-4 anyway");
    expect(sanitize("# Heading\n- bullet one\n* bullet two")).toBe("Heading\nbullet one\nbullet two");
    expect(sanitize("Fire \u{1F525}\u{FE0F} take")).toBe("Fire take");
    expect(sanitize("`code` and _emphasis_")).toBe("code and emphasis");
  });
});

describe("slot parsing", () => {
  it("splits @@ slots and ignores preamble", () => {
    const slots = parseSlots("Sure, here you go.\n@@dek\nOne line.\n@@M-1\nFirst.\n\nSecond.\n@@m-1\nDuplicate.\n@@empty\n");
    expect([...slots.entries()]).toEqual([
      ["dek", "One line."],
      ["m-1", "First.\n\nSecond."],
    ]);
  });

  it("accepts a colon after the slot id and falls back for plain text", () => {
    expect(parseSlots("@@roast:\nText.").get("roast")).toBe("Text.");
    expect(parseSlots("Just a roast.", "roast").get("roast")).toBe("Just a roast.");
    expect(parseSlots("Just a roast.").size).toBe(0);
  });
});
