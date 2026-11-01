import { describe, expect, it } from "vitest";
import { exifDateToIso, exifTakenAt } from "./exif";

/** A TIFF block: IFD0 holding DateTime and a pointer to an Exif IFD holding DateTimeOriginal. */
function tiffWithDates(opts: { little?: boolean; original?: string; datetime?: string }): Uint8Array {
  const little = opts.little ?? true;
  const ifd0: Array<[number, number, number, number | string]> = []; // tag, type, count, value|string
  const exif: Array<[number, number, number, number | string]> = [];
  if (opts.datetime) ifd0.push([0x0132, 2, opts.datetime.length + 1, opts.datetime]);
  if (opts.original) exif.push([0x9003, 2, opts.original.length + 1, opts.original]);

  // Layout: TIFF header (8) | IFD0 | Exif IFD | string data
  const ifd0Size = 2 + (ifd0.length + (exif.length ? 1 : 0)) * 12 + 4;
  const exifSize = exif.length ? 2 + exif.length * 12 + 4 : 0;
  const ifd0At = 8;
  const exifAt = ifd0At + ifd0Size;
  let dataAt = exifAt + exifSize;
  const dataChunks: Array<{ at: number; s: string }> = [];
  const place = (s: string) => {
    const at = dataAt;
    dataChunks.push({ at, s });
    dataAt += s.length + 1;
    return at;
  };
  const stringBytes = [...ifd0, ...exif].reduce((n, [, , , value]) => n + (typeof value === "string" ? value.length + 1 : 0), 0);
  const tiffLen = dataAt + stringBytes;
  const tiff = new Uint8Array(tiffLen);
  const dv = new DataView(tiff.buffer);
  dv.setUint16(0, little ? 0x4949 : 0x4d4d);
  dv.setUint16(2, 0x2a, little);
  dv.setUint32(4, ifd0At, little);

  const writeIfd = (at: number, entries: Array<[number, number, number, number | string]>) => {
    dv.setUint16(at, entries.length, little);
    entries.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + i * 12;
      dv.setUint16(e, tag, little);
      dv.setUint16(e + 2, type, little);
      dv.setUint32(e + 4, count, little);
      if (typeof value === "string") dv.setUint32(e + 8, place(value), little);
      else dv.setUint32(e + 8, value, little);
    });
    dv.setUint32(at + 2 + entries.length * 12, 0, little);
  };
  const ifd0Entries = [...ifd0];
  if (exif.length) ifd0Entries.push([0x8769, 4, 1, exifAt]);
  writeIfd(ifd0At, ifd0Entries);
  if (exif.length) writeIfd(exifAt, exif);
  for (const { at, s } of dataChunks) {
    for (let i = 0; i < s.length; i++) tiff[at + i] = s.charCodeAt(i);
    tiff[at + s.length] = 0;
  }
  return tiff;
}

/** A JPEG with one APP1 EXIF segment around the TIFF block. */
function jpegWith(tiff: Uint8Array): ArrayBuffer {
  const app1Body = new Uint8Array(6 + tiff.length);
  app1Body.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0); // "Exif\0\0"
  app1Body.set(tiff, 6);
  const segLen = app1Body.length + 2;
  const out = new Uint8Array(2 + 2 + 2 + app1Body.length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, segLen >> 8, segLen & 0xff], 0);
  out.set(app1Body, 6);
  out.set([0xff, 0xd9], 6 + app1Body.length);
  return out.buffer;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const box = (type: string, payload: number[]) => [...u32(8 + payload.length), ...ascii(type), ...payload];
const fullBox = (type: string, version: number, payload: number[]) => box(type, [version, 0, 0, 0, ...payload]);

/**
 * A HEIC the way an iPhone lays one out: ftyp, then meta (iinf naming item 2
 * as Exif beside an image item, iloc pointing at its bytes), then mdat holding
 * the image's stand-in bytes and the Exif item. ilocVersion 1 adds the
 * construction method and an index size, as some encoders write.
 */
function heicWith(tiff: Uint8Array | null, ilocVersion = 0): ArrayBuffer {
  const ftyp = box("ftyp", [...ascii("heic"), ...u32(0), ...ascii("mif1heic")]);
  const exifItem = tiff ? [...u32(6), ...ascii("Exif"), 0, 0, ...tiff] : [];
  const image = [1, 2, 3, 4, 5, 6, 7, 8];
  const items = tiff
    ? [
        fullBox("infe", 2, [...u16(1), ...u16(0), ...ascii("hvc1"), 0]),
        fullBox("infe", 2, [...u16(2), ...u16(0), ...ascii("Exif"), 0]),
      ]
    : [fullBox("infe", 2, [...u16(1), ...u16(0), ...ascii("hvc1"), 0])];
  const iinf = fullBox("iinf", 0, [...u16(items.length), ...items.flat()]);
  // The iloc's size is known before its offsets are: 4 + 2 + 2 + per item (2 + [2] + 2 + 2 + 4 + 4).
  const perItem = ilocVersion === 0 ? 14 : 16;
  const ilocLen = 8 + 4 + 2 + 2 + perItem * (tiff ? 2 : 1);
  const metaLen = 8 + 4 + iinf.length + ilocLen;
  const mdatStart = ftyp.length + metaLen + 8;
  const entry = (id: number, offset: number, length: number) => [
    ...u16(id),
    ...(ilocVersion === 0 ? [] : u16(0)), // construction method 0: file offset
    ...u16(0),
    ...u16(1),
    ...u32(offset),
    ...u32(length),
  ];
  const entries = [entry(1, mdatStart, image.length), ...(tiff ? [entry(2, mdatStart + image.length, exifItem.length)] : [])];
  const iloc = fullBox("iloc", ilocVersion, [0x44, 0x00, ...u16(entries.length), ...entries.flat()]);
  const meta = fullBox("meta", 0, [...iinf, ...iloc]);
  const mdat = box("mdat", [...image, ...exifItem]);
  return new Uint8Array([...ftyp, ...meta, ...mdat]).buffer;
}

describe("exifDateToIso", () => {
  it("converts the EXIF shape and rejects the unset one", () => {
    expect(exifDateToIso("2026:10:31 15:10:47")).toBe("2026-10-31T15:10:47");
    expect(exifDateToIso("0000:00:00 00:00:00")).toBeNull();
    expect(exifDateToIso("yesterday")).toBeNull();
  });
});

describe("exifTakenAt from a JPEG", () => {
  it("reads DateTimeOriginal from the Exif IFD, little-endian", () => {
    expect(exifTakenAt(jpegWith(tiffWithDates({ original: "2026:10:31 15:10:47", datetime: "2026:11:01 09:00:00" })))).toBe(
      "2026-10-31T15:10:47",
    );
  });
  it("reads big-endian too", () => {
    expect(exifTakenAt(jpegWith(tiffWithDates({ little: false, original: "2025:06:01 08:30:00" })))).toBe("2025-06-01T08:30:00");
  });
  it("falls back to IFD0 DateTime when there is no original", () => {
    expect(exifTakenAt(jpegWith(tiffWithDates({ datetime: "2026:11:01 09:00:00" })))).toBe("2026-11-01T09:00:00");
  });
  it("returns null for a JPEG without EXIF, a PNG, and garbage", () => {
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]).buffer)).toBeNull();
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(exifTakenAt(new Uint8Array([1, 2]).buffer)).toBeNull();
  });
  it("returns null, not a throw, when a segment claims more bytes than there are", () => {
    const cut = jpegWith(tiffWithDates({ original: "2026:10:31 15:10:47" })).slice(0, 30);
    expect(exifTakenAt(cut)).toBeNull();
  });
});

describe("exifTakenAt from a HEIC", () => {
  it("finds the Exif item through iinf and iloc and reads DateTimeOriginal", () => {
    expect(exifTakenAt(heicWith(tiffWithDates({ little: false, original: "2026:10:31 13:53:31" })))).toBe("2026-10-31T13:53:31");
  });
  it("reads an iloc that carries construction methods", () => {
    expect(exifTakenAt(heicWith(tiffWithDates({ original: "2026:10:31 13:56:49" }), 1))).toBe("2026-10-31T13:56:49");
  });
  it("returns null for a HEIC with no Exif item, and for one cut short", () => {
    expect(exifTakenAt(heicWith(null))).toBeNull();
    const whole = heicWith(tiffWithDates({ original: "2026:10:31 13:53:31" }));
    expect(exifTakenAt(whole.slice(0, whole.byteLength - 20))).toBeNull();
  });
});
