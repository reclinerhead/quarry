// "Where it's found" on a stone's page (#65): Mindat's occurrence counts, which
// Jasper keeps on each record (`mindat_records.places`, jasper.md): how many
// places in the USA report the mineral, in each state, and in each of
// Michigan's counties. Pure: `readStone` reads the records the stone could show
// and hands them here. The counts are places reported, mostly mines and
// quarries, not places to go.

/** A state or a county, by Mindat's locality id, with how many of its places report the mineral. */
export type Area = { id: number; name: string; n: number };

/** One record's counts, most first. `usa` 0 means Mindat reports none in the USA. */
export type Places = { usa: number; states: Area[]; michigan: Area[] };

/** A record the card could show, the most specific first; `places` is null until Jasper counted them. */
export type PlacesRecord = { id: number; name: string; places: Places | null };

/**
 * - `found`: the first record up the stone's chain with places in the USA.
 * - `none`: every record is counted and none has a place in the USA.
 * - `unknown`: Mindat has no entry by the mineral's name.
 * - `pending`: not looked up or not counted yet (forever on a station with no Mindat key).
 */
export type FoundCard =
  | { state: "found"; mindatId: number; name: string; line: string; counties: Area[]; states: Area[] }
  | { state: "none"; mindatId: number; name: string }
  | { state: "unknown" }
  | { state: "pending" };

export const HOME_STATE = "Michigan"; // HOME_STATE in jasper/mindat.py

/** How many rows a list shows before "and N more". */
export const SHORT = 8;

/** Mindat's page for a state or a county, which lists its places. */
export function localityUrl(id: number): string {
  return `https://www.mindat.org/loc-${id}.html`;
}

const whole = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);

function areas(v: unknown): Area[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a) =>
    a && typeof a === "object" && whole(a.id) && typeof a.name === "string" && a.name && whole(a.n) ? [{ id: a.id as number, name: a.name as string, n: a.n as number }] : [],
  );
}

/**
 * `mindat_records.places` as Jasper wrote it, or null before he counted them.
 * Anything malformed reads as no places, the way a malformed `detail` reads as
 * an empty record.
 */
export function parsePlaces(json: string | null): Places | null {
  if (json === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    v = null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { usa: 0, states: [], michigan: [] };
  const o = v as Record<string, unknown>;
  return { usa: whole(o.usa), states: areas(o.states), michigan: areas(o.michigan) };
}

/**
 * The card from the records the stone could show, most specific first: the
 * record its variety names and those above it, then its mineral's own chain.
 * The first counted with places in the USA wins, so an Amethyst shows
 * Amethyst's places and a variety Mindat counts none for falls back to its
 * parent's. A record not counted yet stops the walk, so the card never shows
 * a parent's numbers that the next load would swap for the variety's.
 * `waiting` says the variety's name hasn't been asked of Mindat yet; `miss` that
 * the mineral's name was asked and Mindat has no entry by it.
 */
export function foundCard(records: PlacesRecord[], waiting: boolean, miss: boolean): FoundCard {
  if (waiting) return { state: "pending" };
  if (records.length === 0) return { state: miss ? "unknown" : "pending" };
  for (const r of records) {
    if (r.places === null) return { state: "pending" };
    if (r.places.usa > 0)
      return { state: "found", mindatId: r.id, name: r.name, line: foundLine(r.name, r.places), counties: r.places.michigan, states: r.places.states };
  }
  return { state: "none", mindatId: records[0].id, name: records[0].name };
}

const ORDINAL = ["", "", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

const number = (n: number) => n.toLocaleString("en-US");

/**
 * Where the home state ranks among the states, in words, when it is in the top
 * ten of more than one: "the fifth most of any state", "tied for the most of
 * any state". Null otherwise.
 */
export function rankLine(home: Area, states: Area[]): string | null {
  if (states.length < 2) return null;
  const rank = 1 + states.filter((s) => s.n > home.n).length;
  if (rank > 10) return null;
  const tied = states.some((s) => s.id !== home.id && s.n === home.n);
  return `${tied ? "tied for " : ""}the ${rank === 1 ? "" : `${ORDINAL[rank]} `}most of any state`;
}

/**
 * "Mindat lists Agate at 879 places in the USA, in 47 states. 51 are in
 * Michigan, the fifth most of any state." With none in Michigan: "… None are
 * in Michigan yet."
 */
export function foundLine(name: string, p: Places): string {
  const states = p.states.length ? `, in ${p.states.length} ${p.states.length === 1 ? "state" : "states"}` : "";
  const head = `Mindat lists ${name} at ${number(p.usa)} ${p.usa === 1 ? "place" : "places"} in the USA${states}.`;
  const home = p.states.find((s) => s.name === HOME_STATE);
  if (!home) return `${head} None are in ${HOME_STATE} yet.`;
  const rank = rankLine(home, p.states);
  return `${head} ${number(home.n)} ${home.n === 1 ? "is" : "are"} in ${HOME_STATE}${rank ? `, ${rank}` : ""}.`;
}

/** The first eight, and the rest behind "and N more"; never "1 more", which would take the room of the row it hides. */
export function shortList<T>(list: T[], short: number = SHORT): { shown: T[]; rest: T[] } {
  return list.length <= short + 1 ? { shown: list, rest: [] } : { shown: list.slice(0, short), rest: list.slice(short) };
}

/** "8 places", "1 place". */
export function placesLabel(n: number): string {
  return `${number(n)} ${n === 1 ? "place" : "places"}`;
}
