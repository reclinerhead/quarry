// What a stone is made of (#42): the elements in its main mineral's Mindat
// record, as the stone page's "What it's made of" card draws them, and which
// of them this stone was the first to bring to the household's periodic
// table. Pure: `readStone` reads every stone's chain and hands it here.

import type { ChainRecord, Segment } from "./mindat";

export type PeriodicElement = {
  symbol: string;
  number: number;
  name: string;
  row: number; // its period on the 18-column table; the lanthanides are row 8 and the actinides row 9 (#48)
  col: number; // its group, 1 to 18
};

// The periodic table in order, so an element's number is its place in the list.
const TABLE =
  "H Hydrogen,He Helium,Li Lithium,Be Beryllium,B Boron,C Carbon,N Nitrogen,O Oxygen,F Fluorine,Ne Neon," +
  "Na Sodium,Mg Magnesium,Al Aluminium,Si Silicon,P Phosphorus,S Sulfur,Cl Chlorine,Ar Argon,K Potassium,Ca Calcium," +
  "Sc Scandium,Ti Titanium,V Vanadium,Cr Chromium,Mn Manganese,Fe Iron,Co Cobalt,Ni Nickel,Cu Copper,Zn Zinc," +
  "Ga Gallium,Ge Germanium,As Arsenic,Se Selenium,Br Bromine,Kr Krypton,Rb Rubidium,Sr Strontium,Y Yttrium,Zr Zirconium," +
  "Nb Niobium,Mo Molybdenum,Tc Technetium,Ru Ruthenium,Rh Rhodium,Pd Palladium,Ag Silver,Cd Cadmium,In Indium,Sn Tin," +
  "Sb Antimony,Te Tellurium,I Iodine,Xe Xenon,Cs Caesium,Ba Barium,La Lanthanum,Ce Cerium,Pr Praseodymium,Nd Neodymium," +
  "Pm Promethium,Sm Samarium,Eu Europium,Gd Gadolinium,Tb Terbium,Dy Dysprosium,Ho Holmium,Er Erbium,Tm Thulium,Yb Ytterbium," +
  "Lu Lutetium,Hf Hafnium,Ta Tantalum,W Tungsten,Re Rhenium,Os Osmium,Ir Iridium,Pt Platinum,Au Gold,Hg Mercury," +
  "Tl Thallium,Pb Lead,Bi Bismuth,Po Polonium,At Astatine,Rn Radon,Fr Francium,Ra Radium,Ac Actinium,Th Thorium," +
  "Pa Protactinium,U Uranium,Np Neptunium,Pu Plutonium,Am Americium,Cm Curium,Bk Berkelium,Cf Californium,Es Einsteinium,Fm Fermium," +
  "Md Mendelevium,No Nobelium,Lr Lawrencium,Rf Rutherfordium,Db Dubnium,Sg Seaborgium,Bh Bohrium,Hs Hassium,Mt Meitnerium,Ds Darmstadtium," +
  "Rg Roentgenium,Cn Copernicium,Nh Nihonium,Fl Flerovium,Mc Moscovium,Lv Livermorium,Ts Tennessine,Og Oganesson";

/**
 * Where an element sits on the standard 18-column table: hydrogen top left,
 * helium top right, the main blocks in their periods, and the lanthanides
 * and actinides pulled out into two rows below, under columns 3 to 17.
 */
export function cellOf(n: number): { row: number; col: number } {
  const at = (row: number, col: number) => ({ row, col });
  if (n === 1) return at(1, 1);
  if (n === 2) return at(1, 18);
  if (n <= 10) return n <= 4 ? at(2, n - 2) : at(2, n + 8);
  if (n <= 18) return n <= 12 ? at(3, n - 10) : at(3, n);
  if (n <= 36) return at(4, n - 18);
  if (n <= 54) return at(5, n - 36);
  if (n <= 56) return at(6, n - 54);
  if (n <= 71) return at(8, n - 54);
  if (n <= 86) return at(6, n - 68);
  if (n <= 88) return at(7, n - 86);
  if (n <= 103) return at(9, n - 86);
  return at(7, n - 100);
}

/** All 118, by number. */
export const ELEMENTS: readonly PeriodicElement[] = TABLE.split(",").map((s, i) => {
  const [symbol, name] = s.split(" ");
  return { symbol, number: i + 1, name, ...cellOf(i + 1) };
});

const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));

/**
 * Mindat's `elements` as elements, in Mindat's order, each once: a
 * comma-joined string of symbols ("Ca,F"), or a JSON array of them should
 * Mindat send one. A symbol not on the table is dropped, never drawn blank;
 * Mindat's none (missing, "", "0") is none.
 */
export function parseElements(v: unknown): PeriodicElement[] {
  let parts: unknown[];
  if (Array.isArray(v)) parts = v;
  else if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(s);
        parts = Array.isArray(parsed) ? parsed : [];
      } catch {
        parts = [];
      }
    } else parts = s.split(/[\s,;]+/);
  } else parts = [];
  const out: PeriodicElement[] = [];
  for (const p of parts) {
    const e = typeof p === "string" ? BY_SYMBOL.get(p.trim()) : undefined;
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * A mineral's elements, from the first record in its chain that lists any
 * (a variety's own record, else the species above it); none until the
 * mineral's own record is fetched, and none for a rock, which Mindat
 * records no elements for.
 */
export function elementsOf(chain: Array<Pick<ChainRecord, "detail">>): PeriodicElement[] {
  if (!chain[0]?.detail) return [];
  for (const r of chain) {
    const found = parseElements(r.detail?.["elements"]);
    if (found.length) return found;
  }
  return [];
}

/** A named mineral on a piece, as the collection-wide pass reads it: its elements and its formula, from its own chain. */
export type PieceMineral = { name: string; elements: PeriodicElement[]; formula: Segment[] | null };

/** A stone with every named mineral on it, the main one first, then the ones with it, then the one it sits on (#29). */
export type StoneMinerals = { id: number; createdAt: string; minerals: PieceMineral[] };

/**
 * The elements of the whole piece (#48): the main mineral's first, then each
 * companion's, each element once. A piece's elements are additive, unlike
 * its formula, which is the main mineral's alone.
 */
export function pieceElements(stone: StoneMinerals): PeriodicElement[] {
  const out: PeriodicElement[] = [];
  for (const m of stone.minerals) for (const e of m.elements) if (!out.some((o) => o.symbol === e.symbol)) out.push(e);
  return out;
}

export type ElementTile = PeriodicElement & { isNew: boolean };

/**
 * One mineral's share of the card (#76): its name, its formula, its own
 * elements, and as tiles the ones no earlier group on the card showed. When
 * it has elements but no tiles, `sameAs` names the earlier group that carries
 * every one of them (Marcasite after Pyrite), or is null when they are spread
 * over several.
 */
export type ElementGroup = { name: string; formula: Segment[] | null; elements: PeriodicElement[]; tiles: ElementTile[]; sameAs: string | null };

export type ElementsCard = {
  tiles: ElementTile[]; // the whole piece's, each element once, in piece order
  groups: ElementGroup[]; // the same tiles by mineral, in piece order; the card draws them only when there are two or more
  lit: number; // distinct elements across the whole collection
};

/** Added before: by `created_at`, then id, so two stones named in one second still have an order. */
function before(a: { id: number; createdAt: string }, b: { id: number; createdAt: string }): boolean {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
}

/**
 * The card for one stone among the collection's: each of its elements, and
 * whether it is new with this stone, meaning no stone added before it carries
 * it. That makes "new" a fact about the stone, not about today: the first
 * Fluorite keeps "Fluorine · new" and the second never shows it.
 *
 * The same tiles come grouped by mineral (#76), each element under the first
 * mineral in piece order that carries it, so the sulfur of "Pyrite with
 * Sphalerite" sits under Pyrite and Sphalerite's group holds zinc alone. A
 * group left with nothing (Pyrite with Marcasite, both FeS₂) keeps its name
 * and formula so the card can say its elements are above.
 */
export function elementsCard(stoneId: number, stones: StoneMinerals[]): ElementsCard {
  const self = stones.find((s) => s.id === stoneId);
  const earlier = new Set(self ? stones.filter((s) => before(s, self)).flatMap((s) => pieceElements(s).map((e) => e.symbol)) : []);
  const tile = (e: PeriodicElement): ElementTile => ({ ...e, isNew: !earlier.has(e.symbol) });
  const shown = new Set<string>();
  const groups: ElementGroup[] = [];
  for (const m of self?.minerals ?? []) {
    const own = m.elements.filter((e) => !shown.has(e.symbol));
    for (const e of own) shown.add(e.symbol);
    const sameAs =
      m.elements.length && !own.length ? (groups.find((g) => m.elements.every((e) => g.elements.some((o) => o.symbol === e.symbol)))?.name ?? null) : null;
    groups.push({ name: m.name, formula: m.formula, elements: m.elements, tiles: own.map(tile), sameAs });
  }
  return {
    tiles: groups.flatMap((g) => g.tiles),
    groups,
    lit: new Set(stones.flatMap((s) => pieceElements(s).map((e) => e.symbol))).size,
  };
}

const SMALL = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "calcium and fluorine", "iron, oxygen and silicon". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The line under the tiles: which elements are new to the household's
 * periodic table, then how many are lit. "Fluorine is new to your periodic
 * table. You now have 14 elements lit."
 */
export function elementsLine(card: ElementsCard): string {
  const fresh = card.tiles.filter((t) => t.isNew).map((t) => t.name.toLowerCase());
  const n = card.tiles.length;
  const lit = `${card.lit === 1 ? "1 element" : `${card.lit} elements`} lit.`;
  if (fresh.length) {
    const who = nameList(fresh);
    return `${who.charAt(0).toUpperCase()}${who.slice(1)} ${fresh.length === 1 ? "is" : "are"} new to your periodic table. You now have ${lit}`;
  }
  const already =
    n === 1 ? `${card.tiles[0].name} was` : n === 2 ? "Both were" : `All ${n <= 10 ? SMALL[n] : n} were`;
  return `${already} already on your periodic table. You have ${lit}`;
}

// --- The periodic table page (#48) ---------------------------------------------

/** A lit element: which stones carry it, newest first, with the mineral on each piece that has it, and the stone that brought it. */
export type Lit<T extends StoneMinerals> = {
  element: PeriodicElement;
  stones: Array<{ stone: T; mineral: PieceMineral }>;
  first: T; // the oldest stone carrying it: the one that lit it (#52)
};

export type PeriodicTable<T extends StoneMinerals> = {
  lit: Lit<T>[]; // by atomic number
  stones: number; // stones that carry at least one lit element
  newest: { elements: PeriodicElement[]; stone: T } | null; // the stone that last brought anything new, with what it brought, in piece order
};

/** Newest first: by `created_at`, then id. */
function newestFirst<T extends { id: number; createdAt: string }>(a: T, b: T): number {
  return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : b.id - a.id;
}

/**
 * The household's table: each lit element with the stones that carry it
 * (newest first, each stone once, naming the first mineral on the piece that
 * has the element), and the newest arrival: the stone added last among those
 * that were the first to carry an element, with every element it was first
 * to carry.
 */
export function periodicTable<T extends StoneMinerals>(stones: T[]): PeriodicTable<T> {
  const bySymbol = new Map<string, Omit<Lit<T>, "first">>();
  for (const stone of [...stones].sort(newestFirst))
    for (const mineral of stone.minerals)
      for (const element of mineral.elements) {
        const lit = bySymbol.get(element.symbol) ?? { element, stones: [] };
        if (!lit.stones.some((s) => s.stone.id === stone.id)) lit.stones.push({ stone, mineral });
        bySymbol.set(element.symbol, lit);
      }
  const lit: Lit<T>[] = [...bySymbol.values()]
    .map((l) => ({ ...l, first: l.stones[l.stones.length - 1].stone }))
    .sort((a, b) => a.element.number - b.element.number);
  const last = lit.map((l) => l.first).sort(newestFirst)[0];
  const newest = last ? { elements: lit.filter((l) => l.first.id === last.id).map((l) => l.element), stone: last } : null;
  return { lit, stones: new Set(lit.flatMap((l) => l.stones.map((s) => s.stone.id))).size, newest };
}
