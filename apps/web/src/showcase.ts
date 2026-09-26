import {
  REFERENCE_REPOSITORY_ADDRESS,
  type RestShowcase,
  type RestShowcaseEntry,
  type ShowcaseDemo,
  type ShowcaseTexts,
} from "@skillcdn/core";
import { messagesFor } from "./i18n/index.js";
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "./i18n/languages.js";
import { DEFAULT_SHOWCASE_MEDIA } from "./site.js";

// The landing showcase (ADR-0028): the entries the front page leads with. The operator writes
// them through the admin API and the pages read them through the REST API; until there are any,
// the build's own entry stands, made of the language packs and the media in public/showcase/.

export const DEFAULT_SHOWCASE_ID = "default";

let own: RestShowcaseEntry | undefined;

/** The build's own entry: the reference repository's concept clip, in every language of the UI. */
export function defaultShowcase(): RestShowcaseEntry {
  if (own !== undefined) {
    return own;
  }
  const texts: Record<string, ShowcaseTexts> = {};
  for (const language of LANGUAGES) {
    const { featured, demo, how } = messagesFor(language).landing;
    texts[language] = {
      title: featured.video.title,
      body: featured.video.body,
      tags: [...featured.video.tags],
      action: featured.video.action,
      requirement: featured.video.requirement,
      clip: featured.video.clip,
      credit: featured.video.credit,
      note: featured.video.generated,
      demo: {
        title: demo.title,
        prompt: demo.prompt,
        reference: demo.reference,
        picture: demo.picture,
        question: demo.question,
        answer: demo.answer,
        plan: demo.plan,
        approval: demo.approval,
        consent: demo.consent,
        working: demo.working,
        result: demo.result,
        resultDetail: demo.resultDetail,
        resultLabel: demo.resultLabel,
        stages: [...demo.stages],
        action: how.action,
      },
    };
  }
  const media = DEFAULT_SHOWCASE_MEDIA;
  own = {
    id: DEFAULT_SHOWCASE_ID,
    address: REFERENCE_REPOSITORY_ADDRESS,
    position: 0,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    published: media.published,
    media: {
      clip: { url: media.clip, type: "video/mp4" },
      animation: { url: media.animation, type: "image/avif" },
      poster: { url: media.poster, type: "image/webp" },
      reference: { url: media.reference, type: "image/webp" },
      picture: { url: media.picture, type: "image/webp" },
      social: null,
    },
    texts,
  };
  return own;
}

/** The entries the front page shows: the operator's when there are any, else the build's own. */
export function showcaseEntries(showcase: RestShowcase | undefined): readonly RestShowcaseEntry[] {
  return showcase !== undefined && showcase.items.length > 0 ? showcase.items : [defaultShowcase()];
}

const NO_WORDS: ShowcaseTexts = {
  title: "",
  body: "",
  tags: [],
  action: "",
  requirement: null,
  clip: null,
  credit: null,
  note: null,
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

/**
 * The example conversation of the front page: the first entry's, when it has one in this
 * language, else the build's own, each with the media it plays.
 */
export function showcaseDemo(
  entries: readonly RestShowcaseEntry[],
  language: Language,
): { readonly entry: RestShowcaseEntry; readonly demo: ShowcaseDemo } {
  const first = entries[0];
  const written = first === undefined ? null : showcaseTexts(first, language).demo;
  if (first !== undefined && written !== null) {
    return { entry: first, demo: written };
  }
  const fallback = defaultShowcase();
  const demo = showcaseTexts(fallback, language).demo;
  if (demo === null) {
    throw new Error("the build's own showcase has no example conversation");
  }
  return { entry: fallback, demo };
}
