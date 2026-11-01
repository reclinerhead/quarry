"use client";

// Re-encode a phone photo in the browser before upload: at most 1280 px on
// the long side, JPEG at quality 0.9, orientation applied. That is what
// Jasper sends the models anyway, and it turns a 4 MB photo into a 300 KB
// one, which is the difference between working and not working on a weak
// Wi-Fi. If the browser cannot decode the file (HEIC on a desktop browser,
// say), the original is sent and Jasper re-encodes it on the box.

export const LONG_SIDE = 1280;

export type Shrunk = { blob: Blob; mime: string; shrunk: boolean };

export async function shrinkToJpeg(file: File): Promise<Shrunk> {
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
    return { blob: file, mime: file.type || "application/octet-stream", shrunk: false };
  }
}
