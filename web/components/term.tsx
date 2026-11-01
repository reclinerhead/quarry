"use client";

import { useEffect, useId, useRef, useState } from "react";
import { entry, type GlossaryKey } from "@/lib/glossary";

// The info mark from design/DESIGN.md §4: a 28 px ring in line-strong with an
// azurite "i", 8 px after the term, a real <button> named "What does
// “streak” mean?".
// Pressing it opens a sand note with the explanation. The note floats under
// the mark rather than opening in place (the Conservatory's choice), so
// opening one never moves anything else: the no-layout-shift rule outranks
// the canvas's inline block. Closes on a tap outside, Escape, or the mark.
// `bare` draws the mark alone, beside a term already written in a <label>
// (a button inside a label would also focus the label's field).
export function Term({ k, children, bare = false }: { k: GlossaryKey; children?: React.ReactNode; bare?: boolean }) {
  const e = entry(k);
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline">
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
        <span
          id={id}
          role="note"
          aria-live="polite"
          className="absolute left-0 top-full z-20 mt-2 block w-[min(24rem,calc(100vw-2rem))] rounded-tile border border-line-2 bg-sand p-5 font-sans text-lead font-normal not-italic leading-normal tracking-normal text-ink shadow-hover"
        >
          <span className="block font-display text-h3 font-semibold capitalize leading-tight">{e.term}</span>
          <span className="mt-1.5 block">{e.text}</span>
        </span>
      ) : null}
    </span>
  );
}
