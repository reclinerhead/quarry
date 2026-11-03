// The household's Mohs set (#42): the ten reference minerals, talc to
// diamond, which the README names as a set to complete. A slot is owned by
// having a stone of that mineral; a hardness alone never fills one, so a
// Galena at 2.5 fills nothing and a Milky Quartz fills 7 because it is
// Quartz. Pure: `readStone` reads every stone's names and hands them here.

import { fold } from "./mindat";

export type Reference = { n: number; name: string };

/** Mohs's ten, in order. */
export const MOHS_SET: readonly Reference[] = [
  "Talc", "Gypsum", "Calcite", "Fluorite", "Apatite", "Orthoclase", "Quartz", "Topaz", "Corundum", "Diamond",
].map((name, i) => ({ n: i + 1, name }));

const SLOT_OF = new Map<string, number>(MOHS_SET.map((r) => [fold(r.name), r.n]));
// Mindat's Apatite is a group; its species fill the slot too.
for (const name of ["Fluorapatite", "Chlorapatite", "Hydroxylapatite"]) SLOT_OF.set(fold(name), 5);

/**
 * The slot a mineral fills, from its own name and the names up its Mindat
 * chain (Amethyst → Quartz → 7, Ruby → Corundum → 9), or null. A typed
 * "Fluorite" fills 4 before Jasper has linked it: the name alone decides.
 */
export function referenceSlot(names: string[]): number | null {
  for (const name of names) {
    const n = SLOT_OF.get(fold(name));
    if (n !== undefined) return n;
  }
  return null;
}

export type SlotState = "missing" | "owned" | "this";

export type Slot = Reference & { state: SlotState };

/** Where a stone off the set sits, from its hardness: between two references, or on one's number. */
export type Place = { kind: "between"; below: Reference; above: Reference } | { kind: "same"; as: Reference };

export type MohsCard = {
  slots: Slot[]; // the ten
  reference: Reference | null; // this stone's own slot
  first: boolean; // this stone was the first of its reference mineral in the collection
  range: [number, number] | null; // its hardness, Mindat's hmin and hmax
  place: Place | null; // for a stone off the set with a hardness
};

/** A stone as the card needs it: when it was added, and its main mineral's name with the names up its chain. */
export type StoneNames = { id: number; createdAt: string; names: string[] };

function before(a: { id: number; createdAt: string }, b: { id: number; createdAt: string }): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
}

const ref = (n: number): Reference => MOHS_SET[Math.min(10, Math.max(1, n)) - 1];

/** Galena at 2.5 sits between Gypsum (2) and Calcite (3); Pyrrhotite at 4 is the same as Fluorite. */
export function placeOf(range: [number, number]): Place {
  const below = ref(Math.floor(range[0]));
  const above = ref(Math.ceil(range[1]));
  return below.n === above.n ? { kind: "same", as: below } : { kind: "between", below, above };
}

/**
 * The card for one stone among the collection's: every slot's state, this
 * stone's own slot (solid) and whether it was the first to fill it, and for a
 * stone off the set, where its hardness puts it.
 */
export function mohsCard(stoneId: number, stones: StoneNames[], range: [number, number] | null): MohsCard {
  const self = stones.find((s) => s.id === stoneId);
  const own = self ? referenceSlot(self.names) : null;
  const owned = new Set(stones.flatMap((s) => (s.id === stoneId ? [] : [referenceSlot(s.names)])));
  const first = own !== null && self !== undefined && !stones.some((s) => s.id !== stoneId && before(s, self) && referenceSlot(s.names) === own);
  return {
    slots: MOHS_SET.map((r) => ({ ...r, state: r.n === own ? "this" : owned.has(r.n) ? "owned" : "missing" })),
    reference: own === null ? null : ref(own),
    first,
    range,
    place: own === null && range ? placeOf(range) : null,
  };
}

/** The row of ten in words, for its `aria-label`. */
export function mohsRowLabel(card: MohsCard, name: string): string {
  const owned = card.slots.filter((s) => s.state === "owned").map((s) => `${s.n}`);
  const set = owned.length ? `${owned.join(", ").replace(/, (\d+)$/, " and $1")} in your set` : "none in your set yet";
  const own = card.reference ? `with ${card.reference.n} highlighted for this ${name}, and ${set}` : `with ${set}`;
  return `Mohs scale 1 to 10, ${own}`;
}

// --- The dashboard's set (#52) --------------------------------------------------

export type SetSlot<T extends StoneNames> = Reference & {
  state: "missing" | "owned" | "new"; // new: filled by a stone added today
  stone: T | null; // the stone that filled it: the earliest of its mineral
};

export type MohsSet<T extends StoneNames> = { slots: SetSlot<T>[]; owned: number };

/**
 * The household's set as the dashboard lists it: each slot with the stone
 * that filled it (the earliest of that reference mineral, by `created_at`
 * then id), new when that stone was added today, and how many are owned.
 * A second stone of an owned mineral changes nothing.
 */
export function mohsSet<T extends StoneNames>(stones: T[], isToday: (createdAt: string) => boolean): MohsSet<T> {
  const filled = new Map<number, T>();
  for (const s of stones) {
    const n = referenceSlot(s.names);
    if (n === null) continue;
    const have = filled.get(n);
    if (!have || before(s, have)) filled.set(n, s);
  }
  const slots = MOHS_SET.map((r): SetSlot<T> => {
    const stone = filled.get(r.n) ?? null;
    return { ...r, state: stone ? (isToday(stone.createdAt) ? "new" : "owned") : "missing", stone };
  });
  return { slots, owned: filled.size };
}
