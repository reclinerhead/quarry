// This week's cover (#128): the photo the station launcher
// (reclinerhead/aviary#696, the porch at `/`) shows on this app's tile. The
// pick is a function of the week and the candidates, so it is never stored
// and every device shows the same stone all week. The Aviary and the other
// twin keep their own copies of this file's rule.

/**
 * The number of the week a date's local calendar day falls in, counting
 * Mondays: it goes up by one at Monday 00:00 local and never repeats. The
 * arithmetic runs on UTC fields built from the local parts, so a
 * daylight-saving hour never moves a day.
 */
export function weekIndex(date: Date): number {
  const days = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  return Math.floor((days + 3) / 7); // day 0, 1970-01-01, was a Thursday
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

/** One round's shuffle: the highest hash of the round and the id first, ties to the lowest id. */
function coverRound<T extends { id: number }>(candidates: readonly T[], round: number): T[] {
  return candidates
    .map((c) => ({ c, score: fnv1a(`${round}:${c.id}`) }))
    .sort((a, b) => b.score - a.score || a.c.id - b.c.id)
    .map((s) => s.c);
}

/**
 * This week's pick, or null with nothing to pick from. A rotation: the
 * candidates are shuffled, shown one a week until each has had its turn, then
 * shuffled again, so the same one never shows two weeks running and none
 * waits longer than two rounds. The shuffle is a hash of the round and each
 * id, so nothing is stored and the order the candidates arrive in does not
 * matter. Where a round would open with the one the last round closed on,
 * its first two trade places; two candidates simply alternate.
 */
export function pickCover<T extends { id: number }>(candidates: readonly T[], date: Date): T | null {
  const n = candidates.length;
  if (n === 0) return null;
  if (n === 1) return candidates[0];
  const week = weekIndex(date);
  const turn = ((week % n) + n) % n;
  if (n === 2) return [...candidates].sort((a, b) => a.id - b.id)[turn];
  const round = Math.floor(week / n);
  const order = coverRound(candidates, round);
  if (order[0].id === coverRound(candidates, round - 1)[n - 1].id) [order[0], order[1]] = [order[1], order[0]];
  return order[turn];
}
