"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { allBeliefs, FACT_ANCHOR, loreIntro, loreMeta, shortSource, workParts, type Fact, type LoreBand as Band } from "@/lib/facts";

// "Once believed" (#133, epic #127): the old lore about a stone's mineral, a
// card in the stone page's main column, between the tests and "Did you know?"
// (#138), on its own aged-paper ground (`card-lore`) so it never reads as one
// more white card of fact. One column: the lead belief with the passage it
// rests on, up to three more as headlines under it, and a button that opens
// the whole list in place, every belief with its passage and its source. Lore
// is never shown as fact: the title and the line under it say so. Drawn on the server from `readStone`'s `lore`; the one client piece is
// the expand. Arriving from the dashboard's strip (#once-believed) it opens
// expanded: the hash is read after hydration, since the server never sees it.

const ID = FACT_ANCHOR.lore;

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function LoreBand({ band, name }: { band: Band; name: string }) {
  const arrived = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash === `#${ID}`,
    () => false,
  );
  // null until the person presses the button; then theirs, whatever the address says.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const expanded = chosen ?? arrived;
  // The button moves between the two layouts, so the pressed one is replaced: the new one takes the focus.
  const refocus = useRef(false);
  const button = band.all.length > 1 ? (
    <button
      type="button"
      ref={(el) => {
        if (el && refocus.current) {
          refocus.current = false;
          el.focus();
        }
      }}
      aria-expanded={expanded}
      aria-controls={`${ID}-beliefs`}
      onClick={() => {
        refocus.current = true;
        setChosen(!expanded);
      }}
      className="btn btn-soft self-start"
    >
      {expanded ? "Fewer old beliefs" : allBeliefs(band.all.length)}
    </button>
  ) : null;

  return (
    <section id={ID} aria-labelledby="lore-h" className="card-lore flex scroll-mt-6 flex-col gap-6 px-5 py-6 sm:px-8 sm:py-7">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <h2 id="lore-h" className="text-section leading-tight">
            Once believed
          </h2>
          <p className="text-meta text-ink-2">{loreMeta(name, band.credits)}</p>
        </div>
        <p className="max-w-[72ch] text-lead text-ink-2">{loreIntro(name, band.ancient)}</p>
      </div>

      {expanded ? (
        <>
          <ol id={`${ID}-beliefs`} className="flex flex-col">
            {band.all.map((f, i) => (
              <li key={f.id} className={`flex flex-col gap-2 ${i > 0 ? "mt-5 border-t border-lore-line pt-5" : ""}`}>
                <p className="max-w-[40ch] font-display text-h3 font-semibold leading-tight">{f.text}</p>
                <Passage fact={f} />
              </li>
            ))}
          </ol>
          {button}
        </>
      ) : (
        <>
          <div id={`${ID}-beliefs`} className="flex flex-col gap-5">
            <div className="flex flex-col gap-3.5">
              <p className="max-w-[28ch] font-display text-[28px] font-semibold leading-[1.2] sm:text-section">{band.lead.text}</p>
              <Passage fact={band.lead} />
            </div>
            {band.more.length > 0 ? (
              <ol className="flex flex-col">
                {band.more.map((f) => (
                  <li key={f.id} className="flex flex-col gap-1 border-t border-lore-line py-4 last:pb-0">
                    <p className="max-w-[40ch] font-display text-h3 font-semibold leading-tight">{f.text}</p>
                    <p className="text-meta text-ink-3">{shortSource(f.source)}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
          {button}
        </>
      )}
    </section>
  );
}

/** The passage a belief rests on, in the book's own words, and where to read it: not italic, which is "Not recorded yet". */
function Passage({ fact }: { fact: Fact }) {
  const { source } = fact;
  const [title, rest] = workParts(source.work);
  return (
    <>
      {fact.quote ? <p className="max-w-[60ch] text-lead text-ink-2">{`“${fact.quote}”`}</p> : null}
      <p className="flex flex-wrap items-center text-meta text-ink-3">
        <span>
          {source.author ? `${source.author}, ` : ""}
          <cite>{title}</cite>
          {rest}
          {source.year ? ` · ${source.year}` : ""}
        </span>
        {/* The dot stays with the link, so a wrapped line never ends on it. */}
        <span className="inline-flex items-center whitespace-nowrap pl-1">
          ·
          <a href={source.url} target="_blank" rel="noreferrer" className="text-link">
            Read it
          </a>
        </span>
      </p>
    </>
  );
}
