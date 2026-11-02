// Reading stones for the dashboard and a stone's own page. Server only. Rows
// from node:sqlite have a null prototype, so everything that crosses to a
// client component is built here as a plain object.

import type { DatabaseSync } from "node:sqlite";
import { shortDay, type Acquired, type Tile } from "./collection";
import { cleanAnswers, type Answers } from "./household-tests";
import { thumbPathFor } from "./photos";
import type { StoneKind } from "./pills";

/** The newest photo first: by when it was taken, else when it was uploaded, then id. */
const NEWEST_PHOTO = "COALESCE(p.taken_at, p.uploaded_at) DESC, p.id DESC";

/** Every stone as a dashboard tile, its date label worked out in the station's time zone. */
export function collectionTiles(db: DatabaseSync): Tile[] {
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
  associates: string | null;
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
};

export function readStone(db: DatabaseSync, id: number): StoneView | null {
  const s = db
    .prepare(
      `SELECT sp.id, sp.mineral_id, m.name, m.kind, sp.variety, sp.associates, sp.found_at, sp.acquired, sp.acquired_on,
              sp.location, sp.notes, sp.tests, sp.created_at
         FROM specimens sp JOIN minerals m ON m.id = sp.mineral_id WHERE sp.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        mineral_id: number;
        name: string;
        kind: StoneKind;
        variety: string | null;
        associates: string | null;
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
    associates: s.associates,
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
  };
}
