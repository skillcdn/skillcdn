// The social preview of an address (ADR-0032): the picture a link to the page unfurls with,
// drawn by the server from the words the web build writes for the page in its language. The
// server asks the build's render module for a `SocialCard` and draws it; the build's head names
// the picture's URL under `SOCIAL_ROUTE`.

/** Where the server draws the social preview of an address: `/social/gh/<owner>/<repo>...`. */
export const SOCIAL_ROUTE = "/social";

/**
 * Where the server serves the icon of the MCP server of an address, `/icon/gh/<owner>/<repo>...`:
 * the owner's picture as the git host serves it, `ICON_SIZE` pixels square. It is served from the
 * deployment's own origin because a client fetches a server's icon from that origin and from
 * nowhere else; the server info names it in `icons`.
 */
export const ICON_ROUTE = "/icon";
export const ICON_SIZE = 128;

/**
 * Where the server answers the badge of an address, `/badge/gh/<owner>/<repo>...`: the symbol,
 * the name of the service and how many skills the address serves, as an SVG for the README of
 * the repository (`renderBrandBadge` draws it).
 */
export const BADGE_ROUTE = "/badge";

/**
 * Where the pages render the repository's own documentation, `/docs` and `/docs/<page>`, with the
 * Markdown source of each page beside it as `/docs/<page>.md` (ADR-0049). The server draws the
 * social preview of a page of it at `SOCIAL_ROUTE` followed by the page's path.
 */
export const DOCS_PAGE_PATH = "/docs";

/** The size link previews expect. */
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

/** The words and the pictures of one card, as the render module writes them for a page. */
export interface SocialCard {
  /** What the page is: a repository, a skill, a page of the documentation. */
  readonly kicker: string;
  readonly title: string;
  /** Where it is: the address, and the repository's name when the title is not it. */
  readonly subtitle: string;
  readonly description: string;
  /** Short facts, each a pill: how many skills, whether it is verified. */
  readonly badges: readonly string[];
  readonly verified: boolean;
  /**
   * The owner's picture, an https URL the server fetches to draw it; empty for a page that has
   * no owner, such as a page of the documentation, where the site's own symbol stands.
   */
  readonly avatar: string;
  readonly siteName: string;
}
