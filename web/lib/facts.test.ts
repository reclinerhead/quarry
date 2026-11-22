import { describe, expect, it } from "vitest";
import type { AboutPage } from "./about";
import {
  aboutNames,
  aboutPick,
  allBeliefs,
  listOf,
  loreBand,
  loreIntro,
  loreMeta,
  shortSource,
  workParts,
  FACT_ANCHOR,
  FACT_CYCLE_DAYS,
  FACT_ID,
  FACT_STAMP,
  factCredit,
  factCycleDay,
  factOfTheDay,
  factTitles,
  localDayNumber,
  moreAbout,
  parseFacts,
  type Fact,
  type FactKind,
} from "./facts";

const WIKI = { author: null, work: "Wikipedia", year: null, url: "https://en.wikipedia.org/wiki/Amethyst" };
const PLINY = { author: "Pliny the Elder", work: "Natural History", year: "about AD 77", url: "https://www.gutenberg.org/ebooks/62704" };
const SALT = "2026-10-31T18:04:11.000Z"; // the household's oldest stone

const fact = (id: string, kind: FactKind = "fact", textOf = `Fact ${id}.`): Fact => ({ id, text: textOf, quote: "A quote.", kind, source: kind === "lore" ? PLINY : WIKI });
const id = (n: number) => n.toString(16).padStart(10, "0");
const page = (title: string, summary = `${title} is a mineral.`): AboutPage => ({ title, url: `https://en.wikipedia.org/wiki/${title}`, summary, fetchedAt: "2026-11-04T15:00:00.000Z" });

/** The first `n` ids that land on the same cycle day as `first` under a salt. */
function sharing(first: string, salt: string, n: number): string[] {
  const out = [first];
  for (let i = 1; out.length < n; i++) if (id(i) !== first && factCycleDay(id(i), salt) === factCycleDay(first, salt)) out.push(id(i));
  return out;
}

describe("parseFacts", () => {
  it("reads Jasper's list with each fact's source and the row's kind", () => {
    const json = JSON.stringify([{ id: "0123456789", text: " Greeks carved cups from it. ", quote: "Ancient Greeks wore amethyst.", source: WIKI }]);
    expect(parseFacts(json, "fact")).toEqual([{ id: "0123456789", text: "Greeks carved cups from it.", quote: "Ancient Greeks wore amethyst.", kind: "fact", source: WIKI }]);
    expect(parseFacts(JSON.stringify([{ id: "a", text: "Romans said it.", quote: "q", source: { ...PLINY, year: 77 } }]), "lore")[0]).toMatchObject({ kind: "lore", source: { author: "Pliny the Elder", year: "77" } });
  });

  it("drops what is malformed: no id, no text, no source, not a list, not JSON", () => {
    expect(parseFacts(JSON.stringify([{ text: "No id.", source: WIKI }, { id: "a", source: WIKI }, { id: "b", text: "No source." }, "loose", null]), "fact")).toEqual([]);
    expect(parseFacts('{"facts": []}', "fact")).toEqual([]);
    expect(parseFacts("[", "fact")).toEqual([]);
    expect(parseFacts(null, "fact")).toEqual([]);
    expect(parseFacts("[]", "fact")).toEqual([]);
  });
});

describe("factCycleDay", () => {
  it("is in range, stable, and moved by the salt", () => {
    const days = Array.from({ length: 300 }, (_, i) => factCycleDay(id(i), SALT));
    expect(days.every((d) => Number.isInteger(d) && d >= 0 && d < FACT_CYCLE_DAYS)).toBe(true);
    expect(factCycleDay(id(7), SALT)).toBe(factCycleDay(id(7), SALT));
    expect(new Set(days).size).toBeGreaterThan(60); // spread over the cycle, not bunched
    expect(days.filter((d, i) => d !== factCycleDay(id(i), "another household")).length).toBeGreaterThan(280);
  });
});

describe("localDayNumber", () => {
  it("counts local calendar days, the same all day", () => {
    const morning = localDayNumber(new Date(2026, 10, 21, 0, 5));
    expect(localDayNumber(new Date(2026, 10, 21, 23, 55))).toBe(morning);
    expect(localDayNumber(new Date(2026, 10, 22, 0, 5))).toBe(morning + 1);
  });
});

describe("factOfTheDay", () => {
  const titles = new Set(["Amethyst"]);

  it("shows the fact whose day it is, and nothing on a day none is due", () => {
    const f = fact(id(1));
    const pool = [{ title: "Amethyst", facts: [f] }];
    const day = factCycleDay(f.id, SALT);
    expect(factOfTheDay(pool, titles, SALT, day)).toEqual({ title: "Amethyst", fact: f });
    expect(factOfTheDay(pool, titles, SALT, day + 1)).toBeNull();
    expect(factOfTheDay(pool, titles, SALT, day + FACT_CYCLE_DAYS)).toEqual({ title: "Amethyst", fact: f }); // a whole cycle later
    expect(factOfTheDay([], titles, SALT, day)).toBeNull();
  });

  it("gives several due on one day a turn each, one per cycle", () => {
    const ids = sharing(id(1), SALT, 3);
    const pool = [{ title: "Amethyst", facts: ids.map((i) => fact(i)) }];
    const day = factCycleDay(ids[0], SALT);
    const shown = [0, 1, 2, 3].map((c) => factOfTheDay(pool, titles, SALT, day + c * FACT_CYCLE_DAYS)!.fact.id);
    expect(new Set(shown.slice(0, 3))).toEqual(new Set(ids));
    expect(shown[3]).toBe(shown[0]);
  });

  it("lets a fact and an old belief due on the same day take turns, each with its stamp and its section", () => {
    const [a, b] = sharing(id(1), SALT, 2);
    const pool = [{ title: "Amethyst", facts: [fact(a, "fact"), fact(b, "lore")] }];
    const day = factCycleDay(a, SALT);
    const kinds = [0, 1].map((c) => factOfTheDay(pool, titles, SALT, day + c * FACT_CYCLE_DAYS)!.fact.kind);
    expect([...kinds].sort()).toEqual(["fact", "lore"]);
    expect([FACT_STAMP.fact, FACT_STAMP.lore]).toEqual(["Did you know?", "Once believed"]);
    expect([FACT_ANCHOR.fact, FACT_ANCHOR.lore]).toEqual(["did-you-know", "once-believed"]);
  });

  it("never picks a fact of a title the household has no stone for", () => {
    const f = fact(id(1));
    const pool = [{ title: "Pyrite", facts: [f] }];
    expect(factOfTheDay(pool, titles, SALT, factCycleDay(f.id, SALT))).toBeNull();
    expect(factOfTheDay(pool, new Set(["Pyrite"]), SALT, factCycleDay(f.id, SALT))).toMatchObject({ title: "Pyrite" });
  });

  it("shows nothing once today's fact is dismissed, rather than the next in line", () => {
    const ids = sharing(id(1), SALT, 2);
    const pool = [{ title: "Amethyst", facts: ids.map((i) => fact(i)) }];
    const day = factCycleDay(ids[0], SALT);
    const today = factOfTheDay(pool, titles, SALT, day)!.fact.id;
    expect(factOfTheDay(pool, titles, SALT, day, today)).toBeNull();
    expect(factOfTheDay(pool, titles, SALT, day, ids.find((i) => i !== today))).toMatchObject({ fact: { id: today } }); // yesterday's cookie
  });

  it("picks differently under two salts", () => {
    const pool = [{ title: "Amethyst", facts: Array.from({ length: 80 }, (_, i) => fact(id(i))) }];
    const week = (salt: string) => Array.from({ length: 30 }, (_, d) => factOfTheDay(pool, titles, salt, 20_000 + d)?.fact.id ?? null);
    expect(week(SALT)).not.toEqual(week("2026-11-08T12:00:00.000Z"));
    expect(week(SALT).filter(Boolean).length).toBeGreaterThan(10); // about six days in ten
  });

  it("counts a fact stored under two sources once", () => {
    const f = fact(id(1));
    const pool = [{ title: "Amethyst", facts: [f, f] }];
    expect(factOfTheDay(pool, titles, SALT, factCycleDay(f.id, SALT))).toEqual({ title: "Amethyst", fact: f });
  });
});

describe("the household's titles", () => {
  it("names a stone's terms as written, in the About card's order", () => {
    expect(aboutNames("Quartz", "Agate, banded")).toEqual(["Agate, Banded", "Agate", "Quartz"]);
    expect(aboutNames("tourmaline", " schorl ")).toEqual(["Schorl", "Tourmaline"]);
    expect(aboutNames("Gneiss", null)).toEqual(["Gneiss"]);
    expect(aboutNames("Quartz", "quartz")).toEqual(["Quartz"]);
  });

  it("picks the article the About card shows, with the household's name for it", () => {
    expect(aboutPick({ names: ["Schorl", "Tourmaline"], rows: [page("Tourmaline"), page("Tourmaline")] })).toEqual({ title: "Tourmaline", name: "Schorl" });
    expect(aboutPick({ names: ["Granite Gneiss", "Gneiss"], rows: [page("Gneiss"), page("Gneiss")] })).toEqual({ title: "Gneiss", name: "Granite Gneiss" });
    expect(aboutPick({ names: ["Amethyst", "Quartz"], rows: [page("Amethyst"), page("Quartz")] })).toEqual({ title: "Amethyst", name: "Amethyst" });
    expect(aboutPick({ names: ["Citrine", "Quartz"], rows: [null, page("Quartz")] })).toEqual({ title: "Quartz", name: "Quartz" });
    expect(aboutPick({ names: ["Citrine", "Quartz"], rows: [undefined, page("Quartz")] })).toBeNull(); // the card still waits
    expect(aboutPick({ names: ["Fossil Coral"], rows: [null] })).toBeNull();
    expect(aboutPick({ names: ["Blank"], rows: [page("Blank", "  ")] })).toBeNull();
  });

  it("gathers each title once, under the first stone that reads it", () => {
    const titles = factTitles([
      { id: 3, names: ["Schorl", "Tourmaline"], rows: [page("Tourmaline"), page("Tourmaline")] },
      { id: 5, names: ["Granite Gneiss", "Gneiss"], rows: [page("Gneiss"), page("Gneiss")] },
      { id: 8, names: ["Tourmaline"], rows: [page("Tourmaline")] },
      { id: 9, names: ["Fossil Coral"], rows: [null] },
    ]);
    expect([...titles]).toEqual([
      ["Tourmaline", { stoneId: 3, name: "Schorl" }],
      ["Gneiss", { stoneId: 5, name: "Granite Gneiss" }],
    ]);
  });
});

describe("the strip's words", () => {
  it("credits the author when there is one, else the work", () => {
    expect(factCredit(WIKI)).toBe("Wikipedia");
    expect(factCredit(PLINY)).toBe("Pliny the Elder");
  });

  it("says the button in the household's name for the mineral", () => {
    expect(moreAbout("Amethyst")).toBe("More about amethyst");
    expect(moreAbout("Blue Lace Agate")).toBe("More about blue lace agate");
  });

  it("knows a fact id from anything else a cookie could hold", () => {
    expect(FACT_ID.test("0a1b2c3d4e")).toBe(true);
    expect(["", "0a1b2c3d4", "0a1b2c3d4e5", "0A1B2C3D4E", "../../etc"].some((v) => FACT_ID.test(v))).toBe(false);
  });
});

describe("the Once believed band", () => {
  const KUNZ = { author: "G. F. Kunz", work: "The Curious Lore of Precious Stones", year: "1913", url: "https://www.gutenberg.org/ebooks/57978" };
  const lore = (i: number, source = PLINY): Fact => ({ id: id(i), text: `Belief ${i}.`, quote: `Passage ${i}.`, kind: "lore", source });
  const pool = [lore(1), lore(2), lore(3), lore(4, KUNZ), lore(5, KUNZ), lore(6, KUNZ), lore(7, KUNZ)];

  it("leads with the first belief, puts the next three beside it, and keeps every one for the list", () => {
    const band = loreBand(pool)!;
    expect(band.lead).toBe(pool[0]);
    expect(band.more).toEqual([pool[1], pool[2], pool[3]]);
    expect(band.all).toEqual(pool); // the expanded list, in pool order
    expect(allBeliefs(band.all.length)).toBe("All 7 old beliefs, with their sources");
    expect(band.credits).toEqual(["Pliny the Elder", "G. F. Kunz"]);
    expect(band.ancient).toBe(true);
  });

  it("leads with today's scheduled belief when the stone has one, the rest keeping their order", () => {
    const band = loreBand(pool, id(5))!;
    expect(band.lead).toBe(pool[4]);
    expect(band.more).toEqual([pool[0], pool[1], pool[2]]);
    expect(band.all).toEqual(pool);
    expect(loreBand(pool, id(99))!.lead).toBe(pool[0]); // today's fact is another stone's, or a Wikipedia fact
    expect(loreBand(pool, null)!.lead).toBe(pool[0]);
  });

  it("is none for a title with no lore, and never counts a fact or a repeat", () => {
    expect(loreBand([])).toBeNull();
    expect(loreBand([fact(id(1))])).toBeNull();
    const band = loreBand([fact(id(1)), lore(2), lore(2), lore(3, KUNZ)])!;
    expect(band.all.map((f) => f.id)).toEqual([id(2), id(3)]);
    expect(band.more).toEqual([band.all[1]]);
    expect(loreBand([lore(4, KUNZ)])).toMatchObject({ more: [], credits: ["G. F. Kunz"], ancient: false });
  });

  it("gives each belief its source line, short beside a headline and whole under a passage", () => {
    expect(shortSource(PLINY)).toBe("Pliny the Elder, about AD 77");
    expect(shortSource(KUNZ)).toBe("G. F. Kunz, 1913");
    expect(shortSource(WIKI)).toBe("Wikipedia");
    expect(workParts("Natural History, Book 37")).toEqual(["Natural History", ", Book 37"]);
    expect(workParts(KUNZ.work)).toEqual(["The Curious Lore of Precious Stones", ""]);
  });

  it("names the sources this mineral has, in the household's name for it", () => {
    expect(loreMeta("Agate", ["Pliny the Elder", "G. F. Kunz"])).toBe("Old lore about agate · from Pliny the Elder and G. F. Kunz");
    expect(loreMeta("Schorl", ["G. F. Kunz"])).toBe("Old lore about schorl · from G. F. Kunz");
    expect(listOf(["A", "B", "C"])).toBe("A, B, and C");
  });

  it("says once, over the band, that none of it holds up, with the span of the oldest source", () => {
    expect(loreIntro("Agate", true)).toBe("For two thousand years people wrote down what an agate could do for the one who carried it. None of it holds up. All of it is worth telling.");
    expect(loreIntro("Tourmaline", false)).toBe("For hundreds of years people wrote down what a tourmaline could do for the one who carried it. None of it holds up. All of it is worth telling.");
  });
});
