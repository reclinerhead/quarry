"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CrystalIcon } from "@/components/icons";
import { PhotoView } from "@/components/photo-view";
import { longDay } from "@/lib/collection";

// The photo gallery from DESIGN.md §4: the hero in the dark photo well, 640 px
// tall (360 on a phone), contained rather than cropped, with a caption naming
// the source and date; beside it "More photos of this stone", a 2-across grid
// of thumbnail buttons that swap the hero (selected = a 4 px azurite border
// and aria-pressed). The server sends the main photo first, then the newest
// (#84): the main one is the photo the stone is known by on its card and in
// every list, its thumbnail wears a "Main photo" pill, and under the grid
// "Use this as the main photo" shows while another photo is selected. The
// selection is kept by photo id, not position, so when the save's refresh
// reorders the photos the one the person chose stays in the well.

type Photo = { id: number; url: string; thumbUrl: string; takenAt: string | null; main: boolean };

export function Gallery({ id, photos, name }: { id: number; photos: Photo[]; name: string }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosenId, setChosenId] = useState<number | null>(null); // saved as main, until the refresh shows it as such
  const [error, setError] = useState<string | null>(null);
  const index = Math.max(0, photos.findIndex((p) => p.id === selectedId));
  const hero = photos[index];
  if (!hero)
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2.5 rounded-photo bg-tile-stone">
        <CrystalIcon className="size-14 text-icon-muted" />
        <span className="text-ink-2">No photo yet</span>
      </div>
    );
  const several = photos.length > 1;
  const date = longDay(hero.takenAt);
  const caption = [date ? `Your photo · ${date}` : "Your photo", ...(several ? [`${index + 1} of ${photos.length}`] : []), ...(several && hero.main ? ["Main photo"] : [])].join(" · ");
  const saving = busy || (chosenId === hero.id && !hero.main);

  async function makeMain() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/stones/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ heroPhotoId: hero.id }) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `server ${r.status}`);
      setChosenId(hero.id);
      router.refresh();
    } catch (err) {
      setError(`That wasn’t saved (${err instanceof Error ? err.message : "no answer"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Photos" className="flex flex-wrap items-start gap-6">
      <div className="relative flex h-[360px] min-w-0 flex-[999_1_560px] items-center justify-center overflow-hidden rounded-photo bg-photo-well sm:h-[640px]">
        <PhotoView key={hero.id} url={hero.url} thumbUrl={hero.thumbUrl} alt={`Your photo of the ${name}`} />
        <span className="absolute bottom-3 left-3 rounded-pill bg-caption px-3.5 py-1.5 text-meta font-bold text-white">{caption}</span>
      </div>
      {several ? (
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
          <h2 className="text-h3 leading-tight">More photos of this stone</h2>
          <div className="grid grid-cols-2 gap-3">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-pressed={i === index}
                aria-label={`Show photo ${i + 1} of ${photos.length}${p.main ? ", the main photo" : ""}`}
                className={`relative h-[170px] overflow-hidden rounded-thumb border-4 bg-tile-stone ${i === index ? "border-azurite" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Jasper's 320 px thumbnail */}
                <img src={p.thumbUrl} alt="" className="size-full object-cover" />
                {p.main ? (
                  <span aria-hidden className="absolute bottom-2 left-2 rounded-pill bg-caption px-2.5 py-1 text-meta font-bold text-white">
                    Main photo
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {/* The row keeps its height whether or not the button shows, so choosing a photo never moves the page. */}
          <div className="flex min-h-12 flex-col items-start gap-2">
            {hero.main ? null : (
              <button type="button" onClick={makeMain} disabled={saving} className="btn btn-soft">
                {saving ? "Saving…" : "Use this as the main photo"}
              </button>
            )}
            <p role="status" aria-live="polite" className="min-h-7 text-meta text-warn-ink">
              {error ?? ""}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
