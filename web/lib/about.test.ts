import { describe, expect, it } from "vitest";
import { aboutCard, aboutTerms, paragraphs, type AboutPage } from "./about";

const page = (title: string, summary = `${title} is a rock.`): AboutPage => ({ title, url: `https://en.wikipedia.org/wiki/${title}`, summary, fetchedAt: "2026-11-04T15:00:00.000Z" });

describe("aboutTerms", () => {
  it("tries the variety, the variety before its comma, then the mineral, folded, each once", () => {
    expect(aboutTerms("Quartz", "Agate, banded")).toEqual(["agate, banded", "agate", "quartz"]);
    expect(aboutTerms("Quartz", "Amethyst")).toEqual(["amethyst", "quartz"]);
    expect(aboutTerms("Gneiss", null)).toEqual(["gneiss"]);
    expect(aboutTerms("Quartz", " Quartz ")).toEqual(["quartz"]);
    expect(aboutTerms("Hématite", "")).toEqual(["hematite"]);
  });
});

describe("paragraphs", () => {
  it("splits on blank lines and drops empty ones", () => {
    expect(paragraphs("One.\n\nTwo.\n \n\nThree.")).toEqual(["One.", "Two.", "Three."]);
    expect(paragraphs("  ")).toEqual([]);
  });
});

describe("aboutCard", () => {
  it("shows the first term with an article, headed with the article's title", () => {
    const card = aboutCard([page("Amethyst", "Amethyst is a violet variety of quartz.\n\nIt is a semiprecious stone."), page("Quartz")]);
    expect(card).toEqual({
      state: "page",
      title: "Amethyst",
      url: "https://en.wikipedia.org/wiki/Amethyst",
      paragraphs: ["Amethyst is a violet variety of quartz.", "It is a semiprecious stone."],
      fetchedAt: "2026-11-04T15:00:00.000Z",
    });
  });

  it("falls past a term with no article to the next", () => {
    expect(aboutCard([null, null, page("Gneiss")])).toMatchObject({ state: "page", title: "Gneiss" });
  });

  it("waits while a term before the first article is unasked, not after it", () => {
    expect(aboutCard([undefined, page("Quartz")])).toEqual({ state: "pending" });
    expect(aboutCard([null, undefined])).toEqual({ state: "pending" });
    expect(aboutCard([page("Amethyst"), undefined])).toMatchObject({ state: "page", title: "Amethyst" });
    expect(aboutCard([])).toEqual({ state: "none" }); // no terms, nothing to wait for
  });

  it("is none once every term is asked and none has an article, or the lead is empty", () => {
    expect(aboutCard([null])).toEqual({ state: "none" });
    expect(aboutCard([null, page("Blank", "   ")])).toEqual({ state: "none" });
  });
});
