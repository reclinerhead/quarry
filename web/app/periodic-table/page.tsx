import Link from "next/link";
import { Formula } from "@/components/formula";
import { CrystalIcon } from "@/components/icons";
import { Term } from "@/components/term";
import { ELEMENTS, nameList, periodicTable, type Lit, type PeriodicElement } from "@/lib/elements";
import { withReadDb } from "@/lib/jobs";
import { pieceName } from "@/lib/pills";
import { collectionElements, type PieceElements } from "@/lib/specimens";

// /periodic-table (#48): the README's "Light up the periodic table". Every
// element in any named mineral on a confirmed stone is lit; tapping one lists
// the stones that carry it. A join over the Mindat records Jasper fetched,
// never a model call. The selection rides in the URL (?e=Ca), so the page is
// drawn on the server, a link to an element can be shared, and the back
// button works. Designed at laptop width; on a phone the table's card scrolls
// sideways inside itself (DESIGN.md §6's one exception).
export const dynamic = "force-dynamic";

export const metadata = { title: "Periodic table · The Quarry" };

/** The table's rows in drawing order: periods 1 to 7, a spacer, then the lanthanides and actinides. */
const ROWS = [1, 2, 3, 4, 5, 6, 7, 0, 8, 9];
const COLS = Array.from({ length: 18 }, (_, i) => i + 1);
const AT = new Map(ELEMENTS.map((e) => [`${e.row},${e.col}`, e]));

export default async function PeriodicTablePage({ searchParams }: { searchParams: Promise<{ e?: string | string[] }> }) {
  const { e } = await searchParams;
  const wanted = (Array.isArray(e) ? e[0] : e)?.trim().toLowerCase() ?? "";
  const pieces = withReadDb((db) => collectionElements(db), [] as PieceElements[]);
  const table = periodicTable(pieces);
  const selected = table.lit.find((l) => l.element.symbol.toLowerCase() === wanted) ?? null;
  const lit = new Map(table.lit.map((l) => [l.element.symbol, l]));
  const n = table.lit.length;

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-6 sm:px-10 sm:pb-[72px] sm:pt-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[36px] leading-tight sm:text-h2">
          Your periodic table
          <Term k="periodicTable" bare />
        </h1>
        <p className="text-lead text-ink-2">
          {n === 0 ? (
            <>
              {"No "}
              <Term k="element">elements</Term>
              {" lit yet. The first mineral you name lights its elements here."}
            </>
          ) : (
            <>
              {`${n} of the 118 `}
              <Term k="element">elements</Term>
              {` lit, from ${table.stones === 1 ? "1 stone" : `${table.stones} stones`}.`}
            </>
          )}
        </p>
        {table.newest ? (
          <p className="text-ink-2">
            {`${arrived(table.newest.elements)} came with your `}
            <Link href={`/stones/${table.newest.stone.id}`} className="font-bold">
              {pieceName(table.newest.stone)}
            </Link>
            {` on ${table.newest.stone.added}.`}
          </p>
        ) : null}
      </header>

      <section aria-labelledby="lit-h" className="flex flex-col gap-4">
        <h2 id="lit-h" className="text-section leading-tight">
          Your elements
        </h2>
        {n === 0 ? (
          <p className="text-ink-2">Nothing yet. Each element you have will be a tile here, and tapping it shows the stones that carry it.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {table.lit.map((l) => (
              <li key={l.element.symbol} className="contents">
                <Link
                  href={`/periodic-table?e=${l.element.symbol}`}
                  aria-current={selected?.element.symbol === l.element.symbol ? "true" : undefined}
                  className="element-tile"
                >
                  <span className="text-tag font-bold tabular-nums">{l.element.number}</span>
                  <span className="font-display text-[36px] font-bold leading-[1.1]">{l.element.symbol}</span>
                  <span className="text-meta">{l.element.name}</span>
                  <span className="text-meta">{l.stones.length === 1 ? "1 stone" : `${l.stones.length} stones`}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="table-h" className="card flex flex-col gap-4 overflow-x-auto p-5 sm:p-7">
        <h2 id="table-h" className="text-section leading-tight">
          The table
        </h2>
        <div role="group" aria-label={`The periodic table, ${n} of 118 elements lit`} className="grid min-w-[932px] grid-cols-[repeat(18,minmax(48px,1fr))] gap-1">
          {ROWS.map((row) =>
            COLS.map((col) => {
              if (row === 0) return <span key={`${row},${col}`} aria-hidden className="h-4" />;
              const el = AT.get(`${row},${col}`);
              if (!el) return <span key={`${row},${col}`} aria-hidden />;
              const litEl = lit.get(el.symbol);
              return litEl ? (
                <Link
                  key={el.symbol}
                  href={`/periodic-table?e=${el.symbol}`}
                  aria-label={`${el.name}, ${litEl.stones.length === 1 ? "1 stone" : `${litEl.stones.length} stones`}`}
                  aria-current={selected?.element.symbol === el.symbol ? "true" : undefined}
                  className="periodic-cell periodic-cell-lit"
                >
                  <Cell el={el} />
                </Link>
              ) : (
                <span key={el.symbol} aria-hidden className="periodic-cell">
                  <Cell el={el} />
                </span>
              );
            }),
          )}
        </div>
      </section>

      <StonesWith lit={selected} />
    </main>
  );
}

/** "Iron, sulfur, zinc and silicon", for the newest arrival's line. */
function arrived(elements: PeriodicElement[]): string {
  const s = nameList(elements.map((e) => e.name.toLowerCase()));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Cell({ el }: { el: PeriodicElement }) {
  return (
    <>
      <span className="text-tag tabular-nums">{el.number}</span>
      <span className="font-display text-[22px] font-bold">{el.symbol}</span>
    </>
  );
}

/**
 * The stones that carry the selected element, newest first, each naming the
 * mineral on the piece that has it and that mineral's formula. With nothing
 * selected the card holds its room and says what a tap does.
 */
function StonesWith({ lit }: { lit: Lit<PieceElements> | null }) {
  return (
    <section aria-labelledby="with-h" className="card flex flex-col gap-4 p-5 sm:p-7">
      <h2 id="with-h" className="text-section leading-tight">
        {lit ? `Stones with ${lit.element.name.toLowerCase()}` : "Stones with an element"}
      </h2>
      {lit ? (
        <ul className="flex flex-col">
          {lit.stones.map(({ stone, mineral }, i) => (
            <li key={stone.id} className={i > 0 ? "border-t border-hairline" : ""}>
              <Link href={`/stones/${stone.id}`} className="group flex items-center gap-3.5 py-3 no-underline">
                {stone.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail
                  <img src={stone.thumbUrl} alt="" className="size-16 flex-none rounded-thumb bg-tile-stone object-cover" />
                ) : (
                  <span aria-hidden className="flex size-16 flex-none items-center justify-center rounded-thumb bg-tile-stone">
                    <CrystalIcon className="size-7 text-icon-muted" />
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="line-clamp-2 font-bold group-hover:underline">{pieceName(stone)}</span>
                  <span className="truncate text-meta text-ink-3">
                    {mineral.name}
                    {mineral.formula ? (
                      <>
                        {" · "}
                        <span className="font-label font-bold text-ink-2">
                          <Formula segments={mineral.formula} />
                        </span>
                      </>
                    ) : null}
                    {` · added ${stone.added}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-2">Tap an element to see the stones that carry it.</p>
      )}
    </section>
  );
}
