// The dashboard's greeting (design/DESIGN.md §5): the date, then a line that
// says what changed: how many stones were added today (whatChanged in
// lib/collection.ts), and under it what they added to the Mohs set and the
// periodic table (#52).

import { whatChanged } from "./collection";
import { nameList } from "./elements";

export function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** "Sunday, November 1", in the station's own time zone. */
export function dateLine(when: Date): string {
  return when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** "Good evening. Two new stones today.", or "Your collection starts here." while it is empty. */
export function greeting(when: Date, stones: number, addedToday = 0): string {
  const hello = `Good ${partOfDay(when.getHours())}.`;
  if (stones === 0) return `${hello} Your collection starts here.`;
  const changed = whatChanged(addedToday);
  return changed ? `${hello} ${changed}` : hello;
}

/**
 * What today's stones added, for the line under the greeting: "Your Fluorite
 * filled slot 4 on the Mohs scale, and calcium and fluorine are now lit on
 * your periodic table." `filled` is each slot a stone added today was the
 * first to fill, with the piece's name; `lit` the elements such a stone was
 * the first to carry, in plain lower case. Null on a quiet day, when the
 * standing sentence stays.
 */
export function whatTheyAdded(filled: Array<{ n: number; piece: string }>, lit: string[]): string | null {
  const slots = filled.length
    ? `${nameList(filled.map((f) => `your ${f.piece}`))} filled ${filled.length === 1 ? "slot" : "slots"} ${nameList(filled.map((f) => `${f.n}`))} on the Mohs scale`
    : null;
  const elements = lit.length ? `${nameList(lit)} ${lit.length === 1 ? "is" : "are"} now lit on your periodic table` : null;
  const line = slots && elements ? `${slots}, and ${elements}` : (slots ?? elements);
  return line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}.` : null;
}
