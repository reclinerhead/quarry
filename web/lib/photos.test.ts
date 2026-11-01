import { describe, expect, it } from "vitest";
import { contentTypeFor, extForUpload, mediaRelPath, relPathFor } from "./photos";

describe("relPathFor", () => {
  it("files by upload year and month in UTC", () => {
    expect(relPathFor("abc", "jpg", new Date("2026-10-31T23:30:00Z"))).toBe("photos/2026/10/abc.jpg");
    expect(relPathFor("abc", "heic", new Date("2026-01-05T00:00:00Z"))).toBe("photos/2026/01/abc.heic");
  });
});

describe("extForUpload", () => {
  it("maps known types and falls back to jpg", () => {
    expect(extForUpload("image/jpeg")).toBe("jpg");
    expect(extForUpload("image/png")).toBe("png");
    expect(extForUpload("image/HEIC")).toBe("heic");
    expect(extForUpload("image/heif")).toBe("heic");
    expect(extForUpload("application/octet-stream")).toBe("jpg");
    expect(extForUpload(null)).toBe("jpg");
  });
  it("keeps an untyped HEIC a heic by its name", () => {
    expect(extForUpload("application/octet-stream", "IMG_4021.HEIC")).toBe("heic");
    expect(extForUpload("", "20261031_175642767_iOS.heif")).toBe("heic");
    expect(extForUpload("application/octet-stream", "photo.heic.txt")).toBe("jpg");
  });
  it("trusts the type over the name, as a shrunk HEIC is a JPEG", () => {
    expect(extForUpload("image/jpeg", "IMG_4021.HEIC")).toBe("jpg");
  });
});

describe("mediaRelPath", () => {
  it("accepts exactly the shape relPathFor writes, and Jasper's thumbnail beside it", () => {
    const rel = relPathFor("0b6f7c1e-2a1d-4c55-9a4e-3f1d2b7c8e90", "jpg", new Date("2026-10-31T12:00:00Z"));
    expect(mediaRelPath(rel.split("/"))).toBe(rel);
    expect(mediaRelPath(["photos", "2026", "10", "abc.thumb.jpg"])).toBe("photos/2026/10/abc.thumb.jpg");
    expect(mediaRelPath(["photos", "2026", "01", "abc.heic"])).toBe("photos/2026/01/abc.heic");
  });
  it("refuses anything else", () => {
    expect(mediaRelPath([])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["clips", "2026", "10", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "..", "10", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "..", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "..jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "a..b.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", ".abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "abc.exe"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "abc"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "a b.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "a/b.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "10", "a\\b.jpg"])).toBeNull();
  });
  it("wants a four-digit year and a real month, as relPathFor writes them", () => {
    expect(mediaRelPath(["photos", "26", "10", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "1", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "13", "abc.jpg"])).toBeNull();
    expect(mediaRelPath(["photos", "2026", "00", "abc.jpg"])).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("knows the three servable types", () => {
    expect(contentTypeFor("photos/2026/10/a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("photos/2026/10/a.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("photos/2026/10/a.png")).toBe("image/png");
    expect(contentTypeFor("photos/2026/10/a.heic")).toBe("image/heic");
  });
});
