import Link from "next/link";
import { CameraIcon, CrystalIcon } from "@/components/icons";
import { stoneCount } from "@/lib/db";
import { dateLine, greeting } from "@/lib/greeting";
import { waitingStrip, withReadDb } from "@/lib/jobs";
import { stripLine } from "@/lib/pills";

// The dashboard from design/DESIGN.md §5, as far as there is data for it: the
// greeting, the pending strip (#8) and, while there are no stones, an empty
// collection drawn in the specimen card's shape. The cards, filters and side
// column (#9) arrive with the issue that has data for them; their space is
// not faked. Everything comes from the database on every request, never from
// the build.
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
  const stones = stoneCount();
  const strip = withReadDb(waitingStrip, { count: 0, thumbs: [], first: null });

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-8 sm:px-10 sm:pb-[72px] sm:pt-10">
      <section aria-labelledby="hello" className="flex flex-col gap-1.5">
        <p className="font-bold text-ink-2">{dateLine(now)}</p>
        <h1 id="hello" className="text-[36px] leading-tight sm:text-h1 sm:leading-[1.1]">
          {greeting(now, stones)}
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

      <section aria-labelledby="collection-h" className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-0.5">
          <h2 id="collection-h" className="text-h2 leading-tight">
            Your collection
          </h2>
          <p className="text-[17px] text-ink-2">{stones === 0 ? "No stones yet" : `${stones} ${stones === 1 ? "stone" : "stones"}`}</p>
        </div>

        {stones === 0 && (
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
        )}
      </section>
    </main>
  );
}
