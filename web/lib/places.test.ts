import { describe, expect, it } from "vitest";
import { foundCard, foundLine, parsePlaces, placesLabel, rankLine, shortList, type Area, type Places, type PlacesRecord } from "./places";

// Agate's counts as Mindat gave them on 2026-11-03, the first states and counties of each.
const state = (name: string, n: number, id = n * 100 + name.length): Area => ({ id, name, n });
const MICHIGAN = state("Michigan", 51, 208081);
const AGATE: Places = {
  usa: 879,
  states: [state("Nebraska", 140), state("Utah", 101), state("California", 90), state("Arizona", 60), MICHIGAN, state("Oregon", 40)],
  michigan: [state("Keweenaw County", 31), state("Houghton County", 8)],
};
const QUARTZ: Places = { usa: 32540, states: [state("Arizona", 3000), MICHIGAN], michigan: [state("Marquette County", 168)] };

const rec = (id: number, name: string, places: Places | null): PlacesRecord => ({ id, name, places });

describe("parsePlaces", () => {
  it("reads what Jasper wrote, and null before he counted", () => {
    expect(parsePlaces(JSON.stringify(AGATE))).toEqual(AGATE);
    expect(parsePlaces('{"usa":0}')).toEqual({ usa: 0, states: [], michigan: [] });
    expect(parsePlaces(null)).toBeNull();
  });

  it("reads anything malformed as no places, and drops a malformed area", () => {
    expect(parsePlaces("not json")).toEqual({ usa: 0, states: [], michigan: [] });
    expect(parsePlaces("[1, 2]")).toEqual({ usa: 0, states: [], michigan: [] });
    const odd = { usa: 12, states: [{ id: 1, name: "Ohio", n: 3 }, { id: 2, name: "", n: 1 }, { id: 3, name: "Iowa", n: 0 }, "Utah"], michigan: "none" };
    expect(parsePlaces(JSON.stringify(odd))).toEqual({ usa: 12, states: [{ id: 1, name: "Ohio", n: 3 }], michigan: [] });
  });
});

describe("foundCard", () => {
  it("shows the variety's record when it has places", () => {
    const card = foundCard([rec(198, "Amethyst", { ...AGATE, usa: 820 }), rec(3337, "Quartz", QUARTZ)], false, false);
    expect(card).toMatchObject({ state: "found", mindatId: 198, name: "Amethyst" });
  });

  it("walks up the chain past a record with none in the USA", () => {
    const card = foundCard([rec(7595, "Crazy Lace Agate", { usa: 0, states: [], michigan: [] }), rec(51, "Agate", AGATE), rec(3337, "Quartz", QUARTZ)], false, false);
    expect(card).toMatchObject({ state: "found", mindatId: 51, name: "Agate", counties: AGATE.michigan, states: AGATE.states });
  });

  it("waits for a record not counted yet, rather than show its parent's numbers", () => {
    expect(foundCard([rec(198, "Amethyst", null), rec(3337, "Quartz", QUARTZ)], false, false)).toEqual({ state: "pending" });
  });

  it("waits while the variety's name hasn't been asked", () => {
    expect(foundCard([rec(3337, "Quartz", QUARTZ)], true, false)).toEqual({ state: "pending" });
  });

  it("says none when every record is counted and none is in the USA, naming the most specific", () => {
    const none = { usa: 0, states: [], michigan: [] };
    expect(foundCard([rec(3229, "Obsidian", none)], false, false)).toEqual({ state: "none", mindatId: 3229, name: "Obsidian" });
  });

  it("is unknown for a name Mindat doesn't have, and pending with no record yet", () => {
    expect(foundCard([], false, true)).toEqual({ state: "unknown" });
    expect(foundCard([], false, false)).toEqual({ state: "pending" });
  });
});

describe("foundLine", () => {
  it("says the USA's count, the states, and Michigan's place among them", () => {
    expect(foundLine("Agate", AGATE)).toBe("Mindat lists Agate at 879 places in the USA, in 6 states. 51 are in Michigan, the fifth most of any state.");
    expect(foundLine("Quartz", QUARTZ)).toBe("Mindat lists Quartz at 32,540 places in the USA, in 2 states. 51 are in Michigan, the second most of any state.");
  });

  it("says when Michigan has none", () => {
    const places = { usa: 3, states: [state("Utah", 3)], michigan: [] };
    expect(foundLine("Variscite", places)).toBe("Mindat lists Variscite at 3 places in the USA, in 1 state. None are in Michigan yet.");
  });

  it("says one place in the singular, and no rank when Michigan is the only state", () => {
    const places = { usa: 1, states: [state("Michigan", 1)], michigan: [state("Keweenaw County", 1)] };
    expect(foundLine("Mohawkite", places)).toBe("Mindat lists Mohawkite at 1 place in the USA, in 1 state. 1 is in Michigan.");
  });
});

describe("rankLine", () => {
  const states = (counts: number[]) => counts.map((n, i) => state(`State ${i}`, n, i + 1));

  it("says the rank in the top ten, the first as the most", () => {
    expect(rankLine(MICHIGAN, [MICHIGAN, ...states([40, 30])])).toBe("the most of any state");
    expect(rankLine(MICHIGAN, [...states([90, 80, 70, 60, 55, 54, 53, 52, 52]), MICHIGAN])).toBe("the tenth most of any state");
  });

  it("says nothing past the tenth", () => {
    expect(rankLine(MICHIGAN, [...states([99, 98, 97, 96, 95, 94, 93, 92, 91, 90]), MICHIGAN])).toBeNull();
  });

  it("says when it ties", () => {
    expect(rankLine(MICHIGAN, [state("Utah", 51, 1), MICHIGAN])).toBe("tied for the most of any state");
    expect(rankLine(MICHIGAN, [state("Nebraska", 140, 1), state("Utah", 51, 2), MICHIGAN])).toBe("tied for the second most of any state");
  });
});

describe("shortList", () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("shows eight and keeps the rest back", () => {
    expect(shortList(list(47))).toEqual({ shown: list(8), rest: list(47).slice(8) });
  });

  it("never keeps back just one", () => {
    expect(shortList(list(9))).toEqual({ shown: list(9), rest: [] });
    expect(shortList(list(10)).rest).toEqual([8, 9]);
  });

  it("shows a short list whole", () => {
    expect(shortList(list(3))).toEqual({ shown: list(3), rest: [] });
    expect(shortList([])).toEqual({ shown: [], rest: [] });
  });
});

describe("placesLabel", () => {
  it("counts places, in the singular for one", () => {
    expect(placesLabel(1)).toBe("1 place");
    expect(placesLabel(12484)).toBe("12,484 places");
  });
});
