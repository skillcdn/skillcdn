// The documentation of the repository as the pages receive it (ADR-0049): what the build read
// from docs/nav.json and the Markdown files it names. The build tooling (dev/docs.ts) writes
// these; the pages read them from the virtual modules declared in virtual.d.ts.

/** A heading of a page, for the table of contents; its id is what a fragment of a link names. */
export interface DocsHeading {
  readonly level: 2 | 3;
  readonly text: string;
  readonly id: string;
}

export interface DocsPage {
  /** The last segment of the page's URL: `/docs/<slug>`. */
  readonly slug: string;
  /** The Markdown file the page is rendered from, as a path from the repository root. */
  readonly file: string;
  readonly title: string;
  /** What the page is about, in a sentence or two: the description search engines show. */
  readonly description: string;
  /** The id of the section of docs/nav.json the page is listed under. */
  readonly section: string;
  readonly headings: readonly DocsHeading[];
}

export interface DocsSection {
  readonly id: string;
  readonly pages: readonly DocsPage[];
}

/** Every published page, in the order the navigation lists them. */
export interface DocsCatalog {
  readonly sections: readonly DocsSection[];
}

/** The text of one page, in the two forms it is served in. */
export interface DocsText {
  /**
   * The Markdown the page renders: without the title heading, which the page sets itself, and
   * with every link resolved, to a path of the site for a published page and to the source at
   * the git host for anything else.
   */
  readonly body: string;
  /**
   * The Markdown served beside the page for agents, whole, with every link resolved to an
   * absolute URL: the Markdown of a published page, or the source at the git host.
   */
  readonly source: string;
}

export type DocsContent = Readonly<Record<string, DocsText>>;
