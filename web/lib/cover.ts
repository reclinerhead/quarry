// This week's cover (#128): the photo the station launcher
// (reclinerhead/aviary#696, the porch at `/`) shows on this app's tile. The
// pick is a function of the week and the candidates, so it is never stored
// and every device shows the same stone all week. The Aviary and the other
// twin keep their own copies of this file's rule.

/**
 * The ISO-8601 week of a date's local calendar day, as "2026-W47". The week
 * turns over at Monday 00:00 local, and the days around New Year take the ISO
 * week-year (2027-01-01 is "2026-W53"). The arithmetic runs on UTC fields
 * built from the local parts, so a daylight-saving hour never moves a day.
 */
export function weekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = (day.getUTCDay() + 6) % 7; // Monday 0 .. Sunday 6
  day.setUTCDate(day.getUTCDate() - weekday + 3); // this week's Thursday decides the year
  const year = day.getUTCFullYear();
  const week = Math.floor((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 32-bit FNV-1a over a string's UTF-16 code units. Not a security hash. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** One week's ranking: the highest score first, ties to the lowest id. */
function ranking<T extends { id: number }>(candidates: readonly T[], week: string): T[] {
  return candidates
    .map((c) => ({ c, score: fnv1a(`${week}:${c.id}`) }))
    .sort((a, b) => b.score - a.score || a.c.id - b.c.id)
    .map((s) => s.c);
}

/**
 * This week's pick, or null with nothing to pick from. Each candidate scores
 * as a hash of the week and its id, and the highest wins. With two or more, a
 * winner that also won the week before gives way to the runner-up.
 */
export function pickCover<T extends { id: number }>(candidates: readonly T[], date: Date): T | null {
  if (candidates.length === 0) return null;
  const ranked = ranking(candidates, weekKey(date));
  if (ranked.length < 2) return ranked[0];
  const lastWeek = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7);
  const before = ranking(candidates, weekKey(lastWeek))[0];
  return ranked[0].id === before.id ? ranked[1] : ranked[0];
}
