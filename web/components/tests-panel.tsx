"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { Term } from "@/components/term";
import { TEST_TERM } from "@/lib/glossary";
import { STREAK_COLOURS, TEST_KINDS, TESTS, type Answers, type TestKind } from "@/lib/household-tests";

// "Want to be sure?" (#8): the kitchen-table tests, behind a button because
// nobody has to do them (README). The tests the models suggested come first,
// each with how to do it and what each candidate would show; the other
// household tests wait behind "Other tests". Answers are chips, and "Not
// tried" is a dashed chip so it can never be mistaken for "No". Asking again
// sends the answers and the note to Jasper, which puts them to both models.

type Suggested = { kind: TestKind; how: string; expected: string };

type Props = {
  suggested: Suggested[];
  initial: Answers;
  initialNote: string | null;
  busy: boolean;
  onAsk: (answers: Answers, note: string) => void;
};

export function TestsPanel({ suggested, initial, initialNote, busy, onAsk }: Props) {
  const [answers, setAnswers] = useState<Answers>(initial);
  const [note, setNote] = useState(initialNote ?? "");
  const suggestedKinds = new Set(suggested.map((s) => s.kind));
  const others = TEST_KINDS.filter((k) => !suggestedKinds.has(k));
  const [showOthers, setShowOthers] = useState(suggested.length === 0 || others.some((k) => initial[k] !== undefined));

  function answer(kind: TestKind, value: string | undefined) {
    setAnswers((cur) => {
      const next = { ...cur };
      if (value === undefined) delete next[kind];
      else next[kind] = value;
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">Each answer helps Jasper. Skip any you can&rsquo;t do: &ldquo;not tried&rdquo; is never counted as &ldquo;no&rdquo;.</p>

      {suggested.map((s) => (
        <TestRow key={s.kind} kind={s.kind} hint={s} value={answers[s.kind]} busy={busy} onAnswer={(v) => answer(s.kind, v)} />
      ))}

      {others.length > 0 && suggested.length > 0 ? (
        <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)} className="btn btn-soft self-start">
          {showOthers ? "Hide the other tests" : `Other tests (${others.length})`}
        </button>
      ) : null}
      {showOthers
        ? others.map((k) => <TestRow key={k} kind={k} value={answers[k]} busy={busy} onAnswer={(v) => answer(k, v)} />)
        : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="stone-note" className="font-bold">
          Anything else you know about it?
        </label>
        <textarea
          id="stone-note"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Where it was found or bought, how heavy it feels"
          className="min-h-[88px] w-full resize-y rounded-tile border border-line-2 bg-surface px-[18px] py-3 text-ink placeholder:text-ink-3"
        />
      </div>

      <button type="button" disabled={busy} onClick={() => onAsk(answers, note)} className="btn btn-primary btn-lg self-start">
        Ask Jasper again with these answers
      </button>
    </div>
  );
}

/** One kitchen-table test as a ground row of answer chips (DESIGN.md §4 "Test rows"); the stone page's tests editor uses it too. */
export function TestRow({
  kind,
  hint,
  value,
  busy,
  onAnswer,
}: {
  kind: TestKind;
  hint?: Suggested;
  value: string | undefined;
  busy: boolean;
  onAnswer: (value: string | undefined) => void;
}) {
  const options =
    kind === "streak"
      ? STREAK_COLOURS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))
      : [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ];
  return (
    <fieldset className="flex flex-col gap-3 rounded-tile bg-ground px-4 py-4 sm:px-5">
      <legend className="float-left w-full font-bold leading-snug">
        {TESTS[kind].question}
        <Term k={TEST_TERM[kind]} bare />
      </legend>
      {hint ? (
        <div className="flex flex-col gap-1 text-[17px] text-ink-2">
          <p>{hint.how}</p>
          <p>
            <span className="font-bold text-ink">What to look for:</span> {hint.expected}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" disabled={busy} aria-pressed={value === o.value} onClick={() => onAnswer(o.value)} className="chip">
            {value === o.value ? <CheckIcon className="size-4" /> : null}
            {o.label}
          </button>
        ))}
        <button type="button" disabled={busy} aria-pressed={value === undefined} onClick={() => onAnswer(undefined)} className="chip chip-dashed">
          {value === undefined ? <CheckIcon className="size-4" /> : null}
          Not tried
        </button>
      </div>
    </fieldset>
  );
}
