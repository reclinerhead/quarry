import { describe, expect, it } from "vitest";
import { MOHS_SET, mohsCard, mohsRowLabel, mohsSet, placeOf, referenceSlot, type StoneNames } from "./mohs";

describe("MOHS_SET", () => {
  it("is Mohs's ten, talc to diamond", () => {
    expect(MOHS_SET.map((r) => r.name)).toEqual(["Talc", "Gypsum", "Calcite", "Fluorite", "Apatite", "Orthoclase", "Quartz", "Topaz", "Corundum", "Diamond"]);
    expect(MOHS_SET.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("referenceSlot", () => {
  it("fills a slot by the mineral's own name, folded", () => {
    expect(referenceSlot(["Fluorite"])).toBe(4);
    expect(referenceSlot(["fluorite"])).toBe(4);
    expect(referenceSlot(["Diamond"])).toBe(10);
  });

  it("fills a slot through the chain, and Apatite's by its group's species", () => {
    expect(referenceSlot(["Amethyst", "Quartz"])).toBe(7);
    expect(referenceSlot(["Agate", "Chalcedony", "Quartz"])).toBe(7);
    expect(referenceSlot(["Ruby", "Corundum"])).toBe(9);
    expect(referenceSlot(["Fluorapatite"])).toBe(5);
  });

  it("fills none for anything else", () => {
    expect(referenceSlot(["Galena"])).toBeNull();
    expect(referenceSlot([])).toBeNull();
  });
});

describe("placeOf", () => {
  it("puts a hardness between the references around it, or on one's number", () => {
    expect(placeOf([2.5, 2.5])).toEqual({ kind: "between", below: { n: 2, name: "Gypsum" }, above: { n: 3, name: "Calcite" } });
    expect(placeOf([6, 6.5])).toEqual({ kind: "between", below: { n: 6, name: "Orthoclase" }, above: { n: 7, name: "Quartz" } });
    expect(placeOf([5.5, 7])).toEqual({ kind: "between", below: { n: 5, name: "Apatite" }, above: { n: 7, name: "Quartz" } });
    expect(placeOf([4, 4])).toEqual({ kind: "same", as: { n: 4, name: "Fluorite" } });
  });

  it("stays on the scale", () => {
    expect(placeOf([0.5, 1])).toEqual({ kind: "same", as: { n: 1, name: "Talc" } });
    expect(placeOf([10, 10.5])).toEqual({ kind: "same", as: { n: 10, name: "Diamond" } });
  });
});

const CALCITE: StoneNames = { id: 1, createdAt: "2026-10-01T10:00:00Z", names: ["Calcite"] };
const FLUORITE: StoneNames = { id: 2, createdAt: "2026-10-05T10:00:00Z", names: ["Fluorite"] };
const MILKY: StoneNames = { id: 3, createdAt: "2026-10-09T10:00:00Z", names: ["Quartz"] };
const GALENA: StoneNames = { id: 4, createdAt: "2026-10-10T10:00:00Z", names: ["Galena"] };
const FLUORITE_2: StoneNames = { id: 5, createdAt: "2026-10-12T10:00:00Z", names: ["Fluorite"] };
const STONES = [GALENA, MILKY, FLUORITE_2, CALCITE, FLUORITE];

const states = (id: number, range: [number, number] | null) => mohsCard(id, STONES, range).slots.map((s) => s.state).join("");

describe("mohsCard", () => {
  it("marks this stone's slot, the rest of the collection's as owned, and the others missing", () => {
    // 1 2 3 4 5 6 7 8 9 10, m = missing, o = owned, t = this
    expect(states(2, [4, 4]).replace(/missing/g, "m").replace(/owned/g, "o").replace(/this/g, "t")).toBe("mmotmmommm");
    expect(states(4, [2.5, 2.5]).replace(/missing/g, "m").replace(/owned/g, "o").replace(/this/g, "t")).toBe("mmoommommm");
  });

  it("says whether this stone was the first of its reference mineral", () => {
    expect(mohsCard(2, STONES, [4, 4])).toMatchObject({ reference: { n: 4, name: "Fluorite" }, first: true, place: null });
    expect(mohsCard(5, STONES, [4, 4])).toMatchObject({ reference: { n: 4, name: "Fluorite" }, first: false });
    expect(mohsCard(3, STONES, [7, 7])).toMatchObject({ reference: { n: 7, name: "Quartz" }, first: true });
  });

  it("places a stone off the set by its hardness, and nowhere without one", () => {
    expect(mohsCard(4, STONES, [2.5, 2.5])).toMatchObject({ reference: null, first: false, range: [2.5, 2.5], place: { kind: "between", below: { n: 2 }, above: { n: 3 } } });
    expect(mohsCard(4, STONES, null)).toMatchObject({ reference: null, range: null, place: null });
  });

  it("still shows the collection's slots for a stone it doesn't know", () => {
    expect(states(99, null).replace(/missing/g, "m").replace(/owned/g, "o")).toBe("mmoommommm");
  });
});

describe("mohsRowLabel", () => {
  it("says the row in words", () => {
    expect(mohsRowLabel(mohsCard(2, STONES, [4, 4]), "Fluorite")).toBe("Mohs scale 1 to 10, with 4 highlighted for this Fluorite, and 3 and 7 in your set");
    expect(mohsRowLabel(mohsCard(4, STONES, [2.5, 2.5]), "Galena")).toBe("Mohs scale 1 to 10, with 3, 4 and 7 in your set");
    expect(mohsRowLabel(mohsCard(1, [CALCITE], [3, 3]), "Calcite")).toBe("Mohs scale 1 to 10, with 3 highlighted for this Calcite, and none in your set yet");
  });
});

describe("mohsSet", () => {
  const today = (iso: string) => iso.startsWith("2026-10-12");

  it("lists each slot with the stone that filled it, new when that stone came today", () => {
    const set = mohsSet(STONES, today);
    expect(set.owned).toBe(3);
    expect(set.slots.map((s) => `${s.n}${s.state[0]}`).join(" ")).toBe("1m 2m 3o 4o 5m 6m 7o 8m 9m 10m");
    expect(set.slots[3].stone?.id).toBe(2); // the first Fluorite, not today's second one
  });

  it("marks a slot new only when its first stone came today, and owns through a variety's chain", () => {
    const amethyst: StoneNames = { id: 9, createdAt: "2026-10-12T09:00:00Z", names: ["Amethyst", "Quartz"] };
    const set = mohsSet([GALENA, amethyst, FLUORITE_2], today);
    expect(set.slots.map((s) => s.state)).toEqual(["missing", "missing", "missing", "new", "missing", "missing", "new", "missing", "missing", "missing"]);
    expect(set.slots[6].stone?.id).toBe(9);
    expect(mohsSet([], today)).toEqual({ slots: MOHS_SET.map((r) => ({ ...r, state: "missing", stone: null })), owned: 0 });
  });
});
