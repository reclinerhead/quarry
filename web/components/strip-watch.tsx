"use client";

import { BASE_PATH } from "@/lib/base-path";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isSettled } from "@/lib/job-state";
import type { JobView } from "@/lib/jobs";

// The dashboard's ear on Jasper (#31). While he has rocks, it asks after each
// one through GET /api/jobs/[id], as the add page and the confirm screen do,
// and once one is done (or gone: dismissed), it refreshes the server
// components, so the amber strip is drawn where the working strip stood.
// router.refresh() keeps client state and the scroll. It draws nothing.

const POLL_MS = 2000;

export function StripWatch({ ids }: { ids: number[] }) {
  const router = useRouter();
  const watching = ids.join(",");
  useEffect(() => {
    const jobIds = watching.split(",").map(Number);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const done = await Promise.all(
        jobIds.map(async (id) => {
          try {
            const r = await fetch(`${BASE_PATH}/api/jobs/${id}`, { cache: "no-store" });
            if (r.status === 404) return true;
            if (!r.ok) return false;
            return isSettled((await r.json()) as JobView);
          } catch {
            return false; // ask again next round
          }
        }),
      );
      if (stopped) return;
      // The refresh hands back the jobs still out as new ids, which starts the next watch.
      if (done.some(Boolean)) router.refresh();
      else timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS); // the page was just drawn from the database
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching, router]);
  return null;
}
