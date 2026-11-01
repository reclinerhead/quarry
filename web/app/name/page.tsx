import Link from "next/link";
import { redirect } from "next/navigation";
import { CameraIcon } from "@/components/icons";
import { waitingJobIds, withReadDb } from "@/lib/jobs";

// /name: the strip's "Name them". Sends the person to the oldest stone
// waiting for a name, or says there is none.
export const dynamic = "force-dynamic";

export const metadata = { title: "Name your stones · The Quarry" };

export default function NameIndex() {
  const ids = withReadDb((db) => waitingJobIds(db), []);
  if (ids.length > 0) redirect(`/name/${ids[0]}`);
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:px-10 sm:pt-10">
      <h1 className="text-[36px] leading-tight sm:text-h1 sm:leading-[1.1]">Nothing waiting for a name</h1>
      <p className="max-w-prose text-lead text-ink-2">
        Every stone you have added has a name on it. Add another and Jasper will have a guess ready in a few seconds.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/add" className="btn btn-primary btn-lg">
          <CameraIcon className="size-[22px]" />
          Add a rock
        </Link>
        <Link href="/" className="btn btn-soft btn-lg">
          Back to your collection
        </Link>
      </div>
    </main>
  );
}
