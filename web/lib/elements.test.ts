import { describe, expect, it } from "vitest";
import { ELEMENTS, elementsCard, elementsLine, elementsOf, parseElements, type StoneElements } from "./elements";

const sym = (es: { symbol: string }[]) => es.map((e) => e.symbol);
const el = (...symbols: string[]) => symbols.map((s) => ELEMENTS.find((e) => e.symbol === s)!);

describe("ELEMENTS", () => {
  it("numbers all 118 in order", () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(ELEMENTS[0]).toEqual({ symbol: "H", number: 1, name: "Hydrogen" });
    expect(ELEMENTS[19]).toEqual({ symbol: "Ca", number: 20, name: "Calcium" });
    expect(ELEMENTS[117]).toEqual({ symbol: "Og", number: 118, name: "Oganesson" });
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
  });
});

describe("parseElements", () => {
  it("reads Mindat's comma-joined symbols in order, with numbers and names", () => {
    expect(parseElements("Ca,F")).toEqual([
      { symbol: "Ca", number: 20, name: "Calcium" },
      { symbol: "F", number: 9, name: "Fluorine" },
    ]);
  });

  it("tolerates spaces, an array, a JSON array, and drops what isn't a symbol or is repeated", () => {
    expect(sym(parseElements(" Si, O "))).toEqual(["Si", "O"]);
    expect(sym(parseElements(["Fe", "S"]))).toEqual(["Fe", "S"]);
    expect(sym(parseElements('["Pb","S"]'))).toEqual(["Pb", "S"]);
    expect(sym(parseElements("Ca,Xx,F,Ca"))).toEqual(["Ca", "F"]);
  });

  it("has none for Mindat's none", () => {
    expect(parseElements("")).toEqual([]);
    expect(parseElements("0")).toEqual([]);
    expect(parseElements(null)).toEqual([]);
    expect(parseElements(undefined)).toEqual([]);
    expect(parseElements("[oops")).toEqual([]);
  });
});

describe("elementsOf", () => {
  it("takes the mineral's own elements, or the first record above that lists any", () => {
    expect(sym(elementsOf([{ detail: { elements: "Ca,F" } }]))).toEqual(["Ca", "F"]);
    expect(sym(elementsOf([{ detail: { elements: "" } }, { detail: { elements: "Si,O" } }]))).toEqual(["Si", "O"]);
  });

  it("has none for a rock, and none until the mineral's own record is fetched", () => {
    expect(elementsOf([{ detail: {} }])).toEqual([]);
    expect(elementsOf([])).toEqual([]);
    expect(elementsOf([{ detail: null }, { detail: { elements: "Si,O" } }])).toEqual([]);
  });
});

// Three stones in the order they were added: a Calcite, then a Fluorite, then a Quartz.
const CALCITE: StoneElements = { id: 1, createdAt: "2026-10-01T10:00:00Z", elements: el("Ca", "C", "O") };
const FLUORITE: StoneElements = { id: 2, createdAt: "2026-10-05T10:00:00Z", elements: el("Ca", "F") };
const QUARTZ: StoneElements = { id: 3, createdAt: "2026-10-09T10:00:00Z", elements: el("Si", "O") };
const STONES = [QUARTZ, CALCITE, FLUORITE];

describe("elementsCard", () => {
  it("marks the first stone's elements all new, and on a later stone only what no earlier one carries", () => {
    expect(elementsCard(1, STONES).tiles.map((t) => [t.symbol, t.isNew])).toEqual([["Ca", true], ["C", true], ["O", true]]);
    expect(elementsCard(2, STONES).tiles.map((t) => [t.symbol, t.isNew])).toEqual([["Ca", false], ["F", true]]);
    expect(elementsCard(3, STONES).tiles.map((t) => [t.symbol, t.isNew])).toEqual([["Si", true], ["O", false]]);
  });

  it("counts the distinct elements lit across the collection", () => {
    expect(elementsCard(2, STONES).lit).toBe(5);
    expect(elementsCard(2, [FLUORITE]).lit).toBe(2);
  });

  it("breaks a tie on the date by id, and has no tiles for a stone with no elements", () => {
    const a: StoneElements = { id: 7, createdAt: "2026-10-01T10:00:00Z", elements: el("Au") };
    const b: StoneElements = { id: 8, createdAt: "2026-10-01T10:00:00Z", elements: el("Au") };
    expect(elementsCard(7, [b, a]).tiles[0].isNew).toBe(true);
    expect(elementsCard(8, [b, a]).tiles[0].isNew).toBe(false);
    expect(elementsCard(9, [a, b, { id: 9, createdAt: "2026-10-02T10:00:00Z", elements: [] }])).toEqual({ tiles: [], lit: 1 });
  });
});

describe("elementsLine", () => {
  const card = (news: Array<[string, boolean]>, lit: number) => ({
    tiles: news.map(([s, isNew]) => ({ ...ELEMENTS.find((e) => e.symbol === s)!, isNew })),
    lit,
  });

  it("names what is new, then the count", () => {
    expect(elementsLine(card([["Ca", false], ["F", true]], 14))).toBe("Fluorine is new to your periodic table. You now have 14 elements lit.");
    expect(elementsLine(card([["Ca", true], ["F", true]], 2))).toBe("Calcium and fluorine are new to your periodic table. You now have 2 elements lit.");
    expect(elementsLine(card([["Fe", true], ["O", true], ["Si", true]], 3))).toBe("Iron, oxygen and silicon are new to your periodic table. You now have 3 elements lit.");
  });

  it("says when nothing is new, for one, two or more elements", () => {
    expect(elementsLine(card([["C", false]], 1))).toBe("Carbon was already on your periodic table. You have 1 element lit.");
    expect(elementsLine(card([["Ca", false], ["F", false]], 14))).toBe("Both were already on your periodic table. You have 14 elements lit.");
    expect(elementsLine(card([["Ca", false], ["Mg", false], ["C", false], ["O", false]], 14))).toBe("All four were already on your periodic table. You have 14 elements lit.");
  });
});
