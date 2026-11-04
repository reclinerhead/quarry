import { describe, expect, it } from "vitest";
import { countLine, moveEarlier, moveLater, nextCaseName, pickerRows, placeAt, stoneLine, takeOut } from "./cases";
import type { Tile } from "./collection";

describe("moving a stone within its case", () => {
  it("swaps with the neighbour and leaves the ends alone", () => {
    expect(moveEarlier([1, 2, 3], 2)).toEqual([2, 1, 3]);
    expect(moveLater([1, 2, 3], 2)).toEqual([1, 3, 2]);
    expect(moveEarlier([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(moveLater([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("changes nothing for a stone that isn't in the case, and never the list it was given", () => {
    const order = [1, 2, 3];
    expect(moveEarlier(order, 9)).toEqual([1, 2, 3]);
    expect(moveLater(order, 9)).toEqual([1, 2, 3]);
    moveLater(order, 1);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("takeOut", () => {
  it("removes one and keeps the rest in order", () => {
    expect(takeOut([1, 2, 3], 2)).toEqual([1, 3]);
    expect(takeOut([1, 2, 3], 9)).toEqual([1, 2, 3]);
  });
});

describe("placeAt", () => {
  it("inserts a new stone at an index", () => {
    expect(placeAt([1, 2, 3], 9, 0)).toEqual([9, 1, 2, 3]);
    expect(placeAt([1, 2, 3], 9, 2)).toEqual([1, 2, 9, 3]);
  });

  it("appends at the end, and clamps an index past it or below zero", () => {
    expect(placeAt([1, 2, 3], 9, 3)).toEqual([1, 2, 3, 9]);
    expect(placeAt([1, 2, 3], 9, 40)).toEqual([1, 2, 3, 9]);
    expect(placeAt([1, 2, 3], 9, -4)).toEqual([9, 1, 2, 3]);
    expect(placeAt([], 9, 0)).toEqual([9]);
  });

  it("moves a stone already in the list rather than duplicating it, counting the slot as a drop sees it", () => {
    // Dropping 1 on the slot before 3 (index 2): it lands between 2 and 3.
    expect(placeAt([1, 2, 3], 1, 2)).toEqual([2, 1, 3]);
    // Dropping 3 on the slot before 1 (index 0): it goes first.
    expect(placeAt([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
    // Dropping a stone on its own slot, or the one after it, leaves the order.
    expect(placeAt([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(placeAt([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
    // Past the end moves it last.
    expect(placeAt([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
  });
});

describe("nextCaseName", () => {
  it("starts at Case 1 and counts up", () => {
    expect(nextCaseName([])).toBe("Case 1");
    expect(nextCaseName(["Case 1"])).toBe("Case 2");
    expect(nextCaseName(["Case 1", "Case 2"])).toBe("Case 3");
  });

  it("fills the lowest gap, ignores case and spacing, and is not blocked by other names", () => {
    expect(nextCaseName(["Case 1", "Case 3"])).toBe("Case 2");
    expect(nextCaseName(["case  2", "CASE 1 "])).toBe("Case 3");
    expect(nextCaseName(["Booth 12", "Michigan agates"])).toBe("Case 1");
    expect(nextCaseName(["Case 1 left"])).toBe("Case 1");
  });
});

describe("the lines", () => {
  it("say where a stone sits in its case", () => {
    expect(stoneLine(7, 12)).toBe("stone 7 of 12");
    expect(stoneLine(1, 1)).toBe("the only stone");
  });

  it("count a case's stones", () => {
    expect(countLine(0)).toBe("Nothing in it yet");
    expect(countLine(1)).toBe("1 stone");
    expect(countLine(12)).toBe("12 stones");
  });
});

describe("pickerRows", () => {
  const tile = (id: number): Tile => ({
    id,
    name: "Agate",
    kind: "mineral",
    mineralClass: null,
    variety: null,
    parts: [],
    madeOf: null,
    form: null,
    foundAt: null,
    acquired: null,
    location: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    added: "Nov 1",
    thumbUrl: null,
  });
  const cases = [
    { id: 1, name: "Booth 12", stoneIds: [10, 11] },
    { id: 2, name: "Michigan agates", stoneIds: [12] },
  ];

  it("says where each stone is, in the tiles' order", () => {
    const rows = pickerRows([tile(10), tile(12), tile(13)], cases, 1);
    expect(rows.map((r) => r.id)).toEqual([10, 12, 13]);
    expect(rows[0].where).toEqual({ kind: "here" });
    expect(rows[1].where).toEqual({ kind: "other", caseId: 2, name: "Michigan agates" });
    expect(rows[2].where).toEqual({ kind: "none" });
  });

  it("keeps the tile's own fields", () => {
    expect(pickerRows([tile(10)], cases, 2)[0]).toMatchObject({ id: 10, name: "Agate", where: { kind: "other", caseId: 1, name: "Booth 12" } });
  });
});
