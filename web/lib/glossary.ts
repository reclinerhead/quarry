// The app teaches (README, "Explain itself"). Every mineralogical term a
// screen shows carries an info mark that opens one of these: two or three
// plain sentences. Phase 2 grows the list and adds examples from the
// household's own stones; the confirm screen (#8) starts it with the words it
// uses. A test checks that every key the tests panel needs exists and that no
// entry runs long.

import type { TestKind } from "./household-tests";

export type GlossaryEntry = {
  term: string; // how the word is shown
  text: string; // two or three sentences, plain language
};

export const GLOSSARY = {
  opinions: {
    term: "two opinions",
    text: "Jasper asks two different AI models about every photo. When both name the same stone it says “probably”; tested on stones experts had named, they were right about 9 times in 10 when they agreed. When they differ it says “could be”, and a kitchen-table test can settle it.",
  },
  variety: {
    term: "variety",
    text: "A named kind of a mineral, set apart by its colour or by how it formed. Amethyst is a purple variety of quartz, and agate a banded variety of chalcedony. Shop names like Tiger’s Eye or Blue Lace Agate go here too.",
  },
  hardness: {
    term: "hardness",
    text: "How easily a mineral scratches, on the Mohs scale from 1 (talc) to 10 (diamond). A fingernail is about 2.5, a copper coin 3.5, and glass or a steel nail about 5.5, so what scratches a stone narrows down what it can be.",
  },
  streak: {
    term: "streak",
    text: "The colour of a mineral’s powder, seen by rubbing it across the back of a plain white tile. It is often not the colour of the stone: hematite can look black or silver but always leaves a red-brown streak, which is how it tells lookalikes apart.",
  },
  fizz: {
    term: "fizz",
    text: "Calcite and its cousins fizz in vinegar, because the acid frees the carbon dioxide in them. Quartz and fluorite, which can look just like calcite, never fizz. A drop on a clean corner is enough.",
  },
  magnetism: {
    term: "magnetic",
    text: "A few minerals, magnetite above all, hold a fridge magnet. Most metallic-looking stones do not, so a magnet that sticks is a strong clue.",
  },
  fluorescence: {
    term: "glows under UV",
    text: "Some minerals glow in bright colours under an ultraviolet flashlight, though they look ordinary in daylight. Fluorite gave the glow its name, fluorescence. Not every piece of a mineral glows, so a no proves little.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function entry(k: GlossaryKey): GlossaryEntry {
  return GLOSSARY[k];
}

/** The idea behind each kitchen-table test, for its info mark. */
export const TEST_TERM: Record<TestKind, GlossaryKey> = {
  glass: "hardness",
  steel: "hardness",
  copper: "hardness",
  fingernail: "hardness",
  streak: "streak",
  vinegar: "fizz",
  magnet: "magnetism",
  uv: "fluorescence",
};
