// Writing an uploaded photo to the data directory, and reading the form it
// came in. Server only; used by POST /api/photos.

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db";
import { extForUpload, relPathFor } from "./photos";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_NOTES = 1000;

export type UploadCheck = { ok: true; file: File } | { ok: false; status: number; error: string };

export function checkUpload(form: FormData): UploadCheck {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, status: 400, error: "no file" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, error: "file too large" };
  if (!file.type.startsWith("image/") && file.type !== "application/octet-stream")
    return { ok: false, status: 415, error: "not an image" };
  return { ok: true, file };
}

/** Write the file under photos/yyyy/mm/<uuid>.<ext>; returns the relative path. */
export async function storeUpload(file: File, now = new Date()): Promise<string> {
  const rel = relPathFor(crypto.randomUUID(), extForUpload(file.type, file.name), now);
  const abs = path.join(dataDir(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, new Uint8Array(await file.arrayBuffer()));
  return rel;
}

/** Remove a file storeUpload wrote whose rows never made it in; missing is fine. */
export async function discardUpload(rel: string): Promise<void> {
  try {
    await unlink(path.join(dataDir(), rel));
  } catch {
    /* already gone */
  }
}

export function takenAtFrom(form: FormData): string | null {
  const raw = form.get("takenAt");
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw) ? raw : null;
}

/** The batch's "Anything you know about these?", trimmed; null when left empty. */
export function notesFrom(form: FormData): string | null {
  const raw = form.get("notes");
  const notes = typeof raw === "string" ? raw.trim().slice(0, MAX_NOTES) : "";
  return notes || null;
}
