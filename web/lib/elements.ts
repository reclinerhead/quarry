// What a stone is made of (#42): the elements in its main mineral's Mindat
// record, as the stone page's "What it's made of" card draws them, and which
// of them this stone was the first to bring to the household's periodic
// table. Pure: `readStone` reads every stone's chain and hands it here.

import type { ChainRecord } from "./mindat";

export type PeriodicElement = { symbol: string; number: number; name: string };

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

/** All 118, by number. */
export const ELEMENTS: readonly PeriodicElement[] = TABLE.split(",").map((s, i) => {
  const [symbol, name] = s.split(" ");
  return { symbol, number: i + 1, name };
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

/** A stone as the card needs it: when it was added, and its main mineral's elements. */
export type StoneElements = { id: number; createdAt: string; elements: PeriodicElement[] };

export type ElementTile = PeriodicElement & { isNew: boolean };

export type ElementsCard = {
  tiles: ElementTile[];
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
 */
export function elementsCard(stoneId: number, stones: StoneElements[]): ElementsCard {
  const self = stones.find((s) => s.id === stoneId);
  const earlier = new Set(self ? stones.filter((s) => before(s, self)).flatMap((s) => s.elements.map((e) => e.symbol)) : []);
  return {
    tiles: (self?.elements ?? []).map((e) => ({ ...e, isNew: !earlier.has(e.symbol) })),
    lit: new Set(stones.flatMap((s) => s.elements.map((e) => e.symbol))).size,
  };
}

const SMALL = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "calcium and fluorine", "iron, oxygen and silicon". */
function list(names: string[]): string {
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
    const who = list(fresh);
    return `${who.charAt(0).toUpperCase()}${who.slice(1)} ${fresh.length === 1 ? "is" : "are"} new to your periodic table. You now have ${lit}`;
  }
  const already =
    n === 1 ? `${card.tiles[0].name} was` : n === 2 ? "Both were" : `All ${n <= 10 ? SMALL[n] : n} were`;
  return `${already} already on your periodic table. You have ${lit}`;
}
