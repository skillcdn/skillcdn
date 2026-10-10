import { AUTH_META_NAME, REFERENCE_REPOSITORY_ADDRESS } from "@skillcdn/core";
import { ORIGIN_META_NAME, ORIGIN_PLACEHOLDER, REPOSITORY_URL } from "./site-constants.js";

// Facts about the site that are not copy: where things link to, and how the public origin
// travels from the server into the page. The constants the build tooling reads as well live in
// site-constants.ts and are passed through here.

export { ORIGIN_META_NAME, ORIGIN_PLACEHOLDER, REPOSITORY_URL };

export const LINKS = {
  repository: REPOSITORY_URL,
  license: `${REPOSITORY_URL}/blob/main/LICENSE.md`,
} as const;

/**
 * The media of the build's own showcase (ADR-0028), which the front page leads with until the
 * operator writes a showcase of its own through the admin API. It is bundled with the site: an
 * original AI-generated concept clip of the kind of result the reference repository's skill is
 * for (not a recording of a run of it), the same clip as an animated image for where the video
 * will not play, its first frame as the poster that stands in for both, and the picture of its
 * star, which the example conversation attaches as the character the person brings. The words
 * are in the language packs (`showcase.ts` puts the two together).
 */
export const DEFAULT_SHOWCASE_MEDIA = {
  clip: "/showcase/puppy-interview.mp4",
  animation: "/showcase/puppy-interview.avif",
  poster: "/showcase/puppy-interview.webp",
  picture: "/showcase/puppy.webp",
  /** Pixel size of the clip and its poster. */
  width: 752,
  height: 560,
  /** One pass of the loop. The example conversation plays it once through before it restarts. */
  durationMs: 4_500,
  /** For the structured data that describes the clip. */
  published: "2026-09-26",
} as const;

/**
 * Addresses to try under the field: the reference repository of this project, written in the
 * SkillCDN Format (docs/specs/skill-repo.md) and kept working.
 */
export const EXAMPLE_ADDRESSES = [REFERENCE_REPOSITORY_ADDRESS.replace(/^\/gh\//, "")] as const;

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

/**
 * The deployment's legal surface, as the server wrote it into the head: its terms and privacy
 * pages as standard link types, and whom to write to about content as one meta. Prerendered
 * pages carry none of it, so it is read after mount and shown only where it is set.
 */
export const LEGAL_TAGS = {
  terms: "terms-of-service",
  privacy: "privacy-policy",
  contact: "skillcdn-contact",
} as const;

export interface LegalLinks {
  readonly termsUrl?: string;
  readonly privacyUrl?: string;
  readonly contactEmail?: string;
}

export function readLegalLinks(): LegalLinks {
  if (typeof document === "undefined") {
    return {};
  }
  const href = (rel: string): string | undefined => {
    const value = document.querySelector(`link[rel="${rel}"]`)?.getAttribute("href");
    return value === null || value === undefined || value === "" ? undefined : value;
  };
  const contact = document
    .querySelector(`meta[name="${LEGAL_TAGS.contact}"]`)
    ?.getAttribute("content");
  return {
    termsUrl: href(LEGAL_TAGS.terms),
    privacyUrl: href(LEGAL_TAGS.privacy),
    contactEmail: contact === null || contact === undefined || contact === "" ? undefined : contact,
  };
}

/** `https://host/path` without the scheme, the way an address is usually written down. */
export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, "");
}

/**
 * Whether people can sign in on this deployment, as the server wrote it into the head: a meta
 * tag naming the git host they sign in through. Prerendered pages carry none, so it is read after
 * mount. A development server has no server behind its pages to say so, and asks the API instead.
 */
export function readSignIn(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const declared = document
    .querySelector(`meta[name="${AUTH_META_NAME}"]`)
    ?.getAttribute("content");
  return (declared !== null && declared !== undefined && declared !== "") || import.meta.env.DEV;
}
