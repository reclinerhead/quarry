import { describe, expect, it } from "vitest";
import { fold, formulaSegments, glowOf, gravityLabel, lusterLabel, plain, propertyCard, type ChainRecord } from "./mindat";

// Shaped on Mindat's own records, fetched on 2026-11-02 (#21): the fields the card reads.
function rec(id: number, name: string, entrytype: string, d: Record<string, unknown> | null,
             hmin: number | null = null, hmax: number | null = null, streak: string | null = null): ChainRecord {
  return { id, name, entrytype, hmin, hmax, streak, detail: d };
}

const FLUORITE = rec(1576, "Fluorite", "mineral", {
  mindat_formula: "CaF<sub>2</sub>", csystem: "Isometric", lustretype: "Vitreous,Dull", cleavagetype: "Perfect",
  dmeas: "3.175", dmeas2: "3.56", dcalc: "3.181", strunz10ed1: "3",
  uv: "Blue under LW-UV, due to Eu<sup>2+</sup>; other colors caused by different activators (white & cream - organic matter). Red (Mapimi, Mexico), pink (Doña Ana claims, AZ), white (Sterling Hill, NJ). Green response points to ytterbium (Siddike et al. 2003).\r\nMay also be phosphorescent.\r\n\r\nA distinct peak for photoluminescence is observed at 424 nm in all samples, corresponding to the characteristic luminescence of the rare-earth element Eu2+. The emitted light falls within the violet-blue region of the visible spectrum.",
  luminescence: "Fluorescent, Short UV=blue, Long UV=blue.",
}, 4, 4, "White");
const QUARTZ = rec(3337, "Quartz", "mineral", {
  mindat_formula: "SiO<sub>2</sub>", csystem: "Trigonal", lustretype: "Vitreous", cleavagetype: "Poor/Indistinct",
  dmeas: "2.65", dmeas2: "2.66", dcalc: "2.66", strunz10ed1: "4", uv: "", luminescence: "Triboluminescent",
}, 7, 7, "White");
const CHALCEDONY = rec(960, "Chalcedony", "variety", {
  mindat_formula: "SiO<sub>2</sub>", csystem: "", lustretype: "Waxy,Dull", cleavagetype: "None Observed",
  dmeas: "2.6", dmeas2: "2.6", dcalc: "0", strunz10ed1: "0",
  uv: "None in a pure specimen, however, green fluorescence in short-wave UV light is very common at many localities.", luminescence: "",
}, 6.5, 7, "White");
const AMETHYST = rec(198, "Amethyst", "variety", {
  mindat_formula: "SiO<sub>2</sub>", csystem: "", lustretype: "Vitreous", cleavagetype: "", dmeas: "0", dmeas2: "0", dcalc: "0", strunz10ed1: "0",
});
const GRANITE = rec(48141, "Granite", "rock", { mindat_formula: "", csystem: "", lustretype: "", dmeas: "", strunz10ed1: "", uv: "" });

describe("fold", () => {
  it("folds a name as Jasper does", () => {
    expect(fold("Hématite")).toBe("hematite");
    expect(fold("Tiger’s  Eye")).toBe("tiger's eye");
    expect(fold("  Rose   QUARTZ ")).toBe("rose quartz");
  });
});

describe("formulaSegments", () => {
  it("keeps subscripts and superscripts as positions", () => {
    expect(formulaSegments("CaF<sub>2</sub>")).toEqual([{ text: "CaF", pos: null }, { text: "2", pos: "sub" }]);
    expect(formulaSegments("Fe<sup>2+</sup>Fe<sup>3+</sup><sub>2</sub>O<sub>4</sub>")).toEqual([
      { text: "Fe", pos: null }, { text: "2+", pos: "sup" }, { text: "Fe", pos: null }, { text: "3+", pos: "sup" },
      { text: "2", pos: "sub" }, { text: "O", pos: null }, { text: "4", pos: "sub" },
    ]);
  });

  it("decodes entities, drops other tags with their text kept, and leaves a plain formula whole", () => {
    expect(formulaSegments("CaSO<sub>4</sub>&middot;2H<sub>2</sub>O").map((s) => s.text).join("")).toBe("CaSO4·2H2O");
    expect(formulaSegments("Ca<sub>5</sub>(PO<sub>4</sub>)<sub>3</sub><b>X</b>")).toEqual([
      { text: "Ca", pos: null }, { text: "5", pos: "sub" }, { text: "(PO", pos: null }, { text: "4", pos: "sub" },
      { text: ")", pos: null }, { text: "3", pos: "sub" }, { text: "X", pos: null },
    ]);
    expect(formulaSegments(" PbS ")).toEqual([{ text: "PbS", pos: null }]);
  });
});

describe("plain", () => {
  it("drops tags, decodes entities and collapses whitespace", () => {
    expect(plain("Lead-grey\r\n")).toBe("Lead-grey");
    expect(plain("r<mi>{10_11}</mi>  &amp; more")).toBe("r{10_11} & more");
  });
});

describe("lusterLabel", () => {
  it("takes the first listed, in plain words, and passes an unknown one through", () => {
    expect(lusterLabel("Vitreous,Dull")).toBe("Glassy (vitreous)");
    expect(lusterLabel("Metallic,Sub-Metallic,Dull")).toBe("Metallic");
    expect(lusterLabel("Sub-Adamantine")).toBe("Nearly brilliant (sub-adamantine)");
    expect(lusterLabel("Splendent")).toBe("Splendent");
    expect(lusterLabel("")).toBeNull();
  });
});

describe("gravityLabel", () => {
  it("gives one value, or a range when the second is larger", () => {
    expect(gravityLabel("4.50", "4.50", "4.50")).toBe("4.5");
    expect(gravityLabel("3.175", "3.56", "3.181")).toBe("3.18 to 3.56");
    expect(gravityLabel("2.6", "0", "0")).toBe("2.6");
  });

  it("falls back to the calculated value, and has none for zeros", () => {
    expect(gravityLabel("0", "0", "5.2")).toBe("5.2");
    expect(gravityLabel("0", "0", "0")).toBeNull();
    expect(gravityLabel(null, null, null)).toBeNull();
  });

  it("rounds half up on the digits as written", () => {
    expect(gravityLabel("2.7102", "2.7102", "2.711")).toBe("2.71");
    expect(gravityLabel("7.60", "7.60", "7.57")).toBe("7.6");
    expect(gravityLabel("2.168", null, null)).toBe("2.17");
  });
});

describe("glowOf", () => {
  it.each([
    ["Galena", "Not fluorescent in UV.", "None"],
    ["Hematite", "None.", "None"],
    ["Marcasite", "Not fluorescent in ultraviolet light", ""],
    ["Pyrite", "Not fluorescent in UV", ""],
    ["Schorl", "", "Nonfluorescent."],
    ["Almandine", "", "Non-fluorescent"],
    ["Microcline", "", "None"],
  ])("%s doesn't glow", (_, uv, lum) => {
    expect(glowOf(uv, lum)).toEqual({ glow: "no", detail: null });
  });

  it.each([
    ["Talc", "Not usually fluorescent.", ""],
    ["Topaz", "Rarely yellow, white, orange, greenish-yellow", "Fluorescent, Short UV=golden yellow, Long UV=cream."],
  ])("%s rarely glows", (_, uv, lum) => {
    expect(glowOf(uv, lum)?.glow).toBe("rarely");
  });

  it.each([
    ["Fluorite", FLUORITE.detail!.uv as string, "Fluorescent, Short UV=blue, Long UV=blue."],
    ["Calcite", "May be fluorescent under LW UV, mid-range UV or SW UV as well as under X-rays.", "Fluorescent"],
    ["Dolomite", "Some types fluoresce white, blue white, creamy yellow, etc. in either LW or SW UV.", "None"],
    ["Halite", "Red (SW UV)[Searles Lake, CA]. Orange (SW) [Poland]", ""],
    ["Diamond", "Some - blue, also phosphorescent", "Some stones fluoresce pale blue, green, yellow, and, rarely, other colours."],
    ["Chalcedony", CHALCEDONY.detail!.uv as string, ""],
  ])("%s can glow", (_, uv, lum) => {
    expect(glowOf(uv, lum)?.glow).toBe("can");
  });

  it("says nothing when neither field is about UV", () => {
    expect(glowOf("", "Triboluminescent")).toBeNull();
    expect(glowOf(null, null)).toBeNull();
  });

  it("gives Mindat's words in whole sentences, markup removed, wave bands spelled out", () => {
    expect(glowOf(CHALCEDONY.detail!.uv as string, "")?.detail).toBe(CHALCEDONY.detail!.uv);
    expect(glowOf("Red (SW UV)[Searles Lake, CA]. Orange (SW) [Poland]", "")?.detail).toBe("Red (short-wave UV)[Searles Lake, CA]. Orange (short-wave) [Poland]");
    expect(glowOf("Rarely yellow, white, orange, greenish-yellow", "")?.detail).toBe("Rarely yellow, white, orange, greenish-yellow");
  });

  it("adds sentences after the first while the note stays within 160 characters", () => {
    expect(glowOf(FLUORITE.detail!.uv as string, "")?.detail).toBe(
      "Blue under long-wave UV, due to Eu2+; other colors caused by different activators (white & cream - organic matter).",
    );
    const gypsum = "Common and varied. The most common colours of fluorescence are baby blue and shades of golden yellow to yellow. Selenite crystals often exhibit zoned \"hourglass\" fluorescence in zones that may, or may not, be evident in ordinary light.";
    expect(glowOf(gypsum, "")?.detail).toBe("Common and varied. The most common colours of fluorescence are baby blue and shades of golden yellow to yellow.");
  });

  it("keeps the first sentence whole however long, and doesn't end one at \"et al.\"", () => {
    const long = "Green, after Siddike et al. 2003, who traced the response to ytterbium in fluorite from many localities and compared it with the other activators known in the mineral. Also blue.";
    expect(glowOf(long, "Fluorescent")?.detail).toBe(long.slice(0, long.indexOf(" Also")));
  });
});

describe("propertyCard", () => {
  it("fills every cell for a mineral, in the canvas's order", () => {
    const card = propertyCard([FLUORITE], false);
    expect(card.state).toBe("cells");
    expect(card.mindatId).toBe(1576);
    expect(card.cells.map((c) => [c.label, c.value])).toEqual([
      ["Formula", "CaF2"],
      ["Mohs hardness", "4"],
      ["Crystal system", "Cubic (isometric)"],
      ["Luster", "Glassy (vitreous)"],
      ["Streak", "White"],
      ["Cleavage", "Perfect"],
      ["Specific gravity", "3.18 to 3.56"],
      ["Fluorescence", "Can glow"],
    ]);
    expect(card.cells[0].segments).toEqual([{ text: "CaF", pos: null }, { text: "2", pos: "sub" }]);
    expect(card.cells.at(-1)?.detail).toMatch(/^Blue under long-wave UV/);
    expect([card.mineralClass, card.mohs, card.glow]).toEqual(["Halide", "4", "can"]);
  });

  it("takes what a variety lacks from the record above, and keeps what it has", () => {
    const card = propertyCard([CHALCEDONY, QUARTZ], false);
    const cells = Object.fromEntries(card.cells.map((c) => [c.key, c.value]));
    expect(cells).toMatchObject({ hardness: "6.5 to 7", crystalSystem: "Trigonal", luster: "Waxy", cleavage: "None", specificGravity: "2.6", fluorescence: "Can glow" });
    expect(card.mineralClass).toBe("Oxide");
  });

  it("gives a variety its parent's hardness and hides a glow neither one has", () => {
    const card = propertyCard([AMETHYST, QUARTZ], false);
    const cells = Object.fromEntries(card.cells.map((c) => [c.key, c.value]));
    expect(cells).toMatchObject({ hardness: "7", crystalSystem: "Trigonal", specificGravity: "2.65 to 2.66", cleavage: "Poor" });
    expect(cells.fluorescence).toBeUndefined();
    expect(card.glow).toBeNull();
  });

  it("is empty for a rock Mindat records nothing about", () => {
    expect(propertyCard([GRANITE], false)).toMatchObject({ state: "empty", mindatId: 48141, cells: [], mineralClass: null, mohs: null });
  });

  it("is unknown for a name Mindat doesn't have, and pending before Jasper links or fetches it", () => {
    expect(propertyCard([], true)).toMatchObject({ state: "unknown", mindatId: null });
    expect(propertyCard([], false)).toMatchObject({ state: "pending", mindatId: null });
    expect(propertyCard([{ ...FLUORITE, detail: null }], false)).toMatchObject({ state: "pending", mindatId: 1576, cells: [] });
  });

  it("shows a value not on Mindat's lists as written", () => {
    const odd = rec(1, "Oddite", "mineral", { csystem: "Icosahedral", cleavagetype: "Eminent" });
    expect(propertyCard([odd], false).cells.map((c) => c.value)).toEqual(["Icosahedral", "Eminent"]);
  });
});
