import { notFound } from "next/navigation";
import { Namer } from "@/components/namer";
import { lastNamedStone, nextWaitingJob, readJob, waitingJobIds, withReadDb } from "@/lib/jobs";

// /name/[id]: one stone per screen (#8).
export const dynamic = "force-dynamic";

export const metadata = { title: "Name this stone · The Quarry" };

export default async function NamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) notFound();
  const data = withReadDb((db) => {
    const job = readJob(db, jobId);
    if (!job) return null;
    const ids = waitingJobIds(db);
    return {
      job,
      waiting: ids.length,
      position: Math.max(1, ids.indexOf(jobId) + 1),
      nextJobId: nextWaitingJob(ids, jobId),
      lastStone: lastNamedStone(db),
    };
  }, null);
  if (!data) notFound();
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:px-10 sm:pb-[72px] sm:pt-10">
      <Namer initialJob={data.job} waiting={data.waiting} position={data.position} nextJobId={data.nextJobId} lastStone={data.lastStone} />
    </main>
  );
}
