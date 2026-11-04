import { CasePlanner } from "@/components/case-planner";
import { nextCaseName, type ShowCase } from "@/lib/cases";
import { withReadDb } from "@/lib/jobs";
import { readCases } from "@/lib/specimens";

// /show (#81): the display cases a household plans for the club's rock show.
// One card per case, its stones as numbered tiles in reading order, and the
// tap path to arrange them (a mouse can drag too). The page is the reference
// at the hall: the same page on a phone, the tiles two across, the numbers
// carrying the order. "Add stones" is its own page, /show/[id]/add.
export const dynamic = "force-dynamic";

export const metadata = { title: "Show cases · The Quarry" };

export default async function ShowPage() {
  const cases = withReadDb((db) => readCases(db), [] as ShowCase[]);
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-6 sm:px-10 sm:pb-[72px] sm:pt-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[36px] leading-tight sm:text-h2">Show cases</h1>
        <p className="max-w-[70ch] text-lead text-ink-2">
          Plan what goes in each case before the show. At the hall, open this on your phone and set the stones out in the order of their numbers.
        </p>
      </header>
      <CasePlanner cases={cases} nextName={nextCaseName(cases.map((c) => c.name))} />
    </main>
  );
}
