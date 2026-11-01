import Link from "next/link";
import { Collection } from "@/components/collection";
import { CameraIcon, CrystalIcon } from "@/components/icons";
import { addedToday, glance, places, sortTiles, type Tile } from "@/lib/collection";
import { dateLine, greeting } from "@/lib/greeting";
import { waitingStrip, withReadDb } from "@/lib/jobs";
import { stoneName, stripLine } from "@/lib/pills";
import { collectionTiles } from "@/lib/specimens";

// The dashboard from design/DESIGN.md §5, Phase 1 subset (#9): the greeting
// that says what changed, the pending strip (#8), then two columns: Your
// collection (components/collection.tsx) and the side column with Newest
// additions, At a glance and Where they live. While there are no stones, the
// collection is one empty card in the specimen card's shape. The hardness
// filter, the Mohs set and what new stones add to the periodic table wait for
// Mindat in Phase 2. Everything comes from the database on every request,
// never from the build.
export const dynamic = "force-dynamic";

// Faint cards beside the empty one, so a wide screen shows the grid it will
// fill. Each appears only where the grid has a column for it.
const PLACEHOLDERS = [
  { tint: "bg-tile-violet", shown: "sm:flex" },
  { tint: "bg-tile-brass", shown: "lg:flex" },
  { tint: "bg-tile-rust", shown: "xl:flex" },
];

export default function Home() {
  const now = new Date();
  const { tiles, strip } = withReadDb((db) => ({ tiles: collectionTiles(db), strip: waitingStrip(db) }), {
    tiles: [] as Tile[],
    strip: { count: 0, thumbs: [], first: null },
  });
  const today = addedToday(
    tiles.map((t) => t.createdAt),
    now,
  );

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-8 sm:px-10 sm:pb-[72px] sm:pt-10">
      <section aria-labelledby="hello" className="flex flex-col gap-1.5">
        <p className="font-bold text-ink-2">{dateLine(now)}</p>
        <h1 id="hello" className="text-[36px] leading-tight sm:text-h1 sm:leading-[1.1]">
          {greeting(now, tiles.length, today)}
        </h1>
        <p className="text-lead text-ink-2">Photograph a stone and Jasper will suggest what it is. You decide what it&rsquo;s called.</p>
      </section>

      {/* The pending strip (DESIGN.md §4): amber means "needs you". Drawn only
          when something waits, on the server, so it never pops in. */}
      {strip.count > 0 ? (
        <section aria-labelledby="waiting-h" className="flex flex-wrap items-center gap-x-7 gap-y-5 rounded-card border border-warn-line bg-warn px-5 py-5 sm:px-7 sm:py-[22px]">
          <div className="flex">
            {strip.thumbs.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail
              <img key={src} src={src} alt="" className={`size-[72px] rounded-tile border-[3px] border-surface bg-tile-stone object-cover ${i > 0 ? "-ml-[18px]" : ""}`} />
            ))}
          </div>
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1">
            <h2 id="waiting-h" className="text-[26px] leading-tight">
              {strip.count} {strip.count === 1 ? "rock" : "rocks"} waiting for a name
            </h2>
            {strip.first ? (
              <p className="text-warn-ink">{stripLine(strip.first.plan, strip.first.status === "failed", strip.first.suggestedTests[0]?.kind)}</p>
            ) : null}
          </div>
          <Link href="/name" className="btn btn-primary btn-lg">
            {strip.count === 1 ? "Name it" : "Name them"}
          </Link>
        </section>
      ) : null}

      {tiles.length === 0 ? <EmptyCollection /> : (
        <div className="flex flex-wrap items-start gap-8">
          <div className="min-w-0 flex-[999_1_600px]">
            <Collection tiles={tiles} />
          </div>
          <SideColumn tiles={tiles} />
        </div>
      )}
    </main>
  );
}

function EmptyCollection() {
  return (
    <section aria-labelledby="collection-h" className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-0.5">
        <h2 id="collection-h" className="text-h2 leading-tight">
          Your collection
        </h2>
        <p className="text-[17px] text-ink-2">No stones yet</p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-grid">
        <li className="card flex flex-col overflow-hidden">
          <div className="flex h-[220px] items-center justify-center bg-tile-clear">
            <CrystalIcon className="size-14 text-icon-muted" />
          </div>
          <div className="flex flex-1 flex-col gap-1 px-5 pb-5 pt-[18px]">
            <p className="font-display text-h3 font-semibold leading-tight">No stones yet</p>
            <p className="text-[17px] text-ink-2">The first photo you add becomes the first card here.</p>
            <Link href="/add" className="btn btn-soft mt-3 self-start">
              <CameraIcon className="size-5" />
              Add the first one
            </Link>
          </div>
        </li>
        {PLACEHOLDERS.map(({ tint, shown }) => (
          <li key={tint} aria-hidden className={`card hidden flex-col overflow-hidden opacity-60 ${shown}`}>
            <div className={`flex h-[220px] items-center justify-center ${tint}`}>
              <CrystalIcon className="size-14 text-icon-muted" />
            </div>
            <div className="flex-1" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** DESIGN.md §5's side column: a flex sibling that drops below the collection on a phone, never sticky. */
function SideColumn({ tiles }: { tiles: Tile[] }) {
  const newest = sortTiles(tiles, "new").slice(0, 4);
  const g = glance(tiles);
  const where = places(tiles);
  const stats: Array<[number, string]> = [
    [g.stones, g.stones === 1 ? "stone in your collection" : "stones in your collection"],
    [g.minerals, g.minerals === 1 ? "mineral" : "different minerals"],
    [g.rocks, g.rocks === 1 ? "kind of rock" : "kinds of rock"],
    [g.places, g.places === 1 ? "place they live" : "places they live"],
  ];
  return (
    <aside aria-label="At a glance" className="flex w-full min-w-0 flex-[1_1_320px] flex-col gap-6 lg:max-w-sidebar">
      <section aria-labelledby="newest-h" className="card flex flex-col gap-3 p-card">
        <h2 id="newest-h" className="text-h3 leading-tight">
          Newest additions
        </h2>
        <ul className="flex flex-col">
          {newest.map((t, i) => (
            // The whole row is the link, so the target is the 64 px row, not the name's line.
            <li key={t.id} className={i > 0 ? "border-t border-hairline" : ""}>
              <Link href={`/stones/${t.id}`} className="group flex items-center gap-3.5 py-3 no-underline">
                {t.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail
                  <img src={t.thumbUrl} alt="" className="size-16 flex-none rounded-thumb bg-tile-stone object-cover" />
                ) : (
                  <span aria-hidden className="flex size-16 flex-none items-center justify-center rounded-thumb bg-tile-stone">
                    <CrystalIcon className="size-7 text-icon-muted" />
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-bold group-hover:underline">{stoneName(t.name)}</span>
                  <span className="truncate text-meta text-ink-3">{t.variety ? `${t.variety} · added ${t.added}` : `added ${t.added}`}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/?sort=new" className="text-link self-start">
          See everything by date
        </Link>
      </section>

      <section aria-labelledby="glance-h" className="card flex flex-col gap-4 p-card">
        <h2 id="glance-h" className="text-h3 leading-tight">
          At a glance
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          {stats.map(([n, label]) => (
            <div key={label} className="flex flex-col-reverse gap-1 rounded-tile bg-ground px-4 py-3.5">
              <dt className="text-meta text-ink-2">{label}</dt>
              <dd className="font-display text-[34px] font-semibold leading-none tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="where-h" className="card flex flex-col gap-3 p-card">
        <h2 id="where-h" className="text-h3 leading-tight">
          Where they live
        </h2>
        {where.length === 0 ? (
          <p className="text-ink-2">Nowhere recorded yet. Each stone&rsquo;s page has a place for where it lives: a shelf, a drawer, an egg carton.</p>
        ) : (
          <ul className="flex flex-col">
            {where.map((w, i) => (
              <li key={w.place} className={`flex items-baseline justify-between gap-3 py-2.5 ${i > 0 ? "border-t border-hairline" : ""}`}>
                <span className="min-w-0 truncate">{w.place}</span>
                <span className="text-meta text-ink-2 tabular-nums">{w.n === 1 ? "1 stone" : `${w.n} stones`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
