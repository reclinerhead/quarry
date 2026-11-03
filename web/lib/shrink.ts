"use client";

// Re-encode a phone photo in the browser before upload: at most 1280 px on
// the long side, JPEG at quality 0.9, orientation applied. That is what
// Jasper sends the models anyway, and it turns a 4 MB photo into a 300 KB
// one, which is the difference between working and not working on a weak
// Wi-Fi. A HEIC the browser cannot decode (most desktop browsers) is decoded
// in the page first, by libheif compiled to WebAssembly, which only a browser
// that needs it ever downloads. If that fails too, the original is sent and
// Jasper re-encodes it on the box.

export const LONG_SIDE = 1280;

export type Shrunk = { blob: Blob; mime: string; shrunk: boolean };

export async function shrinkToJpeg(file: File): Promise<Shrunk> {
  const drawn = await drawToJpeg(file);
  if (drawn) return drawn;
  const jpeg = await decodeHeic(file);
  const drawnAgain = jpeg && (await drawToJpeg(jpeg));
  return drawnAgain || { blob: file, mime: file.type || "application/octet-stream", shrunk: false };
}

/**
 * A HEIC decoded to a JPEG File in the page, or null when the file is not a
 * HEIC by name or type, libheif cannot read it, or the decoder (3 MB, loaded
 * on first use and cached) could not be fetched. Never throws. The JPEG has
 * no EXIF: read the date from the original first.
 */
export async function decodeHeic(file: File): Promise<File | null> {
  if (!/\.hei[cf]$/i.test(file.name) && !/^image\/hei[cf]$/i.test(file.type)) return null;
  try {
    const { heicTo } = await import("heic-to");
    const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
    const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return null;
  }
}

async function drawToJpeg(file: File): Promise<Shrunk | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("toBlob failed");
      return { blob, mime: "image/jpeg", shrunk: true };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
