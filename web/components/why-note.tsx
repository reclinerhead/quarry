"use client";

import { FloatingNote, useFloatingNote } from "@/components/floating-note";

// "Why?" under a suggestion (#71): DESIGN.md's text-link, 48 px tall, that
// opens the floating sand note with what Jasper saw, the models' own short
// phrases for that reading (`Pill.reasons`), and whether one opinion or both
// gave them. Never a percentage (README). On a mouse, hovering opens the same
// note; a finger taps, since a touch also fires the hover and would close it
// again at once.
export function WhyNote({ reasons, opinions }: { reasons: string[]; opinions: number }) {
  const { open, setOpen, id, anchor, note, shift } = useFloatingNote();
  if (reasons.length === 0) return null;
  const fine = () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
  return (
    <span ref={anchor} className="relative inline-flex" onMouseEnter={() => fine() && setOpen(true)} onMouseLeave={() => fine() && setOpen(false)}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="text-link">
        Why?
      </button>
      {open ? (
        <FloatingNote
          id={id}
          noteRef={note}
          shift={shift}
          title={
            <>
              Jasper saw <span className="font-sans text-body font-normal text-ink-2">({opinions > 1 ? "both opinions" : "one opinion"})</span>
            </>
          }
        >
          <span className="flex flex-col gap-1">
            {reasons.map((r) => (
              <span key={r} className="flex gap-2">
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
                <span className="min-w-0">{r}</span>
              </span>
            ))}
          </span>
        </FloatingNote>
      ) : null}
    </span>
  );
}
