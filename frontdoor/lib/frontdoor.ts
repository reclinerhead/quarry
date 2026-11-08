// =============================================================================
// The Quarry -- frontdoor/lib/frontdoor.ts
//
// The pure logic of the Quarry's front door (issue #102): slug validation,
// the redirect target builder and the age phrase for the status page.
// Nothing here touches the network or the store; that is store.ts and the
// route handlers. Covered by frontdoor.test.ts.
//
// Copied from the Aviary's frontdoor/lib/frontdoor.ts and cut down. This
// door only reads: the roster, the token matching and the private-address
// policy are the writer's checks and live in the Aviary, whose check-in is
// what fills the store this door reads.
// =============================================================================

/** A station id: lowercase, hostname-safe, the Aviary's MERLE_STATION_ID contract. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The path the Quarry is served under on a station (Caddyfile.station, #100). */
export const QUARRY_PREFIX = "quarry";

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

/**
 * A canonical dotted quad, and nothing else. Not the Aviary's RFC 1918
 * policy (which range a station may report is the writer's decision); this
 * is the reader's one check on a value it got off the network, so the
 * origin it builds is always a literal IPv4 and never a name a record could
 * smuggle in.
 */
function isIPv4(ip: unknown): ip is string {
  if (typeof ip !== "string") return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const octets = m.slice(1);
  if (octets.some((s) => Number(s) > 255)) return false;
  if (octets.some((s) => s.length > 1 && s.startsWith("0"))) return false;
  return true;
}

/**
 * The redirect target: `http://<ip>/quarry` with no path, the segments
 * joined under it otherwise, the query string carried through. The origin
 * is built from a validated IPv4 and the prefix is fixed, so the result can
 * never leave the station's Quarry: each segment is percent-encoded and
 * joined onto `http://<ip>/quarry/`. Empty segments, dot segments and
 * segments carrying a slash are refused outright, not encoded.
 */
export function buildTarget(ip: string, segments: readonly string[] | undefined, search = ""): string | null {
  if (!isIPv4(ip)) return null;
  const parts = segments ?? [];
  if (parts.length > 16) return null;
  for (const s of parts) {
    if (!s || s === "." || s === ".." || s.includes("/") || s.includes("\\")) return null;
    if (s.length > 200) return null;
  }
  const path = parts.map(encodeURIComponent).join("/");
  const query = search && search.startsWith("?") && search.length > 1 ? search : "";
  return `http://${ip}/${QUARRY_PREFIX}${path ? `/${path}` : ""}${query}`;
}

/** "3 minutes ago" for the status page; the input is an ISO timestamp. */
export function describeAge(seenAtIso: string, now: Date = new Date()): string {
  const seen = Date.parse(seenAtIso);
  if (Number.isNaN(seen)) return "unknown";
  const s = Math.max(0, Math.round((now.getTime() - seen) / 1000));
  if (s < 60) return s === 1 ? "1 second ago" : `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/** The record the Aviary's check-in writes, keyed `station:<id>`. Read here, never written. */
export type StationRecord = {
  ip: string;
  iface: string | null;
  sha: string | null;
  seen_at: string; // ISO, the Aviary front door's clock
};
