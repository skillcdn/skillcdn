// The documentation as the build hands it to the pages (dev/docs.ts, ADR-0049): the catalog, which
// is small and may be imported anywhere, and the content, which only the documentation page
// loads. Both are made from docs/nav.json and the Markdown files it names when the pages are built.

declare module "virtual:skillcdn-docs-catalog" {
  import type { DocsCatalog } from "./types.js";

  export const DOCS_CATALOG: DocsCatalog;
}

declare module "virtual:skillcdn-docs-content" {
  import type { DocsContent } from "./types.js";

  export const DOCS_CONTENT: DocsContent;
}
