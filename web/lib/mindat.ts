// The Mineral properties card (#23), shaped from the Mindat records Jasper
// fetched (#21). Pure: `readStone` reads the chain (the mineral's own record,
// then each `varietyof` above it) and hands it here.
//
// Mindat's fields can't go on the page as they are: formulas are HTML, the
// enumerated fields are Mindat's words, numbers are text with "0" for none,
// fluorescence is free prose, and a variety leaves most fields empty. Each value
// is taken from the first record in the chain that has one, so a chalcedony takes
// its crystal system from Quartz. Mindat's HTML never reaches the page as HTML:
// formulas become text segments, everything else plain text.

/** A record as `readStone` reads it: the identification columns, and `detail` parsed (null until Jasper fetched it). */
export type ChainRecord = {
  id: number;
  name: string;
  entrytype: string;
  hmin: number | null;
  hmax: number | null;
  streak: string | null;
  detail: Record<string, unknown> | null;
};

/** A run of a formula's text: plain, subscript or superscript. */
export type Segment = { text: string; pos: "sub" | "sup" | null };

export type Glow = "no" | "rarely" | "can";

export type PropertyKey =
  | "formula"
  | "hardness"
  | "crystalSystem"
  | "luster"
  | "streak"
  | "cleavage"
  | "specificGravity"
  | "fluorescence";

export type Cell = {
  key: PropertyKey;
  label: string;
  value: string; // the formula as plain text too, for its label
  segments?: Segment[]; // the formula only
  detail?: string; // fluorescence only: Mindat's own words
};

/**
 * - `cells`: at least one property has a value.
 * - `empty`: the record is fetched and has none (every rock).
 * - `unknown`: Mindat has no entry by the mineral's name.
 * - `pending`: not linked or not fetched yet (forever on a station with no Mindat key).
 */
export type CardState = "cells" | "empty" | "unknown" | "pending";

export type PropertyCard = {
  state: CardState;
  mindatId: number | null; // the mineral's own record, for the link to mindat.org
  cells: Cell[];
  formula: Segment[] | null;
  mineralClass: string | null; // Strunz's class, singular: "Halide"
  mohs: string | null; // "4", "6.5 to 7"
  glow: Glow | null;
};

export const GLOW_LABEL: Record<Glow, string> = { no: "Doesn’t glow", rarely: "Rarely glows", can: "Can glow" };

/** Folded as Jasper folds a term (`fold` in jasper/mindat.py), to find a name in `mindat_terms`. */
export function fold(s: string): string {
  return s
    .replace(/’/g, "'")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", times: "×",
  deg: "°", plusmn: "±", minus: "−", ndash: "–", mdash: "—", square: "□", box: "□",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/** Mindat's HTML as plain text: tags dropped, entities decoded, whitespace collapsed. */
export function plain(html: string): string {
  return decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** A formula's runs: `<sub>` and `<sup>` kept as positions, any other tag dropped with its text kept. */
export function formulaSegments(html: string): Segment[] {
  const out: Segment[] = [];
  let pos: Segment["pos"] = null;
  for (const part of html.split(/(<\/?[a-z]+[^>]*>)/i)) {
    const tag = /^<(\/?)([a-z]+)/i.exec(part);
    if (tag) {
      const name = tag[2].toLowerCase();
      if (name === "sub" || name === "sup") pos = tag[1] ? null : name;
      continue;
    }
    const text = decode(part).replace(/\s+/g, " ");
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.pos === pos) last.text += text;
    else out.push({ text, pos });
  }
  if (out.length) {
    out[0].text = out[0].text.trimStart();
    out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  }
  return out.filter((s) => s.text !== "");
}

/** "4", or "6.5 to 7", as the confirm screen's misfit note writes it. */
export function mohsLabel(hmin: number, hmax: number): string {
  return hmin === hmax ? `${hmin}` : `${hmin} to ${hmax}`;
}

const CRYSTAL_SYSTEMS: Record<string, string> = { Isometric: "Cubic (isometric)", Amorphous: "None (amorphous)" };

const LUSTERS: Record<string, string> = {
  Vitreous: "Glassy (vitreous)",
  "Sub-Vitreous": "Nearly glassy (sub-vitreous)",
  Adamantine: "Brilliant (adamantine)",
  "Sub-Adamantine": "Nearly brilliant (sub-adamantine)",
  "Sub-Metallic": "Nearly metallic (sub-metallic)",
};

const CLEAVAGES: Record<string, string> = {
  "Very Good": "Very good",
  "Distinct/Good": "Good",
  "Imperfect/Fair": "Fair",
  "Poor/Indistinct": "Poor",
  "None Observed": "None",
};

/** Strunz's ten classes (`strunz10ed1`), singular for a tag. */
const CLASSES: Record<string, string> = {
  "1": "Native element",
  "2": "Sulfide",
  "3": "Halide",
  "4": "Oxide",
  "5": "Carbonate",
  "6": "Borate",
  "7": "Sulfate",
  "8": "Phosphate",
  "9": "Silicate",
  "10": "Organic mineral",
};

/** The first listed of Mindat's comma-joined values, in plain words: "Metallic,Sub-Metallic,Dull" is "Metallic". */
export function lusterLabel(lustretype: string): string | null {
  const first = lustretype.split(",").map((s) => s.trim()).find(Boolean);
  return first ? (LUSTERS[first] ?? first) : null;
}

/** A number Mindat wrote as text, or null for "0", "" or anything that isn't one. */
function measure(s: string | null): string | null {
  return s && /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? s : null;
}

/** At most two decimals, rounded half up on the digits as written: "3.175" is 3.18, "7.60" is 7.6. */
function twoDecimals(s: string): string {
  const [whole, frac = ""] = s.split(".");
  return `${Math.round(Number(`${whole}${frac.slice(0, 2).padEnd(2, "0")}.${frac.slice(2) || "0"}`)) / 100}`;
}

/** Specific gravity: measured, as a range when `dmeas2` is larger, else calculated. */
export function gravityLabel(dmeas: string | null, dmeas2: string | null, dcalc: string | null): string | null {
  const [a, b, c] = [measure(dmeas), measure(dmeas2), measure(dcalc)];
  if (a) return b && Number(b) > Number(a) ? `${twoDecimals(a)} to ${twoDecimals(b)}` : twoDecimals(a);
  return c ? twoDecimals(c) : null;
}

const ONLY_NO = /^(none|not fluorescent( in (uv|ultraviolet light))?|non-?fluorescent)\.?$/i;
const RARELY = /^(not usually|rarely)\b/i;
const ABOUT_UV = /fluoresc|\buv\b|\b[ls]w\b/i;
const NOTE = 160;
/** A sentence ends at . ! or ? before a capital letter or the end, so "et al. 2003" and "e.g. calcite" run on. */
const SENTENCE = /.*?[.!?](?=\s+["“(]?\p{Lu}|\s*$)|.+$/gu;

/**
 * Mindat's words in whole sentences, LW and SW spelled out: the first always,
 * however long, then the next ones while the note stays within 160 characters.
 */
function glowDetail(text: string): string {
  const s = text.replace(/\b([LS])W(-?\s?UV)?\b/g, (_, w: string, uv?: string) => `${w === "L" ? "long" : "short"}-wave${uv ? " UV" : ""}`);
  const [first, ...rest] = (s.match(SENTENCE) ?? [s]).map((p) => p.trim()).filter(Boolean);
  let note = first;
  for (const p of rest) {
    if (note.length + 1 + p.length > NOTE) break;
    note += ` ${p}`;
  }
  return note;
}

/**
 * Whether a mineral glows under UV, from `uv`, or `luminescence` when `uv` is
 * empty: "no" when the text is only a negative, "rarely" when it opens with
 * "not usually" or "rarely", "can" when either field speaks of fluorescence or
 * UV, and null when neither does (Quartz's "Triboluminescent").
 */
export function glowOf(uv: string | null, luminescence: string | null): { glow: Glow; detail: string | null } | null {
  const u = plain(uv ?? "");
  const l = plain(luminescence ?? "");
  const text = u || l;
  if (!text) return null;
  if (ONLY_NO.test(text)) return { glow: "no", detail: null };
  const glow: Glow | null = RARELY.test(text) ? "rarely" : ABOUT_UV.test(u) || ABOUT_UV.test(l) ? "can" : null;
  return glow ? { glow, detail: glowDetail(text) } : null;
}

/** A field of a fetched record as text, or null for Mindat's none: missing, "", "0". */
function field(r: ChainRecord, key: string): string | null {
  const v = r.detail?.[key];
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? `${v}` : "";
  return s && s !== "0" ? s : null;
}

/** The first record in the chain with a value, the mineral's own first. */
function inherit<T>(chain: ChainRecord[], pick: (r: ChainRecord) => T | null): T | null {
  for (const r of chain) {
    const v = pick(r);
    if (v !== null) return v;
  }
  return null;
}

/**
 * The card from the mineral's chain, its own record first. `miss` says the
 * mineral's name is cached in `mindat_terms` with no record, meaning Mindat
 * has no entry by that name.
 */
export function propertyCard(chain: ChainRecord[], miss: boolean): PropertyCard {
  const own = chain[0];
  const card: PropertyCard = { state: "pending", mindatId: own?.id ?? null, cells: [], formula: null, mineralClass: null, mohs: null, glow: null };
  if (!own) return { ...card, state: miss ? "unknown" : "pending" };
  if (!own.detail) return card;

  const formula = inherit(chain, (r) => {
    const f = field(r, "mindat_formula");
    return f ? formulaSegments(f) : null;
  });
  const hard = inherit(chain, (r) => (r.hmin !== null && r.hmax !== null ? mohsLabel(r.hmin, r.hmax) : null));
  const system = inherit(chain, (r) => field(r, "csystem"));
  const luster = inherit(chain, (r) => {
    const t = field(r, "lustretype");
    return t ? lusterLabel(t) : null;
  });
  const streak = inherit(chain, (r) => {
    const s = plain(r.streak ?? "");
    return s ? s[0].toUpperCase() + s.slice(1) : null;
  });
  const cleavage = inherit(chain, (r) => field(r, "cleavagetype"));
  const gravity = inherit(chain, (r) => gravityLabel(field(r, "dmeas"), field(r, "dmeas2"), field(r, "dcalc")));
  const glow = inherit(chain, (r) => glowOf(field(r, "uv"), field(r, "luminescence")));
  const strunz = inherit(chain, (r) => field(r, "strunz10ed1"));

  const cells: Cell[] = [];
  if (formula?.length) cells.push({ key: "formula", label: "Formula", value: formula.map((s) => s.text).join(""), segments: formula });
  if (hard) cells.push({ key: "hardness", label: "Mohs hardness", value: hard });
  if (system) cells.push({ key: "crystalSystem", label: "Crystal system", value: CRYSTAL_SYSTEMS[system] ?? system });
  if (luster) cells.push({ key: "luster", label: "Luster", value: luster });
  if (streak) cells.push({ key: "streak", label: "Streak", value: streak });
  if (cleavage) cells.push({ key: "cleavage", label: "Cleavage", value: CLEAVAGES[cleavage] ?? cleavage });
  if (gravity) cells.push({ key: "specificGravity", label: "Specific gravity", value: gravity });
  if (glow) cells.push({ key: "fluorescence", label: "Fluorescence", value: GLOW_LABEL[glow.glow], ...(glow.detail ? { detail: glow.detail } : {}) });

  return {
    state: cells.length ? "cells" : "empty",
    mindatId: own.id,
    cells,
    formula: formula?.length ? formula : null,
    mineralClass: strunz ? (CLASSES[strunz] ?? null) : null,
    mohs: hard,
    glow: glow?.glow ?? null,
  };
}
