import { describe, expect, it } from "vitest";
import { isSettled } from "./job-state";
import { nextWaitingJob } from "./jobs";

describe("nextWaitingJob", () => {
  it("goes to the next later job", () => {
    expect(nextWaitingJob([2, 5, 9], 5)).toBe(9);
  });

  it("wraps to the first when the current one is the last", () => {
    expect(nextWaitingJob([2, 5, 9], 9)).toBe(2);
  });

  it("works for a job that is no longer waiting (just named)", () => {
    expect(nextWaitingJob([2, 9], 5)).toBe(9);
  });

  it("is null when nothing else waits", () => {
    expect(nextWaitingJob([5], 5)).toBeNull();
    expect(nextWaitingJob([], 5)).toBeNull();
  });
});

describe("isSettled", () => {
  it("is true once Jasper is done with a job, including a failure it won't retry", () => {
    expect(isSettled({ status: "identified", nextAttemptAt: null })).toBe(true);
    expect(isSettled({ status: "rejected", nextAttemptAt: null })).toBe(true);
    expect(isSettled({ status: "failed", nextAttemptAt: null })).toBe(true);
  });

  it("is false while Jasper is still working or will try again", () => {
    expect(isSettled({ status: "queued", nextAttemptAt: null })).toBe(false);
    expect(isSettled({ status: "identifying", nextAttemptAt: null })).toBe(false);
    expect(isSettled({ status: "failed", nextAttemptAt: "2026-11-01T18:00:00.000Z" })).toBe(false);
  });
});
