"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CameraIcon, CoinIcon, CrystalIcon, PhotosIcon, SunIcon, TagIcon } from "@/components/icons";
import { JasperAtWork } from "@/components/jasper-at-work";
import { exifTakenAt } from "@/lib/exif";
import { isSettled } from "@/lib/job-state";
import type { JobView } from "@/lib/jobs";
import { stripLine } from "@/lib/pills";
import { NoRetry, withRetry } from "@/lib/retry";
import { decodeHeic, shrinkToJpeg } from "@/lib/shrink";

type Photo = {
  key: string;
  file: File;
  preview: string;
  look: "photo" | "reading" | "none"; // reading: a HEIC the browser cannot draw, being decoded in the page
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
  const decoded = useRef(new Map<string, Promise<File | null>>()); // photo key -> its HEIC as a JPEG, once the browser could not draw it
  const gone = useRef(new Set<string>()); // photos removed while their decode was still running
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
      look: "photo",
    }));
    const left = picked.length - next.length;
    setCurrent((cur) => [...cur, ...next]);
    setNotice(left > 0 ? `${count(left, "photo")} ${left === 1 ? "wasn't" : "weren't"} added: Jasper looks at five of one rock at most.` : null);
  }

  function removePhoto(key: string) {
    const p = current.find((x) => x.key === key);
    if (p) forget(p);
    setCurrent((cur) => cur.filter((x) => x.key !== key));
    setNotice(null);
  }

  function forget(p: Photo) {
    URL.revokeObjectURL(p.preview);
    gone.current.add(p.key);
  }

  // The <img> failing is the one sign this browser cannot draw the file (an
  // iPhone draws HEIC itself and never gets here). Decode it in the page, show
  // the JPEG, and keep it for the send; a file that isn't a HEIC, or one the
  // decoder can't read, gets "No preview" and goes up as it is.
  function noPreview(p: Photo) {
    if (decoded.current.has(p.key)) return;
    patchPhoto(p.key, { look: "reading" });
    const job = decodeHeic(p.file).then((jpeg) => {
      if (gone.current.has(p.key)) return jpeg;
      if (!jpeg) patchPhoto(p.key, { look: "none" });
      else {
        URL.revokeObjectURL(p.preview);
        patchPhoto(p.key, { look: "photo", preview: URL.createObjectURL(jpeg) });
      }
      return jpeg;
    });
    decoded.current.set(p.key, job);
  }

  function patchPhoto(key: string, change: Partial<Photo>) {
    const mark = (ps: Photo[]) => ps.map((p) => (p.key === key ? { ...p, ...change } : p));
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
    for (const p of rock.photos) forget(p);
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
      const takenAt = exifTakenAt(await p.file.arrayBuffer()); // from the original: the decode and the shrink both drop EXIF
      const jpeg = await decoded.current.get(p.key); // a decode still running is waited for, never run twice
      const { blob, mime } = await shrinkToJpeg(jpeg ?? p.file);
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

  let summary: string;
  if (notice) summary = notice;
  else if (current.length === 0) summary = rocks.length === 0 ? "Take or choose the photos of one rock." : "Ready for the next rock.";
  else
    summary = `${count(current.length, "photo")} of this rock, ready to send.${current.length === MAX_PHOTOS ? " That's the most Jasper looks at." : ""}`;

  return (
    <div className="flex flex-col gap-8">
      {/* The rocks sent, as one strip at the top in the dashboard's pending
          strip's shape (#96). It arrives with the first press of "Send this
          rock", a shift the person's own press makes, and after that its height
          never changes however many rocks follow, so the buttons, the tips and
          the rock card sit together under it. */}
      {rocks.length > 0 ? (
        <SentStrip
          rocks={rocks}
          onNoPreview={noPreview}
          onSendAgain={() => rocks.filter((r) => r.state === "error").forEach(sendAgain)}
          onRemove={() => rocks.filter((r) => r.state === "error").forEach(removeRock)}
        />
      ) : null}

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
            <Tip icon={<CoinIcon className="size-7" />} lead="One with a penny or quarter beside it." why="The coin shows how big the stone and its details are." />
            <Tip icon={<TagIcon className="size-7" />} lead="One of any label or tag." why="Jasper reads them, and a label is the best clue there is." />
          </ul>
        </div>
      </section>

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
                <Thumb photo={p} onNoPreview={() => noPreview(p)} className="aspect-square w-full" />
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
      {photo.look !== "photo" ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
          <CrystalIcon className={`size-9 text-icon-muted ${photo.look === "reading" ? "animate-pulse motion-reduce:animate-none" : ""}`} />
          <span className="text-meta text-ink-2">{photo.look === "reading" ? "Reading the photo…" : "No preview"}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
        <img src={photo.preview} alt="" onError={onNoPreview} className="size-full object-cover" />
      )}
    </div>
  );
}

/** "1 rock", "2 rocks". */
function rocksCount(n: number): string {
  return `${n} ${n === 1 ? "rock" : "rocks"}`;
}

/** "1 is still sending and 2 are with Jasper". */
function listOf(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// What the strip says follows the most pressing state among the rocks: one
// that couldn't be sent first, since only this page has its photos; then rocks
// waiting for a name (amber, DESIGN.md's "needs you"), as on the dashboard;
// then rocks still sending; then rocks with Jasper. The rest are a sentence
// after it. The button's room is always kept, so the box is one size.
function SentStrip({
  rocks,
  onNoPreview,
  onSendAgain,
  onRemove,
}: {
  rocks: Rock[];
  onNoPreview: (photo: Photo) => void;
  onSendAgain: () => void;
  onRemove: () => void;
}) {
  const failed = rocks.filter((r) => r.state === "error");
  const toName = rocks.filter((r) => r.state === "settled");
  const sending = rocks.filter((r) => r.state === "queued" || r.state === "sending");
  const waiting = rocks.filter((r) => r.state === "waiting");
  const are = (xs: Rock[]) => (xs.length === 1 ? "is" : "are");

  let amber = false;
  let heading: string;
  let line: string;
  let lead: Rock[]; // the rocks the heading is about
  let action: React.ReactNode = null;
  if (failed.length > 0) {
    lead = failed;
    heading = `${rocksCount(failed.length)} couldn’t be sent`;
    line = failed[0].error ?? "";
    action = (
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onSendAgain} className="btn btn-primary btn-lg">
          {failed.length === 1 ? "Send it again" : "Send them again"}
        </button>
        <button type="button" onClick={onRemove} className="btn btn-soft btn-lg">
          {failed.length === 1 ? "Remove" : "Remove them"}
        </button>
      </div>
    );
  } else if (toName.length > 0) {
    lead = toName;
    amber = true;
    heading = `${rocksCount(toName.length)} waiting for a name`;
    const job = toName[0].job;
    line = job ? stripLine(job.plan, job.status === "failed", job.suggestedTests[0]?.kind) : "";
    action = (
      <Link href="/name" className="btn btn-primary btn-lg">
        {toName.length === 1 ? "Name it" : "Name them"}
      </Link>
    );
  } else if (sending.length > 0) {
    lead = sending;
    heading = `${rocksCount(sending.length)} sending`;
    const r = sending.find((x) => x.state === "sending");
    const n = r?.photos.length ?? 0;
    const tries = r && r.attempt > 1 ? `, try ${r.attempt} of ${ATTEMPTS}` : "";
    line = !r ? "Waiting its turn to send…" : n > 1 && r.sent < n ? `Sending photo ${r.sent + 1} of ${n}${tries}…` : `Sending${tries}…`;
  } else {
    lead = waiting;
    heading = `${rocksCount(waiting.length)} waiting for Jasper`;
    line = "";
  }
  if (!action) {
    // The amber strip's button, invisible (so out of the tab order and unread),
    // keeping its room so a change of state moves nothing.
    action = (
      <span aria-hidden className="btn btn-primary btn-lg invisible">
        Name it
      </span>
    );
  }

  const others = [
    lead !== toName && toName.length > 0 && `${toName.length} ${are(toName)} waiting for a name`,
    lead !== sending && sending.length > 0 && `${sending.length} ${are(sending)} still sending`,
    lead !== waiting && waiting.length > 0 && `${waiting.length} ${are(waiting)} with Jasper`,
  ].filter((x): x is string => Boolean(x));
  if (others.length > 0) line = `${line} Besides ${lead.length === 1 ? "it" : "them"}, ${listOf(others)}.`.trim();
  // Leaving loses a rock still to send or one that couldn't be sent, so the
  // page says it may be left only once neither is left.
  if (sending.length > 0) line = `${line} Keep this page open until ${sending.length === 1 ? "it’s" : "they’re"} sent.`.trim();
  else if (failed.length === 0 && waiting.length > 0) line = `${line} You can leave this page; Jasper keeps going.`.trim();

  const latest = rocks.slice(-3).reverse(); // the newest in front, where the person just saw it
  return (
    <section
      aria-labelledby="sent-h"
      className={`flex flex-wrap items-center gap-x-7 gap-y-5 px-5 py-5 sm:px-7 sm:py-[22px] ${amber ? "rounded-card border border-warn-line bg-warn" : "card"}`}
    >
      <div className="flex">
        {latest.map((r, i) => {
          const p = r.photos[0];
          return (
            <span
              key={r.key}
              className={`flex size-[72px] flex-none items-center justify-center overflow-hidden rounded-tile border-[3px] border-surface bg-tile-stone ${i > 0 ? "-ml-[18px]" : ""}`}
            >
              {p.look === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
                <img src={p.preview} alt="" onError={() => onNoPreview(p)} className="size-full object-cover" />
              ) : (
                <CrystalIcon className="size-8 text-icon-muted" />
              )}
            </span>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1">
        <h2 id="sent-h" aria-live="polite" className="text-[26px] leading-tight">
          {heading}
        </h2>
        {/* While Jasper has them and nothing else needs the person, Jasper at work, as on the dashboard. */}
        {lead === waiting ? <JasperAtWork seed={waiting[0].jobId ?? 0} className="text-ink-2" /> : null}
        {line ? (
          <p aria-live="polite" className={amber ? "text-warn-ink" : "text-ink-2"}>
            {line}
          </p>
        ) : null}
      </div>
      {action}
    </section>
  );
}
