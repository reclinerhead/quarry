"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

// The floating sand note (DESIGN.md §4's info-mark note, the Conservatory's
// choice): it floats under its trigger rather than opening in place, so
// opening one never moves anything else. The no-layout-shift rule outranks
// the canvas's inline block. It hangs from the trigger's left edge, and when
// that would put it past either edge of the viewport (a mark in the side
// column, #46), it is measured once it is open and shifted inside the 16 px
// gutter. It closes on a tap outside, Escape, or the trigger. The info mark
// (`term.tsx`) and the "Why?" under a suggestion (`why-note.tsx`, #71) share it.

/** The open state, the ids and refs a trigger and its note share, and the shift that keeps the note on screen. */
export function useFloatingNote() {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0); // px to move the note left (negative) or right, to stay in the viewport
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null); // the trigger and the note together: a press inside neither closes it
  const note = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !note.current) {
      setShift(0);
      return;
    }
    const gutter = 16;
    const r = note.current.getBoundingClientRect();
    // The rect is in screen px; the gutter and `left` are in the page's own,
    // which a desktop's 90% zoom (#55) shrinks. Their ratio converts between them.
    const zoom = r.width / note.current.offsetWidth;
    const over = (r.right - window.innerWidth) / zoom + gutter;
    const under = gutter - r.left / zoom;
    setShift(over > 0 ? -over : under > 0 ? under : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent | TouchEvent) => {
      if (anchor.current && !anchor.current.contains(ev.target as Node)) setOpen(false);
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

  return { open, setOpen, id, anchor, note, shift };
}

/** The note itself, drawn only while open, inside the anchor span (which must be `relative`). */
export function FloatingNote({ id, noteRef, shift, title, children }: { id: string; noteRef: RefObject<HTMLSpanElement | null>; shift: number; title: ReactNode; children: ReactNode }) {
  return (
    <span
      id={id}
      ref={noteRef}
      role="note"
      aria-live="polite"
      // The measured shift is the one value no class can know in advance.
      style={shift ? { left: shift } : undefined}
      className="absolute left-0 top-full z-20 mt-2 block w-[min(24rem,calc(100vw-2rem))] rounded-tile border border-line-2 bg-sand p-5 font-sans text-lead font-normal not-italic leading-normal tracking-normal text-ink shadow-hover"
    >
      <span className="block font-display text-h3 font-semibold leading-tight">{title}</span>
      <span className="mt-1.5 block">{children}</span>
    </span>
  );
}
