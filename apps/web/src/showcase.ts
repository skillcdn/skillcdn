import type {
  RestShowcase,
  RestShowcaseEntry,
  RestShowcaseOrganization,
  ShowcaseTexts,
} from "@skillcdn/core";
import { messagesFor } from "./i18n/index.js";
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "./i18n/languages.js";
import { DEFAULT_ORGANIZATIONS, DEFAULT_SHOWCASE_MEDIA, type DefaultShowcaseId } from "./site.js";

// The landing showcase (ADR-0028): the entries the front page leads with, and the organizations
// named beside them. The operator writes both through the admin API and the pages read them
// through the REST API; until there are any, the build's own stand, made of the language packs
// and the media in public/showcase/ and public/organizations/.

const DEFAULT_IDS: readonly DefaultShowcaseId[] = ["cards", "deck", "looks"];

let own: readonly RestShowcaseEntry[] | undefined;

/** The build's own entries: real results of the reference pack, in every language of the UI. */
export function defaultShowcase(): readonly RestShowcaseEntry[] {
  if (own !== undefined) {
    return own;
  }
  const { width, height, entries } = DEFAULT_SHOWCASE_MEDIA;
  own = DEFAULT_IDS.map((id, position) => {
    const media = entries[id];
    const texts: Record<string, ShowcaseTexts> = {};
    for (const language of LANGUAGES) {
      const words = messagesFor(language).landing.showcase.entries[id];
      texts[language] = {
        title: words.title,
        body: words.body,
        tags: [...words.tags],
        action: words.action,
        requirement: null,
        clip: words.poster,
        credit: words.credit,
        demo: null,
      };
    }
    return {
      id,
      address: media.address,
      link: media.link,
      linkType: media.linkType,
      origin: "pack",
      position,
      width,
      height,
      durationMs: null,
      published: null,
      media: {
        clip: null,
        animation: null,
        poster: { url: media.poster, type: "image/webp" },
        reference: null,
        picture: null,
        social: null,
      },
      texts,
    };
  });
  return own;
}

/** The entries the front page shows: the operator's when there are any, else the build's own. */
export function showcaseEntries(showcase: RestShowcase | undefined): readonly RestShowcaseEntry[] {
  return showcase !== undefined && showcase.items.length > 0 ? showcase.items : defaultShowcase();
}

/**
 * The organizations named beside the showcase: the operator's when there are any, else the
 * build's own.
 */
export function showcaseOrganizations(
  showcase: RestShowcase | undefined,
): readonly RestShowcaseOrganization[] {
  const listed = showcase?.organizations ?? [];
  if (listed.length > 0) {
    return listed;
  }
  return DEFAULT_ORGANIZATIONS.map((organization, position) => ({
    id: organization.id,
    name: organization.name,
    url: organization.url,
    logo: { url: organization.logo, type: "image/png" },
    position,
  }));
}

const NO_WORDS: ShowcaseTexts = {
  title: "",
  body: "",
  tags: [],
  action: "",
  requirement: null,
  clip: null,
  credit: null,
  demo: null,
};

/** The words of an entry in a language: the visitor's, else the default language's, else any. */
export function showcaseTexts(entry: RestShowcaseEntry, language: Language): ShowcaseTexts {
  return (
    entry.texts[language] ??
    entry.texts[DEFAULT_LANGUAGE] ??
    Object.values(entry.texts)[0] ??
    NO_WORDS
  );
}
