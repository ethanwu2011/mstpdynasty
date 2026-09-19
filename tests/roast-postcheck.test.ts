/** Post-checks on model output: the number check, banned words, sanitizing and slot parsing. */
import { describe, expect, it } from "vitest";
import { AllowedNumbers, bannedWordsIn, checkText, numbersIn, parseSlots, sanitize, splitSentences } from "@/lib/roast/postcheck";

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
    expect(out.dropped).toEqual([{ sentence: "With a real lineup he scores 187.45.", unknownNumbers: [187.45], bannedWords: [] }]);
  });

  it("keeps paragraphs and decimals intact when splitting", () => {
    expect(splitSentences("He scored 41.26. Then 2.1 happened! Why? Because.")).toEqual(["He scored 41.26.", "Then 2.1 happened!", "Why?", "Because."]);
    const out = checkText("First 97.14.\n\nSecond 38.6.", new AllowedNumbers([FACTS]));
    expect(out.text).toBe("First 97.14.\n\nSecond 38.6.");
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
