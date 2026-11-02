// When two of Jasper's candidates name the same stone. Ported from the Phase 0
// spike's matching (spikes/vision/identify_spike.py: norm, is_hit), which
// asked whether an expected name was in a candidate; the confirm screen asks
// whether two candidates agree, so the rule is symmetric and stricter about
// varieties. Since #18 a candidate can also carry its Mindat chain, which
// Jasper looked up: the record it names, then each record above it, up to a
// species or a rock. Agate's is Agate, Chalcedony, Quartz.

/** A Mindat record as Jasper cached it. Hardness is null when Mindat records none, as on many varieties. */
export type MindatRecord = { id: number; name: string; hmin: number | null; hmax: number | null };

export type Named = { name: string; variety: string | null; chain?: MindatRecord[] };

/** The most records a chain holds, as Jasper's MAX_DEPTH. */
export const MAX_DEPTH = 6;

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
 * Whether two candidates name the same stone. Either rule is enough:
 *
 * - **By name.** Names match as whole words, either way round: a qualifier
 *   still matches (Specular hematite is Hematite, Milky quartz is Quartz) but
 *   a longer mineral name does not (Chalcopyrite is not Pyrite). A variety
 *   matches only the other's whole name: Quartz, variety Amethyst is
 *   Amethyst. Varieties are never matched to each other or by a word in them,
 *   because models put colour words there ("Purple"), which would make a
 *   purple fluorite and an amethyst agree.
 * - **By Mindat.** Both chains end at the same species or rock (`shared`), so
 *   Chalcedony, "Agate, banded" and Quartz, Agate agree. Mindat never undoes
 *   a match by name: it files Tiger's Eye as its own entry, and Quartz, Tiger's
 *   Eye must still agree with Tiger's Eye.
 */
export function sameStone(a: Named, b: Named): boolean {
  const an = norm(a.name);
  const bn = norm(b.name);
  if (within(an, bn) || within(bn, an)) return true;
  const av = a.variety ? norm(a.variety) : "";
  const bv = b.variety ? norm(b.variety) : "";
  if ((av !== "" && av === bn) || (bv !== "" && bv === an)) return true;
  return shared(a, b) !== null;
}

/**
 * The deepest Mindat record two candidates' chains share, or null when either
 * has no chain or they end at different species or rocks. Agate and Agate
 * share Agate, Agate and Carnelian share Chalcedony, Amethyst and Citrine
 * share Quartz.
 */
export function shared(a: Named, b: Named): MindatRecord | null {
  const ac = a.chain ?? [];
  const bc = b.chain ?? [];
  if (ac.length === 0 || bc.length === 0 || ac[ac.length - 1].id !== bc[bc.length - 1].id) return null;
  const ids = new Set(bc.map((r) => r.id));
  return ac.find((r) => ids.has(r.id)) ?? null;
}

/**
 * Where two agreeing candidates part on the variety: the level they share,
 * and each one's own record, when both sit below that level (Agate and
 * Carnelian, under Chalcedony). Null when they don't part, which includes one
 * being only less specific than the other (Chalcedony and Agate), or either
 * having no chain.
 */
export function varietySplit(a: Named, b: Named): { level: MindatRecord; guesses: [MindatRecord, MindatRecord] } | null {
  const level = shared(a, b);
  if (!level) return null;
  const al = a.chain![0];
  const bl = b.chain![0];
  return al.id !== level.id && bl.id !== level.id ? { level, guesses: [al, bl] } : null;
}

/** Whether `a` names something below `b` in the same chain: Agate is finer than Chalcedony. */
export function finer(a: Named, b: Named): boolean {
  const ac = a.chain ?? [];
  const bc = b.chain ?? [];
  return bc.length > 0 && ac.length > bc.length && ac.some((r) => r.id === bc[0].id);
}

/**
 * A candidate's chain from the cached records: its own record, then each
 * `varietyof` above it, at most MAX_DEPTH, stopping at a record not cached.
 */
export function chainOf(id: number | null, records: Map<number, MindatRecord & { varietyof: number | null }>): MindatRecord[] {
  const out: MindatRecord[] = [];
  const seen = new Set<number>();
  for (let at = id; at !== null && out.length < MAX_DEPTH && !seen.has(at); ) {
    const r = records.get(at);
    if (!r) break;
    seen.add(at);
    out.push({ id: r.id, name: r.name, hmin: r.hmin, hmax: r.hmax });
    at = r.varietyof;
  }
  return out;
}
