// The dashboard's greeting (design/DESIGN.md §5): the date, then a line that
// says what changed: how many stones were added today (whatChanged in
// lib/collection.ts). What the new stones add to the Mohs scale and the
// periodic table arrives with Mindat in Phase 2.

import { whatChanged } from "./collection";

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
