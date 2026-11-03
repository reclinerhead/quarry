"use client";

import { useId, useState } from "react";
import { localityUrl, placesLabel, shortList, type Area } from "@/lib/places";

// One list in "Where it's found" (#65): the home state's counties or the
// states, most first, each row a link to its page on Mindat with how many of
// its places report the mineral. The first eight show; "and N more" opens the
// rest in place, and the same button folds them again.
export function AreaList({ title, areas, noun }: { title: string; areas: Area[]; noun: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { shown, rest } = shortList(areas);
  return (
    <div className="flex min-w-0 flex-col">
      <h3 id={id} className="text-h3 leading-tight">
        {title}
      </h3>
      <ul aria-labelledby={id} className="mt-2 flex flex-col">
        {(open ? areas : shown).map((a, i) => (
          <li key={a.id} className={i > 0 ? "border-t border-hairline" : undefined}>
            <a href={localityUrl(a.id)} target="_blank" rel="noreferrer" className="group flex min-h-12 items-center justify-between gap-3 py-1">
              <span className="min-w-0 font-bold underline-offset-4 group-hover:underline">{a.name}</span>
              <span className="shrink-0 text-meta text-ink-2 tabular-nums">{placesLabel(a.n)}</span>
            </a>
          </li>
        ))}
      </ul>
      {rest.length ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-link -ml-1.5 self-start">
          {open ? `Show fewer ${noun}` : `and ${rest.length} more ${noun}`}
        </button>
      ) : null}
    </div>
  );
}
