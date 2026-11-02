"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckIcon, CrystalIcon } from "@/components/icons";
import {
  countLine,
  filterChips,
  filterTiles,
  KIND_LABEL,
  metaLine,
  SORTS,
  sortTiles,
  TILE_TINTS,
  type FromFilter,
  type KindFilter,
  type Sort,
  type Tile,
} from "@/lib/collection";
import { stoneName } from "@/lib/pills";

// "Your collection" from design/DESIGN.md §5: the count line, Sort by, the
// filter chips, then the specimen cards. Every tile is on the page already (a
// family collection is a few kilobytes of them), so the top bar's search, the
// chips and the sort work here, on the phone, with no request. All of it
// lives in the URL (?q=, ?kind=, ?from=, ?sort=), written with the native
// history API, so the back button returns to the same view and the top bar's
// box and this grid agree.
function setParams(next: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === "" || v === "all" || (k === "sort" && v === "name")) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}

export function Collection({ tiles }: { tiles: Tile[] }) {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const kindParam = params.get("kind");
  const fromParam = params.get("from");
  const kind: KindFilter = kindParam === "minerals" || kindParam === "rocks" ? kindParam : "all";
  const from: FromFilter = fromParam === "found" || fromParam === "bought" ? fromParam : "all";
  const sort: Sort = params.get("sort") === "new" ? "new" : "name";
  const filtered = q.trim() !== "" || kind !== "all" || from !== "all";
  const shown = sortTiles(filterTiles(tiles, { q, kind, from }), sort);
  const chips = filterChips(tiles, { kind, from });

  function toggle(key: string) {
    if (key === "all") setParams({ kind: "all", from: "all" });
    else if (key === "minerals" || key === "rocks") setParams({ kind: kind === key ? "all" : key });
    else setParams({ from: from === key ? "all" : key });
  }

  return (
    <section aria-labelledby="collection-h" className="flex min-w-0 flex-col gap-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="collection-h" className="text-h2 leading-tight">
            Your collection
          </h2>
          <p aria-live="polite" className="text-[17px] text-ink-2 tabular-nums">
            {countLine(shown.length, tiles.length, filtered)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sort" className="text-meta font-bold text-ink-2">
            Sort by
          </label>
          <div className="relative">
            <select id="sort" value={sort} onChange={(e) => setParams({ sort: e.target.value })} className="select">
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-[18px] top-4 text-ink-2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </div>

      {/* Chips wrap; a chip row never scrolls sideways. */}
      <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button key={c.key} type="button" aria-pressed={c.on} onClick={() => toggle(c.key)} className="chip">
            {c.on ? <CheckIcon className="size-4" /> : null}
            {c.label}
            <span className="font-normal opacity-80 tabular-nums">{c.n}</span>
          </button>
        ))}
        {filtered ? (
          <button type="button" onClick={() => setParams({ q: "", kind: "all", from: "all" })} className="text-link">
            Clear filters
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-2 bg-surface px-7 py-10 text-center">
          <p className="font-display text-h3 font-semibold">No stones match those choices.</p>
          <p className="text-ink-2">{q.trim() ? "The search looks at the name, the variety and where it came from." : "Try another filter."}</p>
          <button type="button" onClick={() => setParams({ q: "", kind: "all", from: "all" })} className="btn btn-soft">
            Show everything
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-grid">
          {shown.map((t, i) => (
            <li key={t.id}>
              <StoneCard tile={t} tint={TILE_TINTS[i % TILE_TINTS.length]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The specimen card (DESIGN.md §4): the photo or a tinted "No photo yet" tile,
 * 220 px; the name; the variety line, reserved when there is none so cards in
 * a row line up; "Where it lives · added Nov 1"; the kind as a tag. The whole
 * card is one link. No catalog dab (Phase 3) or Mohs tag (Phase 2) yet.
 */
export function StoneCard({ tile, tint }: { tile: Tile; tint: string }) {
  return (
    <Link href={`/stones/${tile.id}`} className="card card-link flex h-full flex-col overflow-hidden text-ink hover:text-ink">
      {tile.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail, never the original
        <img src={tile.thumbUrl} alt="" loading="lazy" width={320} height={220} className="h-[220px] w-full object-cover" />
      ) : (
        <div className={`flex h-[220px] flex-col items-center justify-center gap-2.5 ${tint}`}>
          <CrystalIcon className="size-14 text-icon-muted" />
          <span className="text-meta text-ink-2">No photo yet</span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 px-5 pb-5 pt-[18px]">
        <span className="font-display text-h3 font-semibold leading-tight">{stoneName(tile.name)}</span>
        <span className="text-[17px] text-ink-2">{tile.variety ?? " "}</span>
        <span className="text-meta text-ink-3">{metaLine(tile)}</span>
        <span className="mt-2.5 flex flex-wrap gap-2">
          <span className="tag">{KIND_LABEL[tile.kind]}</span>
        </span>
      </div>
    </Link>
  );
}
