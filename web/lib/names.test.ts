import { describe, expect, it } from "vitest";
import { chainOf, finer, norm, sameStone, shared, varietySplit, type MindatRecord, type Named } from "./names";

const c = (name: string, variety: string | null = null) => ({ name, variety });

// Mindat records as Jasper caches them (#18), shaped on the ones checked on 2026-11-02.
const r = (id: number, name: string, hmin: number | null = null, hmax = hmin): MindatRecord => ({ id, name, hmin, hmax });
const QUARTZ = r(3337, "Quartz", 7);
const CHALCEDONY = r(960, "Chalcedony", 6.5, 7);
const AGATE = r(51, "Agate", 6.5, 7);
const CARNELIAN = r(9333, "Carnelian");
const AMETHYST = r(198, "Amethyst");
const CITRINE = r(1052, "Citrine");
const CALCITE = r(859, "Calcite", 3);
const FLUORITE = r(1576, "Fluorite", 4);
const JASPER = r(2082, "Jasper");
const TIGERS_EYE = r(3960, "Tiger's Eye", 7);
const m = (name: string, variety: string | null, chain: MindatRecord[]): Named => ({ name, variety, chain });
const agate = (name: string, variety: string | null) => m(name, variety, [AGATE, CHALCEDONY, QUARTZ]);

describe("norm", () => {
  it("drops case, apostrophes and punctuation", () => {
    expect(norm("Tiger's Eye")).toBe("tigers eye");
    expect(norm("Quartz, var. Amethyst")).toBe("quartz var amethyst");
    expect(norm("  Red-brown  ")).toBe("red brown");
  });
});

// The cases checked by hand for the Phase 0 spike (#1), now asked both ways.
describe("sameStone", () => {
  it.each([
    ["the same mineral, any case", c("Galena"), c("galena")],
    ["a variety is its mineral", c("Quartz", "Amethyst"), c("Amethyst")],
    ["a trade name as the variety", c("Chalcedony", "Blue Lace Agate"), c("Blue lace agate")],
    ["a qualifier on a mineral", c("Specular hematite"), c("Hematite")],
    ["a qualifier on a rock", c("Andesite porphyry"), c("Porphyry")],
    ["a colour variety written into the name", c("Milky quartz"), c("Quartz", "Milky")],
    ["different varieties of one mineral", c("Baryte"), c("Baryte", "Desert rose")],
  ])("agrees: %s", (_why, a, b) => {
    expect(sameStone(a, b)).toBe(true);
    expect(sameStone(b, a)).toBe(true);
  });

  it.each([
    ["a longer mineral name is not the shorter one", c("Chalcopyrite"), c("Pyrite")],
    ["lookalikes stay apart", c("Marcasite"), c("Pyrite")],
    ["two rocks", c("Slate"), c("Specular hematite")],
    ["granite is not conglomerate", c("Granite"), c("Conglomerate")],
    ["a shared colour word in the varieties", c("Fluorite", "Purple"), c("Amethyst", "Deep purple")],
    ["a colour variety against a name that has the colour", c("Amethyst", "Purple"), c("Purple fluorite")],
  ])("differs: %s", (_why, a, b) => {
    expect(sameStone(a, b)).toBe(false);
    expect(sameStone(b, a)).toBe(false);
  });
});

describe("sameStone through Mindat (#18)", () => {
  it.each<[string, Named, Named]>([
    ["the agate named at two levels", agate("Chalcedony", "Agate, banded"), agate("Quartz", "Agate")],
    ["two varieties of quartz", m("Quartz", "Amethyst", [AMETHYST, QUARTZ]), m("Quartz", "Citrine", [CITRINE, QUARTZ])],
    ["two chalcedonies", agate("Chalcedony", "Agate"), m("Chalcedony", "Carnelian", [CARNELIAN, CHALCEDONY, QUARTZ])],
    ["one only less specific", m("Chalcedony", null, [CHALCEDONY, QUARTZ]), agate("Quartz", "Agate")],
    ["a match by name that Mindat would not make", m("Quartz", "Tiger's Eye", [QUARTZ]), m("Tiger's Eye", null, [TIGERS_EYE])],
  ])("agrees: %s", (_why, a, b) => {
    expect(sameStone(a, b)).toBe(true);
    expect(sameStone(b, a)).toBe(true);
  });

  it.each<[string, Named, Named]>([
    ["agate is not calcite", agate("Quartz", "Agate"), m("Calcite", null, [CALCITE])],
    ["jasper is a rock of its own", m("Jasper", null, [JASPER]), m("Chalcedony", null, [CHALCEDONY, QUARTZ])],
    ["a shared colour word still counts for nothing", m("Fluorite", "Purple", [FLUORITE]), m("Quartz", "Deep purple", [QUARTZ])],
    ["without chains, the agate falls back to the names", c("Chalcedony", "Agate, banded"), c("Quartz", "Agate")],
  ])("differs: %s", (_why, a, b) => {
    expect(sameStone(a, b)).toBe(false);
    expect(sameStone(b, a)).toBe(false);
  });
});

describe("shared, varietySplit and finer", () => {
  it("finds the deepest record two chains share", () => {
    expect(shared(agate("Chalcedony", "Agate, banded"), agate("Quartz", "Agate"))).toEqual(AGATE);
    expect(shared(agate("Quartz", "Agate"), m("Chalcedony", "Carnelian", [CARNELIAN, CHALCEDONY, QUARTZ]))).toEqual(CHALCEDONY);
    expect(shared(agate("Quartz", "Agate"), m("Calcite", null, [CALCITE]))).toBeNull();
    expect(shared(agate("Quartz", "Agate"), c("Quartz", "Agate"))).toBeNull();
  });

  it("parts on the variety only when both sit below the shared level", () => {
    expect(varietySplit(m("Quartz", "Amethyst", [AMETHYST, QUARTZ]), m("Quartz", "Citrine", [CITRINE, QUARTZ]))).toEqual({
      level: QUARTZ,
      guesses: [AMETHYST, CITRINE],
    });
    expect(varietySplit(agate("Chalcedony", "Agate, banded"), agate("Quartz", "Agate"))).toBeNull();
    expect(varietySplit(m("Chalcedony", null, [CHALCEDONY, QUARTZ]), agate("Quartz", "Agate"))).toBeNull();
  });

  it("knows a finer name from a coarser one", () => {
    expect(finer(agate("Quartz", "Agate"), m("Chalcedony", null, [CHALCEDONY, QUARTZ]))).toBe(true);
    expect(finer(m("Chalcedony", null, [CHALCEDONY, QUARTZ]), agate("Quartz", "Agate"))).toBe(false);
    expect(finer(agate("Quartz", "Agate"), agate("Chalcedony", "Agate"))).toBe(false);
  });
});

describe("chainOf", () => {
  const rows = (...rs: Array<[MindatRecord, number | null]>) => new Map(rs.map(([rec, up]) => [rec.id, { ...rec, varietyof: up }]));

  it("walks varietyof up from the candidate's record", () => {
    const records = rows([AGATE, CHALCEDONY.id], [CHALCEDONY, QUARTZ.id], [QUARTZ, null]);
    expect(chainOf(AGATE.id, records)).toEqual([AGATE, CHALCEDONY, QUARTZ]);
    expect(chainOf(null, records)).toEqual([]);
  });

  it("stops at a record not cached, at the cap, and at a loop", () => {
    expect(chainOf(AGATE.id, rows([AGATE, CHALCEDONY.id]))).toEqual([AGATE]);
    const long = rows(...Array.from({ length: 10 }, (_, i): [MindatRecord, number] => [r(100 + i, `Level ${i}`), 101 + i]));
    expect(chainOf(100, long)).toHaveLength(6);
    expect(chainOf(1, rows([r(1, "A"), 2], [r(2, "B"), 1]))).toHaveLength(2);
  });
});
