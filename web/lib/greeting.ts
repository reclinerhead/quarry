// The dashboard's greeting (design/DESIGN.md §5): the date, then a line that
// says what changed. The collection (#9) teaches it to count new stones; for
// now it knows the time of day and whether the collection is empty.

export function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** "Sunday, November 1", in the station's own time zone. */
export function dateLine(when: Date): string {
  return when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function greeting(when: Date, stones: number): string {
  const hello = `Good ${partOfDay(when.getHours())}.`;
  return stones === 0 ? `${hello} Your collection starts here.` : hello;
}
