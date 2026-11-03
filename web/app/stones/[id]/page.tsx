import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Gallery } from "@/components/gallery";
import { CheckIcon } from "@/components/icons";
import { RemoveStone, StoneEditor } from "@/components/stone-editor";
import { Term } from "@/components/term";
import { TestsEditor } from "@/components/tests-editor";
import { fullDay, KIND_LABEL } from "@/lib/collection";
import type { GlossaryKey } from "@/lib/glossary";
import { readJob, withReadDb, type JobView } from "@/lib/jobs";
import type { PropertyKey, Segment } from "@/lib/mindat";
import { HOW_SUMMARY } from "@/lib/naming";
import { sameStone } from "@/lib/names";
import { PieceTitle } from "@/components/piece-title";
import { kindOf, pieceName, stoneName } from "@/lib/pills";
import { readStone, type StoneView } from "@/lib/specimens";

// /stones/[id]: one stone (#9), DESIGN.md §5's specimen page as far as Phase 2
// has data: the breadcrumb, the title block (with the formula and Mindat's
// tags, #23), the photo gallery, then two columns. Main: "This specimen" (the
// editable specimen label), "Kitchen-table tests" and "Mineral properties".
// Side: "How it was named" and Remove. About, handling notes, elements, the
// Mohs scale, relatives, the story log and the box label arrive later in
// Phases 2 and 3.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const stone = Number.isInteger(id) ? withReadDb((db) => readStone(db, id), null) : null;
  return { title: stone ? `${pieceName(stone)} · The Quarry` : "The Quarry" };
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
  const name = pieceName(stone); // the piece, as its label reads (#29)
  const mineral = stoneName(stone.name); // the main mineral, which the property card and tags follow
  const kind = kindOf(stone);
  const props = stone.properties;

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
        <h1 className="text-balance text-[40px] leading-[1.05] sm:text-page-title">
          <PieceTitle piece={stone} />
        </h1>
        {kind || props.formula ? (
          <p className="text-[22px] text-ink-2">
            {kind}
            {kind && props.formula ? " · " : null}
            {props.formula ? (
              <span className="font-label font-bold text-ink">
                <span className="sr-only">Formula: </span>
                <Formula segments={props.formula} />
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-2">
          {props.mineralClass ? (
            <TagTerm k="mineralClass">{props.mineralClass}</TagTerm>
          ) : stone.kind === "rock" ? (
            <TagTerm k="rock">{KIND_LABEL.rock}</TagTerm>
          ) : (
            <span className="tag">{KIND_LABEL[stone.kind]}</span>
          )}
          {props.mohs ? <TagTerm k="hardness">{`Mohs ${props.mohs}`}</TagTerm> : null}
          {props.glow === "can" ? (
            <TagTerm k="fluorescence" uv>
              Can glow under UV
            </TagTerm>
          ) : null}
          <span className="tag">{stone.photos.length === 1 ? "1 photo" : `${stone.photos.length} photos`}</span>
          {stone.sameMineral > 1 ? <span className="tag">{`${stone.sameMineral} ${mineral} in your collection`}</span> : null}
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
          <MineralProperties stone={stone} name={mineral} />
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
 * with a check, the other candidates outlined with their word, each naming its
 * whole reading (#29). The chosen pill reads as the stone is named now, with
 * any minerals the person added. A name typed by hand that no model
 * offered leads, solid. Then when, and how they knew.
 */
function HowNamed({ job, morePhotos }: { job: JobView; morePhotos: number }) {
  const conf = job.confirmation!;
  const chosen = { name: conf.name, variety: null };
  const inPlan = job.plan.pills.some((p) => sameStone(p, chosen));
  return (
    <>
      <ul aria-label="Jasper’s suggestions, and the name chosen" className="flex flex-col gap-2">
        {inPlan ? null : <ChosenPill piece={conf} note="typed by you" />}
        {job.plan.pills.map((p) =>
          sameStone(p, chosen) ? (
            <ChosenPill key={`${p.pick.model}-${p.pick.rank}`} piece={conf} note={p.word} />
          ) : (
            <li key={`${p.pick.model}-${p.pick.rank}`} className="flex min-h-12 items-center justify-between gap-3 rounded-[24px] border border-line-2 px-5 py-2">
              <span className="min-w-0 break-words font-display text-[20px] font-semibold leading-tight">{pieceName(p)}</span>
              <span className="shrink-0 rounded-pill bg-sand px-3 py-1 text-tag font-bold text-tag-ink">{p.word}</span>
            </li>
          ),
        )}
      </ul>
      <dl className="flex flex-col gap-1">
        <div>
          <dt className="sr-only">Named</dt>
          <dd>Named {pieceName(conf)} on {fullDay(conf.confirmedAt)}.</dd>
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

function ChosenPill({ piece, note }: { piece: Parameters<typeof pieceName>[0]; note: string }) {
  return (
    // 24 px corners: a pill on one line, a rounded card when a long name wraps.
    <li className="flex min-h-12 items-center justify-between gap-3 rounded-[24px] bg-azurite px-5 py-2 text-white">
      <span className="flex min-w-0 items-center gap-2 font-display text-[20px] font-semibold leading-tight">
        <CheckIcon className="size-4 flex-none" />
        <span className="min-w-0 break-words">{pieceName(piece)}</span>
      </span>
      <span className="shrink-0 rounded-pill bg-white/15 px-3 py-1 text-tag font-bold">{note}</span>
    </li>
  );
}

const TERM: Record<PropertyKey, GlossaryKey> = {
  formula: "formula",
  hardness: "hardness",
  crystalSystem: "crystalSystem",
  luster: "luster",
  streak: "streak",
  cleavage: "cleavage",
  specificGravity: "specificGravity",
  fluorescence: "fluorescence",
};

/**
 * DESIGN.md §5's Mineral properties card (#23): Mindat's cells in the canvas's
 * order, each label with its info mark, none drawn without a value. With no
 * cells, one line in the card's place says why: a rock, a name Mindat doesn't
 * have, or a record Jasper hasn't fetched yet.
 */
function MineralProperties({ stone, name }: { stone: StoneView; name: string }) {
  const p = stone.properties;
  return (
    <section aria-labelledby="props-h" className="card flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="props-h" className="text-section leading-tight">
          Mineral properties
        </h2>
        {p.mindatId !== null ? (
          // A flex row, so on a phone the hint wraps whole under the link's 48 px target.
          <p className="flex flex-wrap items-center text-meta text-ink-2">
            From
            <a href={`https://www.mindat.org/min-${p.mindatId}.html`} target="_blank" rel="noreferrer" className="text-link">
              Mindat
            </a>
            {p.state === "cells" ? (
              <span>
                <span aria-hidden className="max-sm:hidden">
                  {"· "}
                </span>
                tap <b className="text-azurite">i</b> to learn what a word means
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {p.state === "cells" ? (
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {p.cells.map((c) => (
            <div key={c.key} className="flex flex-col gap-1 rounded-tile bg-ground px-[18px] py-4">
              <dt className="text-meta font-bold text-ink-2">
                <Term k={TERM[c.key]}>{c.label}</Term>
              </dt>
              <dd className={c.segments ? "font-label text-[24px] font-bold leading-snug" : "font-display text-[24px] font-semibold leading-snug"}>
                {c.segments ? <Formula segments={c.segments} /> : c.value}
              </dd>
              {c.detail ? <dd className="text-meta text-ink-2">{c.detail}</dd> : null}
            </div>
          ))}
        </dl>
      ) : p.state === "empty" ? (
        <p className="text-ink-2">
          {stone.kind === "rock" ? (
            <>
              {`Mindat lists no single formula or hardness for ${name}: a `}
              <Term k="rock">rock</Term>
              {" is a mix of minerals."}
            </>
          ) : (
            `Mindat has no properties recorded for ${name}.`
          )}
        </p>
      ) : p.state === "unknown" ? (
        <>
          <p className="text-ink-2">{`Mindat has no entry called ${name}. If it goes by another name there, the name can be changed to Mindat’s.`}</p>
          {stone.namedBy ? (
            <Link href={`/name/${stone.namedBy}`} className="text-link self-start">
              Change the name
            </Link>
          ) : null}
        </>
      ) : (
        <p className="text-ink-2">{`Jasper hasn’t looked ${name} up in Mindat yet.`}</p>
      )}
    </section>
  );
}

/** A formula's runs, with real subscripts and superscripts. */
function Formula({ segments }: { segments: Segment[] }) {
  return segments.map((s, i) =>
    s.pos === "sub" ? <sub key={i}>{s.text}</sub> : s.pos === "sup" ? <sup key={i}>{s.text}</sup> : <Fragment key={i}>{s.text}</Fragment>,
  );
}

/** A title-block tag whose word is a mineralogical term: the pill, then its info mark beside it. */
function TagTerm({ k, uv = false, children }: { k: GlossaryKey; uv?: boolean; children: string }) {
  return (
    <span className="inline-flex items-center">
      <span className={uv ? "tag bg-uv text-uv-ink" : "tag"}>{children}</span>
      <Term k={k} bare />
    </span>
  );
}
