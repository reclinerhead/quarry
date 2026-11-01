// When two of Jasper's candidates name the same stone. Ported from the Phase 0
// spike's matching (spikes/vision/identify_spike.py: norm, is_hit), which
// asked whether an expected name was in a candidate; the confirm screen asks
// whether two candidates agree, so the rule is symmetric and stricter about
// varieties.

export type Named = { name: string; variety: string | null };

/** "Tiger's Eye" -> "tigers eye"; "Quartz, var. Amethyst" -> "quartz var amethyst". */
export function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function within(x: string, y: string): boolean {
  return x !== "" && ` ${y} `.includes(` ${x} `);
}

/**
 * Whether two candidates name the same stone.
 *
 * - Names match as whole words, either way round: a qualifier still matches
 *   (Specular hematite is Hematite, Milky quartz is Quartz) but a longer
 *   mineral name does not (Chalcopyrite is not Pyrite).
 * - A variety matches only the other's whole name: Quartz, variety Amethyst
 *   is Amethyst. Varieties are never matched to each other or by a word in
 *   them, because models put colour words there ("Purple"), which would make
 *   a purple fluorite and an amethyst agree.
 */
export function sameStone(a: Named, b: Named): boolean {
  const an = norm(a.name);
  const bn = norm(b.name);
  if (within(an, bn) || within(bn, an)) return true;
  const av = a.variety ? norm(a.variety) : "";
  const bv = b.variety ? norm(b.variety) : "";
  return (av !== "" && av === bn) || (bv !== "" && bv === an);
}
