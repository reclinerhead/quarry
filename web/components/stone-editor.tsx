"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { PieceTitle } from "@/components/piece-title";
import { Term } from "@/components/term";
import { ACQUIRED_LABEL, KIND_LABEL, longDay, missingDetails, type Acquired } from "@/lib/collection";
import type { MineralHit } from "@/lib/minerals";
import { norm } from "@/lib/names";
import { isMatrix, MATRIX, stoneName, type StoneKind } from "@/lib/pills";
import type { StonePart } from "@/lib/specimens";

// "This specimen" (#9): the specimen label from DESIGN.md §4 (paper, a double
// rule, the name over a 2 px ink rule, Courier field names) with the stone's
// own facts. Unknowns read "Not recorded yet" with an Add link, and an amber
// note counts the details a collector's label would want (missingDetails).
// "Edit details", "Add" or "Fill in details" turns the label into a form; one
// Save sends the lot through PATCH /api/stones/[id]. Since #29 the label's
// name is the piece's (pieceName), and the other minerals on it are rows,
// "With" and "On", picked in the form with the name field's autocomplete.
// The first row is the stone's own mineral (#33), the species the title leads
// with or hides behind a hobby name; it is read-only, since the main mineral
// changes through "Change" on the naming, not the form.

export type StoneFacts = {
  name: string;
  kind: StoneKind;
  variety: string | null;
  parts: StonePart[];
  foundAt: string | null;
  acquired: Acquired | null;
  acquiredOn: string | null;
  location: string | null;
  notes: string | null;
};

type Draft = {
  variety: string;
  withs: Array<{ name: string; kept: boolean }>; // untick to take one off, so a slip is one tap to undo
  on: string; // "" for nothing under it, MATRIX for unnamed rock
  foundAt: string;
  acquired: Acquired | "";
  acquiredOn: string;
  location: string;
  notes: string;
};

type Field = keyof Draft;

function toDraft(f: StoneFacts): Draft {
  return {
    variety: f.variety ?? "",
    withs: f.parts.filter((p) => p.role === "with").map((p) => ({ name: p.name, kept: true })),
    on: f.parts.find((p) => p.role === "on")?.name ?? "",
    foundAt: f.foundAt ?? "",
    acquired: f.acquired ?? "",
    acquiredOn: f.acquiredOn ?? "",
    location: f.location ?? "",
    notes: f.notes ?? "",
  };
}

const ROWS: Array<{ field: Field; label: string; show: (f: StoneFacts) => React.ReactNode | null }> = [
  { field: "variety", label: "Variety", show: (f) => f.variety },
  {
    field: "withs",
    label: "With",
    show: (f) => f.parts.filter((p) => p.role === "with").map((p) => stoneName(p.name)).join(", ") || null,
  },
  {
    field: "on",
    label: "On",
    show: (f) => {
      const base = f.parts.find((p) => p.role === "on");
      if (!base) return null;
      return isMatrix(base.name) ? <Term k="matrix">{MATRIX}</Term> : stoneName(base.name);
    },
  },
  { field: "foundAt", label: "Where from", show: (f) => f.foundAt },
  { field: "acquired", label: "How it came", show: (f) => (f.acquired ? ACQUIRED_LABEL[f.acquired] : null) },
  { field: "acquiredOn", label: "When", show: (f) => longDay(f.acquiredOn) },
  { field: "location", label: "Lives in", show: (f) => f.location },
  { field: "notes", label: "Notes", show: (f) => f.notes },
];

/** The Add link's name where "Add with" or "Add on" would make no sense read aloud. */
const ADD_LABEL: Partial<Record<Field, string>> = { withs: "Add the other minerals on it", on: "Add what it sits on" };

export function StoneEditor({ id, facts, places }: { id: number; facts: StoneFacts; places: string[] }) {
  const router = useRouter();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(facts));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [withText, setWithText] = useState(""); // a mineral being typed for "With"
  const [hits, setHits] = useState<MineralHit[]>([]);
  const firstField = useRef<Field>("variety");
  const missing = missingDetails(facts);

  // The name field's autocomplete (rankMinerals) over the collection's
  // minerals, for whichever of With and On is being typed in.
  const [typing, setTyping] = useState<"withs" | "on">("withs");
  const query = (typing === "on" ? draft.on : withText).trim();
  useEffect(() => {
    if (!editing || !query || isMatrix(query)) return;
    let stopped = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/minerals?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (r.ok && !stopped) setHits((await r.json()) as MineralHit[]);
      } catch {
        /* no suggestions */
      }
    }, 150);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [editing, query]);
  const shownHits = query && !isMatrix(query) ? hits.filter((h) => norm(h.name) !== norm(facts.name)) : [];

  function edit(field: Field = "variety") {
    firstField.current = field;
    setDraft(toDraft(facts));
    setWithText("");
    setStatus(null);
    setEditing(true);
  }

  /** Put a mineral on the "With" list, ticked; one already there is ticked again rather than repeated. */
  function addWith(name: string) {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n || isMatrix(n)) return;
    const there = draft.withs.some((w) => norm(w.name) === norm(n));
    setDraft({ ...draft, withs: there ? draft.withs.map((w) => (norm(w.name) === norm(n) ? { ...w, kept: true } : w)) : [...draft.withs, { name: n, kept: true }] });
    setWithText("");
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    const { withs, on, ...rest } = draft;
    const pending = withText.trim() && !isMatrix(withText) ? [withText.trim()] : []; // typed but not added: Save adds it
    const body = { ...rest, parts: { with: [...withs.filter((w) => w.kept).map((w) => w.name), ...pending], on: on.trim() || null } };
    try {
      const r = await fetch(`/api/stones/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      setEditing(false);
      setStatus({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: `That wasn’t saved (${err instanceof Error ? err.message : "no answer"}). Try again.` });
    } finally {
      setBusy(false);
    }
  }

  const statusLine = (
    <p role="status" aria-live="polite" className={`min-h-7 ${status?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}>
      {status?.text ?? ""}
    </p>
  );

  if (!editing)
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[6px] border border-line-2 bg-label p-2.5">
          <div className="flex flex-col gap-3 border border-line px-5 py-4 sm:px-6">
            <p className="text-balance border-b-2 border-ink pb-2 font-display text-h3 font-semibold leading-tight">
              <PieceTitle piece={facts} />
            </p>
            <dl className="flex flex-col">
              <div className="flex flex-col gap-0.5 border-b border-rule py-2.5 sm:flex-row sm:items-baseline sm:gap-6">
                <dt className="flex-none font-label text-ink-2 sm:w-[140px]">
                  {KIND_LABEL[facts.kind]}
                  {facts.kind === "other" ? null : <Term k={facts.kind} bare />}
                </dt>
                <dd className="min-w-0 break-words">{stoneName(facts.name)}</dd>
              </div>
              {ROWS.map((row) => {
                const value = row.show(facts);
                return (
                  <div key={row.field} className="flex flex-col gap-0.5 border-b border-rule py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
                    <dt className="flex-none font-label text-ink-2 sm:w-[140px]">
                      {row.label}
                      {row.field === "variety" ? <Term k="variety" bare /> : null}
                    </dt>
                    <dd className="min-w-0 whitespace-pre-line break-words">
                      {value ?? (
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="italic text-ink-3">Not recorded yet</span>
                          <button type="button" onClick={() => edit(row.field)} className="text-link" aria-label={ADD_LABEL[row.field] ?? `Add ${row.label.toLowerCase()}`}>
                            Add
                          </button>
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {missing > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-warn-line bg-warn px-4 py-3">
                <p className="font-bold text-warn-ink">{missing === 1 ? "1 detail is missing" : `${missing} details are missing`}</p>
                <button type="button" onClick={() => edit(firstMissing(facts))} className="btn btn-soft">
                  Fill in details
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => edit()} className="btn btn-soft">
            Edit details
          </button>
          {statusLine}
        </div>
      </div>
    );

  const input = (field: Exclude<Field, "acquired" | "notes" | "withs" | "on">, label: string, placeholder: string, list?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${ids}-${field}`} className="font-bold">
        {label}
      </label>
      <div className="field flex items-center">
        <input
          id={`${ids}-${field}`}
          type={field === "acquiredOn" ? "date" : "text"}
          list={list}
          value={draft[field]}
          onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
          placeholder={placeholder}
          maxLength={field === "acquiredOn" ? undefined : 120}
          autoComplete="off"
          autoFocus={firstField.current === field}
        />
      </div>
    </div>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save();
      }}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {input("variety", "Variety or shop name", "Amethyst, or Blue Lace Agate")}
        {input("foundAt", "Where it came from", "Grand Marais beach, or the Tucson show")}
        {input("acquiredOn", "When", "")}
        {input("location", "Where it lives now", "Glass case, top shelf", `${ids}-places`)}
        <datalist id={`${ids}-places`}>
          {places.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      {partsFields()}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-bold">How it came</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACQUIRED_LABEL) as Acquired[]).map((a) => (
            <button key={a} type="button" aria-pressed={draft.acquired === a} onClick={() => setDraft({ ...draft, acquired: a })} className="chip">
              {draft.acquired === a ? <CheckIcon className="size-4" /> : null}
              {ACQUIRED_LABEL[a]}
            </button>
          ))}
          <button type="button" aria-pressed={draft.acquired === ""} onClick={() => setDraft({ ...draft, acquired: "" })} className="chip chip-dashed">
            {draft.acquired === "" ? <CheckIcon className="size-4" /> : null}
            Not recorded
          </button>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-notes`} className="font-bold">
          Notes
        </label>
        <textarea
          id={`${ids}-notes`}
          rows={3}
          maxLength={1000}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Anything worth remembering about it"
          autoFocus={firstField.current === "notes"}
          className="min-h-[96px] w-full resize-y rounded-tile border border-line-2 bg-surface px-[18px] py-3 text-ink placeholder:text-ink-3"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary btn-lg">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)} className="btn btn-soft btn-lg">
          Cancel
        </button>
        {statusLine}
      </div>
    </form>
  );

  // The other minerals on it, as a show label lists them: "With", most
  // prominent first, then "On", a mineral or rock, or plain matrix.
  // A render function, not a nested component, so typing keeps the focus.
  function partsFields() {
    const onMatrix = isMatrix(draft.on);
    const hitChips = (pick: (name: string) => void) =>
      shownHits.length > 0 ? (
        <ul aria-label="Already in your collection" className="flex flex-wrap gap-2">
          {shownHits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => pick(h.name)} className="chip">
                {stoneName(h.name)}
              </button>
            </li>
          ))}
        </ul>
      ) : null;
    return (
      <fieldset className="flex flex-col gap-5 rounded-tile border border-line px-4 pb-5 pt-1 sm:px-5">
        <legend className="px-1 font-bold">Other minerals on it</legend>
        <p className="-mt-2 text-ink-2">As a show label lists them: the main one first, then what&rsquo;s with it, then what it sits on.</p>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-with`} className="font-bold">
            With
          </label>
          {draft.withs.length > 0 ? (
            <ul aria-label="With it" className="flex flex-wrap gap-2">
              {draft.withs.map((w) => (
                <li key={w.name}>
                  <button
                    type="button"
                    aria-pressed={w.kept}
                    onClick={() => setDraft({ ...draft, withs: draft.withs.map((x) => (x === w ? { ...x, kept: !x.kept } : x)) })}
                    className="chip"
                  >
                    {w.kept ? <CheckIcon className="size-4" /> : null}
                    {stoneName(w.name)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <div className="field flex min-w-[200px] flex-1 items-center">
              <input
                id={`${ids}-with`}
                type="text"
                value={withText}
                onChange={(e) => setWithText(e.target.value)}
                onFocus={() => setTyping("withs")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addWith(withText);
                  }
                }}
                placeholder="Sphalerite"
                maxLength={120}
                autoComplete="off"
                autoFocus={firstField.current === "withs"}
              />
            </div>
            <button type="button" onClick={() => addWith(withText)} className="btn btn-soft">
              Add
            </button>
          </div>
          {typing === "withs" ? hitChips(addWith) : null}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-on`} className="font-bold">
            On
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="field flex min-w-[200px] flex-1 items-center">
              <input
                id={`${ids}-on`}
                type="text"
                value={onMatrix ? "" : draft.on}
                onChange={(e) => setDraft({ ...draft, on: e.target.value })}
                onFocus={() => setTyping("on")}
                placeholder={onMatrix ? "On matrix" : "Quartz, or Basalt"}
                maxLength={120}
                autoComplete="off"
                autoFocus={firstField.current === "on"}
              />
            </div>
            <span className="inline-flex items-center">
              <button type="button" aria-pressed={onMatrix} onClick={() => setDraft({ ...draft, on: onMatrix ? "" : MATRIX })} className="chip">
                {onMatrix ? <CheckIcon className="size-4" /> : null}
                On matrix
              </button>
              <Term k="matrix" bare />
            </span>
          </div>
          {typing === "on" ? hitChips((name) => setDraft({ ...draft, on: name })) : null}
        </div>
      </fieldset>
    );
  }
}

function firstMissing(f: StoneFacts): Field {
  if (!f.foundAt) return "foundAt";
  if (!f.acquiredOn) return "acquiredOn";
  if (!f.location) return "location";
  return "variety";
}

/**
 * "Remove this stone": two taps, then DELETE /api/stones/[id], which deletes
 * its photos from the table and from disk; then home.
 */
export function RemoveStone({ id, photoCount }: { id: number; photoCount: number }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/stones/${id}`, { method: "DELETE" });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(`It wasn’t removed (${err instanceof Error ? err.message : "no answer"}). Try again.`);
      setArmed(false);
      setBusy(false);
    }
  }

  const photos = photoCount === 1 ? "its photo" : `its ${photoCount} photos`;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2">{armed ? `This can’t be undone: the stone and ${photos} will be gone.` : `Gone for good, with ${photos}.`}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void remove()} onBlur={() => !busy && setArmed(false)} className="btn btn-soft">
          {armed ? "Yes, remove it" : "Remove this stone"}
        </button>
        {armed ? (
          <button type="button" onClick={() => setArmed(false)} className="text-link">
            Keep it
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-warn-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
