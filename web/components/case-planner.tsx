"use client";

import { BASE_PATH } from "@/lib/base-path";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { CrystalIcon } from "@/components/icons";
import { countLine, MAX_NAME, MAX_NOTE, moveEarlier, moveLater, placeAt, takeOut, type ShowCase } from "@/lib/cases";
import { TILE_TINTS } from "@/lib/collection";
import { pieceName } from "@/lib/pills";

// The show cases (#81), DESIGN.md §5: one card per case, drawn as the case
// itself. The sign over it is its name; the shelf under it holds the stones as
// numbered case tiles in reading order. Tapping a stone's photo picks it up
// (aria-pressed), and the move row under the shelf, always there, offers Move
// earlier, Move later, Take out and, with two or more cases, Move to. That is
// the whole path, and it is complete on its own. On a mouse or trackpad the
// tiles also drag (native HTML drag and drop, nothing on a touch screen, so a
// scroll is a scroll). Every change is one of lib/cases.ts's functions over
// the case's order, then one PUT of the whole list, drawn at once here and
// read back with router.refresh(); a failure puts the server's order back and
// says so. The numbers are what carry the order to the hall: tiles wrap
// differently on a phone and a laptop, but "7 goes next to 8" reads the same.

type Status = { kind: "ok" | "error"; text: string };
type Over = { caseId: number; index: number };

/** A mouse or trackpad (DESIGN.md §3's test): the tiles drag. A touch screen never drags. */
function useFinePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia("(hover: hover) and (pointer: fine)");
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => false,
  );
}

export function CasePlanner({ cases, nextName }: { cases: ShowCase[]; nextName: string }) {
  const router = useRouter();
  const fine = useFinePointer();
  // The cases as drawn: the server's, until a change is made here and drawn
  // at once; when the server's change under it (router.refresh), it follows.
  const [seen, setSeen] = useState(cases);
  const [local, setLocal] = useState(cases);
  if (seen !== cases) {
    setSeen(cases);
    setLocal(cases);
  }
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<Over | null>(null);

  const stoneIds = (c: ShowCase) => c.stones.map((s) => s.id);
  const caseOf = (stoneId: number) => local.find((c) => c.stones.some((s) => s.id === stoneId)) ?? null;

  async function send(url: string, method: string, body: unknown, done: string) {
    setStatus(null);
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      setStatus({ kind: "ok", text: done });
      router.refresh();
      return true;
    } catch (err) {
      setLocal(cases);
      setStatus({ kind: "error", text: `That wasn’t saved (${err instanceof Error ? err.message : "no answer"}). Try again.` });
      return false;
    }
  }

  /** Write one case's order: drawn at once, then PUT; a stone that came from another case leaves it on both sides. */
  function writeOrder(caseId: number, ids: number[], done: string) {
    const target = local.find((c) => c.id === caseId);
    if (!target) return;
    const was = ids.map((id) => caseOf(id)?.stones.find((s) => s.id === id)).filter((s) => s !== undefined);
    setLocal(
      local.map((c) =>
        c.id === caseId ? { ...c, stones: ids.map((id) => was.find((s) => s.id === id)!) } : { ...c, stones: c.stones.filter((s) => !ids.includes(s.id)) },
      ),
    );
    void send(`${BASE_PATH}/api/cases/${caseId}/stones`, "PUT", { ids }, done);
  }

  function move(c: ShowCase, how: "earlier" | "later" | "out") {
    if (selected === null) return;
    const order = stoneIds(c);
    const stone = c.stones.find((s) => s.id === selected);
    if (!stone) return;
    const name = pieceName(stone);
    if (how === "out") {
      setSelected(null);
      writeOrder(c.id, takeOut(order, selected), `${name} is out of ${c.name}.`);
      return;
    }
    const next = how === "earlier" ? moveEarlier(order, selected) : moveLater(order, selected);
    if (next.every((id, i) => id === order[i])) {
      setStatus({ kind: "ok", text: how === "earlier" ? `${name} is already first in ${c.name}.` : `${name} is already last in ${c.name}.` });
      return;
    }
    writeOrder(c.id, next, `${name} is now stone ${next.indexOf(selected) + 1} in ${c.name}.`);
  }

  function moveTo(from: ShowCase, toId: number) {
    if (selected === null) return;
    const to = local.find((c) => c.id === toId);
    const stone = from.stones.find((s) => s.id === selected);
    if (!to || !stone) return;
    writeOrder(to.id, [...stoneIds(to), selected], `${pieceName(stone)} moved to ${to.name}, stone ${to.stones.length + 1}.`);
  }

  function drop(c: ShowCase) {
    const id = dragging;
    const at = over;
    setDragging(null);
    setOver(null);
    if (id === null || !at || at.caseId !== c.id) return;
    const from = caseOf(id);
    const stone = from?.stones.find((s) => s.id === id);
    if (!from || !stone) return;
    const order = stoneIds(c);
    const next = placeAt(order, id, from.id === c.id ? at.index : at.index);
    if (from.id === c.id && next.every((x, i) => x === order[i])) return;
    const n = next.indexOf(id) + 1;
    writeOrder(c.id, next, from.id === c.id ? `${pieceName(stone)} is now stone ${n} in ${c.name}.` : `${pieceName(stone)} moved to ${c.name}, stone ${n}.`);
  }

  async function addCase(name: string) {
    await send(`${BASE_PATH}/api/cases`, "POST", { name }, `${name} is set up. Add stones to it.`);
  }

  async function rename(c: ShowCase, name: string, note: string) {
    setLocal(local.map((k) => (k.id === c.id ? { ...k, name, note: note || null } : k)));
    await send(`${BASE_PATH}/api/cases/${c.id}`, "PATCH", { name, note }, `${name} is renamed.`);
  }

  async function shift(c: ShowCase, by: -1 | 1) {
    const i = local.findIndex((k) => k.id === c.id);
    const j = i + by;
    if (j < 0 || j >= local.length) return;
    const next = [...local];
    [next[i], next[j]] = [next[j], next[i]];
    setLocal(next);
    await send(`${BASE_PATH}/api/cases/${c.id}`, "PATCH", { position: j + 1 }, `${c.name} is now case ${j + 1}.`);
  }

  async function remove(c: ShowCase) {
    setLocal(local.filter((k) => k.id !== c.id));
    await send(`${BASE_PATH}/api/cases/${c.id}`, "DELETE", {}, `${c.name} is removed. Its stones are still in your collection.`);
  }

  return (
    <div className="flex flex-col gap-7">
      <p role="status" aria-live="polite" className={`min-h-7 ${status?.kind === "error" ? "text-warn-ink" : "text-ink-2"}`}>
        {status?.text ?? ""}
      </p>

      {local.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-2 bg-surface px-7 py-10 text-center">
          <CrystalIcon className="size-14 text-icon-muted" />
          <p className="font-display text-h3 font-semibold">No show cases yet.</p>
          <p className="max-w-[48ch] text-ink-2">Name your first one below. It will appear here, and then you can fill it from your collection.</p>
        </div>
      ) : (
        local.map((c, i) => (
          <CaseCard
            key={c.id}
            c={c}
            index={i}
            count={local.length}
            others={local.filter((k) => k.id !== c.id)}
            selected={selected}
            onSelect={(id) => setSelected(selected === id ? null : id)}
            onMove={(how) => move(c, how)}
            onMoveTo={(toId) => moveTo(c, toId)}
            onRename={(name, note) => rename(c, name, note)}
            onShift={(by) => shift(c, by)}
            onRemove={() => remove(c)}
            fine={fine}
            dragging={dragging}
            over={over?.caseId === c.id ? over.index : null}
            onDragStart={(id) => {
              setDragging(id);
              setSelected(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onOver={(index) => setOver({ caseId: c.id, index })}
            onDrop={() => drop(c)}
          />
        ))
      )}

      <AddCase nextName={nextName} onAdd={addCase} />
    </div>
  );
}

function CaseCard({
  c,
  index,
  count,
  others,
  selected,
  onSelect,
  onMove,
  onMoveTo,
  onRename,
  onShift,
  onRemove,
  fine,
  dragging,
  over,
  onDragStart,
  onDragEnd,
  onOver,
  onDrop,
}: {
  c: ShowCase;
  index: number;
  count: number;
  others: ShowCase[];
  selected: number | null;
  onSelect: (id: number) => void;
  onMove: (how: "earlier" | "later" | "out") => void;
  onMoveTo: (toId: number) => void;
  onRename: (name: string, note: string) => Promise<void>;
  onShift: (by: -1 | 1) => Promise<void>;
  onRemove: () => Promise<void>;
  fine: boolean;
  dragging: number | null;
  over: number | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onOver: (index: number) => void;
  onDrop: () => void;
}) {
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [note, setNote] = useState(c.note ?? "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const picked = selected !== null && c.stones.some((s) => s.id === selected);
  const total = c.stones.length;

  const tiles = c.stones.map((s, i) => (
    <li
      key={s.id}
      className="case-tile"
      data-dragging={dragging === s.id || undefined}
      draggable={fine || undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(s.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart(s.id);
      }}
      onDragEnd={onDragEnd}
      onDragEnter={() => dragging !== null && onOver(i)}
    >
      <button
        type="button"
        aria-pressed={selected === s.id}
        aria-label={`${pieceName(s)}, stone ${i + 1} of ${total}. ${selected === s.id ? "Put it down" : "Pick it up to move it"}`}
        onClick={() => onSelect(s.id)}
        className={`case-tile-pick ${s.thumbUrl ? "" : TILE_TINTS[s.id % TILE_TINTS.length]}`}
      >
        <span className="case-tile-n" aria-hidden>
          {i + 1}
        </span>
        {s.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail, never the original
          <img src={s.thumbUrl} alt="" loading="lazy" width={320} height={130} draggable={false} />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1">
            <CrystalIcon className="size-10 text-icon-muted" />
            <span className="text-tag text-ink-2">No photo yet</span>
          </span>
        )}
      </button>
      <Link href={`/stones/${s.id}`} className="case-paper" draggable={false}>
        {pieceName(s)}
      </Link>
    </li>
  ));
  // The slot a dragged stone would land in: drawn at `over`, counted in the order as it is.
  if (over !== null && dragging !== null)
    tiles.splice(
      Math.min(over, tiles.length),
      0,
      <li key="slot" className="case-slot" aria-hidden onDragEnter={(e) => e.stopPropagation()} onDragOver={(e) => e.preventDefault()} />,
    );

  return (
    <section id={`case-${c.id}`} aria-labelledby={`${ids}-h`} className="card flex scroll-mt-6 flex-col gap-5 px-5 py-6 sm:px-8 sm:py-7">
      {editing ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n || busy) return;
            setBusy(true);
            void onRename(n, note.trim()).then(() => {
              setBusy(false);
              setEditing(false);
            });
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-name`} className="font-bold">
                Case name
              </label>
              <div className="field flex items-center">
                <input id={`${ids}-name`} type="text" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-note`} className="font-bold">
                Note
              </label>
              <div className="field flex items-center">
                <input id={`${ids}-note`} type="text" value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} placeholder="Left of the geodes, by the door" autoComplete="off" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setName(c.name);
                setNote(c.note ?? "");
                setEditing(false);
              }}
              className="btn btn-soft"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={`${ids}-h`} className="text-balance text-section leading-tight">
              {c.name}
            </h2>
            <p className="text-[17px] text-ink-2">
              {countLine(total)}
              {c.note ? ` · ${c.note}` : ""}
            </p>
          </div>
          <Link href={`/show/${c.id}/add`} className="btn btn-primary">
            Add stones
          </Link>
        </div>
      )}

      {total === 0 && over === null ? (
        <div className="case-shelf flex min-h-[214px] items-center justify-center text-center">
          <p className="max-w-[40ch] text-ink-2">Nothing in it yet. Add stones from your collection, and they line up here in order.</p>
        </div>
      ) : (
        <ul
          aria-label={`Stones in ${c.name}, in order`}
          className="case-shelf grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]"
          data-over={over !== null || undefined}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (e.target === e.currentTarget) onOver(total); // over the shelf itself, past the last tile
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop();
          }}
        >
          {tiles}
        </ul>
      )}

      {/* The move row, always here, so picking a stone up moves nothing else. */}
      <div className="flex min-h-12 flex-wrap items-center gap-2">
        {picked ? (
          <>
            <button type="button" onClick={() => onMove("earlier")} className="btn btn-soft">
              Move earlier
            </button>
            <button type="button" onClick={() => onMove("later")} className="btn btn-soft">
              Move later
            </button>
            <button type="button" onClick={() => onMove("out")} className="btn btn-soft">
              Take out
            </button>
            {others.length > 0 ? (
              <label className="flex items-center gap-2">
                <span className="text-meta font-bold text-ink-2">Move to</span>
                <span className="relative grid">
                  <select
                    value=""
                    onChange={(e) => {
                      const toId = Number(e.target.value);
                      if (toId) onMoveTo(toId);
                    }}
                    className="select col-start-1 row-start-1"
                  >
                    <option value="">Another case…</option>
                    {others.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                  <Chevron />
                </span>
              </label>
            ) : null}
          </>
        ) : (
          <p className="text-ink-2">{total === 0 ? "Add stones, then tap one to move it." : fine ? "Tap a stone to move it, or drag it where it goes." : "Tap a stone to move it."}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-4">
        {editing ? null : (
          <button type="button" onClick={() => setEditing(true)} className="text-link -ml-1.5">
            Rename
          </button>
        )}
        {count > 1 && index > 0 ? (
          <button type="button" onClick={() => void onShift(-1)} className="text-link">
            Move up
          </button>
        ) : null}
        {count > 1 && index < count - 1 ? (
          <button type="button" onClick={() => void onShift(1)} className="text-link">
            Move down
          </button>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <span className="min-h-12 content-center text-meta text-ink-2">{armed ? `Remove ${c.name}? Its stones stay in your collection.` : ""}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setBusy(true);
              void onRemove();
            }}
            onBlur={() => !busy && setArmed(false)}
            className={armed ? "btn btn-soft" : "text-link"}
          >
            {armed ? "Yes, remove it" : "Remove this case"}
          </button>
          {armed ? (
            <button type="button" onClick={() => setArmed(false)} className="text-link">
              Keep it
            </button>
          ) : null}
        </span>
      </div>
    </section>
  );
}

/** "Add a case": the name field, offered the next free "Case N", and the button. */
function AddCase({ nextName, onAdd }: { nextName: string; onAdd: (name: string) => Promise<void> }) {
  const ids = useId();
  const [seen, setSeen] = useState(nextName);
  const [name, setName] = useState(nextName);
  if (seen !== nextName) {
    setSeen(nextName);
    setName(nextName);
  }
  const [busy, setBusy] = useState(false);
  return (
    <section aria-labelledby={`${ids}-h`} className="card flex flex-col gap-4 px-5 py-6 sm:px-8 sm:py-7">
      <h2 id={`${ids}-h`} className="text-h3 leading-tight">
        Add a case
      </h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n || busy) return;
          setBusy(true);
          void onAdd(n).finally(() => setBusy(false));
        }}
      >
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5 sm:max-w-[420px]">
          <label htmlFor={`${ids}-name`} className="font-bold">
            Case name
          </label>
          <div className="field flex items-center">
            <input id={`${ids}-name`} type="text" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} placeholder="Booth 12" autoComplete="off" />
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn btn-soft btn-lg">
          {busy ? "Adding…" : "Add a case"}
        </button>
      </form>
      <p className="text-meta text-ink-2">Name it the way the hall does (Booth 12), or by what goes in it (Michigan agates). You can rename it any time.</p>
    </section>
  );
}

function Chevron() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-[18px] top-4 text-ink-2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
