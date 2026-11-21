import { describe, expect, it } from "vitest";
import { pickCover, weekIndex } from "./cover";

// Dates are built from local parts, so the suite passes in any time zone.

describe("weekIndex", () => {
  it("turns over between a Sunday and the Monday after it", () => {
    expect(weekIndex(new Date(2026, 10, 23))).toBe(weekIndex(new Date(2026, 10, 22)) + 1);
  });

  it("holds from the first minute of Monday to the last of Sunday", () => {
    const week = weekIndex(new Date(2026, 10, 16, 0, 0, 0));
    for (let d = 0; d < 7; d++) expect(weekIndex(new Date(2026, 10, 16 + d, 12))).toBe(week);
    expect(weekIndex(new Date(2026, 10, 22, 23, 59, 59))).toBe(week);
  });

  it("keeps counting across New Year and a daylight-saving change", () => {
    expect(weekIndex(new Date(2027, 0, 4))).toBe(weekIndex(new Date(2026, 11, 28)) + 1);
    expect(weekIndex(new Date(2027, 0, 1))).toBe(weekIndex(new Date(2026, 11, 28)));
    expect(weekIndex(new Date(2026, 2, 9))).toBe(weekIndex(new Date(2026, 2, 2)) + 1);
  });
});

describe("pickCover", () => {
  const all = [3, 7, 12, 19, 24, 31, 40].map((id) => ({ id }));
  const monday = new Date(2026, 10, 16);
  const mondayOf = (week: number) => new Date(2026, 0, 5 + 7 * week);

  it("has nothing to pick from an empty list", () => {
    expect(pickCover([], monday)).toBeNull();
  });

  it("picks the only candidate", () => {
    expect(pickCover([all[0]], monday)).toBe(all[0]);
  });

  it("does not depend on the order the candidates arrive in", () => {
    for (const size of [2, 3, 6]) {
      const some = all.slice(0, size);
      for (let w = 0; w < 12; w++) {
        const pick = pickCover(some, mondayOf(w));
        expect(pickCover([...some].reverse(), mondayOf(w))).toBe(pick);
        expect(pickCover([...some.slice(1), some[0]], mondayOf(w))).toBe(pick);
      }
    }
  });

  it("holds one pick from Monday to Sunday", () => {
    const pick = pickCover(all, monday);
    for (let d = 0; d < 7; d++) expect(pickCover(all, new Date(2026, 10, 16 + d, 13, 30))).toBe(pick);
  });

  it("never shows the same one two weeks running, whatever the size", () => {
    for (let size = 2; size <= all.length; size++) {
      const some = all.slice(0, size);
      for (let w = 0; w < 160; w++) expect(pickCover(some, mondayOf(w + 1))).not.toBe(pickCover(some, mondayOf(w)));
    }
  });

  it("gives every candidate a turn in each round", () => {
    for (const size of [2, 3, 5, all.length]) {
      const some = all.slice(0, size);
      // Rounds start where the week number divides evenly by the size.
      let start = 0;
      while (weekIndex(mondayOf(start)) % size !== 0) start++;
      for (let round = 0; round < 6; round++) {
        const shown = new Set<unknown>();
        for (let t = 0; t < size; t++) shown.add(pickCover(some, mondayOf(start + round * size + t)));
        expect(shown.size).toBe(size);
      }
    }
  });
});
