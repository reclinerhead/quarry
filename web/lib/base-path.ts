// The path the app is served under: "" on orchid and in dev, "/quarry" on a
// station, where it shares one origin with the Aviary (#100). Next's basePath
// prefixes <Link>, redirect() and router.push on its own; this constant is
// for the literal URLs it does not touch, the fetch("/api/...") calls and the
// /media/ photo paths. Dot access on purpose: the guide's bracket-access
// convention keeps a value out of the build, and this is the one value that
// must be inlined, because client components read it in the browser.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
