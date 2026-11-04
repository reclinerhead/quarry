// Reading stones for the dashboard and a stone's own page, and writing the
// minerals a stone is made of (#29). Server only. Rows from node:sqlite have a
// null prototype, so everything that crosses to a client component is built
// here as a plain object.

import type { DatabaseSync } from "node:sqlite";
import { type AtShow, type ShowCase } from "./cases";
import { shortDay, type Acquired, type Tile } from "./collection";
import { elementsCard, elementsOf, type ElementsCard, type PieceMineral, type StoneMinerals } from "./elements";
import { cleanAnswers, type Answers } from "./household-tests";
import { fold, formulaSegments, mineralClassOf, propertyCard, type ChainRecord, type PropertyCard } from "./mindat";
import { mohsCard, type MohsCard } from "./mohs";
import { chainOf, MAX_DEPTH } from "./names";
import { thumbPathFor } from "./photos";
import { isForm, isMatrix, MATRIX, type Form, type PartRole, type StoneKind } from "./pills";
import { foundCard, parsePlaces, type FoundCard } from "./places";

/**
 * The photo a stone is known by first (#84: `specimens.hero_photo_id`, chosen
 * on its page), then the newest: by when it was taken, else when it was
 * uploaded, then id. One order for the card, the lists, the show cases and the
 * gallery, so they agree by construction; with nothing chosen it is newest
 * first, as before.
 */
const MAIN_PHOTO_FIRST =
  "(p.id = (SELECT h.hero_photo_id FROM specimens h WHERE h.id = p.specimen_id)) DESC, COALESCE(p.taken_at, p.uploaded_at) DESC, p.id DESC";

/** A stone's other minerals as the screens show them: a base of plain matrix is named "matrix". */
export type StonePart = { role: PartRole; name: string };

const PARTS = `SELECT sp.specimen_id, sp.role, sp.mineral_id, m.name FROM specimen_parts sp LEFT JOIN minerals m ON m.id = sp.mineral_id`;

type PartRow = { specimen_id: number; role: PartRole; mineral_id: number | null; name: string | null };

const partOf = (r: PartRow): StonePart => ({ role: r.role, name: r.name ?? MATRIX });

/** Every stone's other minerals, in order, by specimen id. */
function partsByStone(db: DatabaseSync): Map<number, PartRow[]> {
  const parts = new Map<number, PartRow[]>();
  for (const r of db.prepare(`${PARTS} ORDER BY sp.specimen_id, sp.position`).all() as PartRow[])
    parts.set(r.specimen_id, [...(parts.get(r.specimen_id) ?? []), r]);
  return parts;
}

/** One stone's other minerals, in order. */
export function stoneParts(db: DatabaseSync, specimenId: number): StonePart[] {
  return (db.prepare(`${PARTS} WHERE sp.specimen_id = ? ORDER BY sp.position`).all(specimenId) as PartRow[]).map(partOf);
}

/** A record in a mineral's chain, as the collection-wide pass reads it: its name, and three fields of `detail`. */
type ChainLink = { name: string; detail: { strunz10ed1: unknown; elements: unknown; mindat_formula: unknown } | null };

/**
 * The chain of every mineral on any stone, by `minerals.id`, for the tiles
 * (#38), the stone page's side cards (#42) and the periodic table (#48):
 * every chain read at once, as `readProperties` reads one, with only Strunz's
 * class, the elements and the formula taken out of `detail`, so no page
 * parses whole records for the whole collection.
 */
function mineralChains(db: DatabaseSync): Map<number, ChainLink[]> {
  const rows = db
    .prepare(
      `WITH RECURSIVE up(mineral, id, depth) AS (
         SELECT m.id, m.mindat_id, 1 FROM minerals m
          WHERE m.mindat_id IS NOT NULL
            AND (m.id IN (SELECT mineral_id FROM specimens) OR m.id IN (SELECT mineral_id FROM specimen_parts WHERE mineral_id IS NOT NULL))
         UNION
         SELECT up.mineral, r.varietyof, up.depth + 1 FROM up JOIN mindat_records r ON r.id = up.id
          WHERE r.varietyof IS NOT NULL AND up.depth < ?)
       SELECT up.mineral, r.name, r.detail IS NOT NULL AS fetched,
              CASE WHEN json_valid(r.detail) THEN json_extract(r.detail, '$.strunz10ed1') END AS strunz,
              CASE WHEN json_valid(r.detail) THEN json_extract(r.detail, '$.elements') END AS elements,
              CASE WHEN json_valid(r.detail) THEN json_extract(r.detail, '$.mindat_formula') END AS formula
         FROM up JOIN mindat_records r ON r.id = up.id ORDER BY up.mineral, up.depth`,
    )
    .all(MAX_DEPTH) as Array<{ mineral: number; name: string; fetched: number; strunz: string | number | null; elements: string | null; formula: string | null }>;
  const chains = new Map<number, ChainLink[]>();
  for (const r of rows)
    chains.set(r.mineral, [
      ...(chains.get(r.mineral) ?? []),
      { name: r.name, detail: r.fetched ? { strunz10ed1: r.strunz, elements: r.elements, mindat_formula: r.formula } : null },
    ]);
  return chains;
}

/** A mineral's formula from the first record in its chain that has one, once its own record is fetched; Mindat's "0" and "" are none. */
function formulaOf(chain: ChainLink[]): PieceMineral["formula"] {
  if (!chain[0]?.detail) return null;
  for (const c of chain) {
    const f = c.detail?.mindat_formula;
    if (typeof f === "string" && f.trim() && f.trim() !== "0") {
      const segments = formulaSegments(f);
      return segments.length ? segments : null;
    }
  }
  return null;
}

/** A stone with every named mineral on it, and what the periodic table's rows need to draw it (#48). */
export type PieceElements = StoneMinerals & {
  name: string;
  kind: StoneKind;
  variety: string | null;
  parts: StonePart[];
  added: string;
  thumbUrl: string | null;
  minerals: Array<PieceMineral & { chainNames: string[] }>; // the main mineral first; each with its name and the names up its chain
};

/**
 * Every stone with every named mineral on it, main first, then with, then on,
 * each with its elements and formula from its own chain. Plain matrix has no
 * mineral and is left out. The stone page's card and the periodic table both
 * read this, so a piece's elements are the same on both.
 */
export function collectionElements(db: DatabaseSync): PieceElements[] {
  const chains = mineralChains(db);
  const parts = partsByStone(db);
  const mineralOn = (name: string, mineralId: number) => {
    const chain = chains.get(mineralId) ?? [];
    return { name, chainNames: [name, ...chain.map((c) => c.name)], elements: elementsOf(chain), formula: formulaOf(chain) };
  };
  const rows = db
    .prepare(
      `SELECT sp.id, sp.mineral_id, m.name, m.kind, sp.variety, sp.created_at,
              (SELECT p.path FROM photos p WHERE p.specimen_id = sp.id ORDER BY ${MAIN_PHOTO_FIRST} LIMIT 1) AS path
         FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id`,
    )
    .all() as Array<{ id: number; mineral_id: number; name: string; kind: StoneKind; variety: string | null; created_at: string; path: string | null }>;
  return rows.map((r) => {
    const own = parts.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      variety: r.variety,
      parts: own.map(partOf),
      createdAt: r.created_at,
      added: shortDay(r.created_at),
      thumbUrl: r.path ? `/media/${thumbPathFor(r.path)}` : null,
      minerals: [mineralOn(r.name, r.mineral_id), ...own.filter((p) => p.mineral_id !== null && p.name !== null).map((p) => mineralOn(p.name!, p.mineral_id!))],
    };
  });
}

/** The class of each stone's own mineral, by `minerals.id`, for the tiles (#38). */
function mineralClasses(db: DatabaseSync): Map<number, string | null> {
  return new Map([...mineralChains(db)].map(([id, chain]) => [id, mineralClassOf(chain)]));
}

/** Every stone as a dashboard tile, its date label worked out in the station's time zone. */
export function collectionTiles(db: DatabaseSync): Tile[] {
  const parts = partsByStone(db);
  const classes = mineralClasses(db);
  const rows = db
    .prepare(
      `SELECT sp.id, sp.mineral_id, m.name, m.kind, sp.variety, mo.name AS made_of, sp.form, sp.found_at, sp.acquired, sp.location, sp.created_at,
              (SELECT p.path FROM photos p WHERE p.specimen_id = sp.id ORDER BY ${MAIN_PHOTO_FIRST} LIMIT 1) AS path
         FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id LEFT JOIN minerals mo ON mo.id = sp.made_of_id`,
    )
    .all() as Array<{
    id: number;
    mineral_id: number;
    name: string;
    kind: StoneKind;
    variety: string | null;
    made_of: string | null;
    form: string | null;
    found_at: string | null;
    acquired: Acquired | null;
    location: string | null;
    created_at: string;
    path: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mineralClass: classes.get(r.mineral_id) ?? null,
    variety: r.variety,
    madeOf: r.made_of,
    form: isForm(r.form) ? r.form : null,
    parts: (parts.get(r.id) ?? []).map(partOf),
    foundAt: r.found_at,
    acquired: r.acquired,
    location: r.location,
    createdAt: r.created_at,
    added: shortDay(r.created_at),
    thumbUrl: r.path ? `/media/${thumbPathFor(r.path)}` : null,
  }));
}

export type StoneView = {
  id: number;
  name: string;
  kind: StoneKind;
  variety: string | null;
  parts: StonePart[]; // the other minerals on it (#29), "with" in order, then "on"
  madeOf: string | null; // what an object that is not a mineral is made of (#62): a minerals row's name
  form: Form | null; // the shape of the piece (#73)
  foundAt: string | null;
  acquired: Acquired | null;
  acquiredOn: string | null;
  location: string | null;
  notes: string | null;
  tests: Answers;
  createdAt: string;
  added: string;
  photos: Array<{ id: number; url: string; thumbUrl: string; takenAt: string | null; main: boolean }>; // the main photo first (#84)
  heroPhotoId: number | null; // the photo chosen as the main one, null while it is simply the newest
  sameMineral: number; // stones of this mineral in the collection, this one included
  namedBy: number | null; // the job whose naming made the stone, for "How it was named"
  morePhotosNamed: number; // later photos named "same stone as the last one"
  places: string[]; // every place a stone lives, most stones first, for the location field
  properties: PropertyCard; // the Mineral properties card, from the mineral's Mindat record (#23)
  whereFound: FoundCard; // "Where it's found", from Mindat's counts on the variety's record or the mineral's (#65)
  elements: ElementsCard; // "What it's made of" (#42)
  mohsSet: MohsCard; // "On your Mohs scale" (#42)
  atShow: AtShow; // "At the show" (#81): the cases, and which this stone is in
};

/**
 * The mineral's Mindat card: its own record (`minerals.mindat_id`, linked by
 * Jasper, #21) and each `varietyof` above it, with the whole record parsed.
 * An unlinked name cached in `mindat_terms` with no record is one Mindat doesn't have.
 */
function readProperties(db: DatabaseSync, name: string, mindatId: number | null): PropertyCard {
  if (mindatId === null) {
    const term = db.prepare("SELECT mindat_id FROM mindat_terms WHERE term = ?").get(fold(name)) as { mindat_id: number | null } | undefined;
    return propertyCard([], term !== undefined && term.mindat_id === null);
  }
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT ?, 1
         UNION
         SELECT r.varietyof, up.depth + 1 FROM up JOIN mindat_records r ON r.id = up.id
          WHERE r.varietyof IS NOT NULL AND up.depth < ?)
       SELECT id, name, entrytype, varietyof, hmin, hmax, streak, detail FROM mindat_records WHERE id IN (SELECT id FROM up)`,
    )
    .all(mindatId, MAX_DEPTH) as Array<Omit<ChainRecord, "detail"> & { varietyof: number | null; detail: string | null }>;
  const byId = new Map(
    rows.map((r) => [r.id, { id: r.id, name: r.name, entrytype: r.entrytype, varietyof: r.varietyof, hmin: r.hmin, hmax: r.hmax, streak: r.streak, detail: parseDetail(r.detail) }]),
  );
  return propertyCard(chainOf(mindatId, byId).map((r) => byId.get(r.id)!), false);
}

/**
 * "Where it's found" (#65): the records the stone could show, most specific
 * first, for `foundCard`. The variety's record is found as Jasper finds it
 * (`_varieties` in jasper/mindat.py): in `mindat_terms`, its name as written,
 * then before its first comma; a term not there yet is one Jasper hasn't asked.
 * Then that record's chain, then the mineral's own.
 */
function readWhereFound(db: DatabaseSync, name: string, mindatId: number | null, variety: string | null): FoundCard {
  const term = db.prepare("SELECT mindat_id FROM mindat_terms WHERE term = ?");
  let varietyId: number | null = null;
  let waiting = false;
  for (const t of variety ? [...new Set([fold(variety), fold(variety.split(",")[0])])].filter(Boolean) : []) {
    const row = term.get(t) as { mindat_id: number | null } | undefined;
    if (row === undefined) waiting = true;
    else if (row.mindat_id !== null) varietyId = row.mindat_id;
    if (row === undefined || row.mindat_id !== null) break;
  }
  const seeds = [varietyId, mindatId].filter((id): id is number => id !== null);
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT value, 1 FROM json_each(?)
         UNION
         SELECT r.varietyof, up.depth + 1 FROM up JOIN mindat_records r ON r.id = up.id
          WHERE r.varietyof IS NOT NULL AND up.depth < ?)
       SELECT id, name, varietyof, hmin, hmax, places FROM mindat_records WHERE id IN (SELECT id FROM up)`,
    )
    .all(JSON.stringify(seeds), MAX_DEPTH) as Array<{ id: number; name: string; varietyof: number | null; hmin: number | null; hmax: number | null; places: string | null }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = [...new Set(seeds.flatMap((id) => chainOf(id, byId).map((r) => r.id)))];
  const miss = mindatId === null && (term.get(fold(name)) as { mindat_id: number | null } | undefined)?.mindat_id === null;
  return foundCard(
    ids.map((id) => ({ id, name: byId.get(id)!.name, places: parsePlaces(byId.get(id)!.places) })),
    // A mineral not linked yet waits too: its chain may be the one with places.
    waiting || (mindatId === null && !miss),
    miss,
  );
}

function parseDetail(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readStone(db: DatabaseSync, id: number): StoneView | null {
  const s = db
    .prepare(
      `SELECT sp.id, sp.mineral_id, m.name, m.kind, m.mindat_id, sp.variety, mo.name AS made_of, sp.form, sp.found_at, sp.acquired, sp.acquired_on,
              sp.location, sp.notes, sp.tests, sp.created_at, sp.hero_photo_id
         FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id LEFT JOIN minerals mo ON mo.id = sp.made_of_id WHERE sp.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        mineral_id: number;
        name: string;
        kind: StoneKind;
        mindat_id: number | null;
        variety: string | null;
        made_of: string | null;
        form: string | null;
        found_at: string | null;
        acquired: Acquired | null;
        acquired_on: string | null;
        location: string | null;
        notes: string | null;
        tests: string;
        created_at: string;
        hero_photo_id: number | null;
      }
    | undefined;
  if (!s) return null;
  const photos = db
    .prepare(`SELECT p.id, p.path, p.taken_at FROM photos p WHERE p.specimen_id = ? ORDER BY ${MAIN_PHOTO_FIRST}`)
    .all(id) as Array<{ id: number; path: string; taken_at: string | null }>;
  const confirmations = db
    .prepare("SELECT job_id FROM confirmations WHERE specimen_id = ? ORDER BY confirmed_at, rowid")
    .all(id) as Array<{ job_id: number }>;
  const same = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE mineral_id = ?").get(s.mineral_id) as { n: number }).n;
  const places = db
    .prepare("SELECT location FROM specimens WHERE location IS NOT NULL GROUP BY lower(location) ORDER BY COUNT(*) DESC, location")
    .all() as Array<{ location: string }>;
  const properties = readProperties(db, s.name, s.mindat_id);
  // Every stone with every mineral on it, for what this one was the first to bring (#42, #48)
  // and, by the main mineral alone, which Mohs slot each fills.
  const pieces = collectionElements(db);
  const names = pieces.map((p) => ({ id: p.id, createdAt: p.createdAt, names: p.minerals[0].chainNames }));
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    variety: s.variety,
    parts: stoneParts(db, s.id),
    madeOf: s.made_of,
    form: isForm(s.form) ? s.form : null,
    foundAt: s.found_at,
    acquired: s.acquired,
    acquiredOn: s.acquired_on,
    location: s.location,
    notes: s.notes,
    tests: cleanAnswers(s.tests),
    createdAt: s.created_at,
    added: shortDay(s.created_at),
    photos: photos.map((p, i) => ({
      id: p.id,
      url: `/media/${p.path}`,
      thumbUrl: `/media/${thumbPathFor(p.path)}`,
      takenAt: p.taken_at,
      main: s.hero_photo_id === null ? i === 0 : p.id === s.hero_photo_id,
    })),
    heroPhotoId: s.hero_photo_id,
    sameMineral: same,
    namedBy: confirmations[0]?.job_id ?? null,
    morePhotosNamed: Math.max(0, confirmations.length - 1),
    places: places.map((p) => p.location),
    properties,
    whereFound: readWhereFound(db, s.name, s.mindat_id, s.variety),
    elements: elementsCard(s.id, pieces),
    mohsSet: mohsCard(s.id, names, properties.mohsRange),
    atShow: stoneCase(db, s.id),
  };
}

// --- Show cases (#81) ------------------------------------------------------------

/** Whether Jasper has run step 8 yet: a web deploy ahead of Jasper's reads as if there were no cases, and the routes answer 503. */
export function hasCases(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'case_stones'").get() !== undefined;
}

/** Every case in its order, each with its stones in reading order, as the planner draws them. */
export function readCases(db: DatabaseSync): ShowCase[] {
  if (!hasCases(db)) return [];
  const cases = db.prepare("SELECT id, name, note FROM cases ORDER BY position, id").all() as Array<{ id: number; name: string; note: string | null }>;
  const parts = partsByStone(db);
  const rows = db
    .prepare(
      `SELECT cs.case_id, sp.id, m.name, m.kind, sp.variety,
              (SELECT p.path FROM photos p WHERE p.specimen_id = sp.id ORDER BY ${MAIN_PHOTO_FIRST} LIMIT 1) AS path
         FROM case_stones cs JOIN specimens sp ON sp.id = cs.specimen_id JOIN minerals m ON m.id = sp.mineral_id
        ORDER BY cs.case_id, cs.position, sp.id`,
    )
    .all() as Array<{ case_id: number; id: number; name: string; kind: StoneKind; variety: string | null; path: string | null }>;
  const stones = new Map<number, ShowCase["stones"]>();
  for (const r of rows)
    stones.set(r.case_id, [
      ...(stones.get(r.case_id) ?? []),
      { id: r.id, name: r.name, kind: r.kind, variety: r.variety, parts: (parts.get(r.id) ?? []).map(partOf), thumbUrl: r.path ? `/media/${thumbPathFor(r.path)}` : null },
    ]);
  return cases.map((c) => ({ id: c.id, name: c.name, note: c.note, stones: stones.get(c.id) ?? [] }));
}

/** One case's stone ids in order, for the route that rewrites them; null when there is no such case. */
export function caseStoneIds(db: DatabaseSync, caseId: number): number[] | null {
  if (!db.prepare("SELECT 1 FROM cases WHERE id = ?").get(caseId)) return null;
  return (db.prepare("SELECT specimen_id FROM case_stones WHERE case_id = ? ORDER BY position, specimen_id").all(caseId) as Array<{ specimen_id: number }>).map(
    (r) => r.specimen_id,
  );
}

/** The stone page's "At the show" (#81): every case by name, and the one this stone is in with its place. */
export function stoneCase(db: DatabaseSync, specimenId: number): AtShow {
  if (!hasCases(db)) return { cases: [], current: null };
  const cases = db.prepare("SELECT id, name FROM cases ORDER BY position, id").all() as Array<{ id: number; name: string }>;
  const row = db
    .prepare(
      `SELECT c.id, c.name,
              (SELECT COUNT(*) FROM case_stones o WHERE o.case_id = c.id AND (o.position < cs.position OR (o.position = cs.position AND o.specimen_id <= cs.specimen_id))) AS position,
              (SELECT COUNT(*) FROM case_stones o WHERE o.case_id = c.id) AS total
         FROM case_stones cs JOIN cases c ON c.id = cs.case_id WHERE cs.specimen_id = ?`,
    )
    .get(specimenId) as { id: number; name: string; position: number; total: number } | undefined;
  return { cases: cases.map((c) => ({ id: c.id, name: c.name })), current: row ? { id: row.id, name: row.name, position: row.position, total: row.total } : null };
}

// --- Writing a stone's minerals (#29) ------------------------------------------

/**
 * The mineral row for a name, made when the household has none yet:
 * `minerals.name` is COLLATE NOCASE, so "galena" finds "Galena". A new one is a
 * mineral unless told otherwise, until Jasper links it to Mindat (jasper.md).
 */
export function mineralId(db: DatabaseSync, name: string, kind: StoneKind = "mineral"): number {
  db.prepare("INSERT INTO minerals (name, kind) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").run(name, kind);
  return (db.prepare("SELECT id FROM minerals WHERE name = ?").get(name) as { id: number }).id;
}

/**
 * Replace a stone's other minerals with `parts`, in order: a part with no name
 * or naming the stone's own mineral is skipped, each mineral is kept once, and
 * plain matrix is stored with no mineral, as a base only. Returns the minerals the stone no
 * longer uses, for `pruneMinerals`. Call inside the caller's transaction.
 */
export function writeParts(db: DatabaseSync, specimenId: number, parts: ReadonlyArray<{ role: PartRole; name: string }>): number[] {
  const before = (db.prepare("SELECT mineral_id FROM specimen_parts WHERE specimen_id = ? AND mineral_id IS NOT NULL").all(specimenId) as Array<{
    mineral_id: number;
  }>).map((r) => r.mineral_id);
  const own = (db.prepare("SELECT mineral_id FROM specimens WHERE id = ?").get(specimenId) as { mineral_id: number }).mineral_id;
  db.prepare("DELETE FROM specimen_parts WHERE specimen_id = ?").run(specimenId);
  const insert = db.prepare("INSERT INTO specimen_parts (specimen_id, position, role, mineral_id) VALUES (?, ?, ?, ?)");
  const used = new Set<number | null>([own]);
  let position = 0;
  for (const p of parts) {
    const name = p.name.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name || (isMatrix(name) && p.role !== "on")) continue;
    const id = isMatrix(name) ? null : mineralId(db, name.charAt(0).toUpperCase() + name.slice(1));
    if (used.has(id)) continue;
    used.add(id);
    insert.run(specimenId, ++position, p.role, id);
  }
  return before.filter((id) => !used.has(id));
}

/**
 * Set what a stone is made of (#62): a `minerals` row for the name, made the way
 * a part's is, so Jasper links it to Mindat; none for an empty name. Never the
 * stone's own mineral. Returns the mineral the stone no longer uses, for
 * `pruneMinerals`. Call inside the caller's transaction.
 */
export function writeMadeOf(db: DatabaseSync, specimenId: number, name: string | null): number[] {
  const before = db.prepare("SELECT mineral_id, made_of_id FROM specimens WHERE id = ?").get(specimenId) as { mineral_id: number; made_of_id: number | null };
  const n = (name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const found = n && !isMatrix(n) ? mineralId(db, n.charAt(0).toUpperCase() + n.slice(1)) : null;
  const madeOf = found === before.mineral_id ? null : found;
  db.prepare("UPDATE specimens SET made_of_id = ? WHERE id = ?").run(madeOf, specimenId);
  return before.made_of_id !== null && before.made_of_id !== madeOf ? [before.made_of_id] : [];
}

/**
 * Delete each of these minerals that no stone uses any more, as its own mineral,
 * on it, or as what it is made of: what a Change, a removed stone or an edited
 * list leaves behind. Returns how many went.
 */
export function pruneMinerals(db: DatabaseSync, ids: number[]): number {
  const del = db.prepare(
    `DELETE FROM minerals WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM specimens WHERE mineral_id = minerals.id)
        AND NOT EXISTS (SELECT 1 FROM specimens WHERE made_of_id = minerals.id)
        AND NOT EXISTS (SELECT 1 FROM specimen_parts WHERE mineral_id = minerals.id)`,
  );
  return [...new Set(ids)].reduce((n, id) => n + Number(del.run(id).changes), 0);
}
