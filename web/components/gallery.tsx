"use client";

import { useState } from "react";
import { CrystalIcon } from "@/components/icons";
import { PhotoView } from "@/components/photo-view";
import { longDay } from "@/lib/collection";

// The photo gallery from DESIGN.md §4: the hero in the dark photo well, 640 px
// tall (360 on a phone), contained rather than cropped, with a caption naming
// the source and date; beside it "More photos of this stone", a 2-across grid
// of thumbnail buttons that swap the hero (selected = a 4 px azurite border
// and aria-pressed). Newest first, as the server sends them.

type Photo = { id: number; url: string; thumbUrl: string; takenAt: string | null };

export function Gallery({ photos, name }: { photos: Photo[]; name: string }) {
  const [index, setIndex] = useState(0);
  const hero = photos[index] ?? photos[0];
  if (!hero)
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2.5 rounded-photo bg-tile-stone">
        <CrystalIcon className="size-14 text-icon-muted" />
        <span className="text-ink-2">No photo yet</span>
      </div>
    );
  const date = longDay(hero.takenAt);
  return (
    <section aria-label="Photos" className="flex flex-wrap items-start gap-6">
      <div className="relative flex h-[360px] min-w-0 flex-[999_1_560px] items-center justify-center overflow-hidden rounded-photo bg-photo-well sm:h-[640px]">
        <PhotoView key={hero.id} url={hero.url} thumbUrl={hero.thumbUrl} alt={`Your photo of the ${name}`} />
        <span className="absolute bottom-3 left-3 rounded-pill bg-caption px-3.5 py-1.5 text-meta font-bold text-white">
          {date ? `Your photo · ${date}` : "Your photo"}
          {photos.length > 1 ? ` · ${index + 1} of ${photos.length}` : ""}
        </span>
      </div>
      {photos.length > 1 ? (
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
          <h2 className="text-h3 leading-tight">More photos of this stone</h2>
          <div className="grid grid-cols-2 gap-3">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-pressed={i === index}
                aria-label={`Show photo ${i + 1} of ${photos.length}`}
                className={`h-[170px] overflow-hidden rounded-thumb border-4 bg-tile-stone ${i === index ? "border-azurite" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail */}
                <img src={p.thumbUrl} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
