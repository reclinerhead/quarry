import { describe, expect, it } from "vitest";
import { NoRetry, waitFor, withRetry } from "./retry";

const noSleep = async () => {};

describe("withRetry", () => {
  it("returns the first success and reports each retry", async () => {
    const seen: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async (attempt) => {
        calls++;
        if (attempt < 3) throw new Error(`drop ${attempt}`);
        return "ok";
      },
      { attempts: 3, sleep: noSleep, onRetry: (a) => seen.push(a) },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(seen).toEqual([1, 2]);
  });

  it("gives up after the last attempt with the last error", async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error("down");
        },
        { attempts: 2, sleep: noSleep },
      ),
    ).rejects.toThrow("down");
  });

  it("does not retry a NoRetry failure", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new NoRetry("bad photo");
        },
        { attempts: 5, sleep: noSleep },
      ),
    ).rejects.toThrow("bad photo");
    expect(calls).toBe(1);
  });

  it("doubles the wait", () => {
    expect([1, 2, 3, 4].map((a) => waitFor(a, 1000))).toEqual([1000, 2000, 4000, 8000]);
  });
});
