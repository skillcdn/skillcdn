import { AUTH_META_NAME, REFERENCE_REPOSITORY_ADDRESS } from "@skillcdn/core";
import { ORIGIN_META_NAME, ORIGIN_PLACEHOLDER, REPOSITORY_URL } from "./site-constants.js";

// Facts about the site that are not copy: where things link to, and how the public origin
// travels from the server into the page. The constants the build tooling reads as well live in
// site-constants.ts and are passed through here.

export { ORIGIN_META_NAME, ORIGIN_PLACEHOLDER, REPOSITORY_URL };

/**
 * The reference console (ADR-0047): a pack of its own, which an agent connected to it follows to
 * set a console up and run one. The front page leads there, since the pack is the way in.
 */
export const CONSOLE_PACK_ADDRESS = "/gh/skillcdn/console";

/** The organization on the git host where builders work in the open, and where the front page sends them. */
export const BUILDERS_URL = "https://github.com/skillcdn-builders";

export const LINKS = {
  repository: REPOSITORY_URL,
  license: `${REPOSITORY_URL}/blob/main/LICENSE.md`,
  builders: BUILDERS_URL,
} as const;

/**
 * The media of the build's own showcase (ADR-0028), which the front page leads with until the
 * operator writes a showcase of its own through the admin API. Each is a real result of a skill
 * of the reference pack, made by an agent from one sentence and bundled with the site: a poster
 * of it, the result itself to open and what it is, and the address of the skill it came from. The words are in
 * the language packs (`showcase.ts` puts the two together). Pixel size of every poster.
 */
export const DEFAULT_SHOWCASE_MEDIA = {
  width: 1440,
  height: 900,
  entries: {
    cards: {
      poster: "/showcase/card-news.webp",
      link: "/showcase/card-news-sheet.webp",
      linkType: "image/webp",
      address: `${REFERENCE_REPOSITORY_ADDRESS}/design/skills/html-card-news-from-brief`,
    },
    deck: {
      poster: "/showcase/builders-intro.webp",
      link: "/showcase/builders-intro.pdf",
      linkType: "application/pdf",
      address: `${REFERENCE_REPOSITORY_ADDRESS}/design/skills/html-deck-from-outline`,
    },
    looks: {
      poster: "/showcase/hero-looks.webp",
      link: "/showcase/hero-looks-sheet.webp",
      linkType: "image/webp",
      address: `${REFERENCE_REPOSITORY_ADDRESS}/design/skills/html-design-variations`,
    },
  },
} as const;

export type DefaultShowcaseId = keyof typeof DEFAULT_SHOWCASE_MEDIA.entries;

/**
 * The organizations the front page names beside the showcase until the operator writes a list
 * of their own (ADR-0028): the operator of the reference deployment, whose mark ships with
 * the site with a margin around it, so that it stands the size of the others in a strip.
 */
export const DEFAULT_ORGANIZATIONS = [
  {
    id: "kdxlabs",
    name: "KDX Labs",
    url: "https://kdxlabs.com",
    logo: "/organizations/kdxlabs.png",
  },
] as const;

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
