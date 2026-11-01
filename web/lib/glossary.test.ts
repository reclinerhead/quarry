import { describe, expect, it } from "vitest";
import { GLOSSARY, TEST_TERM } from "./glossary";
import { TEST_KINDS } from "./household-tests";

describe("GLOSSARY", () => {
  it("explains every entry in two or three sentences that fit on a phone", () => {
    for (const [k, e] of Object.entries(GLOSSARY)) {
      const sentences = e.text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;
      expect(sentences, k).toBeGreaterThanOrEqual(2);
      expect(sentences, k).toBeLessThanOrEqual(3);
      expect(e.text.length, k).toBeLessThanOrEqual(320);
    }
  });

  it("has an entry behind every kitchen-table test", () => {
    for (const kind of TEST_KINDS) expect(GLOSSARY[TEST_TERM[kind]], kind).toBeDefined();
  });
});
