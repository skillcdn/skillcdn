// The social preview of an address (ADR-0032): the picture a link to the page unfurls with,
// drawn by the server from the words the web build writes for the page in its language. The
// server asks the build's render module for a `SocialCard` and draws it; the build's head names
// the picture's URL under `SOCIAL_ROUTE`.

/** Where the server draws the social preview of an address: `/social/gh/<owner>/<repo>...`. */
export const SOCIAL_ROUTE = "/social";

/** The size link previews expect. */
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

/** The words and the pictures of one card, as the render module writes them for a page. */
export interface SocialCard {
  /** What the page is: a repository, a skill. */
  readonly kicker: string;
  readonly title: string;
  /** Where it is: the address, and the repository's name when the title is not it. */
  readonly subtitle: string;
  readonly description: string;
  /** Short facts, each a pill: how many skills, whether it is verified. */
  readonly badges: readonly string[];
  readonly verified: boolean;
  /** The owner's picture, an https URL the server fetches to draw it. */
  readonly avatar: string;
  readonly siteName: string;
}
