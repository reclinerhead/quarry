"use client";

import { useEffect, useState } from "react";
import { RockHammerIcon } from "@/components/icons";

// Jasper at work (#31): the tapping hammer and a rock hound's line that changes
// every few seconds, while Jasper has a rock. On the add page's sent rows and
// the dashboard's working strip. Decoration only: the status beside it says
// where things stand, so it is hidden from screen readers and sits in no live
// region. Plain words only, since a line that keeps changing can't carry an
// info mark, and short enough to stay on one line in a sent row at 390 px.

const LINES = [
  "Digging in…",
  "Giving it a lick…",
  "Hand lens out…",
  "Sifting the gravel…",
  "Tap, tap, tap…",
  "Checking the shine…",
  "Brushing it off…",
  "Splitting a geode…",
  "Asking an old-timer…",
  "Rinsing off the mud…",
];
const EVERY_MS = 2500;

/**
 * `seed` (a job id) offsets the line, so rows side by side never say the same
 * thing. Every row steps on the same wall-clock beat rather than its own
 * timer, which would drift into step with a row sent a second later.
 */
export function JasperAtWork({ seed, className = "" }: { seed: number; className?: string }) {
  const [beat, setBeat] = useState(0); // 0 until the first beat, so the server and the first render agree
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => (timer = setTimeout(step, EVERY_MS - (Date.now() % EVERY_MS)));
    const step = () => {
      if (!still.matches) setBeat(Math.floor(Date.now() / EVERY_MS));
      wait();
    };
    wait();
    return () => clearTimeout(timer);
  }, []);
  const at = (seed + beat) % LINES.length;
  return (
    <p aria-hidden className={`flex items-center gap-2 ${className}`}>
      <RockHammerIcon className="size-[1.5em] flex-none text-azurite" />
      <span key={at} className="animate-line-in whitespace-nowrap motion-reduce:animate-none">
        {LINES[at]}
      </span>
    </p>
  );
}
