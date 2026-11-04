// Show cases (#81): the display cases a household plans for the club's rock
// show, and the stones in each, in order. The order of a case is one list of
// stone ids, and every change to it (a tap on Move earlier, a drop, the
// picker's append, the stone page's select) is one of these functions over
// that list, then one PUT of the whole list. Pure, so the planner on the phone
// and the route on the server agree about what an action does. Reading and
// writing the rows is `lib/specimens.ts` and the routes under /api/cases.

import type { Tile } from "./collection";
import type { StoneKind } from "./pills";
import type { StonePart } from "./specimens";

/** A stone as a case tile draws it: the name as a show label gives it, and the thumbnail of its first photo. */
export type CaseStone = {
  id: number;
  name: string;
  kind: StoneKind;
  variety: string | null;
  parts: StonePart[];
  thumbUrl: string | null;
};

/** One display case, with its stones in reading order. */
export type ShowCase = {
  id: number;
  name: string;
  note: string | null;
  stones: CaseStone[];
};

/** The case's order with `id` one place earlier; the first stays first, and a stone not in it changes nothing. */
export function moveEarlier(order: readonly number[], id: number): number[] {
  const i = order.indexOf(id);
  if (i <= 0) return [...order];
  const next = [...order];
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  return next;
}

/** The case's order with `id` one place later; the last stays last, and a stone not in it changes nothing. */
export function moveLater(order: readonly number[], id: number): number[] {
  const i = order.indexOf(id);
  if (i < 0 || i === order.length - 1) return [...order];
  const next = [...order];
  [next[i], next[i + 1]] = [next[i + 1], next[i]];
  return next;
}

/** The case's order without `id`; the rest keep their order. */
export function takeOut(order: readonly number[], id: number): number[] {
  return order.filter((x) => x !== id);
}

/**
 * The case's order with `id` at `index`: a stone already in the list moves
 * there rather than appearing twice, and an index past the end puts it last.
 * `index` counts positions in the list as it is before the stone is taken out,
 * which is how a drop reads it (the slot before the tile under the pointer).
 */
export function placeAt(order: readonly number[], id: number, index: number): number[] {
  const rest = order.filter((x) => x !== id);
  const was = order.indexOf(id);
  let at = Math.max(0, Math.min(index, order.length));
  if (was >= 0 && was < at) at -= 1; // the slot was counted with the stone still ahead of it
  rest.splice(Math.min(at, rest.length), 0, id);
  return rest;
}

/**
 * The name the Add a case field offers: "Case 1" with no cases, else "Case N"
 * for the lowest N no case is called. A case named anything else ("Booth 12")
 * doesn't block a number, and the match ignores case and spacing.
 */
export function nextCaseName(names: readonly string[]): string {
  const taken = new Set<number>();
  for (const n of names) {
    const m = /^\s*case\s+(\d+)\s*$/i.exec(n);
    if (m) taken.add(Number(m[1]));
  }
  let i = 1;
  while (taken.has(i)) i += 1;
  return `Case ${i}`;
}

/** "stone 7 of 12", or "the only stone" when a case holds one. */
export function stoneLine(n: number, total: number): string {
  return total === 1 ? "the only stone" : `stone ${n} of ${total}`;
}

/** The stone page's "At the show" card: every case by name, and the one the stone is in with its place in it. */
export type AtShow = {
  cases: Array<{ id: number; name: string }>;
  current: { id: number; name: string; position: number; total: number } | null;
};

/** Where a stone is, for the picker's rows and the stone page's select. */
export type Placement = { kind: "none" } | { kind: "here" } | { kind: "other"; caseId: number; name: string };

export type PickerRow = Tile & { where: Placement };

/**
 * The collection as the Add stones page lists it for one case: each stone with
 * where it is. One already in this case can't be ticked ("here"); one in another
 * case can, and ticking it moves it; one in no case can.
 */
export function pickerRows(tiles: readonly Tile[], cases: ReadonlyArray<{ id: number; name: string; stoneIds: readonly number[] }>, caseId: number): PickerRow[] {
  const at = new Map<number, Placement>();
  for (const c of cases) for (const id of c.stoneIds) at.set(id, c.id === caseId ? { kind: "here" } : { kind: "other", caseId: c.id, name: c.name });
  return tiles.map((t) => ({ ...t, where: at.get(t.id) ?? { kind: "none" } }));
}

/** What the routes accept: a case's name, its note. */
export const MAX_NAME = 60;
export const MAX_NOTE = 200;

/** A trimmed string of at most `max` characters, or null when blank; undefined when the field was not sent. As the stone route reads text. */
export function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/[ \t]+/g, " ");
  return t.length === 0 ? null : t.slice(0, max);
}

/** A route's `[id]` as a positive integer, or null. */
export function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** "Nothing in it yet", "1 stone", "12 stones". */
export function countLine(n: number): string {
  return n === 0 ? "Nothing in it yet" : n === 1 ? "1 stone" : `${n} stones`;
}
