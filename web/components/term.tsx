"use client";

import { FloatingNote, useFloatingNote } from "@/components/floating-note";
import { entry, type GlossaryKey } from "@/lib/glossary";

// The info mark from design/DESIGN.md §4: a 28 px ring in line-strong with an
// azurite "i", 8 px after the term, a real <button> named "What does
// “streak” mean?". Pressing it opens the floating sand note
// (`floating-note.tsx`) with the glossary's explanation.
// `bare` draws the mark alone, beside a term already written in a <label>
// (a button inside a label would also focus the label's field).
export function Term({ k, children, bare = false }: { k: GlossaryKey; children?: React.ReactNode; bare?: boolean }) {
  const e = entry(k);
  const { open, setOpen, id, anchor, note, shift } = useFloatingNote();

  return (
    <span ref={anchor} className="relative inline">
      {bare ? null : (children ?? e.term)}
      <button
        type="button"
        aria-label={`What does “${e.term}” mean?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        // The ring is 28 px; the invisible ::before widens what a finger can hit.
        className="relative ml-2 inline-flex size-7 translate-y-[-2px] items-center justify-center rounded-full border-2 border-line-strong bg-surface align-middle font-display text-[17px] font-bold leading-none text-azurite before:absolute before:-inset-2.5 before:content-[''] hover:bg-sand"
      >
        i
      </button>
      {open ? (
        <FloatingNote id={id} noteRef={note} shift={shift} title={<span className="capitalize">{e.term}</span>}>
          {e.text}
        </FloatingNote>
      ) : null}
    </span>
  );
}
