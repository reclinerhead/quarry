"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CameraIcon, GemMark } from "@/components/icons";

// The top bar from design/DESIGN.md §5: gem mark and wordmark, nav pills, the
// search, the primary "Add a rock", then the strata band. Only pages that
// exist get a nav pill; Minerals, Periodic table, Labels and Gem Show join as
// their phases land.
//
// Below lg the bar is two rows: the wordmark with Add, then the nav with the
// search. From lg it is the canvas's one row.
export function TopBar() {
  const pathname = usePathname();
  return (
    <header>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-page flex-wrap items-center gap-x-3 gap-y-3 px-4 py-4 sm:gap-x-7 sm:px-10 sm:py-[18px]">
          <Link href="/" className="order-1 flex items-center gap-2.5 text-ink hover:text-ink">
            <GemMark className="size-8 text-azurite sm:size-9" />
            <span className="font-display text-[26px] font-bold tracking-[-0.01em] sm:text-[30px]">The Quarry</span>
          </Link>

          {/* Nav and search share a row of their own until lg, so the search
              never squeezes between the wordmark and Add. */}
          <div className="order-3 flex min-w-0 basis-full items-center gap-3 lg:order-2 lg:flex-1 lg:basis-auto lg:gap-7">
            <nav aria-label="Main" className="flex flex-wrap gap-1.5">
              <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className="nav-pill px-4 sm:px-5">
                Collection
              </Link>
            </nav>

            {/* The search reads the URL, which a static page (/add) can only
                do behind a Suspense boundary; the fallback is the same box, not yet live. */}
            <Suspense fallback={<SearchForm value="" />}>
              <LiveSearch />
            </Suspense>
          </div>

          <Link href="/add" className="btn btn-primary btn-lg order-2 ml-auto px-5 sm:px-6 lg:order-3 lg:ml-0">
            <CameraIcon className="size-[22px]" />
            <span>
              Add<span className="max-sm:sr-only"> a rock</span>
            </span>
          </Link>
        </div>
      </div>
      {/* The strata band: four sediment layers under the bar, decoration only. */}
      <div aria-hidden className="flex flex-col">
        <div className="h-1 bg-strata-1" />
        <div className="h-[3px] bg-strata-2" />
        <div className="h-[5px] bg-strata-3" />
        <div className="h-0.5 bg-strata-4" />
      </div>
    </header>
  );
}

/**
 * "Search your rocks" (#9). On the collection it filters as you type, through
 * the URL (?q=) with the native history API, so no request leaves the phone;
 * anywhere else, Enter goes to the collection with the search applied.
 */
function LiveSearch() {
  const pathname = usePathname();
  const router = useRouter();
  const urlQ = useSearchParams().get("q") ?? "";
  // Typed text is local; when the URL's q changes under it (the back button,
  // "Clear filters"), the box follows. Adjusting state during render, per React.
  const [seen, setSeen] = useState(urlQ);
  const [value, setValue] = useState(urlQ);
  if (seen !== urlQ) {
    setSeen(urlQ);
    setValue(urlQ);
  }
  const live = pathname === "/";
  return (
    <SearchForm
      value={value}
      onChange={(v) => {
        setValue(v);
        if (!live) return;
        const url = new URL(window.location.href);
        if (v.trim()) url.searchParams.set("q", v);
        else url.searchParams.delete("q");
        window.history.replaceState(null, "", url.pathname + url.search);
      }}
      onSubmit={() => {
        if (!live) router.push(value.trim() ? `/?q=${encodeURIComponent(value.trim())}` : "/");
      }}
    />
  );
}

function SearchForm({ value, onChange, onSubmit }: { value: string; onChange?: (v: string) => void; onSubmit?: () => void }) {
  return (
    <form
      role="search"
      action="/"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
      className="flex min-w-0 flex-1 sm:max-w-[400px] lg:ml-auto lg:w-[300px] lg:flex-none xl:w-[340px]"
    >
      <label className="field flex w-full items-center gap-2.5 px-4 sm:px-[18px]">
        <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-none text-ink-2">
          <circle cx="10" cy="10" r="6.5" />
          <path d="M15 15l6 6" />
        </svg>
        <span className="sr-only">Search your rocks</span>
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={!onChange}
          placeholder="Search your rocks"
          autoComplete="off"
        />
      </label>
    </form>
  );
}
