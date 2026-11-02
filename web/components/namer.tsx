"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CameraIcon, CheckIcon, TagIcon } from "@/components/icons";
import { PhotoView } from "@/components/photo-view";
import { Term } from "@/components/term";
import { TestsPanel } from "@/components/tests-panel";
import { exifTakenAt } from "@/lib/exif";
import type { Answers } from "@/lib/household-tests";
import { isSettled } from "@/lib/job-state";
import type { JobView } from "@/lib/jobs";
import type { MineralHit } from "@/lib/minerals";
import { HOW_CHOICES, type ConfirmHow } from "@/lib/naming";
import { takenLabel } from "@/lib/photos";
import { stoneName, verdictLine, type Pill } from "@/lib/pills";
import { shrinkToJpeg } from "@/lib/shrink";

// One stone per screen (#8), on the Conservatory's namer: large targets, one
// tap to name, every naming saved at once, and a Change that reverses it.
// What it says comes from Phase 0 (#1): "probably" when Jasper's two opinions
// agree, "could be" when they don't, never a percentage, and the name field
// always on the screen because "could be" never promises the answer is among
// the pills. The same screen serves the person walking the strip and the one
// waiting at the kitchen table: an unsettled job polls until Jasper answers,
// with the pill area reserved so nothing moves when the pills arrive.

type Stone = { id: number; name: string; variety: string | null };

type Props = {
  initialJob: JobView;
  waiting: number;
  position: number;
  nextJobId: number | null;
  lastStone: Stone | null;
};

type Named = { specimenId: number; name: string; variety: string | null; how: ConfirmHow; nextJobId: number | null };

const MAX_PHOTOS = 5;
const POLL_MS = 1500;

export function Namer({ initialJob, waiting, position, nextJobId: initialNext, lastStone }: Props) {
  const router = useRouter();
  const [job, setJob] = useState<JobView>(initialJob);
  const [named, setNamed] = useState<Named | null>(initialJob.confirmation ? { ...initialJob.confirmation, nextJobId: initialNext } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [variety, setVariety] = useState("");
  const [hits, setHits] = useState<MineralHit[]>([]);
  const [showTests, setShowTests] = useState(false);
  const [armedDismiss, setArmedDismiss] = useState(false);
  const [howSaved, setHowSaved] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const addRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);

  const settled = isSettled(job);
  const plan = job.plan;
  const asking = !settled && plan.pills.length > 0; // asked again; the old pills wait for the new
  const nextJobId = named?.nextJobId ?? initialNext;

  // Poll until Jasper has answered (the on-the-spot flow, and asking again).
  useEffect(() => {
    if (settled) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (!r.ok || stopped) return;
        const fresh = (await r.json()) as JobView;
        if (!stopped) setJob(fresh);
      } catch {
        /* next tick */
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [settled, job.id]);

  // Autocomplete over the minerals already in the collection; refetched after
  // a naming or a Change, which both move stones in and out of it.
  useEffect(() => {
    let stopped = false;
    const t = setTimeout(
      async () => {
        try {
          const r = await fetch(`/api/minerals?q=${encodeURIComponent(typed)}`, { cache: "no-store" });
          if (r.ok && !stopped) setHits((await r.json()) as MineralHit[]);
        } catch {
          /* no suggestions */
        }
      },
      typed ? 150 : 0,
    );
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [typed, named]);

  async function send<T>(url: string, init: RequestInit, failure: string): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, init);
      const data = (await r.json()) as T & { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      return data;
    } catch (err) {
      setError(`${failure} (${err instanceof Error ? err.message : "no answer"}). Try again.`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function confirm(body: Record<string, unknown>) {
    const data = await send<Named>(
      `/api/jobs/${job.id}/confirm`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, variety: variety.trim() || undefined }) },
      "That name wasn’t saved",
    );
    if (data) {
      setNamed(data);
      setHowSaved(false);
      router.refresh();
    }
  }

  async function setHow(how: ConfirmHow) {
    if (!named || named.how === how) return;
    const data = await send<{ how: ConfirmHow }>(
      `/api/jobs/${job.id}/confirm`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ how }) },
      "That wasn’t saved",
    );
    if (data) {
      setNamed({ ...named, how: data.how });
      setHowSaved(true);
    }
  }

  async function change() {
    const data = await send<{ ok: true }>(`/api/jobs/${job.id}/confirm`, { method: "DELETE" }, "The name couldn’t be taken off");
    if (data) {
      setNamed(null);
      router.refresh();
    }
  }

  async function dismiss() {
    if (!armedDismiss) {
      setArmedDismiss(true);
      return;
    }
    const data = await send<{ nextJobId: number | null }>(`/api/jobs/${job.id}/dismiss`, { method: "POST" }, "The photo couldn’t be removed");
    if (data) {
      router.push(data.nextJobId ? `/name/${data.nextJobId}` : "/name");
      router.refresh();
    }
  }

  async function ask(answers: Answers, note: string) {
    const data = await send<{ tests: Answers }>(
      `/api/jobs/${job.id}/tests`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tests: answers, notes: note }) },
      "Jasper couldn’t be asked again",
    );
    if (data) {
      setJob((j) => ({ ...j, status: "queued", nextAttemptAt: null, tests: data.tests, notes: note.trim() || null }));
      setShowTests(false);
    }
  }

  async function addPhoto(file: File) {
    setBusy(true);
    setError(null);
    try {
      const takenAt = exifTakenAt(await file.arrayBuffer());
      const { blob, mime } = await shrinkToJpeg(file);
      const form = new FormData();
      form.append("file", new File([blob], file.name, { type: mime }));
      if (takenAt) form.append("takenAt", takenAt);
      const r = await fetch(`/api/jobs/${job.id}/photos`, { method: "POST", body: form });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `server ${r.status}`);
      const fresh = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (fresh.ok) {
        const j = (await fresh.json()) as JobView;
        setJob(j);
        setPhotoIndex(j.photos.length - 1);
      }
    } catch (err) {
      setError(`The photo wasn’t added (${err instanceof Error ? err.message : "no answer"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  const photo = job.photos[photoIndex] ?? job.photos[0];
  const canAddPhoto = !named && job.photos.length < MAX_PHOTOS && job.status !== "identifying";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2 leading-tight">Name this stone</h1>
          <p className="text-ink-2 tabular-nums">{countLine(named !== null, waiting, position)}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!named && nextJobId ? (
            <Link href={`/name/${nextJobId}`} className="btn btn-soft">
              Skip for now
            </Link>
          ) : null}
          <Link href="/" className="btn btn-soft">
            Done for now
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-8">
        <section aria-label="The photo" className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 lg:max-w-[640px]">
          {/* 280 px on a phone so Jasper's guess is on the first screen; DESIGN.md's 640 px hero is the specimen page's. */}
          <div className="relative flex h-[280px] items-center justify-center overflow-hidden rounded-photo bg-photo-well sm:h-[520px]">
            {photo ? <PhotoView key={photo.id} url={photo.url} thumbUrl={photo.thumbUrl} alt="Your photo of the stone" /> : null}
            <span className="absolute bottom-3 left-3 rounded-pill bg-caption px-3.5 py-1.5 text-meta font-bold text-white">
              {takenLabel(photo?.takenAt ?? null)}
              {job.photos.length > 1 ? ` · ${photoIndex + 1} of ${job.photos.length}` : ""}
            </span>
          </div>
          {job.photos.length > 1 ? (
            <div className="flex flex-wrap gap-2.5">
              {job.photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPhotoIndex(i)}
                  aria-pressed={i === photoIndex}
                  aria-label={`Photo ${i + 1} of ${job.photos.length}`}
                  className={`size-[72px] overflow-hidden rounded-thumb border-4 bg-tile-stone ${i === photoIndex ? "border-azurite" : "border-transparent"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail, already small */}
                  <img src={p.thumbUrl} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
          {canAddPhoto ? (
            <>
              <button type="button" disabled={busy} onClick={() => addRef.current?.click()} className="btn btn-soft self-start">
                <CameraIcon className="size-5" />
                Add another photo of this stone
              </button>
              <input
                ref={addRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void addPhoto(f);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
        </section>

        <section aria-label="Its name" className="card flex min-w-0 flex-[1_1_380px] flex-col gap-6 p-5 sm:p-8">
          {named ? namedView(named) : !settled && plan.pills.length === 0 ? lookingView() : chooseView()}
          {error ? (
            <p role="alert" className="rounded-tile border border-warn-line bg-warn px-4 py-3 text-warn-ink">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </>
  );

  // Render functions rather than nested components: a component declared in
  // Namer would be a new type on every render, and React would remount the
  // inputs on each keystroke and drop the focus.

  function lookingView() {
    const retrying = job.status === "failed";
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="font-display text-h2 font-semibold leading-tight">Jasper is looking&hellip;</p>
          <p className="text-lead text-ink-2">
            {retrying ? "Jasper hit a snag and will try again shortly." : "Usually a few seconds. Jasper’s suggestions appear here."}
          </p>
        </div>
        <div aria-hidden className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-pill border border-line bg-ground" />
          ))}
        </div>
      </>
    );
  }

  function chooseView() {
    const none = plan.verdict === "none";
    const heading = !none ? verdictLine(plan) : job.status === "failed" ? "Jasper couldn’t look at this one" : "Jasper had no guess";
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="font-display text-[30px] font-semibold leading-tight sm:text-h2">{heading}</p>
          <p className="text-lead text-ink-2">{explain()}</p>
        </div>

        {job.labelText ? (
          <figure className="flex items-start gap-3 rounded-[4px] border border-ink bg-label px-4 py-3">
            <TagIcon className="mt-1 size-6 flex-none text-ink-2" />
            <div className="min-w-0">
              <figcaption className="text-meta font-bold text-ink-2">Jasper read a label in the photo</figcaption>
              <p className="whitespace-pre-line break-words font-label text-ink">{job.labelText}</p>
            </div>
          </figure>
        ) : null}

        {none ? nameField(true) : null}

        {plan.pills.length > 0 ? (
          <div role="group" aria-label="Jasper’s suggestions" className="flex flex-col gap-3">
            {plan.pills.map((p) => (
              <PillButton key={`${p.pick.model}-${p.pick.rank}`} pill={p} disabled={busy || asking} onPick={() => confirm({ pick: p.pick })} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center">
            <label htmlFor="variety" className="font-bold">
              Variety or shop name <span className="font-normal text-ink-2">(optional)</span>
            </label>
            <Term k="variety" bare />
          </div>
          <div className="field flex items-center">
            <input
              id="variety"
              type="text"
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              maxLength={80}
              placeholder="Amethyst, or Blue Lace Agate"
              autoComplete="off"
            />
          </div>
        </div>

        {!none ? nameField(false) : null}

        <div className="flex flex-col gap-4 border-t border-line pt-5">
          <button type="button" aria-expanded={showTests} disabled={asking} onClick={() => setShowTests((v) => !v)} className="btn btn-soft self-start">
            {showTests ? "Hide the tests" : "Want to be sure? Try a test"}
          </button>
          {showTests ? <TestsPanel suggested={job.suggestedTests} initial={job.tests} initialNote={job.notes} busy={busy} onAsk={ask} /> : null}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          {lastStone ? (
            <button type="button" disabled={busy} onClick={() => confirm({ sameAsSpecimenId: lastStone.id })} className="btn btn-soft">
              Same stone as the last one <span className="font-normal text-ink-2">({stoneName(lastStone.name)})</span>
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={dismiss} onBlur={() => setArmedDismiss(false)} className="btn btn-soft">
            {armedDismiss ? "Tap again to remove this photo" : "Not a rock"}
          </button>
        </div>
      </>
    );
  }

  function explain() {
    if (asking) return "Jasper is asking again with your answers. The new suggestions replace these in a few seconds.";
    const opinions = <Term k="opinions">Jasper&rsquo;s two opinions</Term>;
    if (plan.verdict === "probably") return <>{opinions} agree. Tap it if it looks right, or name it yourself.</>;
    if (plan.verdict === "could_be" && plan.opinions === 2)
      return <>{opinions} differ. Tap the one that looks right, or try a test to be sure.</>;
    if (plan.verdict === "could_be") return <>Only one of {opinions} came back, so Jasper isn&rsquo;t sure.</>;
    if (job.status === "failed") return "Something went wrong when Jasper tried. If you know the name, type it below.";
    return <>Neither of {opinions} could name it. If you know the name, type it below.</>;
  }

  function nameField(first: boolean) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) void confirm({ typedName: typed });
          else typedRef.current?.focus();
        }}
      >
        <label htmlFor="typed" className="font-bold">
          {first ? "Type the name" : "Or type the name"}
        </label>
        <div className="flex flex-wrap gap-3">
          <div className="field flex min-w-[200px] flex-1 items-center">
            <input
              ref={typedRef}
              id="typed"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={120}
              placeholder="Galena, or Granite"
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={busy || asking} className="btn btn-primary btn-lg">
            Name it
          </button>
        </div>
        {hits.length > 0 ? (
          <div className="flex flex-col gap-2 pt-1">
            <p id="hits-h" className="text-meta text-ink-2">
              Already in your collection
            </p>
            <ul aria-labelledby="hits-h" className="flex flex-wrap gap-2">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" disabled={busy || asking} onClick={() => confirm({ typedName: h.name })} className="chip">
                    {stoneName(h.name)}
                    <span className="font-normal text-ink-2">{h.stones}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>
    );
  }

  function namedView(n: Named) {
    return (
      <>
        {/* The specimen label (DESIGN.md §4): paper, a double rule, an ink rule under the name. */}
        <div className="rounded-[6px] border border-line-2 bg-label p-2.5">
          <div className="flex flex-col gap-2 border border-line px-5 py-4">
            <p className="font-label text-meta text-ink-2">Named</p>
            <p className="border-b-2 border-ink pb-2 font-display text-h2 font-semibold leading-tight">{stoneName(n.name)}</p>
            <p className="font-label text-meta text-ink-2">
              Variety: <span className={`font-sans text-body ${n.variety ? "text-ink" : "italic text-ink-3"}`}>{n.variety ?? "Not recorded"}</span>
            </p>
          </div>
        </div>
        <p className="text-lead text-ink-2">It&rsquo;s in your collection now.</p>

        <fieldset className="flex flex-col gap-3">
          <legend className="float-left w-full font-display text-h3 font-semibold leading-tight">How do you know?</legend>
          <p className="text-ink-2">So Jasper can be checked against what you know, later on.</p>
          <div className="flex flex-wrap gap-2">
            {HOW_CHOICES.map((c) => (
              <button key={c.how} type="button" disabled={busy} aria-pressed={n.how === c.how} onClick={() => setHow(c.how)} className="chip">
                {n.how === c.how ? <CheckIcon className="size-4" /> : null}
                {c.label}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="min-h-7 text-meta text-ink-2">
            {howSaved ? "Saved." : ""}
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          {nextJobId ? (
            <Link href={`/name/${nextJobId}`} className="btn btn-primary btn-lg">
              Next stone
            </Link>
          ) : (
            <Link href="/" className="btn btn-primary btn-lg">
              Back to your collection
            </Link>
          )}
          <button type="button" disabled={busy} onClick={change} className="min-h-12 px-2 font-bold text-azurite underline underline-offset-4 hover:text-azurite-deep">
            Change
          </button>
        </div>
      </>
    );
  }
}

function countLine(named: boolean, waiting: number, position: number): string {
  if (named) return waiting > 0 ? `${waiting} still waiting` : "Nothing else is waiting";
  if (waiting > 1) return `${position} of ${waiting} waiting`;
  return waiting === 1 ? "The only one waiting" : "Nothing else is waiting";
}

function PillButton({ pill, disabled, onPick }: { pill: Pill; disabled: boolean; onPick: () => void }) {
  const lead = pill.word === "probably";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label={`${stoneName(pill.name)}${pill.variety ? `, ${pill.variety}` : ""}: ${pill.word}`}
      className={`flex min-h-16 w-full items-center justify-between gap-4 rounded-pill border bg-surface py-2.5 pl-6 pr-3 text-left transition-colors hover:border-line-strong hover:bg-sand disabled:cursor-progress disabled:opacity-60 ${lead ? "border-2 border-azurite" : "border-line-2"}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-display text-h3 font-semibold leading-tight">{stoneName(pill.name)}</span>
        {pill.variety ? <span className="block truncate text-[17px] text-ink-2">{pill.variety}</span> : null}
      </span>
      <span className={`shrink-0 rounded-pill px-3 py-1 text-tag font-bold ${lead ? "bg-azurite-soft text-azurite-note" : "bg-sand text-tag-ink"}`}>{pill.word}</span>
    </button>
  );
}
