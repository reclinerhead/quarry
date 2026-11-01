// GET /media/photos/<yyyy>/<mm>/<file>: a photo, or the thumbnail Jasper
// writes beside it, from QUARRY_DATA. The path guard (mediaRelPath) accepts
// exactly the shape the upload route writes and nothing a filesystem could
// interpret. Photo names are UUIDs written once, so the browser may cache
// them for a year.

import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { contentTypeFor, mediaRelPath } from "@/lib/photos";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const rel = mediaRelPath(parts ?? []);
  if (!rel) return new Response(null, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(dataDir(), rel));
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentTypeFor(rel),
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
