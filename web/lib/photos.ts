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

/** photos/2026/10/abc.heic -> photos/2026/10/abc.thumb.jpg: the 320 px thumbnail Jasper writes beside every photo it looks at. */
export function thumbPathFor(rel: string): string {
  const slash = rel.lastIndexOf("/");
  const dot = rel.lastIndexOf(".");
  return `${dot > slash ? rel.slice(0, dot) : rel}.thumb.jpg`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The caption on a photo: "Taken Oct 31, 2026" from its EXIF date, read from
 * the text itself so the server and the phone agree whatever their time
 * zones; "Your photo" when the photo carried no date.
 */
export function takenLabel(takenAt: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `Taken ${month} ${Number(m[3])}, ${m[1]}` : "Your photo";
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
