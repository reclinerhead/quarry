// The kitchen-table tests (DESIGN.md §4 "Test rows"): what each one asks, how
// the confirm screen answers it, and how the answers are stored on a job.
// The kinds are the schema's CHECK on suggested_tests.kind and Jasper's
// TEST_KINDS (jasper/identify.py), in the same order. The questions read the
// way Jasper words the answers back to the models: the stone scratches glass,
// but the knife, the coin and the fingernail scratch the stone.

export const TEST_KINDS = ["glass", "steel", "copper", "fingernail", "streak", "vinegar", "magnet", "uv"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const TESTS: Record<TestKind, { question: string; phrase: string }> = {
  glass: { question: "Does it scratch glass?", phrase: "a scratch on glass" },
  steel: { question: "Does a steel knife or nail scratch it?", phrase: "a steel nail" },
  copper: { question: "Does a copper coin scratch it?", phrase: "a copper coin" },
  fingernail: { question: "Does your fingernail scratch it?", phrase: "a fingernail" },
  streak: { question: "What colour is its streak on the back of a tile?", phrase: "a streak on the back of a tile" },
  vinegar: { question: "Does it fizz in vinegar?", phrase: "a drop of vinegar" },
  magnet: { question: "Does a magnet stick to it?", phrase: "a fridge magnet" },
  uv: { question: "Does it glow under a UV light?", phrase: "a UV flashlight" },
};

export const STREAK_COLOURS = ["white", "grey", "black", "greenish black", "red-brown", "yellow-brown"] as const;

/** A job's or a specimen's answers: "yes", "no", or the streak's colour. A test not tried has no key. */
export type Answers = Partial<Record<TestKind, string>>;

const STREAK_MAX = 40;

export function isTestKind(k: string): k is TestKind {
  return (TEST_KINDS as readonly string[]).includes(k);
}

/**
 * Answers from a request or a column, cleaned: known kinds only; "yes" or
 * "no" for every test but the streak, which is its colour in a few words.
 * Anything else, including "not tried", leaves the key out: not tried is
 * never no (README).
 */
export function cleanAnswers(raw: unknown): Answers {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Answers = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (!isTestKind(k) || typeof value !== "string") continue;
    const t = value.trim().replace(/\s+/g, " ").toLowerCase();
    if (k === "streak") {
      if (t && t !== "not tried" && t !== "not_tried") out.streak = t.slice(0, STREAK_MAX);
    } else if (t === "yes" || t === "no") {
      out[k] = t;
    }
  }
  return out;
}

/**
 * The tests the models suggested, the identifier's first, each kind once: the
 * order the "Want to be sure?" panel asks them in.
 */
export function suggestedOrder<T extends { model: string; rank: number; kind: string }>(tests: T[], identifier: string): T[] {
  const sorted = tests.toSorted((a, b) => (a.model === b.model ? a.rank - b.rank : a.model === identifier ? -1 : b.model === identifier ? 1 : a.model.localeCompare(b.model)));
  const seen = new Set<string>();
  return sorted.filter((t) => isTestKind(t.kind) && !seen.has(t.kind) && seen.add(t.kind));
}
