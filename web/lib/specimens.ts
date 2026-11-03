// Reading stones for the dashboard and a stone's own page, and writing the
// minerals a stone is made of (#29). Server only. Rows from node:sqlite have a
// null prototype, so everything that crosses to a client component is built
// here as a plain object.

import type { DatabaseSync } from "node:sqlite";
import { shortDay, type Acquired, type Tile } from "./collection";
import { cleanAnswers, type Answers } from "./household-tests";
import { fold, propertyCard, type ChainRecord, type PropertyCard } from "./mindat";
import { chainOf, MAX_DEPTH } from "./names";
import { thumbPathFor } from "./photos";
import { isMatrix, MATRIX, type PartRole, type StoneKind } from "./pills";

/** The newest photo first: by when it was taken, else when it was uploaded, then id. */
const NEWEST_PHOTO = "COALESCE(p.taken_at, p.uploaded_at) DESC, p.id DESC";

/** A stone's other minerals as the screens show them: a base of plain matrix is named "matrix". */
export type StonePart = { role: PartRole; name: string };

const PARTS = `SELECT sp.specimen_id, sp.role, m.name FROM specimen_parts sp LEFT JOIN minerals m ON m.id = sp.mineral_id`;

type PartRow = { specimen_id: number; role: PartRole; name: string | null };

const partOf = (r: PartRow): StonePart => ({ role: r.role, name: r.name ?? MATRIX });

/** One stone's other minerals, in order. */
export function stoneParts(db: DatabaseSync, specimenId: number): StonePart[] {
  return (db.prepare(`${PARTS} WHERE sp.specimen_id = ? ORDER BY sp.position`).all(specimenId) as PartRow[]).map(partOf);
}

/** Every stone as a dashboard tile, its date label worked out in the station's time zone. */
export function collectionTiles(db: DatabaseSync): Tile[] {
  const parts = new Map<number, StonePart[]>();
  for (const r of db.prepare(`${PARTS} ORDER BY sp.specimen_id, sp.position`).all() as PartRow[])
    parts.set(r.specimen_id, [...(parts.get(r.specimen_id) ?? []), partOf(r)]);
  const rows = db
    .prepare(
      `SELECT sp.id, m.name, m.kind, sp.variety, sp.found_at, sp.acquired, sp.location, sp.created_at,
              (SELECT p.path FROM photos p WHERE p.specimen_id = sp.id ORDER BY ${NEWEST_PHOTO} LIMIT 1) AS path
         FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id`,
    )
    .all() as Array<{
    id: number;
    name: string;
    kind: StoneKind;
    variety: string | null;
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
    variety: r.variety,
    parts: parts.get(r.id) ?? [],
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
  foundAt: string | null;
  acquired: Acquired | null;
  acquiredOn: string | null;
  location: string | null;
  notes: string | null;
  tests: Answers;
  createdAt: string;
  added: string;
  photos: Array<{ id: number; url: string; thumbUrl: string; takenAt: string | null }>;
  sameMineral: number; // stones of this mineral in the collection, this one included
  namedBy: number | null; // the job whose naming made the stone, for "How it was named"
  morePhotosNamed: number; // later photos named "same stone as the last one"
  places: string[]; // every place a stone lives, most stones first, for the location field
  properties: PropertyCard; // the Mineral properties card, from the mineral's Mindat record (#23)
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
      `SELECT sp.id, sp.mineral_id, m.name, m.kind, m.mindat_id, sp.variety, sp.found_at, sp.acquired, sp.acquired_on,
              sp.location, sp.notes, sp.tests, sp.created_at
         FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id WHERE sp.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        mineral_id: number;
        name: string;
        kind: StoneKind;
        mindat_id: number | null;
        variety: string | null;
        found_at: string | null;
        acquired: Acquired | null;
        acquired_on: string | null;
        location: string | null;
        notes: string | null;
        tests: string;
        created_at: string;
      }
    | undefined;
  if (!s) return null;
  const photos = db
    .prepare(`SELECT p.id, p.path, p.taken_at FROM photos p WHERE p.specimen_id = ? ORDER BY ${NEWEST_PHOTO}`)
    .all(id) as Array<{ id: number; path: string; taken_at: string | null }>;
  const confirmations = db
    .prepare("SELECT job_id FROM confirmations WHERE specimen_id = ? ORDER BY confirmed_at, rowid")
    .all(id) as Array<{ job_id: number }>;
  const same = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE mineral_id = ?").get(s.mineral_id) as { n: number }).n;
  const places = db
    .prepare("SELECT location FROM specimens WHERE location IS NOT NULL GROUP BY lower(location) ORDER BY COUNT(*) DESC, location")
    .all() as Array<{ location: string }>;
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    variety: s.variety,
    parts: stoneParts(db, s.id),
    foundAt: s.found_at,
    acquired: s.acquired,
    acquiredOn: s.acquired_on,
    location: s.location,
    notes: s.notes,
    tests: cleanAnswers(s.tests),
    createdAt: s.created_at,
    added: shortDay(s.created_at),
    photos: photos.map((p) => ({ id: p.id, url: `/media/${p.path}`, thumbUrl: `/media/${thumbPathFor(p.path)}`, takenAt: p.taken_at })),
    sameMineral: same,
    namedBy: confirmations[0]?.job_id ?? null,
    morePhotosNamed: Math.max(0, confirmations.length - 1),
    places: places.map((p) => p.location),
    properties: readProperties(db, s.name, s.mindat_id),
  };
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
 * Delete each of these minerals that no stone uses any more, as its own mineral
 * or on it: what a Change, a removed stone or an edited list leaves behind.
 * Returns how many went.
 */
export function pruneMinerals(db: DatabaseSync, ids: number[]): number {
  const del = db.prepare(
    `DELETE FROM minerals WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM specimens WHERE mineral_id = minerals.id)
        AND NOT EXISTS (SELECT 1 FROM specimen_parts WHERE mineral_id = minerals.id)`,
  );
  return [...new Set(ids)].reduce((n, id) => n + Number(del.run(id).changes), 0);
}
