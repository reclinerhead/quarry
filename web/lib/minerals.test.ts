import { describe, expect, it } from "vitest";
import { rankMinerals, type MineralHit } from "./minerals";

const rows: MineralHit[] = [
  { id: 1, name: "Calcite", kind: "mineral", stones: 2 },
  { id: 2, name: "Fluorite", kind: "mineral", stones: 5 },
  { id: 3, name: "Chalcopyrite", kind: "mineral", stones: 1 },
  { id: 4, name: "Pyrite", kind: "mineral", stones: 3 },
  { id: 5, name: "Conglomerate", kind: "rock", stones: 0 },
  { id: 6, name: "Milky quartz", kind: "mineral", stones: 1 },
];

const names = (hits: MineralHit[]) => hits.map((h) => h.name);

describe("rankMinerals", () => {
  it("offers what the household owns, most stones first, when nothing is typed", () => {
    expect(names(rankMinerals(rows, ""))).toEqual(["Fluorite", "Pyrite", "Calcite", "Chalcopyrite", "Milky quartz"]);
  });

  it("puts names that start with the query ahead of names that only contain it", () => {
    expect(names(rankMinerals(rows, "py"))).toEqual(["Pyrite", "Chalcopyrite"]);
  });

  it("counts a word that starts with the query as a start", () => {
    expect(names(rankMinerals(rows, "quar"))).toEqual(["Milky quartz"]);
  });

  it("ignores case and punctuation, and finds minerals with no stones left", () => {
    expect(names(rankMinerals(rows, "CONGLOM"))).toEqual(["Conglomerate"]);
  });

  it("stops at the limit", () => {
    expect(rankMinerals(rows, "", 2)).toHaveLength(2);
  });
});
