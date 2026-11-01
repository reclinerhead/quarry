// The one EXIF field the Quarry wants from a phone photo: when it was taken.
// The browser re-encodes photos before upload and the re-encode drops EXIF,
// so the date is read here, client-side, from the original bytes. Two
// containers: a JPEG's APP1 segment, and a HEIC's Exif item (an iPhone shoots
// HEIC, and Safari hands the original over). No library, nothing else parsed.

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME = 0x0132;

/** "2026:10:31 15:10:47" (EXIF) -> "2026-10-31T15:10:47" (ISO, local time, no zone). */
export function exifDateToIso(s: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  if (y === "0000" || mo === "00" || d === "00") return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
}

/** DateTimeOriginal from a JPEG's or HEIC's EXIF, as ISO, or null when absent or unreadable. */
export function exifTakenAt(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  try {
    if (v.byteLength >= 4 && v.getUint16(0) === 0xffd8) return jpegTakenAt(v);
    if (v.byteLength >= 12 && readAscii(v, 4, 4) === "ftyp") return heifTakenAt(v);
  } catch {
    /* a length that points past the end: unreadable, and never worth failing an upload over */
  }
  return null;
}

function jpegTakenAt(v: DataView): string | null {
  let off = 2;
  while (off + 4 <= v.byteLength) {
    if (v.getUint8(off) !== 0xff) return null;
    const marker = v.getUint8(off + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // image data; no EXIF after this
    const len = v.getUint16(off + 2);
    if (marker === 0xe1 && off + 10 <= v.byteLength && readAscii(v, off + 4, 4) === "Exif") {
      return readTiff(v, off + 10, off + 2 + len);
    }
    off += 2 + len;
  }
  return null;
}

// HEIC (ISO base media): the meta box lists items in iinf and says where each
// one's bytes are in iloc. The Exif item's bytes start with the distance from
// their fifth byte to the TIFF header (past an "Exif\0\0" prefix).
function heifTakenAt(v: DataView): string | null {
  const meta = child(v, 0, v.byteLength, "meta");
  if (!meta) return null;
  const inner = meta.start + 4; // a full box: version and flags first
  const iinf = child(v, inner, meta.end, "iinf");
  const iloc = child(v, inner, meta.end, "iloc");
  if (!iinf || !iloc) return null;
  const id = exifItemId(v, iinf);
  if (id === null) return null;
  const item = itemExtent(v, iloc, id);
  if (!item || item.offset + 4 > v.byteLength) return null;
  return readTiff(v, item.offset + 4 + v.getUint32(item.offset), item.offset + item.length);
}

type Box = { type: string; start: number; end: number }; // start: the payload, after the header

function* boxes(v: DataView, from: number, to: number): Generator<Box> {
  let off = from;
  while (off + 8 <= to) {
    let size = v.getUint32(off);
    let header = 8;
    if (size === 1) {
      size = v.getUint32(off + 8) * 2 ** 32 + v.getUint32(off + 12);
      header = 16;
    } else if (size === 0) size = to - off; // runs to the end
    if (size < header || off + size > to) return;
    yield { type: readAscii(v, off + 4, 4), start: off + header, end: off + size };
    off += size;
  }
}

function child(v: DataView, from: number, to: number, type: string): Box | null {
  for (const b of boxes(v, from, to)) if (b.type === type) return b;
  return null;
}

function exifItemId(v: DataView, iinf: Box): number | null {
  const entries = iinf.start + 4 + (v.getUint8(iinf.start) === 0 ? 2 : 4);
  for (const infe of boxes(v, entries, iinf.end)) {
    const version = infe.type === "infe" ? v.getUint8(infe.start) : 0;
    if (version < 2) continue; // versions 0 and 1 carry no item type
    const idSize = version === 2 ? 2 : 4;
    if (readAscii(v, infe.start + 4 + idSize + 2, 4) === "Exif") return uint(v, infe.start + 4, idSize);
  }
  return null;
}

/** Where an item's bytes are: its first extent, when it is stored by file offset. */
function itemExtent(v: DataView, iloc: Box, id: number): { offset: number; length: number } | null {
  const version = v.getUint8(iloc.start);
  let off = iloc.start + 4;
  const read = (n: number) => {
    const x = uint(v, off, n);
    off += n;
    return x;
  };
  const sizes = read(1);
  const more = read(1);
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0xf;
  const baseSize = more >> 4;
  const indexSize = version > 0 ? more & 0xf : 0;
  const count = read(version < 2 ? 2 : 4);
  for (let i = 0; i < count; i++) {
    const itemId = read(version < 2 ? 2 : 4);
    const method = version > 0 ? read(2) & 0xf : 0;
    read(2); // data reference index
    const base = read(baseSize);
    const extents = read(2);
    let first: { offset: number; length: number } | null = null;
    for (let e = 0; e < extents; e++) {
      read(indexSize);
      const offset = read(offsetSize);
      const length = read(lengthSize);
      first ??= { offset: base + offset, length };
    }
    if (itemId === id) return method === 0 ? first : null;
  }
  return null;
}

function uint(v: DataView, at: number, n: number): number {
  switch (n) {
    case 0:
      return 0;
    case 1:
      return v.getUint8(at);
    case 2:
      return v.getUint16(at);
    case 4:
      return v.getUint32(at);
    case 8:
      return v.getUint32(at) * 2 ** 32 + v.getUint32(at + 4);
    default:
      throw new RangeError(`no ${n}-byte field in iloc`);
  }
}

function readAscii(v: DataView, at: number, n: number): string {
  let s = "";
  for (let i = 0; i < n && at + i < v.byteLength; i++) {
    const c = v.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function readTiff(v: DataView, tiff: number, end: number): string | null {
  if (tiff + 8 > end) return null;
  const order = v.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  const u16 = (at: number) => v.getUint16(at, little);
  const u32 = (at: number) => v.getUint32(at, little);
  if (u16(tiff + 2) !== 0x2a) return null;
  const ifd0 = tiff + u32(tiff + 4);

  const readIfd = (at: number): Map<number, { type: number; count: number; valueAt: number }> => {
    const entries = new Map<number, { type: number; count: number; valueAt: number }>();
    if (at + 2 > end) return entries;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > end) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = typeSize(type) * count;
      const valueAt = size > 4 ? tiff + u32(e + 8) : e + 8;
      entries.set(tag, { type, count, valueAt });
    }
    return entries;
  };

  const ascii = (f: { type: number; count: number; valueAt: number } | undefined): string | null => {
    if (!f || f.type !== 2 || f.valueAt + f.count > end) return null;
    return readAscii(v, f.valueAt, f.count);
  };

  const main = readIfd(ifd0);
  const exifPtr = main.get(TAG_EXIF_IFD);
  if (exifPtr && (exifPtr.type === 4 || exifPtr.type === 3)) {
    const sub = readIfd(tiff + u32(exifPtr.valueAt));
    const dto = ascii(sub.get(TAG_DATETIME_ORIGINAL));
    const iso = dto && exifDateToIso(dto);
    if (iso) return iso;
  }
  const dt = ascii(main.get(TAG_DATETIME));
  return dt ? exifDateToIso(dt) : null;
}

function typeSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 1;
  }
}
