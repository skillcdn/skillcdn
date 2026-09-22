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
 * A short silent clip beside each step of "how it works", in the order of the steps: a path
 * under public/. A step without one shows an empty frame. Nothing is recorded yet.
 */
export const HOW_CLIPS: readonly string[] = [];

/**
 * The three the landing page puts forward, in the order their copy is written. A tile leads to
 * that repository's page, which is where the address to connect is on screen.
 */
export const FEATURED_ADDRESSES = [
  "skillcdn/skillcdn/skills/single-skill",
  "skillcdn/skillcdn/skills/multi-skill",
  "skillcdn/skillcdn@main/skills/hostile",
] as const;

/**
 * Addresses to try under the field: the examples repository of this project, written in the
 * SkillCDN Format (docs/specs/skill-repo.md) and kept working. The forms an address can take
 * are taught by the table on the front page, not here.
 */
export const EXAMPLE_ADDRESSES = ["skillcdn/examples"] as const;

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
