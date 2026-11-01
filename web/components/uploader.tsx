"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CameraIcon, CoinIcon, CrystalIcon, PhotosIcon, SunIcon, TagIcon } from "@/components/icons";
import { exifTakenAt } from "@/lib/exif";
import { isSettled } from "@/lib/job-state";
import type { JobView } from "@/lib/jobs";
import { verdictLine } from "@/lib/pills";
import { NoRetry, withRetry } from "@/lib/retry";
import { shrinkToJpeg } from "@/lib/shrink";

type Item = {
  key: string;
  file: File;
  preview: string;
  previewFailed?: boolean; // a HEIC the browser cannot draw
  state: "ready" | "sending" | "waiting" | "settled" | "error";
  attempt: number;
  jobId?: number;
  job?: JobView;
  error?: string;
};

const ATTEMPTS = 5; // waits of 1, 2, 4 and 8 s between them
const SEND_TIMEOUT_MS = 60_000; // a request the Wi-Fi dropped mid-way must not hang the batch
const POLL_MS = 1500;

/** Why a photo did not go, in words; status is null when the Quarry was never reached. */
function sendError(status: number | null): string {
  if (status === null) return "Couldn't reach the Quarry. Check the Wi-Fi, then send it again.";
  if (status === 413) return "It's too big to send. The limit is 25 MB.";
  if (status === 415) return "That file isn't a photo.";
  if (status === 503) return "The Quarry isn't running on the computer yet.";
  return `The Quarry couldn't save it (error ${status}).`;
}

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cameraRef = useRef<HTMLInputElement>(null);
  const rollRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const removed = useRef(new Set<string>());

  function add(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map<Item>((file) => ({
      key: String(++nextKey.current),
      file,
      preview: URL.createObjectURL(file),
      state: "ready",
      attempt: 0,
    }));
    setItems((cur) => [...cur, ...next]);
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function remove(key: string) {
    const it = items.find((x) => x.key === key);
    if (it) URL.revokeObjectURL(it.preview);
    removed.current.add(key); // a send in progress skips it when its turn comes
    setItems((cur) => cur.filter((x) => x.key !== key));
  }

  async function sendOne(it: Item, note: string) {
    update(it.key, { state: "sending", attempt: 1, error: undefined });
    let status: number | null = null;
    try {
      const takenAt = exifTakenAt(await it.file.arrayBuffer()); // before the shrink drops EXIF
      const { blob, mime } = await shrinkToJpeg(it.file);
      const res = await withRetry(
        async (attempt) => {
          update(it.key, { attempt });
          status = null;
          const form = new FormData();
          form.append("file", new File([blob], it.file.name, { type: mime }));
          if (note) form.append("notes", note);
          if (takenAt) form.append("takenAt", takenAt);
          const r = await fetch("/api/photos", { method: "POST", body: form, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
          status = r.status;
          if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new NoRetry(`refused (${r.status})`);
          if (!r.ok) throw new Error(`server ${r.status}`);
          return (await r.json()) as { jobId: number };
        },
        { attempts: ATTEMPTS, baseMs: 1000 },
      );
      update(it.key, { state: "waiting", jobId: res.jobId });
    } catch {
      update(it.key, { state: "error", error: sendError(status) });
    }
  }

  async function sendAll() {
    const batch = items.filter((it) => it.state === "ready" || it.state === "error");
    const note = notes.trim();
    setBusy(true);
    setProgress({ done: 0, total: batch.length });
    for (const it of batch) {
      if (!removed.current.has(it.key)) await sendOne(it, note);
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setBusy(false);
  }

  // Ask after every sent photo until Jasper is done with it: all of them every
  // 1.5 s, the next round once the last has answered.
  const watching = items.flatMap((it) => (it.state === "waiting" && it.jobId ? [it.jobId] : [])).join(",");
  useEffect(() => {
    if (!watching) return;
    const ids = watching.split(",").map(Number);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await Promise.all(
        ids.map(async (id) => {
          try {
            const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
            if (!r.ok) return;
            const job = (await r.json()) as JobView;
            if (stopped) return;
            setItems((cur) =>
              cur.map((it) =>
                it.jobId !== id || (it.job?.status === job.status && it.job?.nextAttemptAt === job.nextAttemptAt)
                  ? it
                  : { ...it, job, state: isSettled(job) ? "settled" : "waiting" },
              ),
            );
          } catch {
            /* try again next round */
          }
        }),
      );
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching]);

  const toSend = items.filter((it) => it.state === "ready" || it.state === "error").length;
  const failedSends = items.filter((it) => it.state === "error").length;
  const waiting = items.filter((it) => it.state === "waiting").length;
  const toName = items.filter((it) => it.state === "settled").length;

  let summary: string;
  if (items.length === 0) summary = "Choose some photos first.";
  else if (busy) summary = `Sending ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
  else if (failedSends > 0 && failedSends === toSend)
    summary = `${count(failedSends, "photo")} couldn't be sent. Check the Wi-Fi, then send ${failedSends === 1 ? "it" : "them"} again.`;
  else if (toSend > 0) summary = `${count(toSend, "photo")} ready to send.`;
  else {
    const parts = [toName > 0 && `${toName} ready to name`, waiting > 0 && `${waiting} waiting for Jasper`].filter(Boolean);
    summary = `All sent: ${parts.join(", ")}.${waiting > 0 ? " You can leave this page; Jasper keeps going." : ""}`;
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Choose photos" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={() => cameraRef.current?.click()} className="btn btn-primary btn-lg">
            <CameraIcon className="size-[22px]" />
            Take a photo
          </button>
          <button type="button" onClick={() => rollRef.current?.click()} className="btn btn-soft btn-lg">
            <PhotosIcon className="size-[22px]" />
            Choose from your photos
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={rollRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* The README's photo advice, as an info note under the buttons. */}
        <div className="rounded-tile bg-sand px-5 py-5 sm:px-7 sm:py-6">
          <h2 className="text-[22px] leading-tight">For the best guess</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-3 md:gap-7">
            <Tip icon={<SunIcon className="size-7" />} lead="One close-up, in daylight." why="Window light shows the stone's true colour and shine." />
            <Tip icon={<CoinIcon className="size-7" />} lead="One with a coin beside it." why="The coin shows how big the stone is." />
            <Tip icon={<TagIcon className="size-7" />} lead="One of any label or tag." why="Jasper reads them, and a label is the best clue there is." />
          </ul>
        </div>
      </section>

      <section aria-labelledby="photos-h" className="flex flex-col gap-4">
        <h2 id="photos-h" className="text-section leading-tight">
          Your photos
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3">
          {items.length === 0 ? (
            <li className="col-span-full flex min-h-[138px] flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-line-strong px-6 text-center">
              <p className="font-bold">No photos chosen yet</p>
              <p className="text-ink-2">Take one, or choose some from your photos.</p>
            </li>
          ) : (
            items.map((it) => <Row key={it.key} item={it} onRemove={() => remove(it.key)} onNoPreview={() => update(it.key, { previewFailed: true })} />)
          )}
        </ul>
      </section>

      <section aria-label="Send" className="card flex flex-col gap-6 p-5 sm:px-8 sm:py-7 lg:flex-row lg:items-end lg:gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label htmlFor="notes" className="flex flex-col gap-1">
            <span className="font-display text-h3 font-semibold leading-tight">Anything you know about these?</span>
            <span className="text-ink-2">Optional. Where they were found or bought, and roughly when. Jasper reads it with every photo you send.</span>
          </label>
          <textarea
            id="notes"
            rows={3}
            maxLength={1000}
            value={notes}
            readOnly={busy}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Picked up on the beach at Grand Marais, August 2025"
            className="min-h-[108px] w-full resize-y rounded-tile border border-line-2 bg-surface px-[18px] py-3 text-ink placeholder:text-ink-3 read-only:bg-ground read-only:text-ink-2"
          />
        </div>
        <div className="flex flex-col gap-3 lg:w-[340px] lg:flex-none">
          <p aria-live="polite" className="min-h-[54px] text-ink-2">
            {summary}
          </p>
          <div className="min-h-[52px]">
            {busy ? (
              <button type="button" disabled className="btn btn-primary btn-lg w-full">
                Sending…
              </button>
            ) : toSend > 0 ? (
              <button type="button" onClick={sendAll} className="btn btn-primary btn-lg w-full">
                {failedSends === toSend ? `Send ${failedSends === 1 ? "it" : count(failedSends, "photo")} again` : `Send ${count(toSend, "photo")}`}
              </button>
            ) : items.length > 0 ? (
              <Link href="/" className="btn btn-soft btn-lg w-full">
                Back to your collection
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function Tip({ icon, lead, why }: { icon: React.ReactNode; lead: string; why: string }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-px flex-none text-azurite">{icon}</span>
      <p className="text-tag-ink">
        <strong className="text-ink">{lead}</strong> {why}
      </p>
    </li>
  );
}

function Row({ item, onRemove, onNoPreview }: { item: Item; onRemove: () => void; onNoPreview: () => void }) {
  const job = item.job;
  // Amber means "needs you" (DESIGN.md §1): a photo Jasper is done with waits for a name.
  const needsYou = item.state === "settled";
  let status: string;
  let detail: string | null = null;
  switch (item.state) {
    case "ready":
      status = "Ready to send";
      break;
    case "sending":
      status = item.attempt > 1 ? `Sending, try ${item.attempt} of ${ATTEMPTS}…` : "Sending…";
      break;
    case "error":
      status = "Couldn't send it";
      detail = item.error ?? null;
      break;
    case "waiting":
      if (job?.status === "identifying") status = "Jasper is looking at it…";
      else if (job?.status === "failed") {
        status = "Waiting for Jasper";
        detail = "Jasper hit a snag and will try again.";
      } else status = "Waiting for Jasper";
      break;
    case "settled":
      if (job?.status === "failed") {
        status = "Jasper couldn't look at it";
        detail = job.error ? `You can still name it yourself. (${job.error})` : "You can still name it yourself.";
      } else {
        status = "Ready to name";
        if (job?.status === "rejected") detail = "Jasper had no guess, so the name is up to you.";
        else if (job) detail = `${verdictLine(job.plan)}.`;
      }
      break;
  }

  return (
    <li className={`card flex gap-4 p-4 ${needsYou ? "border-warn-line bg-warn" : ""}`}>
      <div className="size-[104px] flex-none overflow-hidden rounded-thumb bg-tile-stone">
        {item.previewFailed ? (
          <div className="flex size-full flex-col items-center justify-center gap-1">
            <CrystalIcon className="size-9 text-icon-muted" />
            <span className="text-meta text-ink-2">No preview</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
          <img src={item.preview} alt="" onError={onNoPreview} className="size-full object-cover" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={`font-bold leading-snug ${needsYou ? "text-warn-ink" : "text-ink"}`}>{status}</p>
        {detail ? <p className={`text-meta ${needsYou ? "text-warn-ink" : "text-ink-2"}`}>{detail}</p> : null}
        <p className={`truncate text-meta ${needsYou ? "text-warn-ink" : "text-ink-3"}`}>{item.file.name}</p>
        <div className="mt-auto flex min-h-12 items-end pt-1.5">
          {item.state === "ready" || item.state === "error" ? (
            <button type="button" onClick={onRemove} className="btn btn-soft px-5">
              Remove
            </button>
          ) : needsYou && item.jobId ? (
            <Link href={`/name/${item.jobId}`} className="btn btn-primary px-5">
              {job?.status === "identified" ? "Name it" : "Name it yourself"}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
