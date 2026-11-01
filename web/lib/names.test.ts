import { describe, expect, it } from "vitest";
import { norm, sameStone } from "./names";

const c = (name: string, variety: string | null = null) => ({ name, variety });

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
