// Fun facts and old lore (#126, epic #127): what Jasper wrote about each
// mineral the household owns, kept in `fun_facts` by Wikipedia article title
// (jasper.md), and the dashboard's fact of the day. Pure: `lib/specimens.ts`
// reads the rows and hands them here. Copied from the Aviary's fun facts
// (aviary #422, `web/lib/aviary.ts`) and adapted; never shared.
//
// A FACT OF THE DAY, WITH NO STORED STATE. Each fact hashes (salt + fact id) to
// one day of a FACT_CYCLE_DAYS cycle, and only facts whose day it is, among the
// titles the household's stones resolve to, are due; several due on one day
// take turns, one per cycle. So a fact can only return a whole number of cycles
// later, adding facts moves nobody else's day, and every phone on a box sees
// the same fact. A day with nothing due shows nothing. The salt is the
// household's oldest stone's `created_at`, so the house and a station with the
// same minerals don't show the same fact on the same day.
//
// The server makes the pick on the dashboard's render, so the strip is in the
// first paint. "Not today" sets a cookie holding the fact's id; tomorrow's fact
// is another id by construction, so one dismissal ends facts for the day.

import type { AboutRow } from "./about";
import { fold } from "./mindat";
import { stoneName } from "./pills";

/** "Once in a while" is this: at 91 days a pool of about 80 facts shows one on roughly six days in ten. */
export const FACT_CYCLE_DAYS = 91;
/** Holds the id of the fact dismissed today. */
export const FACT_DISMISS_COOKIE = "quarry_fact_dismissed";
/** Long enough to outlive the day it names; the id does the day's work. */
export const FACT_DISMISS_MAX_AGE_S = 2 * 86_400;
/** A fact's id as Jasper writes it (`fun_facts.fact_id`): ten hex characters. */
export const FACT_ID = /^[0-9a-f]{10}$/;

/** A true fact from Wikipedia, or an old belief from one of the books (#127), which is never shown as a fact. */
export type FactKind = "fact" | "lore";

/** What a surface prints under a fact, as Jasper stored it: "Pliny the Elder, Natural History, about AD 77". */
export type FactSource = { author: string | null; work: string; year: string | null; url: string };

export type Fact = { id: string; text: string; quote: string; kind: FactKind; source: FactSource };

/** One article's facts, every source's together, in the order Jasper stored them. */
export type FactsOf = { title: string; facts: Fact[] };

/** The label over a fact, by its kind: lore is always marked as a belief. */
export const FACT_STAMP: Record<FactKind, string> = { fact: "Did you know?", lore: "Once believed" };
/** The section of the stone's page the strip's button lands on, by kind. */
export const FACT_ANCHOR: Record<FactKind, string> = { fact: "did-you-know", lore: "once-believed" };

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** One row's `facts` column (JSON, a list) as facts of the row's kind; anything malformed is dropped. */
export function parseFacts(json: string | null, kind: FactKind): Fact[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f: unknown): Fact[] => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    const s = (o.source && typeof o.source === "object" ? o.source : {}) as Record<string, unknown>;
    const year = typeof s.year === "number" ? String(s.year) : text(s.year);
    const fact = { id: text(o.id), text: text(o.text), quote: text(o.quote), kind, source: { author: text(s.author) || null, work: text(s.work), year: year || null, url: text(s.url) } };
    return fact.id && fact.text && fact.source.work && fact.source.url ? [fact] : [];
  });
}

/** FNV-1a, 32-bit: small, stable across runtimes, plenty for spreading a few hundred facts over 91 days. Not a security hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The box's local calendar day as a whole number (days since the epoch): the box lives in its household's time zone. */
export function localDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** The one day of the cycle this fact may show on, in this household. */
export function factCycleDay(factId: string, salt: string): number {
  return fnv1a(`${salt}|${factId}`) % FACT_CYCLE_DAYS;
}

/**
 * Today's fact: one of a title the household's stones resolve to, whose cycle
 * day is today, taking turns by cycle when several share the day (a fact and an
 * old belief due together alternate like any two). Null when none is due, or
 * when today's is the one dismissed: tomorrow's is another id.
 */
export function factOfTheDay(pool: readonly FactsOf[], titles: ReadonlySet<string>, salt: string, day: number, dismissedId?: string | null): { title: string; fact: Fact } | null {
  const slot = ((day % FACT_CYCLE_DAYS) + FACT_CYCLE_DAYS) % FACT_CYCLE_DAYS;
  const cycle = Math.floor(day / FACT_CYCLE_DAYS);
  const due: Array<{ title: string; fact: Fact; order: number }> = [];
  const seen = new Set<string>();
  for (const { title, facts } of pool) {
    if (!titles.has(title)) continue;
    for (const fact of facts) {
      if (seen.has(fact.id) || factCycleDay(fact.id, salt) !== slot) continue;
      seen.add(fact.id);
      due.push({ title, fact, order: fnv1a(`turn|${salt}|${fact.id}`) });
    }
  }
  if (due.length === 0) return null;
  due.sort((a, b) => a.order - b.order || a.fact.id.localeCompare(b.fact.id));
  const pick = due[((cycle % due.length) + due.length) % due.length];
  return pick.fact.id === dismissedId ? null : { title: pick.title, fact: pick.fact };
}

/** A stone's names as its About card tries them (`aboutTerms`: the variety, the variety before its comma, the mineral), as written, capitalized, beside each term's row. */
export type FactStone = { id: number; names: string[]; rows: AboutRow[] };

/** The names `aboutTerms` folds, in its order and with its dedupe, as the household wrote them. */
export function aboutNames(name: string, variety: string | null): string[] {
  const out: string[] = [];
  const seen: string[] = [];
  for (const t of [variety, variety?.split(",")[0], name]) {
    const f = fold(t ?? "");
    if (f && !seen.includes(f)) {
      seen.push(f);
      out.push(stoneName((t ?? "").trim().replace(/\s+/g, " ")));
    }
  }
  return out;
}

/**
 * The article a stone's About card shows (`aboutCard`'s rule: the first term
 * with an article, none while an earlier term is still unasked), with the
 * household's own name for it: "Schorl" for the stone that reads Tourmaline's.
 */
export function aboutPick(stone: Pick<FactStone, "names" | "rows">): { title: string; name: string } | null {
  for (const [i, r] of stone.rows.entries()) {
    if (r === undefined) return null;
    if (r !== null && r.summary.trim()) return { title: r.title, name: stone.names[i] ?? r.title };
  }
  return null;
}

/**
 * The household's eligible titles: each article some stone's About card
 * resolves to, with the first stone given (pass them oldest first) and its name
 * for the mineral. A Schorl contributes Tourmaline; a term with no article
 * contributes nothing.
 */
export function factTitles(stones: readonly FactStone[]): Map<string, { stoneId: number; name: string }> {
  const out = new Map<string, { stoneId: number; name: string }>();
  for (const s of stones) {
    const pick = aboutPick(s);
    if (pick && !out.has(pick.title)) out.set(pick.title, { stoneId: s.id, name: pick.name });
  }
  return out;
}

/** Who a fact is from, as the strip's line names it: the author when there is one, else the work. "Agate · from Pliny the Elder". */
export function factCredit(source: FactSource): string {
  return source.author ?? source.work;
}

/** The strip's button: "More about amethyst", in the household's name for the mineral. */
export function moreAbout(name: string): string {
  return `More about ${name.toLowerCase()}`;
}
