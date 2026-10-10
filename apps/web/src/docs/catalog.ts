import { DOCS_CATALOG } from "virtual:skillcdn-docs-catalog";
import type { Messages } from "../i18n/messages/en.js";
import type { DocsPage, DocsSection } from "./types.js";

// What the documentation holds (ADR-0049), as the build read it from docs/nav.json: the sections
// and their pages in order, and the pages by slug. Small enough for the router and the head to
// import; the text of the pages is another module, loaded with the documentation page alone.

export const DOCS_SECTIONS: readonly DocsSection[] = DOCS_CATALOG.sections;

/** Every page, in the order the navigation lists them. */
export const DOCS_PAGES: readonly DocsPage[] = DOCS_SECTIONS.flatMap((section) => section.pages);

const BY_SLUG: ReadonlyMap<string, DocsPage> = new Map(DOCS_PAGES.map((page) => [page.slug, page]));

/** The page that says how to write a repository: where the pages send an author. */
export const AUTHORS_GUIDE_SLUG = "write-a-repository";

export function docsPage(slug: string): DocsPage | undefined {
  return BY_SLUG.get(slug);
}

export function hasDocsPage(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/** The pages before and after one, in the order the navigation lists them. */
export function docsNeighbours(slug: string): {
  readonly previous: DocsPage | undefined;
  readonly next: DocsPage | undefined;
} {
  const at = DOCS_PAGES.findIndex((page) => page.slug === slug);
  return {
    previous: at > 0 ? DOCS_PAGES[at - 1] : undefined,
    next: at >= 0 ? DOCS_PAGES[at + 1] : undefined,
  };
}

/**
 * The label of a section in the visitor's language. A section of docs/nav.json is named in the
 * language packs; a test keeps the two in step, and the id stands in should they ever differ.
 */
export function docsSectionLabel(t: Messages, section: string): string {
  const labels: Readonly<Record<string, string | undefined>> = t.docs.sections;
  return labels[section] ?? section;
}
