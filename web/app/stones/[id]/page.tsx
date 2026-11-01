import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { CheckIcon } from "@/components/icons";
import { RemoveStone, StoneEditor } from "@/components/stone-editor";
import { TestsEditor } from "@/components/tests-editor";
import { fullDay, KIND_LABEL } from "@/lib/collection";
import { readJob, withReadDb, type JobView } from "@/lib/jobs";
import { HOW_SUMMARY } from "@/lib/naming";
import { sameStone } from "@/lib/names";
import { stoneName } from "@/lib/pills";
import { readStone } from "@/lib/specimens";

// /stones/[id]: one stone (#9), DESIGN.md §5's specimen page as far as Phase 1
// has data: the breadcrumb, the title block, the photo gallery, then two
// columns. Main: "This specimen" (the editable specimen label) and
// "Kitchen-table tests". Side: "How it was named" and Remove. Mineral
// properties, handling notes, elements, the Mohs scale, relatives, the story
// log and the box label arrive with Phases 2 and 3.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const name = Number.isInteger(id) ? withReadDb((db) => readStone(db, id)?.name ?? null, null) : null;
  return { title: name ? `${stoneName(name)} · The Quarry` : "The Quarry" };
}

export default async function StonePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = withReadDb((db) => {
    const stone = readStone(db, id);
    if (!stone) return null;
    return { stone, naming: stone.namedBy ? readJob(db, stone.namedBy) : null };
  }, null);
  if (!data) notFound();
  const { stone, naming } = data;
  const name = stoneName(stone.name);

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-6 sm:px-10 sm:pb-[72px] sm:pt-8">
      <nav aria-label="Breadcrumb" className="text-[17px]">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="inline-flex min-h-12 items-center font-bold text-ink-2 hover:text-ink">
              Collection
            </Link>
          </li>
          <li aria-hidden className="text-ink-3">
            ›
          </li>
          <li aria-current="page" className="text-ink">
            {name}
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-3">
        <h1 className="text-[40px] leading-[1.05] sm:text-page-title">{name}</h1>
        {stone.variety ? <p className="text-[22px] text-ink-2">{stone.variety}</p> : null}
        <p className="flex flex-wrap gap-2">
          <span className="tag">{KIND_LABEL[stone.kind]}</span>
          <span className="tag">{stone.photos.length === 1 ? "1 photo" : `${stone.photos.length} photos`}</span>
          {stone.sameMineral > 1 ? <span className="tag">{`${stone.sameMineral} ${name} in your collection`}</span> : null}
          <span className="tag">{`Added ${stone.added}`}</span>
        </p>
      </header>

      <Gallery photos={stone.photos} name={name} />

      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-7">
          <section aria-labelledby="specimen-h" className="card flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-7">
            <h2 id="specimen-h" className="text-section leading-tight">
              This specimen
            </h2>
            <StoneEditor id={stone.id} facts={stone} places={stone.places} />
          </section>
          <section aria-labelledby="tests-h" className="card flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-7">
            <h2 id="tests-h" className="text-section leading-tight">
              Kitchen-table tests
            </h2>
            <TestsEditor id={stone.id} initial={stone.tests} />
          </section>
        </div>

        <aside aria-label="About its naming" className="flex w-full min-w-0 flex-[1_1_320px] flex-col gap-6 lg:max-w-sidebar">
          <section aria-labelledby="named-h" className="card flex flex-col gap-4 p-card">
            <h2 id="named-h" className="text-h3 leading-tight">
              How it was named
            </h2>
            {naming?.confirmation ? <HowNamed job={naming} morePhotos={stone.morePhotosNamed} /> : <p className="text-ink-2">No record of its naming.</p>}
          </section>
          <section aria-labelledby="remove-h" className="card flex flex-col gap-3 p-card">
            <h2 id="remove-h" className="text-h3 leading-tight">
              Remove
            </h2>
            <RemoveStone id={stone.id} photoCount={stone.photos.length} />
          </section>
        </aside>
      </div>
    </main>
  );
}

/**
 * The models' pills as they were (DESIGN.md §4): the name chosen solid azurite
 * with a check, the other candidates outlined with their word. A name typed
 * by hand that no model offered leads, solid. Then when, and how they knew.
 */
function HowNamed({ job, morePhotos }: { job: JobView; morePhotos: number }) {
  const conf = job.confirmation!;
  const chosen = { name: conf.name, variety: null };
  const inPlan = job.plan.pills.some((p) => sameStone(p, chosen));
  return (
    <>
      <ul aria-label="Jasper’s suggestions, and the name chosen" className="flex flex-col gap-2">
        {inPlan ? null : <ChosenPill name={conf.name} note="typed by you" />}
        {job.plan.pills.map((p) =>
          sameStone(p, chosen) ? (
            <ChosenPill key={`${p.pick.model}-${p.pick.rank}`} name={p.name} note={p.word} />
          ) : (
            <li key={`${p.pick.model}-${p.pick.rank}`} className="flex min-h-12 items-center justify-between gap-3 rounded-pill border border-line-2 px-5 py-2">
              <span className="font-display text-[20px] font-semibold">{stoneName(p.name)}</span>
              <span className="rounded-pill bg-sand px-3 py-1 text-tag font-bold text-tag-ink">{p.word}</span>
            </li>
          ),
        )}
      </ul>
      <dl className="flex flex-col gap-1">
        <div>
          <dt className="sr-only">Named</dt>
          <dd>Named {stoneName(conf.name)} on {fullDay(conf.confirmedAt)}.</dd>
        </div>
        <div>
          <dt className="sr-only">How</dt>
          <dd className="text-ink-2">{HOW_SUMMARY[conf.how]}.</dd>
        </div>
      </dl>
      {morePhotos > 0 ? (
        <p className="text-meta text-ink-2">{morePhotos === 1 ? "One more photo was added as the same stone." : `${morePhotos} more photos were added as the same stone.`}</p>
      ) : null}
      <Link href={`/name/${job.id}`} className="text-link self-start">
        Change the name
      </Link>
    </>
  );
}

function ChosenPill({ name, note }: { name: string; note: string }) {
  return (
    <li className="flex min-h-12 items-center justify-between gap-3 rounded-pill bg-azurite px-5 py-2 text-white">
      <span className="flex items-center gap-2 font-display text-[20px] font-semibold">
        <CheckIcon className="size-4" />
        {stoneName(name)}
      </span>
      <span className="rounded-pill bg-white/15 px-3 py-1 text-tag font-bold">{note}</span>
    </li>
  );
}
