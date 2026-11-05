"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CameraIcon, CheckIcon, TagIcon } from "@/components/icons";
import { JasperAtWork } from "@/components/jasper-at-work";
import { PhotoView } from "@/components/photo-view";
import { PieceTitle } from "@/components/piece-title";
import { Term } from "@/components/term";
import { TestsPanel } from "@/components/tests-panel";
import { WhyNote } from "@/components/why-note";
import { exifTakenAt } from "@/lib/exif";
import { HARDNESS_TESTS, TESTS, type Answers, type Misfit } from "@/lib/household-tests";
import { isSettled } from "@/lib/job-state";
import type { JobView } from "@/lib/jobs";
import type { MineralHit } from "@/lib/minerals";
import { HOW_CHOICES, type ConfirmHow } from "@/lib/naming";
import { takenLabel } from "@/lib/photos";
import { FORM_LABEL, FORMS, kindOf, madeOfLine, pieceName, savedParts, stoneName, verdictLine, type Form, type Pill } from "@/lib/pills";
import { shrinkToJpeg } from "@/lib/shrink";
import type { StonePart } from "@/lib/specimens";

// One stone per screen (#8), on the Conservatory's namer: large targets, one
// tap to name, every naming saved at once, and a Change that reverses it.
// What it says comes from Phase 0 (#1): "probably" when Jasper's two opinions
// agree, "could be" when they don't, never a percentage, and the name field
// always on the screen because "could be" never promises the answer is among
// the pills. The same screen serves the person walking the strip and the one
// waiting at the kitchen table: an unsettled job polls until Jasper answers,
// with the pill area reserved so nothing moves when the pills arrive. Since
// #18 it also says when the two agree on the stone but not its variety (and
// offers both guesses for the variety field), names the test that would
// settle a real disagreement, and notes a pill that can't fit a scratch test
// the person answered. Since #36 the card's heading is where the wait shows:
// "Jasper is looking…" with Jasper at work under it, for the first look and
// again after "Ask Jasper again", when focus moves there so the heading is on
// the screen and read out. Since #29 each pill names the whole piece as a show
// label does (pieceName), wrapping rather than cut, and a mineral only one
// opinion saw is a chip under the lead pill, off until the person ticks it.
// Since #62 an object that is not a mineral says what it is made of under its
// pill ("Made of Calcite"), with a "Made of" field and, when the two opinions
// differ on it, both guesses as chips, as the variety has. Since #71 each pill
// has "Why?" under it, which opens what the models saw. Since #73 a pill
// carries the piece's form as a tag ("geode", "tumbled"), and a Form chip row
// under the fields, prefilled from the lead pill, is what a tap saves. Since
// #106 the pills sit in a limestone well under the heading, the name field
// follows, and the fields are one "Details" group under it, so the choice
// reads as the choice and the rest as paperwork.

type Props = {
  initialJob: JobView;
  waiting: number;
  position: number;
  nextJobId: number | null;
};

type Named = { specimenId: number; name: string; variety: string | null; parts: StonePart[]; madeOf: string | null; form: Form | null; how: ConfirmHow; nextJobId: number | null };

const MAX_PHOTOS = 5;
const POLL_MS = 1500;

export function Namer({ initialJob, waiting, position, nextJobId: initialNext }: Props) {
  const router = useRouter();
  const [job, setJob] = useState<JobView>(initialJob);
  const [named, setNamed] = useState<Named | null>(initialJob.confirmation ? { ...initialJob.confirmation, nextJobId: initialNext } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [variety, setVariety] = useState("");
  const [madeOf, setMadeOf] = useState(""); // what an object that is not a mineral is made of (#62)
  const [form, setForm] = useState<Form | null | undefined>(undefined); // the Form chips (#73): undefined until touched, then the choice or none
  const [ticked, setTicked] = useState<string[]>([]); // the lead pill's one-opinion minerals the person added
  const [hits, setHits] = useState<MineralHit[]>([]);
  const [showTests, setShowTests] = useState(false);
  const [armedDismiss, setArmedDismiss] = useState(false);
  const [howSaved, setHowSaved] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const addRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLDivElement>(null); // the card's heading block: focused after "Ask Jasper again"

  const settled = isSettled(job);
  const plan = job.plan;
  const asking = !settled && plan.pills.length > 0; // asked again; the old pills wait for the new
  const doubt = plan.verdict === "probably" ? plan.pills[0]?.doubt : undefined;
  const madeOfDoubt = plan.verdict === "probably" ? plan.pills[0]?.madeOfDoubt : undefined;
  // The "Made of" field is for a fossil, a shell, sea glass: shown when any pill is one, or says what it is made of.
  const asksMadeOf = plan.pills.some((p) => p.kind === "other" || p.madeOf !== null || p.madeOfDoubt !== undefined);
  const nextJobId = named?.nextJobId ?? initialNext;
  // The Form chips follow the lead pill until the person touches them; a tap on any pill then saves the chips' choice.
  const formShown: Form | null = form === undefined ? (plan.pills[0]?.form ?? null) : form;

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
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, variety: variety.trim() || undefined, madeOf: madeOf.trim() || undefined, form: form === undefined ? undefined : (form ?? "") }),
      },
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
      // The button just pressed goes with the panel, so focus would be lost;
      // the heading takes it, which also brings the card's top into view on a
      // phone and has a screen reader say "Jasper is looking again…".
      headRef.current?.focus();
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

  // The heading block, one element for both looks and the verdict, so focus
  // and the live region stay put while the words under them change. Jasper at
  // work sits under the heading while he has the stone; it is aria-hidden, so
  // the live region reads only the heading and the line.
  function head(heading: ReactNode, line: ReactNode, working: boolean) {
    const answered = !working && Object.keys(job.tests).length > 0;
    return (
      <div ref={headRef} tabIndex={-1} aria-live="polite" className="flex flex-col gap-2 outline-none">
        {answered ? <p className="text-meta font-bold text-ink-2">Jasper looked again with your answers</p> : null}
        <p className={`font-display font-semibold leading-tight ${working ? "text-h2" : "text-[30px] sm:text-h2"}`}>{heading}</p>
        {working ? <JasperAtWork seed={job.id} className="text-lead text-ink-2" /> : null}
        <p className="text-lead text-ink-2">{line}</p>
      </div>
    );
  }

  function snag() {
    return job.status === "failed" ? "Jasper hit a snag and will try again shortly." : null;
  }

  function lookingView() {
    return (
      <>
        {head(<>Jasper is looking&hellip;</>, snag() ?? "Usually a few seconds. Jasper’s suggestions appear here.", true)}
        <div aria-hidden className="well flex flex-col gap-3">
          <p className="text-meta font-bold text-ink-2">Jasper&rsquo;s suggestions</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-[32px] border border-line bg-surface" />
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
        {asking
          ? head(<>Jasper is looking again&hellip;</>, snag() ?? "With your answers. The new suggestions replace these in a few seconds.", true)
          : head(heading, explain(), false)}

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
          // The well (#106): the suggestions on limestone, so white pills read as things to press and the fields below as the paperwork.
          <div className="well flex flex-col gap-3">
            <p id="suggestions-h" className="text-meta font-bold text-ink-2">
              Jasper&rsquo;s suggestions
            </p>
            <div role="group" aria-labelledby="suggestions-h" className="flex flex-col gap-3">
              {plan.pills.map((p) => {
                const key = `${p.pick.model}-${p.pick.rank}`.replace(/[^a-z0-9]+/gi, "-");
                // What a tap saves, so the pill always says it: its parts and the maybes ticked.
                const parts = savedParts(p, ticked);
                return (
                  <div key={key} className="flex flex-col gap-1.5">
                    <PillButton
                      pill={p}
                      name={pieceName({ ...p, parts })}
                      describedBy={p.misfit ? `misfit-${key}` : undefined}
                      disabled={busy || asking}
                      onPick={() => confirm({ pick: p.pick, maybe: ticked })}
                    />
                    {/* Flush under its pill: the 48 px target starts at the pill's edge, with no gap above it. */}
                    {p.reasons.length > 0 ? (
                      <div className="-mt-1.5 pl-4">
                        <WhyNote reasons={p.reasons} opinions={p.models.length} />
                      </div>
                    ) : null}
                    {p.misfit ? misfitNote(p.misfit, `misfit-${key}`) : null}
                    {p.maybe.length > 0 ? maybeChips(p) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {!none ? nameField(false) : null}

        {/* The paperwork (#106): what goes with the name, under the name, behind a rule. */}
        <div className="flex flex-col gap-5 border-t border-line pt-5">
          <p className="text-meta font-bold text-ink-2">
            Details to save with the name <span className="font-normal">(optional)</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center">
              <label htmlFor="variety" className="font-bold">
                Variety or shop name
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
            {doubt ? (
              <div className="flex flex-col gap-2 pt-1">
                <p id="guesses-h" className="text-meta text-ink-2">
                  Jasper&rsquo;s two guesses
                </p>
                <ul aria-labelledby="guesses-h" className="flex flex-wrap gap-2">
                  {doubt.guesses.map((g) => {
                    const on = variety === stoneName(g);
                    return (
                      <li key={g}>
                        <button
                          type="button"
                          disabled={busy || asking}
                          aria-pressed={on}
                          onClick={() => setVariety(on ? "" : stoneName(g))}
                          className="chip"
                        >
                          {on ? <CheckIcon className="size-4" /> : null}
                          {stoneName(g)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          {asksMadeOf ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center">
                <label htmlFor="made-of" className="font-bold">
                  Made of
                </label>
                <Term k="madeOf" bare />
              </div>
              <div className="field flex items-center">
                <input
                  id="made-of"
                  type="text"
                  value={madeOf}
                  onChange={(e) => setMadeOf(e.target.value)}
                  maxLength={80}
                  placeholder="Calcite, or Quartz"
                  autoComplete="off"
                />
              </div>
              {madeOfDoubt ? (
                <div className="flex flex-col gap-2 pt-1">
                  <p id="made-of-guesses-h" className="text-meta text-ink-2">
                    Jasper&rsquo;s two guesses
                  </p>
                  <ul aria-labelledby="made-of-guesses-h" className="flex flex-wrap gap-2">
                    {madeOfDoubt.guesses.map((g) => {
                      const on = madeOf === stoneName(g);
                      return (
                        <li key={g}>
                          <button
                            type="button"
                            disabled={busy || asking}
                            aria-pressed={on}
                            onClick={() => setMadeOf(on ? "" : stoneName(g))}
                            className="chip"
                          >
                            {on ? <CheckIcon className="size-4" /> : null}
                            {stoneName(g)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {plan.pills.length > 0 ? formChips() : null}
        </div>

        <div className="flex flex-col gap-4 border-t border-line pt-5">
          <button type="button" aria-expanded={showTests} disabled={asking} onClick={() => setShowTests((v) => !v)} className="btn btn-soft self-start">
            {showTests ? "Hide the tests" : "Want to be sure? Try a test"}
          </button>
          {showTests ? <TestsPanel suggested={job.suggestedTests} initial={job.tests} initialNote={job.notes} busy={busy} onAsk={ask} /> : null}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <button type="button" disabled={busy} onClick={dismiss} onBlur={() => setArmedDismiss(false)} className="btn btn-soft">
            {armedDismiss ? "Tap again to remove this photo" : "Not a rock"}
          </button>
        </div>
      </>
    );
  }

  function explain() {
    const opinions = <Term k="opinions">Jasper&rsquo;s two opinions</Term>;
    if (doubt)
      return (
        <>
          {opinions}
          {` agree it’s ${stoneName(doubt.level)}, but not on the `}
          <Term k="variety">variety</Term>
          {`: ${doubt.guesses.map(stoneName).join(" or ")}.`}
        </>
      );
    if (madeOfDoubt) {
      const test = job.suggestedTests[0];
      const phrase = test ? TESTS[test.kind].phrase : null;
      return (
        <>
          {opinions}
          {` agree it’s ${pieceName(plan.pills[0])}, but not what it’s `}
          <Term k="madeOf">made of</Term>
          {`: ${madeOfDoubt.guesses.map(stoneName).join(" or ")}.`}
          {phrase ? ` ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} would tell.` : null}
        </>
      );
    }
    if (plan.verdict === "probably") return <>{opinions} agree. Tap the name that fits, or type your own below.</>;
    const test = job.suggestedTests[0];
    // A test tells two minerals apart; two readings of a fossil it can only tell what it is made of.
    const bothStones = !plan.pills.slice(0, 2).some((p) => p.kind === "other");
    if (plan.verdict === "could_be" && plan.opinions === 2 && test && bothStones) {
      const phrase = TESTS[test.kind].phrase;
      return (
        <>
          {opinions}
          {` differ. ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} would tell them apart.`}
        </>
      );
    }
    if (plan.verdict === "could_be" && plan.opinions === 2)
      return <>{opinions} differ. Tap the one that looks right, or try a test to be sure.</>;
    if (plan.verdict === "could_be") return <>Only one of {opinions} came back, so Jasper isn&rsquo;t sure.</>;
    if (job.status === "failed") return "Something went wrong when Jasper tried. If you know the name, type it below.";
    return <>Neither of {opinions} could name it. If you know the name, type it below.</>;
  }

  // The shape of the piece (#73), as a rock hound bins it: chips, one on at
  // most, following the lead pill until touched; a dashed "Not sure" for none.
  function formChips() {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="float-left mb-2 flex w-full items-center font-bold">
          Form <Term k="form" bare />
        </legend>
        <div className="flex flex-wrap gap-2">
          {FORMS.map((f) => (
            <button key={f} type="button" disabled={busy || asking} aria-pressed={formShown === f} onClick={() => setForm(formShown === f ? null : f)} className="chip">
              {formShown === f ? <CheckIcon className="size-4" /> : null}
              {FORM_LABEL[f]}
            </button>
          ))}
          <button type="button" disabled={busy || asking} aria-pressed={formShown === null} onClick={() => setForm(null)} className="chip chip-dashed">
            {formShown === null ? <CheckIcon className="size-4" /> : null}
            Not sure
          </button>
        </div>
      </fieldset>
    );
  }

  // The minerals only one opinion saw, under the lead pill (#29): each a chip,
  // off by default, that adds it to what the pill names and saves.
  function maybeChips(p: Pill) {
    const names = p.maybe.map((m) => stoneName(m.name));
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const id = `maybe-${p.pick.model}-${p.pick.rank}`.replace(/[^a-z0-9]+/gi, "-");
    return (
      <div className="flex flex-col gap-2 pl-6 pt-1">
        <p id={id} className="text-ink-2">
          {names.length === 1
            ? `Jasper also saw ${list} (one opinion). Add it?`
            : `Jasper also saw ${list} (one opinion each). Add them?`}
        </p>
        <ul aria-labelledby={id} className="flex flex-wrap gap-2">
          {p.maybe.map((m) => {
            const on = ticked.includes(m.name);
            return (
              <li key={m.name}>
                <button
                  type="button"
                  disabled={busy || asking}
                  aria-pressed={on}
                  onClick={() => setTicked(on ? ticked.filter((t) => t !== m.name) : [...ticked, m.name])}
                  className="chip"
                >
                  {on ? <CheckIcon className="size-4" /> : null}
                  {`${m.role === "on" ? "On" : "With"} ${stoneName(m.name)}`}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // DESIGN.md's warn note for answers that don't fit the Mindat record, with the reason.
  function misfitNote(m: Misfit, id: string) {
    const mohs = m.hmin === m.hmax ? `${m.hmin}` : `${m.hmin} to ${m.hmax}`;
    return (
      <p id={id} className="rounded-tile border border-warn-line bg-warn px-4 py-2.5 text-warn-ink">
        {`Doesn’t fit your ${HARDNESS_TESTS[m.test]?.word ?? m.test} test: ${stoneName(m.name)} is `}
        <Term k="hardness">{`Mohs ${mohs}`}</Term>.
      </p>
    );
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
          {/* Primary only on the no-guess screen (#106): with pills, the main action is a tap on one. */}
          <button type="submit" disabled={busy || asking} className={`btn btn-lg ${first ? "btn-primary" : "btn-soft"}`}>
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
            <p className="text-balance border-b-2 border-ink pb-2 font-display text-h2 font-semibold leading-tight">
              <PieceTitle piece={n} />
            </p>
            <p className="font-label text-meta text-ink-2">
              Variety: <span className={`font-sans text-body ${n.variety ? "text-ink" : "italic text-ink-3"}`}>{n.variety ?? "Not recorded"}</span>
            </p>
            {n.madeOf ? (
              <p className="font-label text-meta text-ink-2">
                Made of: <span className="font-sans text-body text-ink">{stoneName(n.madeOf)}</span>
              </p>
            ) : null}
            {n.form ? (
              <p className="font-label text-meta text-ink-2">
                Form: <span className="font-sans text-body text-ink">{FORM_LABEL[n.form]}</span>
              </p>
            ) : null}
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

/**
 * One of Jasper's suggestions (DESIGN.md §4): the piece's name as a show label
 * gives it, wrapping onto a second line rather than cut, with "A kind of
 * Quartz" under a hobby name, "Made of Calcite" under a fossil (#62), and its word.
 */
function PillButton({ pill, name, describedBy, disabled, onPick }: { pill: Pill; name: string; describedBy?: string; disabled: boolean; onPick: () => void }) {
  const lead = pill.word === "probably";
  const kind = kindOf(pill);
  const made = pill.madeOf ? madeOfLine(pill.madeOf) : null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label={`${name}${kind ? `, ${kind.toLowerCase()}` : ""}${made ? `, ${made.toLowerCase()}` : ""}${pill.form ? `, ${FORM_LABEL[pill.form].toLowerCase()}` : ""}: ${pill.word}`}
      aria-describedby={describedBy}
      // 32 px corners: a pill on one line, and a rounded card, not an oval, when a long name wraps.
      // The name has first claim on the width (a 12 rem basis); where the tags can't fit beside
      // that, on a phone, they drop under it, rather than squeezing the name to a syllable a line.
      className={`flex min-h-16 w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[32px] border bg-surface py-2.5 pl-6 pr-3 text-left transition-colors hover:border-line-strong hover:bg-sand disabled:opacity-60 ${lead ? "border-2 border-azurite" : "border-line-2"}`}
    >
      <span className="min-w-0 flex-[1_1_12rem]">
        <span className="block text-balance break-words font-display text-h3 font-semibold leading-tight">{name}</span>
        {kind ? <span className="block text-[17px] text-ink-2">{kind}</span> : null}
        {made ? <span className="block text-[17px] text-ink-2">{made}</span> : null}
      </span>
      <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {pill.form ? <span className="rounded-pill bg-sand px-3 py-1 text-tag font-bold text-tag-ink">{FORM_LABEL[pill.form].toLowerCase()}</span> : null}
        <span className={`rounded-pill px-3 py-1 text-tag font-bold ${lead ? "bg-azurite-soft text-azurite-note" : "bg-sand text-tag-ink"}`}>{pill.word}</span>
      </span>
    </button>
  );
}
