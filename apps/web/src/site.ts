// Facts about the site that are not copy: where things link to, and how the public origin
// travels from the server into the page.

/**
 * What stands in for the public origin in prerendered pages. Whatever serves the pages replaces
 * it with the real origin (ADR-0009), so one build works on any domain. It is a syntactically
 * valid URL so that nothing chokes on it before that happens.
 */
export const ORIGIN_PLACEHOLDER = "https://origin.skillcdn.invalid";

export const ORIGIN_META_NAME = "skillcdn-origin";

export const REPOSITORY_URL = "https://github.com/skillcdn/skillcdn";

export const LINKS = {
  repository: REPOSITORY_URL,
  docs: `${REPOSITORY_URL}/tree/main/docs`,
  convention: `${REPOSITORY_URL}/blob/main/docs/specs/skill-repo.md`,
  license: `${REPOSITORY_URL}/blob/main/LICENSE.md`,
  trademarks: `${REPOSITORY_URL}/blob/main/TRADEMARKS.md`,
  security: `${REPOSITORY_URL}/blob/main/SECURITY.md`,
} as const;

/**
 * Editorial selection shared by the landing page and explorer. Its media is bundled with the
 * site: an original AI-generated concept clip of the kind of result the skill is for (not a
 * recording of a run of it), the same clip as an animated image for where the video will not
 * play, its first frame as the poster that stands in for both, and what the clip was made from,
 * which the example conversation attaches: a frame of the ad it took its look from, and the
 * picture of its star.
 */
export const FEATURED_VIDEO = {
  address: "/gh/skillcdn/skills",
  href: "/gh/skillcdn/skills",
  clip: "/showcase/explorer-ad.mp4",
  animation: "/showcase/explorer-ad.avif",
  poster: "/showcase/explorer-ad.webp",
  reference: "/showcase/reference-ad.webp",
  picture: "/showcase/explorer.webp",
  /** Pixel size of the clip and its poster. */
  width: 752,
  height: 560,
  /** One pass of the loop. The example conversation plays it once through before it restarts. */
  durationMs: 9_500,
  /** For the structured data that describes the clip. */
  published: "2026-09-24",
} as const;

/**
 * Addresses to try under the field: the reference repository of this project, written in the
 * SkillCDN Format (docs/specs/skill-repo.md) and kept working.
 */
export const EXAMPLE_ADDRESSES = ["skillcdn/skills"] as const;

/**
 * The origin to show in URLs a visitor copies. In the browser it comes from the meta tag the
 * server filled in, else from the location. While prerendering it is the placeholder.
 */
export function readOrigin(): string {
  if (typeof document === "undefined") {
    return ORIGIN_PLACEHOLDER;
  }
  const declared = document
    .querySelector(`meta[name="${ORIGIN_META_NAME}"]`)
    ?.getAttribute("content");
  return declared === undefined ||
    declared === null ||
    declared === "" ||
    declared === ORIGIN_PLACEHOLDER
    ? window.location.origin
    : declared;
}

/** `https://host/path` without the scheme, the way an address is usually written down. */
export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, "");
}
