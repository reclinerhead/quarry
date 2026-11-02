// What the confirm screen offers for a job: the verdict in words and the pills.
// Phase 0 (#1) settled the rules. Claude Haiku and Gemini Flash were each right
// first time about 3 in 5; when the two agreed they were right nearly 9 in 10.
// So the screen says "probably" only when both models' first choices name the
// same stone, "could be" otherwise, and never shows a percentage. Pure: the
// server builds the plan from the candidates rows, and it is recomputed on
// every render, so the rule can change without rewriting rows. Since #18 the
// candidates carry their Mindat chains, so "the same stone" includes two
// levels of one lineage, and the plan says when the two agree on the stone but
// not on its variety.

import { misfit, TESTS, type Answers, type Misfit, type TestKind } from "./household-tests";
import { finer, sameStone, varietySplit, type MindatRecord } from "./names";

export type StoneKind = "mineral" | "rock" | "other";

export type Candidate = {
  model: string; // the gateway slug
  rank: number;
  name: string;
  variety: string | null;
  kind: StoneKind;
  confidence: number;
  chain?: MindatRecord[]; // its Mindat record and those above it, when Jasper looked it up
};

export type Verdict = "probably" | "could_be" | "none";

export type Pill = {
  name: string;
  variety: string | null; // none while `doubt` is set
  kind: StoneKind;
  chain?: MindatRecord[];
  pick: { model: string; rank: number }; // the candidate a tap names
  models: string[]; // every model that named it
  word: "probably" | "could be" | "could also be";
  // The lead pill only: both first choices name this stone, but Mindat puts
  // them on different varieties of it, so neither variety is taken.
  doubt?: { level: string; guesses: string[] };
  misfit: Misfit | null; // an answered scratch test this stone can't fit
};

export type Plan = { verdict: Verdict; opinions: number; pills: Pill[] };

export const MAX_PILLS = 3;

/** Each model's candidates in rank order: the identifier's first, then the others by slug. */
export function byModel(candidates: Candidate[], identifier: string): Candidate[][] {
  const lists = new Map<string, Candidate[]>();
  for (const c of candidates) lists.set(c.model, [...(lists.get(c.model) ?? []), c]);
  const order = [...lists.keys()].sort((a, b) => (a === identifier ? -1 : b === identifier ? 1 : a.localeCompare(b)));
  return order.map((m) => lists.get(m)!.toSorted((a, b) => a.rank - b.rank));
}

/**
 * - **probably**: both first choices name the same stone. One lead pill, then
 *   up to two "could also be" from the rest of both lists. When Mindat puts
 *   the two first choices on different varieties of that stone (Amethyst and
 *   Citrine, both Quartz), the lead pill carries the `doubt` and no variety;
 *   when one is only finer than the other (Agate under Chalcedony), the lead
 *   pill takes the finer variety.
 * - **could_be**, two opinions: each model's first choice, the identifier's
 *   first, then one more from the rest.
 * - **could_be**, one opinion (the other model failed): its candidates, never
 *   "probably".
 * - **none**: no candidates; the name field leads.
 * A candidate naming a stone already on a pill adds its model to that pill
 * instead of a second pill. `answers` are the job's test answers, for each
 * pill's `misfit`.
 */
export function planPills(candidates: Candidate[], identifier: string, answers: Answers = {}): Plan {
  const lists = byModel(candidates, identifier).slice(0, 2);
  const pills: Pill[] = [];
  const add = (c: Candidate, word: Pill["word"]) => {
    const same = pills.find((p) => sameStone(p, c));
    if (same) {
      if (!same.models.includes(c.model)) same.models.push(c.model);
      if (!same.variety && !same.doubt && c.variety) same.variety = c.variety;
      return;
    }
    if (pills.length < MAX_PILLS)
      pills.push({
        name: c.name,
        variety: c.variety,
        kind: c.kind,
        chain: c.chain,
        pick: { model: c.model, rank: c.rank },
        models: [c.model],
        word,
        misfit: misfit(c.chain ?? [], answers),
      });
  };

  if (lists.length === 0) return { verdict: "none", opinions: 0, pills };
  if (lists.length === 1) {
    for (const c of lists[0]) add(c, "could be");
    return { verdict: "could_be", opinions: 1, pills };
  }
  const [a, b] = lists;
  const rest = interleave(a.slice(1), b.slice(1));
  if (sameStone(a[0], b[0])) {
    add(a[0], "probably");
    add(b[0], "probably");
    const lead = pills[0];
    const split = varietySplit(a[0], b[0]);
    if (split) {
      lead.doubt = { level: split.level.name, guesses: split.guesses.map((g) => g.name) };
      lead.variety = null;
    } else if (b[0].variety && finer(b[0], a[0])) {
      lead.variety = b[0].variety;
      lead.chain = b[0].chain;
      lead.misfit = misfit(b[0].chain ?? [], answers);
    }
    for (const c of rest) add(c, "could also be");
    return { verdict: "probably", opinions: 2, pills };
  }
  add(a[0], "could be");
  add(b[0], "could be");
  for (const c of rest) add(c, "could be");
  return { verdict: "could_be", opinions: 2, pills };
}

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/** "Milky quartz" -> "Milky Quartz", "tiger's eye" -> "Tiger's Eye": mineral names are capitalized (DESIGN.md §3). */
export function stoneName(name: string): string {
  return name.replace(/(^|[\s-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The verdict as one line: "Probably Galena", "Could be Chalcopyrite or Marcasite", "No guess". */
export function verdictLine(plan: Plan): string {
  const [first, second] = plan.pills;
  if (plan.verdict === "none" || !first) return "No guess";
  if (plan.verdict === "probably") return `Probably ${stoneName(first.name)}`;
  return second ? `Could be ${stoneName(first.name)} or ${stoneName(second.name)}` : `Could be ${stoneName(first.name)}`;
}

/**
 * The pending strip's line about the first stone waiting (DESIGN.md §4):
 * Jasper's guess and, when it is torn, the test that would settle it.
 * `failed` is a job Jasper could not look at.
 */
export function stripLine(plan: Plan, failed: boolean, firstTest?: TestKind): string {
  if (plan.verdict === "none" || plan.pills.length === 0)
    return failed
      ? "Jasper couldn’t look at the first one, so the name is up to you."
      : "Jasper had no guess for the first one, so the name is up to you.";
  const guess = verdictLine(plan).replace(/^\w/, (ch) => ch.toLowerCase());
  const line = `Jasper’s guess for the first one: ${guess}.`;
  if (plan.verdict === "probably" || plan.pills.length < 2 || !firstTest) return line;
  const phrase = TESTS[firstTest].phrase;
  return `${line} ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} would tell them apart.`;
}
