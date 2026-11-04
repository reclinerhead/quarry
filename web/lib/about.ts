// "About [mineral]" on a stone's page (#92): Wikipedia's lead paragraphs, which
// Jasper fetches once per name and keeps in `wikipedia_pages` (jasper.md).
// Pure: `readStone` looks each of the stone's terms up and hands the rows here.
// The terms are the ones Jasper asks for, most specific first: the variety as
// written, the variety before its first comma, then the mineral's name, so an
// Amethyst reads Amethyst's article and a Granite Gneiss lands on Gneiss.

import { fold } from "./mindat";

/** One term's page as Jasper stored it. */
export type AboutPage = { title: string; url: string; summary: string; fetchedAt: string };

/** A term's row: `undefined` when Jasper hasn't asked yet, `null` when Wikipedia has no article for it. */
export type AboutRow = AboutPage | null | undefined;

/**
 * - `page`: the first term with an article, headed with the article's title.
 * - `none`: every term is asked and none has an article.
 * - `pending`: a term before the first article isn't asked yet, so the card
 *   waits rather than show a parent's paragraph the next load would swap.
 */
export type AboutCard =
  | { state: "page"; title: string; url: string; paragraphs: string[]; fetchedAt: string }
  | { state: "none" }
  | { state: "pending" };

/** The terms a stone's About card tries, folded as `wikipedia_pages.term` is, each once, in order. */
export function aboutTerms(name: string, variety: string | null): string[] {
  const out: string[] = [];
  for (const t of [variety, variety?.split(",")[0], name]) {
    const f = fold(t ?? "");
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** The lead as paragraphs: Jasper stores them with a blank line between. */
export function paragraphs(summary: string): string[] {
  return summary
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The card from the rows in the terms' order. */
export function aboutCard(rows: AboutRow[]): AboutCard {
  for (const r of rows) {
    if (r === undefined) return { state: "pending" };
    if (r !== null) {
      const ps = paragraphs(r.summary);
      if (ps.length) return { state: "page", title: r.title, url: r.url, paragraphs: ps, fetchedAt: r.fetchedAt };
    }
  }
  return { state: "none" };
}
