import { describe, expect, it } from "vitest";
import type { MindatRecord } from "./names";
import {
  byModel,
  kindOf,
  madeOfLine,
  ownName,
  parseParts,
  pieceName,
  planPills,
  savedParts,
  stoneName,
  stripLine,
  verdictLine,
  type Candidate,
  type Part,
} from "./pills";

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

// #29: each candidate reads the whole piece, as a show label names it.
const piece = (c: Candidate, ...parts: Part[]): Candidate => ({ ...c, parts });
const W = (name: string, chain?: MindatRecord[]): Part => ({ role: "with", name, chain });
const ON = (name: string, chain?: MindatRecord[]): Part => ({ role: "on", name, chain });

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

  // #18: the candidates carry the Mindat chains Jasper looked up.
  const R = (id: number, name: string, hmin: number | null = null, hmax = hmin): MindatRecord => ({ id, name, hmin, hmax });
  const QUARTZ = R(3337, "Quartz", 7);
  const CHALCEDONY = R(960, "Chalcedony", 6.5, 7);
  const AGATE = [R(51, "Agate", 6.5, 7), CHALCEDONY, QUARTZ];
  const withChain = (list: Candidate[], ...chains: MindatRecord[][]) => list.map((c, i) => ({ ...c, chain: chains[i] ?? [] }));

  it("agrees on the agate named at two levels, with one pill for both models", () => {
    const plan = planPills(
      [...withChain(cands(HAIKU, ["Chalcedony", "Agate, banded"]), AGATE), ...withChain(cands(FLASH, ["Quartz", "Agate"]), AGATE)],
      HAIKU,
    );
    expect(plan.verdict).toBe("probably");
    expect(plan.pills).toHaveLength(1);
    expect(plan.pills[0]).toMatchObject({ name: "Chalcedony", variety: "Agate, banded", models: [HAIKU, FLASH], word: "probably" });
    expect(plan.pills[0].doubt).toBeUndefined();
  });

  it("says when the opinions agree on the stone but not its variety, and takes neither", () => {
    const plan = planPills(
      [
        ...withChain(cands(HAIKU, ["Quartz", "Amethyst"]), [R(198, "Amethyst"), QUARTZ]),
        ...withChain(cands(FLASH, ["Quartz", "Citrine"], ["Quartz", "Smoky"]), [R(1052, "Citrine"), QUARTZ], [R(3700, "Smoky Quartz"), QUARTZ]),
      ],
      HAIKU,
    );
    expect(plan.verdict).toBe("probably");
    expect(plan.pills[0].doubt).toEqual({ level: "Quartz", guesses: ["Amethyst", "Citrine"] });
    expect(plan.pills[0].variety).toBeNull(); // and the smoky further down doesn't fill it
    expect(verdictLine(plan)).toBe("Probably Quartz");
  });

  it("takes the finer variety when one first choice is only less specific", () => {
    const plan = planPills(
      [...withChain(cands(HAIKU, ["Quartz", "Chalcedony"]), [CHALCEDONY, QUARTZ]), ...withChain(cands(FLASH, ["Chalcedony", "Agate"]), AGATE)],
      HAIKU,
    );
    expect(plan.pills[0]).toMatchObject({ name: "Quartz", variety: "Agate", pick: { model: HAIKU, rank: 1 } });
  });

  it("leaves a real disagreement as it was", () => {
    const plan = planPills([...withChain(cands(HAIKU, ["Quartz", "Agate"]), AGATE), ...withChain(cands(FLASH, "Calcite"), [R(859, "Calcite", 3)])], HAIKU);
    expect(plan.verdict).toBe("could_be");
    expect(names(plan)).toEqual(["Quartz", "Calcite"]);
  });

  it("notes on each pill a scratch answer it can't fit", () => {
    const plan = planPills([...withChain(cands(HAIKU, ["Quartz", "Agate"]), AGATE), ...withChain(cands(FLASH, "Calcite"), [R(859, "Calcite", 3)])], HAIKU, {
      glass: "no",
    });
    expect(plan.pills.map((p) => p.misfit?.test ?? null)).toEqual(["glass", null]);
  });

  it("puts the identifier first even when it sorts later", () => {
    expect(byModel([...cands("z/first", "A"), ...cands("a/second", "B")], "z/first").map((l) => l[0].model)).toEqual(["z/first", "a/second"]);
  });

  it("agrees on the piece when each model saw the other's main mineral (the #29 photo)", () => {
    const [haiku] = cands(HAIKU, "Pyrite");
    const [flash, flash2] = cands(FLASH, "Quartz", "Pyrite");
    const plan = planPills([piece(haiku, W("Sphalerite"), ON("Quartz")), piece(flash, W("Pyrite")), flash2], HAIKU);
    expect(plan.verdict).toBe("probably");
    expect(plan.pills).toHaveLength(1); // Flash's Pyrite further down is the same piece
    expect(plan.pills[0]).toMatchObject({ name: "Pyrite", models: [HAIKU, FLASH], parts: [ON("Quartz")], maybe: [W("Sphalerite")] });
    expect(verdictLine(plan)).toBe("Probably Pyrite on Quartz");
  });

  it("says could be when only one model saw the other's main mineral, each pill its whole reading", () => {
    const [haiku] = cands(HAIKU, "Pyrite");
    const plan = planPills([piece(haiku, ON("Quartz")), ...cands(FLASH, "Quartz")], HAIKU);
    expect(plan.verdict).toBe("could_be");
    expect(plan.pills.map((p) => p.parts)).toEqual([[ON("Quartz")], []]);
    expect(plan.pills.every((p) => p.maybe.length === 0)).toBe(true);
    expect(verdictLine(plan)).toBe("Could be Pyrite on Quartz, or Quartz");
  });

  it("agrees on a part through its Mindat chain", () => {
    const [haiku] = cands(HAIKU, "Calcite");
    const [flash] = cands(FLASH, "Calcite");
    const plan = planPills([piece(haiku, ON("Chalcedony", [CHALCEDONY, QUARTZ])), piece(flash, ON("Agate", AGATE))], HAIKU);
    expect(plan.pills[0].parts).toEqual([ON("Chalcedony", [CHALCEDONY, QUARTZ])]);
    expect(plan.pills[0].maybe).toEqual([]);
  });

  it("agrees on Agate on matrix and Chalcedony on matrix through the chain", () => {
    const [haiku] = withChain(cands(HAIKU, ["Chalcedony", "Agate"]), AGATE);
    const [flash] = withChain(cands(FLASH, "Chalcedony"), [CHALCEDONY, QUARTZ]);
    const plan = planPills([piece(haiku, ON("matrix")), piece(flash, ON("matrix"))], HAIKU);
    expect(plan.verdict).toBe("probably");
    expect(plan.pills[0]).toMatchObject({ parts: [ON("matrix")], maybe: [], models: [HAIKU, FLASH] });
    expect(verdictLine(plan)).toBe("Probably Agate on matrix");
  });

  it("keeps the identifier's base as it gave it, and offers the other's as a maybe", () => {
    const [haiku] = cands(HAIKU, "Fluorite");
    const [flash] = cands(FLASH, "Fluorite");
    const plan = planPills([piece(haiku, W("Pyrite"), ON("Quartz")), piece(flash, W("Pyrite"), ON("Calcite"))], HAIKU);
    expect(plan.pills[0].parts).toEqual([W("Pyrite"), ON("Quartz")]);
    expect(plan.pills[0].maybe).toEqual([ON("Calcite")]);
  });

  it("takes matrix from the lead reading, and offers each one-sided mineral once", () => {
    const [haiku] = cands(HAIKU, ["Quartz", "Amethyst"]);
    const [flash] = cands(FLASH, ["Quartz", "Amethyst"]);
    const plan = planPills([piece(haiku, W("Calcite"), ON("matrix")), piece(flash, W("calcite"), W("Goethite"), W("Hematite"))], HAIKU);
    expect(plan.pills[0].parts).toEqual([W("Calcite"), ON("matrix")]);
    expect(plan.pills[0].maybe).toEqual([W("Goethite"), W("Hematite")]);
    expect(verdictLine(plan)).toBe("Probably Amethyst with Calcite on matrix");
  });

  // #62: the honeycomb coral from orchid's job 24, as prompt v3 has the models answer it.
  const CALCITE = R(859, "Calcite", 3);
  const fossil = (c: Candidate, madeOf: string | null, chain?: MindatRecord[]): Candidate => ({ ...c, kind: "other", madeOf: madeOf ? { name: madeOf, chain } : null });

  it("agrees on a fossil coral, and doubts what it is made of when the opinions differ (the honeycomb)", () => {
    const [haiku, haiku2] = cands(HAIKU, "Fossil coral", "Chalcedony");
    const [flash] = cands(FLASH, ["Fossil coral", "Favosites"]);
    const plan = planPills([fossil(haiku, "Calcite", [CALCITE]), haiku2, fossil(flash, "Quartz", [QUARTZ])], HAIKU);
    expect(plan.verdict).toBe("probably");
    expect(plan.pills[0]).toMatchObject({ name: "Fossil coral", variety: "Favosites", kind: "other", models: [HAIKU, FLASH], madeOf: null });
    expect(plan.pills[0].madeOfDoubt).toEqual({ guesses: ["Calcite", "Quartz"] });
    expect(verdictLine(plan)).toBe("Probably Favosites");
    expect(kindOf(plan.pills[0])).toBe("A kind of Fossil Coral");
  });

  it("takes what both opinions say a fossil is made of, through the chain, and the one given when only one says", () => {
    const [haiku] = cands(HAIKU, "Fossil coral");
    const [flash] = cands(FLASH, "Fossil coral");
    const agreed = planPills([fossil(haiku, "Quartz", [QUARTZ]), fossil(flash, "Chalcedony", [CHALCEDONY, QUARTZ])], HAIKU);
    expect(agreed.pills[0].madeOf).toEqual({ name: "Quartz", chain: [QUARTZ] });
    expect(agreed.pills[0].madeOfDoubt).toBeUndefined();
    const oneSided = planPills([fossil(haiku, null), fossil(flash, "Calcite", [CALCITE])], HAIKU);
    expect(oneSided.pills[0].madeOf).toEqual({ name: "Calcite", chain: [CALCITE] });
    expect(oneSided.pills[0].madeOfDoubt).toBeUndefined();
  });

  it("gives a could-be pill its own made of, and a row from before prompt v3 none", () => {
    const [haiku] = cands(HAIKU, "Fossil coral");
    const plan = planPills([fossil(haiku, "Calcite", [CALCITE]), ...cands(FLASH, "Chalcedony")], HAIKU);
    expect(plan.verdict).toBe("could_be");
    expect(plan.pills.map((p) => p.madeOf)).toEqual([{ name: "Calcite", chain: [CALCITE] }, null]);
    const old = planPills([...cands(HAIKU, "Galena"), ...cands(FLASH, "Galena")], HAIKU);
    expect(old.pills[0]).toMatchObject({ madeOf: null });
    expect(old.pills[0].madeOfDoubt).toBeUndefined();
  });

  // #71: each pill carries what the models saw, for the "Why?" under it.
  const seen = (c: Candidate, ...features: string[]): Candidate => ({ ...c, features });

  it("gives the lead pill both first choices' reasons, each once ignoring case, and a runner-up its own plus what folded in", () => {
    const [haiku, haiku2] = cands(HAIKU, "Galena", "Sphalerite");
    const [flash, flash2] = cands(FLASH, "Galena", "Sphalerite");
    const plan = planPills(
      [seen(haiku, "metallic grey", "cubic cleavage"), seen(haiku2, "resinous luster"), seen(flash, "Cubic cleavage", "heavy for its size"), seen(flash2, "brown", "resinous luster")],
      HAIKU,
    );
    expect(plan.pills[0].reasons).toEqual(["metallic grey", "cubic cleavage", "heavy for its size"]);
    expect(plan.pills[1].reasons).toEqual(["resinous luster", "brown"]);
  });

  it("caps the reasons at five, and keeps none from a row that carried none", () => {
    const [haiku] = cands(HAIKU, "Galena");
    const [flash] = cands(FLASH, "Galena");
    const plan = planPills([seen(haiku, "a", "b", "c", "d"), seen(flash, "e", "f", "g")], HAIKU);
    expect(plan.pills[0].reasons).toEqual(["a", "b", "c", "d", "e"]);
    const bare = planPills([...cands(HAIKU, "Galena"), ...cands(FLASH, "Galena")], HAIKU);
    expect(bare.pills[0].reasons).toEqual([]);
  });

  it("keeps the reasons when the piece agrees mineral by mineral rather than by name", () => {
    const [haiku] = cands(HAIKU, "Pyrite");
    const [flash] = cands(FLASH, "Quartz");
    const plan = planPills([seen(piece(haiku, ON("Quartz")), "brassy cubes"), seen(piece(flash, W("Pyrite")), "clear points")], HAIKU);
    expect(plan.verdict).toBe("probably");
    expect(plan.pills[0].reasons).toEqual(["brassy cubes", "clear points"]);
  });

  it("puts no scratch misfit on a piece with parts, since the answer could be about any of them", () => {
    const [haiku] = cands(HAIKU, "Calcite");
    const [flash] = cands(FLASH, "Calcite");
    const calcite = [R(859, "Calcite", 3)];
    const plan = planPills([{ ...piece(haiku, ON("Quartz")), chain: calcite }, { ...piece(flash, ON("Quartz")), chain: calcite }], HAIKU, { glass: "yes" });
    expect(plan.pills[0].misfit).toBeNull();
    const bare = planPills([{ ...haiku, chain: calcite }, { ...flash, chain: calcite }], HAIKU, { glass: "yes" });
    expect(bare.pills[0].misfit?.test).toBe("glass");
  });
});

describe("pieceName", () => {
  it.each([
    [{ name: "Galena" }, "Galena"],
    [{ name: "galena", variety: "  " }, "Galena"],
    [{ name: "Quartz", variety: "Amethyst" }, "Amethyst"],
    [{ name: "Quartz", variety: "milky" }, "Milky Quartz"],
    [{ name: "Quartz", variety: "Rose Quartz" }, "Rose Quartz"],
    [{ name: "Fluorite", parts: [W("pyrite")] }, "Fluorite with Pyrite"],
    [{ name: "Pyrite", parts: [W("Sphalerite"), W("Galena"), ON("Quartz")] }, "Pyrite with Sphalerite and Galena on Quartz"],
    [{ name: "Fluorite", parts: [W("Pyrite"), W("Galena"), W("Sphalerite")] }, "Fluorite with Pyrite, Galena, and Sphalerite"],
    [{ name: "Quartz", variety: "Amethyst", parts: [ON("Matrix")] }, "Amethyst on matrix"],
  ])("names %o as %s", (p, expected) => {
    expect(pieceName(p)).toBe(expected);
  });
});

describe("kindOf", () => {
  it("says what a hobby name is a kind of, and nothing when the name already says it", () => {
    expect(kindOf({ name: "Quartz", variety: "Amethyst" })).toBe("A kind of Quartz");
    expect(kindOf({ name: "chalcedony", variety: "Blue lace agate" })).toBe("A kind of Chalcedony");
    expect(kindOf({ name: "Quartz", variety: "Milky" })).toBeNull();
    expect(kindOf({ name: "Quartz", variety: "Rose quartz" })).toBeNull();
    expect(kindOf({ name: "Galena", variety: null })).toBeNull();
  });
});

describe("madeOfLine", () => {
  it("says what a fossil is made of, capitalized", () => {
    expect(madeOfLine({ name: "calcite" })).toBe("Made of Calcite");
  });
});

describe("ownName", () => {
  it("leads with the hobby name, and puts a colour or look in front of the mineral", () => {
    expect(ownName("Quartz", "Tiger's eye")).toBe("Tiger's Eye");
    expect(ownName("Quartz", "Smoky")).toBe("Smoky Quartz");
    expect(ownName("hematite", "specular")).toBe("Specular Hematite");
    expect(ownName("Quartz", null)).toBe("Quartz");
  });
});

describe("savedParts", () => {
  it("saves the pill's parts and the ticked maybes, withs first and one base", () => {
    const pill = { parts: [ON("Quartz")], maybe: [W("Sphalerite"), W("Galena")] };
    expect(savedParts(pill, [])).toEqual([{ role: "on", name: "Quartz" }]);
    expect(savedParts(pill, ["galena"])).toEqual([
      { role: "with", name: "Galena" },
      { role: "on", name: "Quartz" },
    ]);
  });

  it("keeps the pill's own base, so a second one ticked reads as with", () => {
    const pill = { parts: [ON("matrix")], maybe: [ON("Calcite")] };
    expect(savedParts(pill, ["Calcite"])).toEqual([
      { role: "with", name: "Calcite" },
      { role: "on", name: "matrix" },
    ]);
    expect(savedParts({ parts: [], maybe: [ON("Calcite"), ON("Dolomite")] }, ["Calcite", "Dolomite"])).toEqual([
      { role: "with", name: "Dolomite" },
      { role: "on", name: "Calcite" },
    ]);
  });
});

describe("parseParts", () => {
  it("reads Jasper's parts JSON and leaves out anything malformed", () => {
    expect(parseParts('[{"role":"with","name":" Sphalerite ","mindat_id":3727},{"role":"on","name":"matrix","mindat_id":null}]')).toEqual([
      { role: "with", name: "Sphalerite", mindatId: 3727 },
      { role: "on", name: "matrix", mindatId: null },
    ]);
    expect(parseParts('[{"role":"under","name":"Quartz"},{"role":"on","name":""},{"role":"with"},"Galena",null,{"role":"on","name":"Quartz","mindat_id":"3337"}]')).toEqual([
      { role: "on", name: "Quartz", mindatId: null },
    ]);
    expect(parseParts(null)).toEqual([]);
    expect(parseParts("not json")).toEqual([]);
    expect(parseParts('{"role":"with","name":"Galena"}')).toEqual([]);
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
