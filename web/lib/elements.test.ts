import { describe, expect, it } from "vitest";
import { cellOf, ELEMENTS, elementsCard, elementsLine, elementsOf, parseElements, periodicTable, pieceElements, type StoneElements, type StoneMinerals } from "./elements";

const sym = (es: { symbol: string }[]) => es.map((e) => e.symbol);
const el = (...symbols: string[]) => symbols.map((s) => ELEMENTS.find((e) => e.symbol === s)!);

describe("ELEMENTS", () => {
  it("numbers all 118 in order", () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(ELEMENTS[0]).toEqual({ symbol: "H", number: 1, name: "Hydrogen", row: 1, col: 1 });
    expect(ELEMENTS[19]).toEqual({ symbol: "Ca", number: 20, name: "Calcium", row: 4, col: 2 });
    expect(ELEMENTS[117]).toEqual({ symbol: "Og", number: 118, name: "Oganesson", row: 7, col: 18 });
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
  });
});

describe("parseElements", () => {
  it("reads Mindat's comma-joined symbols in order, with numbers and names", () => {
    expect(sym(parseElements("Ca,F"))).toEqual(["Ca", "F"]);
    expect(parseElements("Ca,F").map((e) => [e.number, e.name])).toEqual([[20, "Calcium"], [9, "Fluorine"]]);
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

describe("cellOf", () => {
  it("puts every element in its own cell on the 18-column table", () => {
    const cells = new Set(ELEMENTS.map((e) => `${e.row},${e.col}`));
    expect(cells.size).toBe(118);
    for (const e of ELEMENTS) {
      expect(e.col, e.symbol).toBeGreaterThanOrEqual(1);
      expect(e.col, e.symbol).toBeLessThanOrEqual(18);
      expect(e.row, e.symbol).toBeGreaterThanOrEqual(1);
      expect(e.row, e.symbol).toBeLessThanOrEqual(9);
    }
  });

  it("places the corners and the blocks as the standard table does", () => {
    expect(cellOf(2)).toEqual({ row: 1, col: 18 }); // He
    expect(cellOf(5)).toEqual({ row: 2, col: 13 }); // B
    expect(cellOf(11)).toEqual({ row: 3, col: 1 }); // Na
    expect(cellOf(26)).toEqual({ row: 4, col: 8 }); // Fe
    expect(cellOf(56)).toEqual({ row: 6, col: 2 }); // Ba
    expect(cellOf(72)).toEqual({ row: 6, col: 4 }); // Hf
    expect(cellOf(86)).toEqual({ row: 6, col: 18 }); // Rn
    expect(cellOf(104)).toEqual({ row: 7, col: 4 }); // Rf
  });

  it("pulls the lanthanides and actinides out into rows 8 and 9, under columns 3 to 17", () => {
    expect(cellOf(57)).toEqual({ row: 8, col: 3 }); // La
    expect(cellOf(71)).toEqual({ row: 8, col: 17 }); // Lu
    expect(cellOf(89)).toEqual({ row: 9, col: 3 }); // Ac
    expect(cellOf(103)).toEqual({ row: 9, col: 17 }); // Lr
    expect(ELEMENTS.filter((e) => e.row === 6 && e.col === 3)).toEqual([]);
  });
});

// A Calcite, a Fluorite, then a Pyrite with Sphalerite on Quartz.
const mineral = (name: string, ...symbols: string[]) => ({ name, elements: el(...symbols), formula: null });
const P_CALCITE: StoneMinerals = { id: 1, createdAt: "2026-10-01T10:00:00Z", minerals: [mineral("Calcite", "Ca", "C", "O")] };
const P_FLUORITE: StoneMinerals = { id: 2, createdAt: "2026-10-05T10:00:00Z", minerals: [mineral("Fluorite", "Ca", "F")] };
const P_PYRITE: StoneMinerals = {
  id: 3,
  createdAt: "2026-10-09T10:00:00Z",
  minerals: [mineral("Pyrite", "Fe", "S"), mineral("Sphalerite", "Zn", "S"), mineral("Quartz", "Si", "O")],
};
const P_GRANITE: StoneMinerals = { id: 4, createdAt: "2026-10-10T10:00:00Z", minerals: [mineral("Granite")] };
const PIECES = [P_GRANITE, P_PYRITE, P_CALCITE, P_FLUORITE];

describe("pieceElements", () => {
  it("takes the main mineral's elements first, then each companion's, each once", () => {
    expect(sym(pieceElements(P_PYRITE))).toEqual(["Fe", "S", "Zn", "Si", "O"]);
    expect(sym(pieceElements(P_GRANITE))).toEqual([]);
  });
});

describe("periodicTable", () => {
  const table = periodicTable(PIECES);

  it("lights each element once, by atomic number, with its stones newest first and the mineral that carries it", () => {
    expect(table.lit.map((l) => l.element.symbol)).toEqual(["C", "O", "F", "Si", "S", "Ca", "Fe", "Zn"]);
    const o = table.lit.find((l) => l.element.symbol === "O")!;
    expect(o.stones.map((s) => [s.stone.id, s.mineral.name])).toEqual([[3, "Quartz"], [1, "Calcite"]]);
    const s = table.lit.find((l) => l.element.symbol === "S")!;
    expect(s.stones.map((x) => [x.stone.id, x.mineral.name])).toEqual([[3, "Pyrite"]]);
  });

  it("counts the stones that carry anything, and names the element that arrived last", () => {
    expect(table.stones).toBe(3);
    expect(table.newest?.stone.id).toBe(3);
    expect(sym(table.newest!.elements)).toEqual(["Fe", "S", "Zn", "Si"]);
    expect(periodicTable([P_GRANITE])).toEqual({ lit: [], stones: 0, newest: null });
    const two = periodicTable([P_FLUORITE, P_CALCITE]).newest!;
    expect([two.stone.id, sym(two.elements)]).toEqual([2, ["F"]]);
  });

  it("marks a companion's element new on the stone page when no earlier stone carried it", () => {
    const stones = PIECES.map((p) => ({ id: p.id, createdAt: p.createdAt, elements: pieceElements(p) }));
    expect(elementsCard(3, stones).tiles.map((t) => [t.symbol, t.isNew])).toEqual([["Fe", true], ["S", true], ["Zn", true], ["Si", true], ["O", false]]);
    expect(elementsCard(3, stones).lit).toBe(8);
  });
});
