import { describe, expect, it } from "vitest";
import { dateLine, greeting, partOfDay } from "./greeting";

describe("partOfDay", () => {
  it("turns at noon and at five", () => {
    expect(partOfDay(0)).toBe("morning");
    expect(partOfDay(11)).toBe("morning");
    expect(partOfDay(12)).toBe("afternoon");
    expect(partOfDay(16)).toBe("afternoon");
    expect(partOfDay(17)).toBe("evening");
    expect(partOfDay(23)).toBe("evening");
  });
});

describe("dateLine", () => {
  it("names the weekday, month and day, with no year", () => {
    expect(dateLine(new Date(2026, 10, 1, 18, 30))).toBe("Sunday, November 1");
  });
});

describe("greeting", () => {
  const evening = new Date(2026, 10, 1, 19, 0);

  it("invites the first stone when the collection is empty", () => {
    expect(greeting(evening, 0)).toBe("Good evening. Your collection starts here.");
  });

  it("just says hello once there are stones", () => {
    expect(greeting(evening, 3)).toBe("Good evening.");
  });
});
