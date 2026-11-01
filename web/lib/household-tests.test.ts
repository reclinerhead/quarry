import { describe, expect, it } from "vitest";
import { cleanAnswers, suggestedOrder, TEST_KINDS, TESTS } from "./household-tests";

describe("cleanAnswers", () => {
  it("keeps yes and no, and the streak's colour", () => {
    expect(cleanAnswers({ glass: "Yes", vinegar: " no ", streak: "Red-brown" })).toEqual({ glass: "yes", vinegar: "no", streak: "red-brown" });
  });

  it("leaves out anything not tried, so not tried is never no", () => {
    expect(cleanAnswers({ glass: "not_tried", magnet: "", streak: "Not tried", uv: "maybe" })).toEqual({});
  });

  it("drops unknown tests and odd values, and reads the JSON column", () => {
    expect(cleanAnswers({ lick: "yes", steel: true, copper: 1 })).toEqual({});
    expect(cleanAnswers('{"magnet":"yes"}')).toEqual({ magnet: "yes" });
    expect(cleanAnswers("not json")).toEqual({});
    expect(cleanAnswers(["yes"])).toEqual({});
    expect(cleanAnswers(null)).toEqual({});
  });

  it("keeps a streak colour short", () => {
    expect(cleanAnswers({ streak: "x".repeat(80) }).streak).toHaveLength(40);
  });
});

describe("suggestedOrder", () => {
  const HAIKU = "anthropic/claude-haiku-5.5";
  const FLASH = "google/gemini-3.8-flash";
  it("asks the identifier's tests first, each kind once", () => {
    const tests = [
      { model: FLASH, rank: 1, kind: "streak" },
      { model: FLASH, rank: 2, kind: "magnet" },
      { model: HAIKU, rank: 2, kind: "streak" },
      { model: HAIKU, rank: 1, kind: "steel" },
      { model: HAIKU, rank: 3, kind: "lick" },
    ];
    expect(suggestedOrder(tests, HAIKU).map((t) => `${t.model === HAIKU ? "h" : "f"}:${t.kind}`)).toEqual(["h:steel", "h:streak", "f:magnet"]);
  });
});

describe("TESTS", () => {
  it("has a question and a phrase for every kind Jasper knows", () => {
    for (const k of TEST_KINDS) {
      expect(TESTS[k].question).toMatch(/\?$/);
      expect(TESTS[k].phrase.length).toBeGreaterThan(0);
    }
  });
});
