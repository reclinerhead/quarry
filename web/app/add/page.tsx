import { Uploader } from "@/components/uploader";

export const metadata = { title: "Add a rock · The Quarry" };

// Both of the README's ways in: the camera-roll batch after a trip, and the
// photo taken at the kitchen table. Each photo becomes a queued job for Jasper;
// the name goes on afterwards, on the confirm screen (#8).
export default function AddPage() {
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 pb-16 pt-8 sm:px-10 sm:pb-[72px] sm:pt-10">
      <section aria-labelledby="add-h" className="flex flex-col gap-1.5">
        <h1 id="add-h" className="text-[36px] leading-tight sm:text-h1 sm:leading-[1.1]">
          Add a rock
        </h1>
        <p className="max-w-[60ch] text-lead text-ink-2">
          Take a photo now, or choose the ones already on your phone. Jasper looks at each one and suggests what it might be, and you put
          the name on it afterwards.
        </p>
      </section>
      <Uploader />
    </main>
  );
}
