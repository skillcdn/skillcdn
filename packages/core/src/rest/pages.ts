// The pages of a deployment that the server and the web build agree on: where a search across
// the packs is answered as a page (ADR-0075), and which sections of the front page an operator
// may leave out. The words of every page stay in the web build; this is only what is shared.

/**
 * Where the pages answer a search across the packs of the deployment: `/search` is the page
 * with the box alone, and `/search/<term>` the results of one term, the term as its one segment.
 * `/search?q=<text>` is answered by a redirect to the page of the term.
 */
export const SEARCH_PAGE_PATH = "/search";

/** The query parameter a search box submits, which the server turns into the page of the term. */
export const SEARCH_QUERY_PARAM = "q";

/** The longest term a results page is made for; what is longer is cut to it. */
export const MAX_SEARCH_TERM_LENGTH = 120;

/**
 * A term as every spelling of it is written: trimmed, its runs of whitespace one space, control
 * characters out, cut to the limit. Empty for nothing to search. Case is kept: the search reads
 * words without it, and the page shows the term as it was typed.
 */
export function normalizeSearchTerm(text: string): string {
  return text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_TERM_LENGTH)
    .trim();
}

/** The path of the results page of a term, `/search/<term>`; the page of the box alone for none. */
export function searchPagePath(term: string): string {
  const normalized = normalizeSearchTerm(term);
  return normalized === ""
    ? SEARCH_PAGE_PATH
    : `${SEARCH_PAGE_PATH}/${encodeURIComponent(normalized)}`;
}

/**
 * The term a path names: the decoded segment of `/search/<term>`, `""` for `/search`, and
 * `undefined` for a path that is neither, or a segment that is not percent-encoded text. What
 * it answers is as written, not normalized: the server compares the two to decide on a redirect.
 */
export function searchTermOfPath(pathname: string): string | undefined {
  if (pathname === SEARCH_PAGE_PATH) {
    return "";
  }
  if (!pathname.startsWith(`${SEARCH_PAGE_PATH}/`)) {
    return undefined;
  }
  const segment = pathname.slice(SEARCH_PAGE_PATH.length + 1);
  if (segment === "" || segment.includes("/")) {
    return undefined;
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * The sections of the front page after its first screen, in the order the page shows them. An
 * operator lists the ones a deployment shows (`LANDING_SECTIONS` in the environment); the first
 * screen, with the search box, is always there.
 */
export const LANDING_SECTIONS = [
  "organizations",
  "showcase",
  "console",
  "steps",
  "packs",
  "builders",
  "faq",
  "cta",
] as const;
export type LandingSection = (typeof LANDING_SECTIONS)[number];

export function isLandingSection(value: string): value is LandingSection {
  return (LANDING_SECTIONS as readonly string[]).includes(value);
}

/**
 * The sections a comma-separated list names, in the page's own order, each once; `undefined`
 * when the list names something that is no section. An empty list is a front page of its first
 * screen alone.
 */
export function parseLandingSections(text: string): readonly LandingSection[] | undefined {
  const named = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (!named.every(isLandingSection)) {
    return undefined;
  }
  return LANDING_SECTIONS.filter((section) => named.includes(section));
}

/**
 * How the server tells the pages what this deployment has, in the head of every page: the
 * sections of the front page, as a comma-separated list, and whether the search across packs
 * is there. The pages take the defaults, everything, where a tag is missing.
 */
export const FEATURE_META_NAMES = {
  landingSections: "skillcdn-landing",
  search: "skillcdn-search",
} as const;
