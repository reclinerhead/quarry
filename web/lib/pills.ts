// What the confirm screen offers for a job: the verdict in words and the pills.
// Phase 0 (#1) settled the rules. Claude Haiku and Gemini Flash were each right
// first time about 3 in 5; when the two agreed they were right nearly 9 in 10.
// So the screen says "probably" only when both models' first choices name the
// same stone, "could be" otherwise, and never shows a percentage. Pure: the
// server builds the plan from the candidates rows, and it is recomputed on
// every render, so the rule can change without rewriting rows. Since #18 the
// candidates carry their Mindat chains, so "the same stone" includes two
// levels of one lineage, and the plan says when the two agree on the stone but
// not on its variety. Since #29 a candidate is a reading of the whole piece, as
// a rock-show label names it (Pyrite with Sphalerite on Quartz): agreement is
// judged mineral by mineral, and pieceName builds the name every screen shows.
// Since #62 an object that is not a mineral (a fossil, sea glass) is named for
// what it is, and the mineral it is made of rides beside the name: shown under
// the pill, never part of the name, and in doubt when the two opinions differ
// on it the way a variety can be. Since #71 a pill carries its reasons: the
// models' own short phrases for the readings that merged into it, for the
// "Why?" under it. Since #73 a candidate and a pill carry the piece's form,
// the shape a rock hound bins it by (geode, cluster, tumbled): a tag beside the
// name, never part of it, and never a reason two readings differ.

import { misfit, TESTS, type Answers, type Misfit, type TestKind } from "./household-tests";
import { finer, norm, sameStone, varietySplit, type MindatRecord, type Named } from "./names";

export type StoneKind = "mineral" | "rock" | "other";

/** The shape of a piece as a rock hound bins it (#73): Jasper's FORMS and the schema's CHECK, in the same order. */
export const FORMS = ["crystal", "cluster", "geode", "druzy", "rough", "tumbled", "slab", "carved"] as const;
export type Form = (typeof FORMS)[number];

/** The form as a tag or a chip says it. */
export const FORM_LABEL: Record<Form, string> = {
  crystal: "Crystal",
  cluster: "Cluster",
  geode: "Geode",
  druzy: "Druzy",
  rough: "Rough",
  tumbled: "Tumbled",
  slab: "Slab",
  carved: "Cut or carved",
};

export function isForm(s: unknown): s is Form {
  return typeof s === "string" && (FORMS as readonly string[]).includes(s);
}

export type PartRole = "with" | "on";

/** Another mineral on the piece (#29): one the main mineral is `with`, or the base it is `on`, which may be MATRIX. */
export type Part = { role: PartRole; name: string; chain?: MindatRecord[] };

/** A base of rock nobody names: "Amethyst on matrix". It names no mineral, so it is never matched or looked up. */
export const MATRIX = "matrix";

export function isMatrix(name: string): boolean {
  return norm(name) === MATRIX;
}

/** What an object that is not a mineral is made of (#62): the mineral it is composed of or preserved as, with its Mindat chain. */
export type MadeOf = { name: string; chain?: MindatRecord[] };

export type Candidate = {
  model: string; // the gateway slug
  rank: number;
  name: string;
  variety: string | null;
  kind: StoneKind;
  confidence: number;
  chain?: MindatRecord[]; // its Mindat record and those above it, when Jasper looked it up
  parts?: Part[]; // the other minerals the model saw on the piece; none on a prompt v1 answer
  madeOf?: MadeOf | null; // a fossil coral made of Calcite; none on a mineral, a rock, or an answer before prompt v3
  features?: string[]; // the model's own short phrases for this reading, as Jasper stored them
  form?: Form | null; // the shape of the piece (#73); none when the model didn't say, or on an answer before prompt v6
};

export type Verdict = "probably" | "could_be" | "none";

export type Pill = {
  name: string;
  variety: string | null; // none while `doubt` is set
  kind: StoneKind;
  chain?: MindatRecord[];
  pick: { model: string; rank: number }; // the candidate a tap names
  models: string[]; // every model that named it
  word: "probably" | "could be";
  // The lead pill only: both first choices name this stone, but Mindat puts
  // them on different varieties of it, so neither variety is taken.
  doubt?: { level: string; guesses: string[] };
  parts: Part[]; // the other minerals on the piece that a tap saves: on the lead pill, those both models saw
  maybe: Part[]; // the lead pill only: minerals one model saw, offered but never saved by the tap alone
  misfit: Misfit | null; // an answered scratch test this stone can't fit; never on a piece with parts
  madeOf: MadeOf | null; // what the object is made of, which a tap saves: on the lead pill, what both models said, or the one that said
  // The lead pill only: both first choices name this object, but each says it is
  // made of a different mineral, so neither is taken.
  madeOfDoubt?: { guesses: string[] };
  reasons: string[]; // what the models saw (#71): the features of every candidate that merged into this pill, each once, at most MAX_REASONS
  form: Form | null; // the shape of the piece (#73): on the lead pill the identifier's, else the other model's; a could-be pill's own
};

/** How many of the models' phrases a pill keeps for its "Why?". */
export const MAX_REASONS = 5;

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
 * - **probably**: the two first choices name the same piece. One lead pill,
 *   then up to two "could be" from the rest of both lists. They name the
 *   same piece when their main minerals are the same stone, or when each model
 *   saw the other's main mineral on it (Pyrite on Quartz, and Quartz with
 *   Pyrite). The lead pill is the identifier's reading: its main mineral, its
 *   base, the `with` minerals the other model saw too, and as `maybe` the
 *   minerals only one of them saw.
 *   When Mindat puts the two first choices on different varieties of that
 *   stone (Amethyst and Citrine, both Quartz), the lead pill carries the
 *   `doubt` and no variety; when one is only finer than the other (Agate under
 *   Chalcedony), the lead pill takes the finer variety.
 * - **could_be**, two opinions: each model's first choice, the identifier's
 *   first, then one more from the rest, each pill its whole reading.
 * - **could_be**, one opinion (the other model failed): its candidates, never
 *   "probably".
 * - **none**: no candidates; the name field leads.
 * A candidate naming a stone already on a pill adds its model to that pill
 * instead of a second pill, and so, after a lead pill, does one led by a
 * mineral already on the piece. `answers` are the job's test answers, for each
 * pill's `misfit`, which a piece with parts never gets: the answer could be
 * about any of them.
 */
export function planPills(candidates: Candidate[], identifier: string, answers: Answers = {}): Plan {
  const lists = byModel(candidates, identifier).slice(0, 2);
  const pills: Pill[] = [];
  const add = (c: Candidate, word: Pill["word"], afterLead = false) => {
    const same = pills.find((p) => sameStone(p, c));
    if (same) {
      if (!same.models.includes(c.model)) same.models.push(c.model);
      if (!same.variety && !same.doubt && c.variety) same.variety = c.variety;
      addReasons(same, c);
      return;
    }
    const piece = afterLead ? pills.find((p) => [...p.parts, ...p.maybe].some((x) => !isMatrix(x.name) && sameStone(asNamed(x), c))) : undefined;
    if (piece) {
      if (!piece.models.includes(c.model)) piece.models.push(c.model);
      addReasons(piece, c);
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
        parts: c.parts ?? [],
        maybe: [],
        misfit: c.parts?.length ? null : misfit(c.chain ?? [], answers),
        madeOf: c.madeOf ?? null,
        reasons: addReasons({ reasons: [] }, c).reasons,
        form: c.form ?? null,
      });
  };

  if (lists.length === 0) return { verdict: "none", opinions: 0, pills };
  if (lists.length === 1) {
    for (const c of lists[0]) add(c, "could be");
    return { verdict: "could_be", opinions: 1, pills };
  }
  const [a, b] = lists;
  const rest = interleave(a.slice(1), b.slice(1));
  const sameMain = sameStone(a[0], b[0]);
  if (sameMain || (saw(a[0], b[0]) && saw(b[0], a[0]))) {
    add(a[0], "probably");
    const lead = pills[0];
    if (sameMain) {
      add(b[0], "probably");
      const split = varietySplit(a[0], b[0]);
      if (split) {
        lead.doubt = { level: split.level.name, guesses: split.guesses.map((g) => g.name) };
        lead.variety = null;
      } else if (b[0].variety && finer(b[0], a[0])) {
        lead.variety = b[0].variety;
        lead.chain = b[0].chain;
        lead.misfit = misfit(b[0].chain ?? [], answers);
      }
    } else {
      lead.models.push(b[0].model);
      addReasons(lead, b[0]);
    }
    const { parts, maybe } = agreedParts(a[0], b[0]);
    lead.parts = parts;
    lead.maybe = maybe;
    if (parts.length > 0) lead.misfit = null;
    const made = agreedMadeOf(a[0], b[0]);
    lead.madeOf = made.madeOf;
    if (made.doubt) lead.madeOfDoubt = made.doubt;
    lead.form = a[0].form ?? b[0].form ?? null;
    for (const c of rest) add(c, "could be", true);
    return { verdict: "probably", opinions: 2, pills };
  }
  add(a[0], "could be");
  add(b[0], "could be");
  for (const c of rest) add(c, "could be");
  return { verdict: "could_be", opinions: 2, pills };
}

/** Put a candidate's features on the pill it merged into (#71): in order, each phrase once ignoring case, at most MAX_REASONS. */
function addReasons<P extends { reasons: string[] }>(pill: P, c: Candidate): P {
  const seen = new Set(pill.reasons.map(norm));
  for (const f of c.features ?? []) {
    if (pill.reasons.length >= MAX_REASONS) break;
    const key = norm(f);
    if (key && !seen.has(key)) {
      seen.add(key);
      pill.reasons.push(f);
    }
  }
  return pill;
}

/** A part as a stone to match: a name with no variety, and its Mindat chain. */
function asNamed(p: Part): Named {
  return { name: p.name, variety: null, chain: p.chain };
}

/** Every mineral a reading names: its main one, then its parts, but not plain matrix. */
function mineralsOf(c: Candidate): Named[] {
  return [c, ...(c.parts ?? []).filter((p) => !isMatrix(p.name)).map(asNamed)];
}

/** Whether a reading names `x` among its minerals. */
function saw(c: Candidate, x: Named): boolean {
  return mineralsOf(c).some((m) => sameStone(m, x));
}

/**
 * The lead pill's parts and maybes: the lead reading's base as it gave it
 * (matrix included), each of its `with` minerals the other reading saw too,
 * and as `maybe` every other mineral only one of the two saw, each once.
 */
function agreedParts(lead: Candidate, other: Candidate): { parts: Part[]; maybe: Part[] } {
  const parts: Part[] = [];
  const maybe: Part[] = [];
  const known = (p: Part) => [...parts, ...maybe].some((q) => !isMatrix(q.name) && sameStone(asNamed(q), asNamed(p)));
  for (const p of lead.parts ?? []) {
    if (p.role === "on" || saw(other, asNamed(p))) parts.push(p);
    else if (!known(p)) maybe.push(p);
  }
  for (const p of other.parts ?? []) if (!isMatrix(p.name) && !saw(lead, asNamed(p)) && !known(p)) maybe.push(p);
  return { parts, maybe };
}

/**
 * What the lead pill says the object is made of (#62): what both first readings
 * said when they agree (Quartz and Chalcedony agree through the chain), the one
 * that said anything when only one did, and neither, as a doubt, when they
 * differ: a coral preserved as Calcite or as Quartz.
 */
function agreedMadeOf(lead: Candidate, other: Candidate): { madeOf: MadeOf | null; doubt?: { guesses: string[] } } {
  const x = lead.madeOf ?? null;
  const y = other.madeOf ?? null;
  if (!x || !y) return { madeOf: x ?? y };
  if (sameStone({ name: x.name, variety: null, chain: x.chain }, { name: y.name, variety: null, chain: y.chain })) return { madeOf: x };
  return { madeOf: null, doubt: { guesses: [x.name, y.name] } };
}

/** The line under a pill or a title that says what the object is made of: "Made of Calcite". */
export function madeOfLine(madeOf: { name: string }): string {
  return `Made of ${stoneName(madeOf.name)}`;
}

/**
 * What a tap on a pill saves as the stone's other minerals: the pill's parts,
 * then each of its `maybe` the person ticked, by name. A label has one base, so
 * a second "on" reads as "with"; the withs come first, then the base.
 */
export function savedParts(pill: Pick<Pill, "parts" | "maybe">, ticked: readonly string[]): Array<{ role: PartRole; name: string }> {
  const want = new Set(ticked.map(norm));
  const all = [...pill.parts, ...pill.maybe.filter((p) => want.has(norm(p.name)))];
  const base = all.find((p) => p.role === "on");
  const withs = all.filter((p) => p !== base && !isMatrix(p.name)).map((p) => ({ role: "with" as const, name: p.name }));
  return base ? [...withs, { role: "on", name: base.name }] : withs;
}

/** A candidate's stored `parts` (JSON, as Jasper writes it), with anything malformed left out. */
export function parseParts(json: string | null): Array<{ role: PartRole; name: string; mindatId: number | null }> {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: unknown) => {
    if (!p || typeof p !== "object") return [];
    const { role, name, mindat_id } = p as { role?: unknown; name?: unknown; mindat_id?: unknown };
    if ((role !== "with" && role !== "on") || typeof name !== "string" || !name.trim()) return [];
    return [{ role, name: name.trim(), mindatId: typeof mindat_id === "number" ? mindat_id : null }];
  });
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

// A variety that is only a colour or a look, as models sometimes give: it reads
// in front of the mineral ("Milky Quartz") rather than standing for it.
const LOOKS = new Set(
  "milky smoky clear colorless colourless specular banded massive red orange yellow green blue purple violet pink white black grey gray brown golden".split(" "),
);

/**
 * A stone's own name, as a rock hound says it (#29): the hobby or trade name when
 * there is one (Amethyst, Blue Lace Agate), else the mineral or rock. A variety that
 * is only a colour or a look goes in front of the mineral: Milky Quartz.
 */
export function ownName(name: string, variety: string | null | undefined): string {
  const v = variety?.trim();
  if (!v) return stoneName(name);
  return stoneName(LOOKS.has(norm(v)) ? `${v} ${name}` : v);
}

/**
 * The name every screen shows, built as a rock-show label is (#29): the stone's own
 * name, then "with" the other minerals in order, then "on" its base. Pyrite with
 * Sphalerite on Quartz; Amethyst on matrix; Galena.
 */
export function pieceName(p: { name: string; variety?: string | null; parts?: ReadonlyArray<{ role: PartRole; name: string }> }): string {
  const parts = p.parts ?? [];
  const withs = parts.filter((x) => x.role === "with").map((x) => stoneName(x.name));
  const on = parts.find((x) => x.role === "on");
  const list = withs.length <= 2 ? withs.join(" and ") : `${withs.slice(0, -1).join(", ")}, and ${withs[withs.length - 1]}`;
  return ownName(p.name, p.variety) + (withs.length ? ` with ${list}` : "") + (on ? ` on ${isMatrix(on.name) ? MATRIX : stoneName(on.name)}` : "");
}

/**
 * The line under a hobby name, where the Mindat plumbing shows: "A kind of Quartz"
 * under Amethyst. Null when the name already says the mineral (Galena, Rose Quartz).
 */
export function kindOf(p: { name: string; variety?: string | null }): string | null {
  if (!p.variety?.trim()) return null;
  return ` ${norm(ownName(p.name, p.variety))} `.includes(` ${norm(p.name)} `) ? null : `A kind of ${stoneName(p.name)}`;
}

/**
 * The verdict as one line: "Probably Galena", "Could be Chalcopyrite or Marcasite", "No guess".
 * After a reading with parts the "or" takes a comma, so "on Quartz, or Calcite" can't read as
 * the base being either.
 */
export function verdictLine(plan: Plan): string {
  const [first, second] = plan.pills;
  if (plan.verdict === "none" || !first) return "No guess";
  if (plan.verdict === "probably") return `Probably ${pieceName(first)}`;
  if (!second) return `Could be ${pieceName(first)}`;
  return `Could be ${pieceName(first)}${first.parts.length > 0 ? "," : ""} or ${pieceName(second)}`;
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
