import { describe, expect, it } from "vitest";
import {
  addedToday,
  countLine,
  filterChips,
  filterTiles,
  fullDay,
  glance,
  longDay,
  metaLine,
  missingDetails,
  places,
  shortDay,
  sortTiles,
  whatChanged,
  type Tile,
} from "./collection";

let nextId = 1;
function tile(name: string, over: Partial<Tile> = {}): Tile {
  const id = nextId++;
  return {
    id,
    name,
    kind: "mineral",
    variety: null,
    foundAt: null,
    acquired: null,
    location: null,
    createdAt: `2026-11-01T1${id % 10}:00:00.000Z`,
    added: "Nov 1",
    thumbUrl: null,
    ...over,
  };
}

const galena = tile("Galena", { foundAt: "Grandpa's collection", location: "Glass case", acquired: "gifted", createdAt: "2026-10-30T12:00:00.000Z" });
const fluorite = tile("Fluorite", { variety: "Purple", location: "Glass case", createdAt: "2026-11-01T15:00:00.000Z" });
const slate = tile("Slate", { kind: "rock", foundAt: "Beach in Michigan", acquired: "found", location: "Windowsill", createdAt: "2026-11-01T16:00:00.000Z" });
const fossil = tile("Petoskey stone", { kind: "other", acquired: "found", createdAt: "2026-10-31T09:00:00.000Z" });
const all = [galena, fluorite, slate, fossil];
const names = (ts: Tile[]) => ts.map((t) => t.name);
const none = { q: "", kind: "all", from: "all" } as const;

describe("filterTiles", () => {
  it("searches the name, the variety and where it was found, ignoring case and punctuation", () => {
    expect(names(filterTiles(all, { ...none, q: "FLUOR" }))).toEqual(["Fluorite"]);
    expect(names(filterTiles(all, { ...none, q: "purple" }))).toEqual(["Fluorite"]);
    expect(names(filterTiles(all, { ...none, q: "michigan" }))).toEqual(["Slate"]);
    expect(names(filterTiles(all, { ...none, q: "grandpas" }))).toEqual(["Galena"]);
  });

  it("puts rocks and everything that isn't a mineral under Rocks and fossils", () => {
    expect(names(filterTiles(all, { ...none, kind: "minerals" }))).toEqual(["Galena", "Fluorite"]);
    expect(names(filterTiles(all, { ...none, kind: "rocks" }))).toEqual(["Slate", "Petoskey stone"]);
  });

  it("counts a gift or a trade as bought or gifted, and combines filters", () => {
    expect(names(filterTiles(all, { ...none, from: "bought" }))).toEqual(["Galena"]);
    expect(names(filterTiles(all, { ...none, from: "found" }))).toEqual(["Slate", "Petoskey stone"]);
    expect(names(filterTiles(all, { q: "", kind: "rocks", from: "found" }))).toEqual(["Slate", "Petoskey stone"]);
    expect(names(filterTiles(all, { q: "slate", kind: "minerals", from: "all" }))).toEqual([]);
  });
});

describe("sortTiles", () => {
  it("sorts by name A to Z, ignoring case", () => {
    expect(names(sortTiles([slate, tile("calcite"), galena], "name"))).toEqual(["calcite", "Galena", "Slate"]);
  });

  it("sorts newest first, ties by id", () => {
    const a = tile("A", { createdAt: "2026-11-01T10:00:00.000Z" });
    const b = tile("B", { createdAt: "2026-11-01T10:00:00.000Z" });
    expect(names(sortTiles([galena, a, slate, b], "new"))).toEqual(["Slate", "B", "A", "Galena"]);
  });
});

describe("filterChips", () => {
  it("counts the whole collection and leaves out chips with nobody in them", () => {
    const chips = filterChips([galena, fluorite], { kind: "all", from: "all" });
    expect(chips.map((c) => `${c.label} ${c.n}`)).toEqual(["Everything 2", "Minerals 2", "Bought or gifted 1"]);
    expect(chips[0].on).toBe(true);
  });

  it("marks the chosen chips", () => {
    const chips = filterChips(all, { kind: "rocks", from: "found" });
    expect(chips.filter((c) => c.on).map((c) => c.key)).toEqual(["rocks", "found"]);
  });
});

describe("countLine", () => {
  it("says how many show, and changes its words once anything filters", () => {
    expect(countLine(12, 47, false)).toBe("Showing 12 of 47 stones");
    expect(countLine(1, 1, false)).toBe("Showing 1 of 1 stone");
    expect(countLine(3, 47, true)).toBe("Showing 3 stones that match");
    expect(countLine(1, 47, true)).toBe("Showing 1 stone that matches");
    expect(countLine(0, 47, true)).toBe("No stones match");
  });
});

describe("the side column", () => {
  it("counts stones, different minerals, kinds of rock and places", () => {
    expect(glance([...all, tile("galena")])).toEqual({ stones: 5, minerals: 2, rocks: 2, places: 2 });
  });

  it("lists where they live, most stones first", () => {
    expect(places([...all, tile("Quartz", { location: "glass case" })])).toEqual([
      { place: "Glass case", n: 3 },
      { place: "Windowsill", n: 1 },
    ]);
  });
});

describe("metaLine and longDay", () => {
  it("puts where it lives before when it was added", () => {
    expect(metaLine({ location: "Glass case", added: "Nov 1" })).toBe("Glass case · added Nov 1");
    expect(metaLine({ location: null, added: "Nov 1" })).toBe("added Nov 1");
  });

  it("reads a date from its text", () => {
    expect(longDay("2026-10-31")).toBe("Oct 31, 2026");
    expect(longDay(null)).toBeNull();
  });

  it("dates an instant in the station's zone", () => {
    expect(shortDay(new Date(2026, 10, 1, 23, 30).toISOString())).toBe("Nov 1");
    expect(fullDay(new Date(2026, 10, 1, 23, 30).toISOString())).toBe("Nov 1, 2026");
    expect(fullDay("nonsense")).toBe("");
  });
});

describe("the greeting's what changed", () => {
  it("counts the stones added today in the station's time zone", () => {
    const now = new Date(2026, 10, 1, 19, 0);
    const today = [new Date(2026, 10, 1, 0, 5).toISOString(), new Date(2026, 10, 1, 18, 0).toISOString()];
    const yesterday = new Date(2026, 9, 31, 23, 55).toISOString();
    expect(addedToday([...today, yesterday], now)).toBe(2);
  });

  it("says it in words", () => {
    expect(whatChanged(0)).toBeNull();
    expect(whatChanged(1)).toBe("One new stone today.");
    expect(whatChanged(2)).toBe("Two new stones today.");
    expect(whatChanged(14)).toBe("14 new stones today.");
  });
});

describe("missingDetails", () => {
  it("counts where it came from, how, when and where it lives, never the extras", () => {
    expect(missingDetails({ foundAt: null, acquired: null, acquiredOn: null, location: null })).toBe(4);
    expect(missingDetails({ foundAt: "Beach", acquired: "found", acquiredOn: null, location: "" })).toBe(2);
    expect(missingDetails({ foundAt: "Beach", acquired: "found", acquiredOn: "2026-08-01", location: "Shelf" })).toBe(0);
  });
});
