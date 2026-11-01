"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { Term } from "@/components/term";
import { ACQUIRED_LABEL, longDay, missingDetails, type Acquired } from "@/lib/collection";
import { stoneName } from "@/lib/pills";

// "This specimen" (#9): the specimen label from DESIGN.md §4 (paper, a double
// rule, the name over a 2 px ink rule, Courier field names) with the stone's
// own facts. Unknowns read "Not recorded yet" with an Add link, and an amber
// note counts the details a collector's label would want (missingDetails).
// "Edit details", "Add" or "Fill in details" turns the label into a form; one
// Save sends the lot through PATCH /api/stones/[id].

export type StoneFacts = {
  name: string;
  variety: string | null;
  associates: string | null;
  foundAt: string | null;
  acquired: Acquired | null;
  acquiredOn: string | null;
  location: string | null;
  notes: string | null;
};

type Draft = { variety: string; associates: string; foundAt: string; acquired: Acquired | ""; acquiredOn: string; location: string; notes: string };

type Field = keyof Draft;

function toDraft(f: StoneFacts): Draft {
  return {
    variety: f.variety ?? "",
    associates: f.associates ?? "",
    foundAt: f.foundAt ?? "",
    acquired: f.acquired ?? "",
    acquiredOn: f.acquiredOn ?? "",
    location: f.location ?? "",
    notes: f.notes ?? "",
  };
}

const ROWS: Array<{ field: Field; label: string; show: (f: StoneFacts) => string | null }> = [
  { field: "variety", label: "Variety", show: (f) => f.variety },
  { field: "associates", label: "Also on it", show: (f) => f.associates },
  { field: "foundAt", label: "Where from", show: (f) => f.foundAt },
  { field: "acquired", label: "How it came", show: (f) => (f.acquired ? ACQUIRED_LABEL[f.acquired] : null) },
  { field: "acquiredOn", label: "When", show: (f) => longDay(f.acquiredOn) },
  { field: "location", label: "Lives in", show: (f) => f.location },
  { field: "notes", label: "Notes", show: (f) => f.notes },
];

export function StoneEditor({ id, facts, places }: { id: number; facts: StoneFacts; places: string[] }) {
  const router = useRouter();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(facts));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const firstField = useRef<Field>("variety");
  const missing = missingDetails(facts);

  function edit(field: Field = "variety") {
    firstField.current = field;
    setDraft(toDraft(facts));
    setStatus(null);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/stones/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
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
            <p className="border-b-2 border-ink pb-2 font-display text-h3 font-semibold leading-tight">{stoneName(facts.name)}</p>
            <dl className="flex flex-col">
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
                          <button type="button" onClick={() => edit(row.field)} className="text-link" aria-label={`Add ${row.label.toLowerCase()}`}>
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

  const input = (field: Exclude<Field, "acquired" | "notes">, label: string, placeholder: string, list?: string) => (
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
        {input("associates", "Also on it", "On sphalerite, with a little quartz")}
        {input("foundAt", "Where it came from", "Grand Marais beach, or the Tucson show")}
        {input("acquiredOn", "When", "")}
        {input("location", "Where it lives now", "Glass case, top shelf", `${ids}-places`)}
        <datalist id={`${ids}-places`}>
          {places.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
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
