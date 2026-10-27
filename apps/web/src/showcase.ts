import type {
  RestShowcase,
  RestShowcaseEntry,
  RestShowcaseOrganization,
  ShowcaseTexts,
} from "@skillcdn/core";
import { messagesFor } from "./i18n/index.js";
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "./i18n/languages.js";
import {
  DEFAULT_ORGANIZATIONS,
  DEFAULT_SHOWCASE_MEDIA,
  type DefaultShowcaseId,
  localizedPath,
} from "./site.js";

// The landing showcase (ADR-0028): the entries the front page leads with, and the organizations
// named beside them. The operator writes both through the admin API and the pages read them
// through the REST API; until there are any, the build's own stand, made of the language packs
// and the media in public/showcase/ and public/organizations/.

const DEFAULT_IDS: readonly DefaultShowcaseId[] = ["ad", "cards", "deck", "looks"];

const own = new Map<Language, readonly RestShowcaseEntry[]>();

/**
 * The build's own entries in a language: real results of the reference pack, with their words
 * in every language of the UI and their files in the cut of this one.
 */
export function defaultShowcase(
  language: Language = DEFAULT_LANGUAGE,
): readonly RestShowcaseEntry[] {
  const made = own.get(language);
  if (made !== undefined) {
    return made;
  }
  const entries = DEFAULT_IDS.map((id, position): RestShowcaseEntry => {
    const media = DEFAULT_SHOWCASE_MEDIA.entries[id];
    const texts: Record<string, ShowcaseTexts> = {};
    for (const each of LANGUAGES) {
      const words = messagesFor(each).landing.showcase.entries[id];
      texts[each] = {
        title: words.title,
        body: words.body,
        tags: [...words.tags],
        action: words.action,
        requirement: words.requirement,
        clip: words.poster,
        credit: words.credit,
        demo: null,
      };
    }
    return {
      id,
      address: media.address,
      link: localizedPath(media.link, language),
      linkType: media.linkType,
      origin: "pack",
      position,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      published: media.published,
      media: {
        clip:
          media.clip === null
            ? null
            : { url: localizedPath(media.clip, language), type: "video/mp4" },
        animation: null,
        poster: { url: localizedPath(media.poster, language), type: "image/webp" },
        reference: null,
        picture: null,
        social: null,
      },
      texts,
    };
  });
  own.set(language, entries);
  return entries;
}

/** The entries the front page shows: the operator's when there are any, else the build's own. */
export function showcaseEntries(
  showcase: RestShowcase | undefined,
  language: Language = DEFAULT_LANGUAGE,
): readonly RestShowcaseEntry[] {
  return showcase !== undefined && showcase.items.length > 0
    ? showcase.items
    : defaultShowcase(language);
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
