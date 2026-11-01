// The name field's autocomplete: the minerals and rocks already in the
// collection, so the second stone of anything is one tap. Pure; the
// route reads the rows.

import { norm } from "./names";

export type MineralHit = { id: number; name: string; kind: "mineral" | "rock" | "other"; stones: number };

/**
 * With nothing typed, the minerals the household owns, most stones first.
 * With a query, every mineral whose name contains it: names that start with
 * it (or have a word that does) first, then most stones, then A to Z.
 */
export function rankMinerals(rows: MineralHit[], q: string, limit = 6): MineralHit[] {
  const nq = norm(q);
  const pool = nq ? rows.filter((r) => norm(r.name).includes(nq)) : rows.filter((r) => r.stones > 0);
  const starts = (r: MineralHit) => (nq && ` ${norm(r.name)}`.includes(` ${nq}`) ? 0 : 1);
  return pool.toSorted((a, b) => starts(a) - starts(b) || b.stones - a.stones || a.name.localeCompare(b.name)).slice(0, limit);
}
