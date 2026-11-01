// When Jasper is done with a job. Pure, so the add page, the confirm screen
// (both client components) and the server's waiting list share one rule.

export type JobStatus = "queued" | "identifying" | "identified" | "rejected" | "failed";

/** Named something, named nothing, or failed for good (a failed job with a next attempt is one Jasper will retry). */
export function isSettled(job: { status: JobStatus; nextAttemptAt: string | null }): boolean {
  return job.status === "identified" || job.status === "rejected" || (job.status === "failed" && job.nextAttemptAt === null);
}
