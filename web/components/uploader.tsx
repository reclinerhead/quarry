"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CameraIcon, CoinIcon, CrystalIcon, PhotosIcon, SunIcon, TagIcon } from "@/components/icons";
import { JasperAtWork } from "@/components/jasper-at-work";
import { exifTakenAt } from "@/lib/exif";
import { isSettled } from "@/lib/job-state";
import type { JobView } from "@/lib/jobs";
import { verdictLine } from "@/lib/pills";
import { NoRetry, withRetry } from "@/lib/retry";
import { shrinkToJpeg } from "@/lib/shrink";

type Photo = {
  key: string;
  file: File;
  preview: string;
  previewFailed?: boolean; // a HEIC the browser cannot draw
};

type Rock = {
  key: string;
  photos: Photo[];
  note: string; // the note as it was when the rock was sent
  state: "queued" | "sending" | "waiting" | "settled" | "error";
  sent: number; // photos the Quarry has
  attempt: number; // the try of the request in flight
  jobId?: number;
  job?: JobView;
  error?: string;
};

const MAX_PHOTOS = 5; // Jasper's MAX_IMAGES: the most it looks at for one rock
const ATTEMPTS = 5; // waits of 1, 2, 4 and 8 s between them
const SEND_TIMEOUT_MS = 60_000; // a request the Wi-Fi dropped mid-way must not hang the rock
const POLL_MS = 1500;

/** Why a rock did not go, in words; status is null when the Quarry was never reached. */
function sendError(status: number | null): string {
  if (status === null) return "Couldn't reach the Quarry. Check the Wi-Fi, then send it again.";
  if (status === 404) return "The Quarry no longer has its photos. Send it again to send them afresh.";
  if (status === 413) return "One of its photos is too big to send. The limit is 25 MB.";
  if (status === 415) return "One of its files isn't a photo.";
  if (status === 503) return "The Quarry isn't running on the computer yet.";
  return `The Quarry couldn't save it (error ${status}).`;
}

/** A 4xx other than 408 and 429 will not change on a retry. */
function refuseOrThrow(r: Response) {
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new NoRetry(`refused (${r.status})`);
  if (!r.ok) throw new Error(`server ${r.status}`);
}

export function Uploader() {
  const [current, setCurrent] = useState<Photo[]>([]);
  const [rocks, setRocks] = useState<Rock[]>([]);
  const [notes, setNotes] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const rollRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const uploaded = useRef(new Map<string, number>()); // photo key -> photos.id, once the Quarry has it
  const line = useRef<Promise<void>>(Promise.resolve()); // rocks send one after another

  function pick(input: HTMLInputElement | null) {
    if (current.length >= MAX_PHOTOS) setNotice("This rock has five photos, the most Jasper looks at. Send it, or remove one first.");
    else input?.click();
  }

  function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const next = picked.slice(0, MAX_PHOTOS - current.length).map<Photo>((file) => ({
      key: String(++nextKey.current),
      file,
      preview: URL.createObjectURL(file),
    }));
    const left = picked.length - next.length;
    setCurrent((cur) => [...cur, ...next]);
    setNotice(left > 0 ? `${count(left, "photo")} ${left === 1 ? "wasn't" : "weren't"} added: Jasper looks at five of one rock at most.` : null);
  }

  function removePhoto(key: string) {
    const p = current.find((x) => x.key === key);
    if (p) URL.revokeObjectURL(p.preview);
    setCurrent((cur) => cur.filter((x) => x.key !== key));
    setNotice(null);
  }

  function noPreview(key: string) {
    const mark = (ps: Photo[]) => ps.map((p) => (p.key === key ? { ...p, previewFailed: true } : p));
    setCurrent(mark);
    setRocks((cur) => cur.map((r) => (r.photos.some((p) => p.key === key) ? { ...r, photos: mark(r.photos) } : r)));
  }

  function patch(key: string, change: Partial<Rock>) {
    setRocks((cur) => cur.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  function enqueue(rock: Rock) {
    line.current = line.current.then(() => sendRock(rock));
  }

  function sendThis() {
    if (current.length === 0) return;
    const rock: Rock = { key: String(++nextKey.current), photos: current, note: notes.trim(), state: "queued", sent: 0, attempt: 0 };
    setRocks((cur) => [...cur, rock]);
    setCurrent([]);
    setNotice(null);
    enqueue(rock);
  }

  function sendAgain(rock: Rock) {
    patch(rock.key, { state: "queued", error: undefined });
    enqueue(rock);
  }

  function removeRock(rock: Rock) {
    for (const p of rock.photos) URL.revokeObjectURL(p.preview);
    setRocks((cur) => cur.filter((r) => r.key !== rock.key)); // photos it already sent are swept by the Quarry a day later
  }

  // Every photo first, each its own request with retry, so a drop on the third
  // keeps the first two; then the job, so Jasper only ever sees the whole rock.
  // Never throws: the line of rocks behind it must keep moving.
  async function sendRock(rock: Rock) {
    const have = uploaded.current;
    const ids = () => rock.photos.flatMap((p) => (have.has(p.key) ? [have.get(p.key)!] : []));
    patch(rock.key, { state: "sending", attempt: 0, sent: ids().length, error: undefined });
    for (const p of rock.photos) {
      if (have.has(p.key)) continue;
      const res = await sendPhoto(rock.key, p);
      if (!res.ok) {
        patch(rock.key, { state: "error", error: sendError(res.status) });
        return;
      }
      have.set(p.key, res.photoId);
      patch(rock.key, { sent: ids().length });
    }
    const made = await makeJob(rock.key, ids(), rock.note);
    if (!made.ok) {
      if (made.status === 404) for (const p of rock.photos) have.delete(p.key); // swept: send them afresh
      patch(rock.key, { state: "error", error: sendError(made.status) });
      return;
    }
    patch(rock.key, { state: "waiting", jobId: made.jobId });
  }

  async function sendPhoto(rockKey: string, p: Photo): Promise<{ ok: true; photoId: number } | { ok: false; status: number | null }> {
    let status: number | null = null;
    try {
      const takenAt = exifTakenAt(await p.file.arrayBuffer()); // before the shrink drops EXIF
      const { blob, mime } = await shrinkToJpeg(p.file);
      const res = await withRetry(
        async (attempt) => {
          patch(rockKey, { attempt });
          status = null;
          const form = new FormData();
          form.append("file", new File([blob], p.file.name, { type: mime }));
          if (takenAt) form.append("takenAt", takenAt);
          const r = await fetch("/api/photos", { method: "POST", body: form, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
          status = r.status;
          refuseOrThrow(r);
          return (await r.json()) as { photoId: number };
        },
        { attempts: ATTEMPTS, baseMs: 1000 },
      );
      return { ok: true, photoId: res.photoId };
    } catch {
      return { ok: false, status };
    }
  }

  async function makeJob(rockKey: string, photoIds: number[], note: string): Promise<{ ok: true; jobId: number } | { ok: false; status: number | null }> {
    let status: number | null = null;
    try {
      const res = await withRetry(
        async (attempt) => {
          patch(rockKey, { attempt });
          status = null;
          const r = await fetch("/api/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ photoIds, notes: note }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          });
          status = r.status;
          refuseOrThrow(r);
          return (await r.json()) as { jobId: number };
        },
        { attempts: ATTEMPTS, baseMs: 1000 },
      );
      return { ok: true, jobId: res.jobId };
    } catch {
      return { ok: false, status };
    }
  }

  // Ask after every sent rock until Jasper is done with it: all of them every
  // 1.5 s, the next round once the last has answered.
  const watching = rocks.flatMap((r) => (r.state === "waiting" && r.jobId ? [r.jobId] : [])).join(",");
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
            setRocks((cur) =>
              cur.map((rock) =>
                rock.jobId !== id || (rock.job?.status === job.status && rock.job?.nextAttemptAt === job.nextAttemptAt)
                  ? rock
                  : { ...rock, job, state: isSettled(job) ? "settled" : "waiting" },
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

  const sending = rocks.filter((r) => r.state === "queued" || r.state === "sending").length;
  const failed = rocks.filter((r) => r.state === "error").length;
  const waiting = rocks.filter((r) => r.state === "waiting").length;
  const toName = rocks.filter((r) => r.state === "settled").length;

  let summary: string;
  if (notice) summary = notice;
  else if (current.length === 0) summary = rocks.length === 0 ? "Take or choose the photos of one rock." : "Ready for the next rock.";
  else
    summary = `${count(current.length, "photo")} of this rock, ready to send.${current.length === MAX_PHOTOS ? " That's the most Jasper looks at." : ""}`;

  const sentParts = [
    sending > 0 && `${sending} sending`,
    failed > 0 && `${failed} couldn't be sent`,
    waiting > 0 && `${waiting} waiting for Jasper`,
    toName > 0 && `${toName} ready to name`,
  ].filter(Boolean);
  // Leaving loses a rock still to send or one that couldn't be sent, so the
  // page says it may be left only once neither is left.
  let hint = "";
  if (sending > 0) hint = " Keep this page open until they're sent.";
  else if (failed === 0 && waiting > 0) hint = " You can leave this page; Jasper keeps going.";
  const sentLine = `${sentParts.join(", ")}.${hint}`;

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Choose photos" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={() => pick(cameraRef.current)} className="btn btn-primary btn-lg">
            <CameraIcon className="size-[22px]" />
            Take a photo
          </button>
          <button type="button" onClick={() => pick(rollRef.current)} className="btn btn-soft btn-lg">
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
          <h2 className="text-[22px] leading-tight">For the best guess, three photos of each rock</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-3 md:gap-7">
            <Tip icon={<SunIcon className="size-7" />} lead="One close-up, in daylight." why="Window light shows the stone's true colour and shine." />
            <Tip icon={<CoinIcon className="size-7" />} lead="One with a coin beside it." why="The coin shows how big the stone is." />
            <Tip icon={<TagIcon className="size-7" />} lead="One of any label or tag." why="Jasper reads them, and a label is the best clue there is." />
          </ul>
        </div>
      </section>

      {/* Under the tips, where it's in sight after a send (#31). It arrives with
          the first press of "Send this rock", and each rock after grows it and
          moves the rock card down: a shift the person's own press makes. */}
      {rocks.length > 0 ? (
        <section aria-labelledby="sent-h" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="sent-h" className="text-section leading-tight">
              Rocks you&rsquo;ve sent
            </h2>
            <p aria-live="polite" className="text-ink-2">
              {sentLine}
            </p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3">
            {rocks.map((r) => (
              <Row key={r.key} rock={r} onNoPreview={noPreview} onSendAgain={() => sendAgain(r)} onRemove={() => removeRock(r)} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="rock-h" className="card flex flex-col gap-5 p-5 sm:px-8 sm:py-7">
        <h2 id="rock-h" className="text-section leading-tight">
          {rocks.length === 0 ? "This rock" : "The next rock"}
        </h2>
        {/* Five slots, always drawn, so a photo fills a slot and moves nothing. */}
        <ul aria-label="Its photos" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {Array.from({ length: MAX_PHOTOS }, (_, i) => {
            const p = current[i];
            return p ? (
              <li key={p.key} className="flex flex-col gap-2">
                <Thumb photo={p} onNoPreview={() => noPreview(p.key)} className="aspect-square w-full" />
                <button type="button" onClick={() => removePhoto(p.key)} aria-label={`Remove photo ${i + 1}`} className="btn btn-soft w-full px-3">
                  Remove
                </button>
              </li>
            ) : (
              <li key={`slot-${i}`} aria-hidden className="flex flex-col gap-2">
                <div className="aspect-square w-full rounded-thumb border-2 border-dashed border-line-strong" />
                <div className="h-12" />
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-6 border-t border-line pt-6 lg:flex-row lg:items-end lg:gap-10">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <label htmlFor="notes" className="flex flex-col gap-1">
              <span className="font-display text-h3 font-semibold leading-tight">Anything you know about this rock?</span>
              <span className="text-ink-2">Optional. Where it was found or bought, and roughly when. It stays here for the next rock until you change it.</span>
            </label>
            <textarea
              id="notes"
              rows={3}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Picked up on the beach at Grand Marais, August 2025"
              className="min-h-[108px] w-full resize-y rounded-tile border border-line-2 bg-surface px-[18px] py-3 text-ink placeholder:text-ink-3"
            />
          </div>
          <div className="flex flex-col gap-3 lg:w-[340px] lg:flex-none">
            <p aria-live="polite" className="min-h-[54px] text-ink-2">
              {summary}
            </p>
            <div className="min-h-[52px]">
              {current.length > 0 ? (
                <button type="button" onClick={sendThis} className="btn btn-primary btn-lg w-full">
                  Send this rock
                </button>
              ) : rocks.length > 0 && sending === 0 && failed === 0 ? (
                <Link href="/" className="btn btn-soft btn-lg w-full">
                  Back to your collection
                </Link>
              ) : null}
            </div>
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

function Thumb({ photo, onNoPreview, className }: { photo: Photo; onNoPreview: () => void; className: string }) {
  return (
    <div className={`overflow-hidden rounded-thumb bg-tile-stone ${className}`}>
      {photo.previewFailed ? (
        <div className="flex size-full flex-col items-center justify-center gap-1">
          <CrystalIcon className="size-9 text-icon-muted" />
          <span className="text-meta text-ink-2">No preview</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
        <img src={photo.preview} alt="" onError={onNoPreview} className="size-full object-cover" />
      )}
    </div>
  );
}

function Row({
  rock,
  onNoPreview,
  onSendAgain,
  onRemove,
}: {
  rock: Rock;
  onNoPreview: (photoKey: string) => void;
  onSendAgain: () => void;
  onRemove: () => void;
}) {
  const job = rock.job;
  const n = rock.photos.length;
  // Amber means "needs you" (DESIGN.md §1): a rock Jasper is done with waits for a name.
  const needsYou = rock.state === "settled";
  const tries = rock.attempt > 1 ? `, try ${rock.attempt} of ${ATTEMPTS}` : "";
  let status: string;
  let detail: string | null = null;
  switch (rock.state) {
    case "queued":
      status = "Waiting its turn to send";
      break;
    case "sending":
      status = n > 1 && rock.sent < n ? `Sending photo ${rock.sent + 1} of ${n}${tries}…` : `Sending${tries}…`;
      break;
    case "error":
      status = "Couldn't send it";
      detail = rock.error ?? null;
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

  const first = rock.photos[0];
  return (
    <li className={`card flex gap-4 p-4 ${needsYou ? "border-warn-line bg-warn" : ""}`}>
      <Thumb photo={first} onNoPreview={() => onNoPreview(first.key)} className="size-[104px] flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={`font-bold leading-snug ${needsYou ? "text-warn-ink" : "text-ink"}`}>{status}</p>
        {detail ? <p className={`text-meta ${needsYou ? "text-warn-ink" : "text-ink-2"}`}>{detail}</p> : null}
        {/* While Jasper has it, Jasper at work stands in the photo count's line, one line tall like it. */}
        {rock.state === "waiting" ? (
          <JasperAtWork seed={rock.jobId ?? 0} className="text-meta text-ink-2" />
        ) : (
          <p className={`text-meta ${needsYou ? "text-warn-ink" : "text-ink-3"}`}>{count(n, "photo")}</p>
        )}
        <div className="mt-auto flex min-h-12 flex-wrap items-end gap-2 pt-1.5">
          {rock.state === "error" ? (
            <>
              <button type="button" onClick={onSendAgain} className="btn btn-primary px-5">
                Send it again
              </button>
              <button type="button" onClick={onRemove} className="btn btn-soft px-5">
                Remove
              </button>
            </>
          ) : needsYou && rock.jobId ? (
            <Link href={`/name/${rock.jobId}`} className="btn btn-primary px-5">
              {job?.status === "identified" ? "Name it" : "Name it yourself"}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
