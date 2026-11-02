import { describe, expect, it } from "vitest";
import { cleanAnswers, misfit, suggestedOrder, TEST_KINDS, TESTS } from "./household-tests";
import type { MindatRecord } from "./names";

const r = (id: number, name: string, hmin: number | null = null, hmax = hmin): MindatRecord => ({ id, name, hmin, hmax });
const QUARTZ = r(3337, "Quartz", 7);
const AGATE = [r(51, "Agate", 6.5, 7), r(960, "Chalcedony", 6.5, 7), QUARTZ];
const AMETHYST = [r(198, "Amethyst"), QUARTZ];
const CALCITE = [r(859, "Calcite", 3)];
const HEMATITE = [r(1856, "Hematite", 5, 6)];
const JASPER = [r(2082, "Jasper")];

describe("misfit (#18)", () => {
  it("catches a stone that can't fit a scratch answer", () => {
    expect(misfit(CALCITE, { glass: "yes" })).toEqual({ test: "glass", name: "Calcite", hmin: 3, hmax: 3 });
    expect(misfit(AGATE, { glass: "no" })).toEqual({ test: "glass", name: "Agate", hmin: 6.5, hmax: 7 });
    expect(misfit(AGATE, { steel: "yes" })?.test).toBe("steel");
    expect(misfit([r(1784, "Gypsum", 2)], { copper: "no" })?.test).toBe("copper");
  });

  it("gives a stone near the tool's hardness the benefit of the doubt", () => {
    expect(misfit(HEMATITE, { glass: "yes" })).toBeNull();
    expect(misfit(HEMATITE, { glass: "no", steel: "yes" })).toBeNull();
    expect(misfit(CALCITE, { fingernail: "yes" })).toBeNull();
  });

  it("takes a variety's hardness from the record above it", () => {
    expect(misfit(AMETHYST, { glass: "no" })).toEqual({ test: "glass", name: "Quartz", hmin: 7, hmax: 7 });
  });

  it("checks nothing without a hardness or a scratch answer", () => {
    expect(misfit(JASPER, { glass: "no" })).toBeNull();
    expect(misfit([], { glass: "no" })).toBeNull();
    expect(misfit(CALCITE, {})).toBeNull();
    expect(misfit(CALCITE, { vinegar: "no", streak: "black" })).toBeNull();
  });
});

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
