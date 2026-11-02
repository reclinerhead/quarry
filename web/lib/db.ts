import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The Quarry's database is created and migrated by Jasper (jasper/db.py); the
// web app opens it, read-only for pages and read-write for the routes that
// record a person's actions. Bracket access on purpose: Next inlines a static
// `process.env.FOO` at build time, and these must be read at runtime on the
// box. Resolved at call time against the working directory, with the tracer
// told to look away where the path is built and where it is checked:
// otherwise Turbopack's file tracing follows the relative default and pulls
// all of web/ into every route that opens the database.
function dbPath(): string {
  const configured = process.env["QUARRY_DB"] ?? "../data/quarry.db";
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** The directory photos live under (QUARRY_DATA), absolute. */
export function dataDir(): string {
  const configured = process.env["QUARRY_DATA"] ?? "../data";
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

/** Open the database read-only, or null when Jasper has not created it yet. */
export function openReadOnly(): DatabaseSync | null {
  const file = dbPath();
  if (!existsSync(/* turbopackIgnore: true */ file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

/** Open the database for writing. Throws when Jasper has not created it yet. */
export function openReadWrite(): DatabaseSync {
  const file = dbPath();
  if (!existsSync(/* turbopackIgnore: true */ file)) throw new Error(`database not found at ${file}; is Jasper running?`);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000"); // Jasper writes to this file too
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
