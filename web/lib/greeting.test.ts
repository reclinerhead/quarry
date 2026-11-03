import { describe, expect, it } from "vitest";
import { dateLine, greeting, partOfDay, whatTheyAdded } from "./greeting";

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

  it("just says hello once there are stones and none came today", () => {
    expect(greeting(evening, 3)).toBe("Good evening.");
    expect(greeting(evening, 3, 0)).toBe("Good evening.");
  });

  it("says what changed today", () => {
    expect(greeting(evening, 3, 2)).toBe("Good evening. Two new stones today.");
  });
});

describe("whatTheyAdded", () => {
  it("says what today's stones did to the set and the table", () => {
    expect(whatTheyAdded([{ n: 4, piece: "Fluorite" }], ["calcium", "fluorine"])).toBe(
      "Your Fluorite filled slot 4 on the Mohs scale, and calcium and fluorine are now lit on your periodic table.",
    );
    expect(whatTheyAdded([{ n: 4, piece: "Fluorite" }, { n: 3, piece: "Calcite" }], [])).toBe("Your Fluorite and your Calcite filled slots 4 and 3 on the Mohs scale.");
    expect(whatTheyAdded([], ["zinc"])).toBe("Zinc is now lit on your periodic table.");
    expect(whatTheyAdded([], ["iron", "sulfur", "zinc"])).toBe("Iron, sulfur and zinc are now lit on your periodic table.");
  });

  it("says nothing on a quiet day", () => {
    expect(whatTheyAdded([], [])).toBeNull();
  });
});
