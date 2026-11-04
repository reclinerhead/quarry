"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { stoneLine, type AtShow } from "@/lib/cases";

// "At the show" on a stone's page (#81): a native select (DESIGN.md §4) that
// says which show case the stone is in and changes it in one 50 px target,
// so a person can walk the collection putting stones in cases and set the
// order on the Show cases page afterwards. Choosing a case puts the stone at
// its end (PUT /api/cases/[id]/stones with `add`); "Not in a case" takes it out
// of the one it is in. With no cases yet, the card says so and points at /show.

export function CaseSelect({ stoneId, atShow }: { stoneId: number; atShow: AtShow }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = atShow.current;

  async function choose(value: string) {
    const toId = Number(value);
    const url = toId ? `/api/cases/${toId}/stones` : current ? `/api/cases/${current.id}/stones` : null;
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(toId ? { add: [stoneId] } : { remove: [stoneId] }) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      router.refresh();
    } catch (err) {
      setError(`That wasn’t saved (${err instanceof Error ? err.message : "no answer"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  if (atShow.cases.length === 0)
    return (
      <>
        <p className="text-ink-2">No show cases yet. Set one up, and this stone can go in it.</p>
        <Link href="/show" className="text-link self-start">
          Set up a case
        </Link>
      </>
    );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="text-meta font-bold text-ink-2">
          Show case
        </label>
        <span className="relative grid min-w-0 flex-1">
          <select id={id} value={current?.id ?? ""} disabled={busy} onChange={(e) => void choose(e.target.value)} className="select col-start-1 row-start-1 w-full">
            <option value="">Not in a case</option>
            {atShow.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-[18px] top-4 text-ink-2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </div>
      <p role="status" aria-live="polite" className={`min-h-7 ${error ? "text-warn-ink" : "text-ink-2"}`}>
        {error ?? (busy ? "Saving…" : current ? `In ${current.name}, ${stoneLine(current.position, current.total)}.` : "Not in a case. Choose one to put it in.")}
      </p>
      <Link href={current ? `/show#case-${current.id}` : "/show"} className="text-link self-start">
        {current ? "Arrange the case" : "Plan the show"}
      </Link>
    </>
  );
}
