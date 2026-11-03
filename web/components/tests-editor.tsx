"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TestRow } from "@/components/tests-panel";
import { TEST_KINDS, type Answers, type TestKind } from "@/lib/household-tests";

// "Kitchen-table tests" on a stone's page (#9): what has been tried on it, as
// DESIGN.md §4's test rows, editable in place with the confirm screen's rows.
// The tests already answered show first; with none answered, the four the
// design names (glass, streak, vinegar, magnet). The rest wait behind "Other
// tests". A stone with nothing recorded opens folded (#45): the line and a
// "Record a test" button, with the rows behind it. One Save sends the answers
// through PATCH /api/stones/[id]. The check against the mineral's Mindat
// record arrives in Phase 2.

const FIRST_FOUR: TestKind[] = ["glass", "streak", "vinegar", "magnet"];

function sameAnswers(a: Answers, b: Answers): boolean {
  return TEST_KINDS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export function TestsEditor({ id, initial }: { id: number; initial: Answers }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Answers>(initial);
  const [answers, setAnswers] = useState<Answers>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const answered = TEST_KINDS.filter((k) => initial[k] !== undefined);
  // Which rows show first is settled when the page opens, so saving an answer
  // (which refreshes `initial`) never moves the rows under the person's finger.
  const [first] = useState(() => (answered.length > 0 ? answered : FIRST_FOUR));
  const others = TEST_KINDS.filter((k) => !first.includes(k));
  const [showOthers, setShowOthers] = useState(false);
  // A stone with no answer saved folds the rows away behind "Record a test".
  // Settled once, like `first`, so the first save never folds them again.
  const [folds] = useState(() => answered.length === 0);
  const [open, setOpen] = useState(false);
  const showRows = !folds || open;
  const dirty = !sameAnswers(answers, saved);

  function answer(kind: TestKind, value: string | undefined) {
    setStatus(null);
    setAnswers((cur) => {
      const next = { ...cur };
      if (value === undefined) delete next[kind];
      else next[kind] = value;
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/stones/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tests: answers }) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      setSaved(answers);
      setStatus({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: `That wasn’t saved (${err instanceof Error ? err.message : "no answer"}). Try again.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">
        {`${answered.length > 0 ? "What has been tried on this stone." : "Nothing tried on this stone yet."} “Not tried” is never counted as “no”.`}
      </p>
      {folds ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn btn-soft self-start">
          {open ? "Hide the tests" : "Record a test"}
        </button>
      ) : null}
      {showRows ? (
        <>
          {first.map((k) => (
            <TestRow key={k} kind={k} value={answers[k]} busy={busy} onAnswer={(v) => answer(k, v)} />
          ))}
          <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)} className="btn btn-soft self-start">
            {showOthers ? "Hide the other tests" : `Other tests (${others.length})`}
          </button>
          {showOthers ? others.map((k) => <TestRow key={k} kind={k} value={answers[k]} busy={busy} onAnswer={(v) => answer(k, v)} />) : null}
        </>
      ) : null}
      {/* The Save row stays out while something is unsaved, even with the rows folded, so an answer is never hidden unsaved. */}
      {showRows || dirty || busy ? (
        <div className="flex flex-wrap items-center gap-4">
          {dirty || busy ? (
            <button type="button" disabled={busy} onClick={() => void save()} className="btn btn-primary btn-lg">
              {busy ? "Saving…" : "Save the answers"}
            </button>
          ) : null}
          <p role="status" aria-live="polite" className={`min-h-7 ${status?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}>
            {status?.text ?? (dirty ? "Not saved yet." : "")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
