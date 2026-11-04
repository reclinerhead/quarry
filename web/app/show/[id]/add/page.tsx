import Link from "next/link";
import { notFound } from "next/navigation";
import { CasePicker } from "@/components/case-picker";
import { parseId, pickerRows } from "@/lib/cases";
import { sortTiles } from "@/lib/collection";
import { withReadDb } from "@/lib/jobs";
import { collectionTiles, readCases } from "@/lib/specimens";

// /show/[id]/add (#81): add stones to one show case. Its own page rather than
// a dialog, so it is full width on a phone and the back button leaves it. The
// collection as rows with a checkbox each, a search, and one button that says
// how many go in. A stone already in this case can't be ticked; one in another
// case can, and moves. The order they land in is the collection's; the planner
// is where it gets set.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  const name = id ? withReadDb((db) => readCases(db).find((c) => c.id === id)?.name ?? null, null) : null;
  return { title: name ? `Add stones to ${name} · The Quarry` : "The Quarry" };
}

export default async function AddToCasePage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const data = withReadDb((db) => {
    const cases = readCases(db);
    const c = cases.find((k) => k.id === id);
    if (!c) return null;
    const tiles = sortTiles(collectionTiles(db), "name");
    return { name: c.name, rows: pickerRows(tiles, cases.map((k) => ({ id: k.id, name: k.name, stoneIds: k.stones.map((s) => s.id) })), id) };
  }, null);
  if (!data) notFound();

  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-6 sm:px-10 sm:pb-[72px] sm:pt-8">
      <nav aria-label="Breadcrumb" className="text-[17px]">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/show" className="inline-flex min-h-12 items-center font-bold text-ink-2 hover:text-ink">
              Show cases
            </Link>
          </li>
          <li aria-hidden className="text-ink-3">
            ›
          </li>
          <li>
            <Link href={`/show#case-${id}`} className="inline-flex min-h-12 items-center font-bold text-ink-2 hover:text-ink">
              {data.name}
            </Link>
          </li>
          <li aria-hidden className="text-ink-3">
            ›
          </li>
          <li aria-current="page" className="text-ink">
            Add stones
          </li>
        </ol>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="text-balance text-[36px] leading-tight sm:text-h2">{`Add stones to ${data.name}`}</h1>
        <p className="max-w-[70ch] text-lead text-ink-2">Tick the stones that go in this case. You can put them in order on the Show cases page afterwards.</p>
      </header>
      <CasePicker caseId={id} caseName={data.name} rows={data.rows} />
    </main>
  );
}
