// The collection's shape, pure: what a tile says, how tiles are searched,
// filtered and sorted, and what the side column counts. The server reads the
// rows (lib/specimens.ts) and works out every date label in the station's
// time zone; the client (components/collection.tsx) filters and sorts here on
// every keystroke, so a search over the whole collection never leaves the
// phone. The Conservatory's lib/collection.ts, for stones.

import { norm } from "./names";
import type { StoneKind } from "./pills";

export type Acquired = "found" | "bought" | "gifted" | "traded";

export type Tile = {
  id: number;
  name: string; // the mineral or rock
  kind: StoneKind;
  variety: string | null;
  foundAt: string | null; // where it was found or bought
  acquired: Acquired | null;
  location: string | null; // where it lives now
  createdAt: string; // ISO, UTC
  added: string; // "Nov 1", in the station's time zone
  thumbUrl: string | null; // the newest photo's thumbnail
};

export type KindFilter = "all" | "minerals" | "rocks";
export type FromFilter = "all" | "found" | "bought";
export type Sort = "name" | "new";
export type Filters = { q: string; kind: KindFilter; from: FromFilter };

export const SORTS: Array<{ key: Sort; label: string }> = [
  { key: "name", label: "Name, A to Z" },
  { key: "new", label: "Newest first" },
];

export const ACQUIRED_LABEL: Record<Acquired, string> = { found: "Found it", bought: "Bought it", gifted: "A gift", traded: "Traded for it" };

export const KIND_LABEL: Record<StoneKind, string> = { mineral: "Mineral", rock: "Rock", other: "Other" };

/** The tints for a stone with no photo (DESIGN.md §2): vary between neighbours. */
export const TILE_TINTS = ["bg-tile-stone", "bg-tile-violet", "bg-tile-brass", "bg-tile-moss", "bg-tile-rust", "bg-tile-clear"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1" for an instant, in the zone of the Date it is read with (the server's, the station's). */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Nov 1, 2026" for an instant, in the zone of the Date it is read with (the server's, the station's). */
export function fullDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Oct 31, 2026" from an ISO date ("2026-10-31"), read from the text so no time zone moves it. */
export function longDay(isoDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[3])}, ${m[1]}` : null;
}

/** The card's meta line (DESIGN.md §4): "Glass case · added Nov 1", or "added Nov 1" when it has no place yet. */
export function metaLine(t: Pick<Tile, "location" | "added">): string {
  const added = t.added ? `added ${t.added}` : "added recently";
  return t.location ? `${t.location} · ${added}` : added;
}

/** The search box: any part of the name, the variety or where it was found, ignoring case and punctuation. */
export function matchesQuery(t: Pick<Tile, "name" | "variety" | "foundAt">, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  return [t.name, t.variety ?? "", t.foundAt ?? ""].some((v) => norm(v).includes(needle));
}

function matchesKind(t: Tile, kind: KindFilter): boolean {
  if (kind === "minerals") return t.kind === "mineral";
  if (kind === "rocks") return t.kind !== "mineral"; // "Rocks and fossils": rocks and everything that isn't a mineral
  return true;
}

function matchesFrom(t: Tile, from: FromFilter): boolean {
  if (from === "found") return t.acquired === "found";
  if (from === "bought") return t.acquired === "bought" || t.acquired === "gifted" || t.acquired === "traded";
  return true;
}

export function filterTiles(tiles: Tile[], f: Filters): Tile[] {
  return tiles.filter((t) => matchesQuery(t, f.q) && matchesKind(t, f.kind) && matchesFrom(t, f.from));
}

/** Name A to Z (then newest), or newest first (then id, so two in the same second keep their order). */
export function sortTiles(tiles: Tile[], sort: Sort): Tile[] {
  const newest = (a: Tile, b: Tile) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1);
  if (sort === "new") return tiles.toSorted(newest);
  return tiles.toSorted((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || newest(a, b));
}

export type Chip = { key: string; label: string; n: number; on: boolean };

/**
 * The filter chips DESIGN.md §5 names that Phase 1 has data for: Everything,
 * Minerals, Rocks and fossils, Found it myself, Bought or gifted. Counts come
 * from the whole collection, so the row never changes shape while a person
 * types, and a chip with nobody in it is left out.
 */
export function filterChips(tiles: Tile[], f: Pick<Filters, "kind" | "from">): Chip[] {
  const n = (pred: (t: Tile) => boolean) => tiles.filter(pred).length;
  const chips: Chip[] = [
    { key: "all", label: "Everything", n: tiles.length, on: f.kind === "all" && f.from === "all" },
    { key: "minerals", label: "Minerals", n: n((t) => matchesKind(t, "minerals")), on: f.kind === "minerals" },
    { key: "rocks", label: "Rocks and fossils", n: n((t) => matchesKind(t, "rocks")), on: f.kind === "rocks" },
    { key: "found", label: "Found it myself", n: n((t) => matchesFrom(t, "found")), on: f.from === "found" },
    { key: "bought", label: "Bought or gifted", n: n((t) => matchesFrom(t, "bought")), on: f.from === "bought" },
  ];
  return chips.filter((c) => c.key === "all" || c.n > 0);
}

/** "Showing 12 of 47 stones"; "Showing 3 stones that match" once anything filters. */
export function countLine(shown: number, total: number, filtered: boolean): string {
  const stones = (n: number) => `${n} ${n === 1 ? "stone" : "stones"}`;
  if (filtered) return shown === 0 ? "No stones match" : `Showing ${stones(shown)} that ${shown === 1 ? "matches" : "match"}`;
  return `Showing ${shown} of ${stones(total)}`;
}

/** The "At a glance" tiles: stones, different minerals, kinds of rock, places they live. */
export function glance(tiles: Tile[]): { stones: number; minerals: number; rocks: number; places: number } {
  const distinct = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase())).size;
  return {
    stones: tiles.length,
    minerals: distinct(tiles.filter((t) => t.kind === "mineral").map((t) => t.name)),
    rocks: distinct(tiles.filter((t) => t.kind !== "mineral").map((t) => t.name)),
    places: distinct(tiles.flatMap((t) => (t.location ? [t.location] : []))),
  };
}

/** "Where they live": each place with its count, most stones first, then A to Z. */
export function places(tiles: Tile[]): Array<{ place: string; n: number }> {
  const counts = new Map<string, { place: string; n: number }>();
  for (const t of tiles) {
    if (!t.location) continue;
    const key = t.location.toLowerCase();
    const c = counts.get(key) ?? { place: t.location, n: 0 };
    c.n += 1;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.place.localeCompare(b.place));
}

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** How many stones were added on the same calendar day as `now`, in `now`'s time zone. */
export function addedToday(createdAts: string[], now: Date): number {
  return createdAts.filter((iso) => {
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;
}

/** The greeting's "what changed" (DESIGN.md §5): "Two new stones today.", or nothing on a quiet day. */
export function whatChanged(today: number): string | null {
  if (today <= 0) return null;
  const n = NUMBER_WORDS[today] ?? String(today);
  return `${n} new ${today === 1 ? "stone" : "stones"} today.`;
}

/**
 * The specimen label's details a collector would want on the paper label
 * (DESIGN.md §4 "4 details are missing"): where it came from, how, when, and
 * where it lives. Variety, other minerals on it and notes are extras, never
 * counted as missing: most stones have no variety.
 */
export type LabelDetails = { foundAt: string | null; acquired: Acquired | null; acquiredOn: string | null; location: string | null };

export function missingDetails(s: LabelDetails): number {
  return [s.foundAt, s.acquired, s.acquiredOn, s.location].filter((v) => v === null || v === "").length;
}
