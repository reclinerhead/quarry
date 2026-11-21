import { describe, expect, it } from "vitest";
import { pickCover, weekKey } from "./cover";

// Dates are built from local parts, so the suite passes in any time zone.

describe("weekKey", () => {
  it("names the ISO week of a local date", () => {
    expect(weekKey(new Date(2026, 10, 21))).toBe("2026-W47");
  });

  it("turns over between a Sunday and the Monday after it", () => {
    expect(weekKey(new Date(2026, 10, 22))).toBe("2026-W47");
    expect(weekKey(new Date(2026, 10, 23))).toBe("2026-W48");
  });

  it("holds from the first minute of Monday to the last of Sunday", () => {
    expect(weekKey(new Date(2026, 10, 16, 0, 0, 0))).toBe("2026-W47");
    expect(weekKey(new Date(2026, 10, 22, 23, 59, 59))).toBe("2026-W47");
  });

  it("gives the days around New Year their ISO week-year", () => {
    expect(weekKey(new Date(2026, 11, 28))).toBe("2026-W53");
    expect(weekKey(new Date(2027, 0, 1))).toBe("2026-W53");
    expect(weekKey(new Date(2027, 0, 3))).toBe("2026-W53");
    expect(weekKey(new Date(2027, 0, 4))).toBe("2027-W01");
    expect(weekKey(new Date(2024, 11, 30))).toBe("2025-W01");
  });
});

describe("pickCover", () => {
  const stones = [3, 7, 12, 19, 24, 31].map((id) => ({ id }));
  const monday = new Date(2026, 10, 16);

  it("has nothing to pick from an empty list", () => {
    expect(pickCover([], monday)).toBeNull();
  });

  it("picks the only candidate", () => {
    expect(pickCover([stones[0]], monday)).toBe(stones[0]);
  });

  it("does not depend on the order the candidates arrive in", () => {
    const pick = pickCover(stones, monday);
    expect(pickCover([...stones].reverse(), monday)).toBe(pick);
    expect(pickCover([...stones.slice(3), ...stones.slice(0, 3)], monday)).toBe(pick);
  });

  it("holds one pick from Monday to Sunday", () => {
    const pick = pickCover(stones, monday);
    for (let d = 0; d < 7; d++) expect(pickCover(stones, new Date(2026, 10, 16 + d, 13, 30))).toBe(pick);
  });
});
