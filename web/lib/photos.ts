// Where a photo lives and how it is named. Pure; the routes are thin over this.

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
};

/**
 * File extension for an upload: from its MIME type, else from a .heic or .heif
 * name (a browser that cannot place HEIC sends it untyped); anything else
 * unknown is stored as jpg and Jasper re-encodes.
 */
export function extForUpload(mime: string | null | undefined, name?: string | null): string {
  const byMime = EXT_BY_MIME[(mime ?? "").toLowerCase()];
  if (byMime) return byMime;
  return /\.hei[cf]$/i.test(name ?? "") ? "heic" : "jpg";
}

/** photos/2026/10/<id>.jpg, relative to QUARRY_DATA. Dated by upload, not by EXIF, so a folder is never surprising. */
export function relPathFor(id: string, ext: string, uploadedAt: Date): string {
  const y = uploadedAt.getUTCFullYear();
  const m = String(uploadedAt.getUTCMonth() + 1).padStart(2, "0");
  return `photos/${y}/${m}/${id}.${ext}`;
}

const YEAR = /^\d{4}$/;
const MONTH = /^(0[1-9]|1[0-2])$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SERVABLE = new Set(["jpg", "jpeg", "png", "heic"]);

/**
 * The guard for GET /media/[...path]: exactly the shape the upload route
 * writes, photos/yyyy/mm/<file>, which also covers the <stem>.thumb.jpg Jasper
 * writes beside a photo, and nothing a filesystem could interpret. Returns the
 * relative path or null.
 */
export function mediaRelPath(parts: string[]): string | null {
  if (parts.length !== 4 || parts[0] !== "photos") return null;
  const [, year, month, file] = parts;
  if (!YEAR.test(year) || !MONTH.test(month) || !FILE.test(file) || file.includes("..")) return null;
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return SERVABLE.has(ext) ? parts.join("/") : null;
}

export function contentTypeFor(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}
