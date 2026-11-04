"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CrystalIcon } from "@/components/icons";
import type { PickerRow } from "@/lib/cases";
import { matchesQuery, metaLine, TILE_TINTS } from "@/lib/collection";
import { kindOf, pieceName } from "@/lib/pills";

// "Add stones to Booth 12" (#81): the collection as side-panel rows (DESIGN.md
// §4), a 48 px checkbox each, with a search over the same fields as the top
// bar's. A stone already in this case has no checkbox and says so; one in
// another case can be ticked, and moves; where a stone is reads as a line
// under its name, since a column at the right would squeeze the name on a
// phone. The one button says how many go in
// and where; with none ticked its room holds a line instead, so nothing moves.
// PUT /api/cases/[id]/stones with `add`, then back to the case on /show.

export function CasePicker({ caseId, caseName, rows }: { caseId: number; caseName: string; rows: PickerRow[] }) {
  const router = useRouter();
  const ids = useId();
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = q.trim() ? rows.filter((r) => matchesQuery(r, q)) : rows;
  const n = checked.length;

  function toggle(id: number) {
    setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  }

  async function add() {
    if (n === 0 || busy) return;
    setBusy(true);
    setError(null);
    // In the collection's order, not the order they were ticked in: the planner sets the order.
    const inOrder = rows.filter((r) => checked.includes(r.id)).map((r) => r.id);
    try {
      const r = await fetch(`/api/cases/${caseId}/stones`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ add: inOrder }) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      router.push(`/show#case-${caseId}`);
      router.refresh();
    } catch (err) {
      setError(`They weren’t added (${err instanceof Error ? err.message : "no answer"}). Try again.`);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="field flex min-w-[220px] flex-1 items-center gap-2.5 sm:max-w-[400px]">
          <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-none text-ink-2">
            <circle cx="10" cy="10" r="6.5" />
            <path d="M15 15l6 6" />
          </svg>
          <span className="sr-only">Search your rocks</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your rocks" autoComplete="off" />
        </label>
        {/* The button's room is kept whether or not anything is ticked. */}
        <div className="flex min-h-[52px] items-center" aria-live="polite">
          {n > 0 ? (
            <button type="button" disabled={busy} onClick={() => void add()} className="btn btn-primary btn-lg">
              {busy ? "Adding…" : n === 1 ? `Add 1 stone to ${caseName}` : `Add ${n} stones to ${caseName}`}
            </button>
          ) : (
            <p className="text-ink-2">{`Tick the stones you want in ${caseName}.`}</p>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-warn-ink">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-ink-2">Nothing in your collection yet. Add a rock first, and it will be here to choose.</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-2 bg-surface px-7 py-10 text-center">
          <p className="font-display text-h3 font-semibold">No stones match.</p>
          <p className="text-ink-2">The search looks at the name, the variety and where it came from.</p>
          <button type="button" onClick={() => setQ("")} className="btn btn-soft">
            Show everything
          </button>
        </div>
      ) : (
        <ul className="card flex flex-col px-5 sm:px-6">
          {shown.map((r) => {
            const on = checked.includes(r.id);
            const id = `${ids}-${r.id}`;
            const thumb = r.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail, never the original
              <img src={r.thumbUrl} alt="" loading="lazy" width={64} height={64} className="size-16 flex-none rounded-thumb object-cover" />
            ) : (
              <span className={`flex size-16 flex-none items-center justify-center rounded-thumb ${TILE_TINTS[r.id % TILE_TINTS.length]}`}>
                <CrystalIcon className="size-7 text-icon-muted" />
              </span>
            );
            // Where it is, as a line under the name: at a phone's width a column at the right would squeeze the name.
            const where =
              r.where.kind === "here" ? `Already in ${caseName}` : r.where.kind === "other" ? `In ${r.where.name} · ${on ? "moves here" : "would move here"}` : null;
            const words = (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold leading-snug">{pieceName(r)}</span>
                {kindOf(r) ? <span className="text-meta text-ink-2">{kindOf(r)}</span> : null}
                <span className="text-meta text-ink-3">{metaLine(r)}</span>
                {where ? <span className="text-meta font-bold text-ink-2">{where}</span> : null}
              </span>
            );
            return (
              <li key={r.id} className="flex min-h-[88px] items-center gap-4 border-b border-hairline py-3 last:border-b-0">
                {r.where.kind === "here" ? (
                  <>
                    <span aria-hidden className="size-7 flex-none" />
                    {thumb}
                    {words}
                  </>
                ) : (
                  <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
                    <input id={id} type="checkbox" checked={on} onChange={() => toggle(r.id)} className="size-7 flex-none accent-azurite" />
                    {thumb}
                    {words}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
