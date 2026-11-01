import { describe, expect, it } from "vitest";
import { byModel, planPills, stoneName, stripLine, verdictLine, type Candidate } from "./pills";

const HAIKU = "anthropic/claude-haiku-5.5";
const FLASH = "google/gemini-3.8-flash";

function cands(model: string, ...names: Array<string | [string, string]>): Candidate[] {
  return names.map((n, i) => ({
    model,
    rank: i + 1,
    name: Array.isArray(n) ? n[0] : n,
    variety: Array.isArray(n) ? n[1] : null,
    kind: "mineral",
    confidence: 0.5 - i * 0.1,
  }));
}

const names = (plan: ReturnType<typeof planPills>) => plan.pills.map((p) => p.name);

// Fixtures shaped on Mom's stones as the #7 run identified them (PR #12).
describe("planPills", () => {
  it("says probably when both first choices agree (stone 1, galena)", () => {
    const plan = planPills([...cands(HAIKU, "Galena", "Sphalerite", "Magnetite"), ...cands(FLASH, "Galena", "Hematite", "Sphalerite")], HAIKU);
    expect(plan.verdict).toBe("probably");
    expect(plan.opinions).toBe(2);
    expect(names(plan)).toEqual(["Galena", "Sphalerite", "Hematite"]);
    expect(plan.pills.map((p) => p.word)).toEqual(["probably", "could also be", "could also be"]);
    expect(plan.pills[0].models).toEqual([HAIKU, FLASH]);
    expect(plan.pills[1].models).toEqual([HAIKU, FLASH]); // both named sphalerite further down
  });

  it("agrees through a qualifier, and keeps the identifier's name (stone 11 the other way round)", () => {
    const plan = planPills([...cands(HAIKU, "Hematite"), ...cands(FLASH, "Specular hematite")], HAIKU);
    expect(plan.verdict).toBe("probably");
    expect(names(plan)).toEqual(["Hematite"]);
  });

  it("says could be when the first choices differ (stone 3, chalcopyrite or marcasite)", () => {
    const plan = planPills([...cands(FLASH, "Marcasite", "Pyrite"), ...cands(HAIKU, "Chalcopyrite", "Pyrite", "Bornite")], HAIKU);
    expect(plan.verdict).toBe("could_be");
    expect(names(plan)).toEqual(["Chalcopyrite", "Marcasite", "Pyrite"]);
    expect(plan.pills.every((p) => p.word === "could be")).toBe(true);
    expect(plan.pills[0].pick).toEqual({ model: HAIKU, rank: 1 });
    expect(plan.pills[1].pick).toEqual({ model: FLASH, rank: 1 });
  });

  it("does not let chalcopyrite and pyrite agree (stone 7)", () => {
    const plan = planPills([...cands(HAIKU, "Chalcopyrite"), ...cands(FLASH, "Pyrite")], HAIKU);
    expect(plan.verdict).toBe("could_be");
    expect(names(plan)).toEqual(["Chalcopyrite", "Pyrite"]);
  });

  it("never says probably on one opinion", () => {
    const plan = planPills(cands(FLASH, "Fluorite", "Calcite"), HAIKU);
    expect(plan.verdict).toBe("could_be");
    expect(plan.opinions).toBe(1);
    expect(names(plan)).toEqual(["Fluorite", "Calcite"]);
  });

  it("has no pills and no verdict when nobody named anything", () => {
    expect(planPills([], HAIKU)).toEqual({ verdict: "none", opinions: 0, pills: [] });
  });

  it("caps the pills at three and merges duplicates within one model's list", () => {
    const plan = planPills([...cands(HAIKU, "Quartz", ["Quartz", "Milky"], "Calcite", "Dolomite"), ...cands(FLASH, "Quartz", "Calcite", "Barite")], HAIKU);
    expect(names(plan)).toEqual(["Quartz", "Calcite", "Barite"]);
    expect(plan.pills[0].variety).toBe("Milky");
  });

  it("puts the identifier first even when it sorts later", () => {
    expect(byModel([...cands("z/first", "A"), ...cands("a/second", "B")], "z/first").map((l) => l[0].model)).toEqual(["z/first", "a/second"]);
  });
});

describe("verdictLine", () => {
  it("puts the plan in words", () => {
    expect(verdictLine(planPills([...cands(HAIKU, "galena"), ...cands(FLASH, "Galena")], HAIKU))).toBe("Probably Galena");
    expect(verdictLine(planPills([...cands(HAIKU, "Slate"), ...cands(FLASH, "Specular hematite")], HAIKU))).toBe("Could be Slate or Specular Hematite");
    expect(verdictLine(planPills(cands(FLASH, "Fluorite"), HAIKU))).toBe("Could be Fluorite");
    expect(verdictLine(planPills([], HAIKU))).toBe("No guess");
  });
});

describe("stripLine", () => {
  it("gives the guess, and the test only when the models are torn", () => {
    const agree = planPills([...cands(HAIKU, "Galena"), ...cands(FLASH, "Galena")], HAIKU);
    expect(stripLine(agree, false, "streak")).toBe("Jasper’s guess for the first one: probably Galena.");
    const torn = planPills([...cands(HAIKU, "Chalcopyrite"), ...cands(FLASH, "Marcasite")], HAIKU);
    expect(stripLine(torn, false, "steel")).toBe(
      "Jasper’s guess for the first one: could be Chalcopyrite or Marcasite. A steel nail would tell them apart.",
    );
    expect(stripLine(torn, false)).toBe("Jasper’s guess for the first one: could be Chalcopyrite or Marcasite.");
  });

  it("says when there is no guess, and why", () => {
    expect(stripLine(planPills([], HAIKU), false)).toBe("Jasper had no guess for the first one, so the name is up to you.");
    expect(stripLine(planPills([], HAIKU), true)).toBe("Jasper couldn’t look at the first one, so the name is up to you.");
  });
});

describe("stoneName", () => {
  it("capitalizes each word and keeps apostrophes and hyphens", () => {
    expect(stoneName("milky quartz")).toBe("Milky Quartz");
    expect(stoneName("tiger's eye")).toBe("Tiger's Eye");
    expect(stoneName("red-brown jasper")).toBe("Red-Brown Jasper");
  });
});
