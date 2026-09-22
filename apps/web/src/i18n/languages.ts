// Languages of the UI. Adding one: a pack in messages/, an entry here, the list in public/boot.js,
// and a social-preview image in public/og/. Tests fail until all four agree.

export const LANGUAGES = ["en", "ko"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language of a URL that does not name one. */
export const DEFAULT_LANGUAGE: Language = "en";

/** The query parameter that forces the language. Paths are the same in every language. */
export const LANGUAGE_PARAM = "lang";

export const LANGUAGE_STORAGE_KEY = "skillcdn.lang";

/**
 * Set on the document by public/boot.js while a page prerendered in the default language waits
 * to be rendered in the visitor's language, so the wrong language never shows; the app removes
 * it once it has rendered.
 */
export const LANGUAGE_PENDING_ATTRIBUTE = "data-language-pending";

/** `short` is what the switcher shows; `label` names it for anyone who cannot see it. */
export const LANGUAGE_INFO: Record<
  Language,
  {
    readonly label: string;
    readonly short: string;
    readonly htmlLang: string;
    readonly ogLocale: string;
  }
> = {
  en: { label: "English", short: "EN", htmlLang: "en", ogLocale: "en_US" },
  ko: { label: "한국어", short: "KO", htmlLang: "ko", ogLocale: "ko_KR" },
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** The language a URL forces: its `lang` parameter when that is a language we have. */
export function languageInSearch(search: string): Language | undefined {
  const value = new URLSearchParams(search).get(LANGUAGE_PARAM);
  return isLanguage(value) ? value : undefined;
}

/**
 * The language a URL asks for, as the server and the prerenderer read it: forced, else the
 * default. What a browser shows is decided by `resolveLanguage`.
 */
export function languageOfSearch(search: string): Language {
  return languageInSearch(search) ?? DEFAULT_LANGUAGE;
}

export interface ResolvedLanguage {
  readonly language: Language;
  /**
   * Whether the URL names the language. Links then carry it on, so the page stays in that
   * language wherever it leads; otherwise links stay clean and every reader gets their own.
   */
  readonly forced: boolean;
}

/**
 * The language a page is shown in: the one the URL forces, else the visitor's preference (their
 * choice, or their browser's, as `preferredLanguage` gives it), else the default. Without a
 * preference, as on the server, a URL without a parameter is the default language.
 */
export function resolveLanguage(
  search: string,
  preferred: Language | undefined = undefined,
): ResolvedLanguage {
  const forced = languageInSearch(search);
  if (forced !== undefined) {
    return { language: forced, forced: true };
  }
  return { language: preferred ?? DEFAULT_LANGUAGE, forced: false };
}

/**
 * The same location in another language. The default language has no parameter, so every page
 * has exactly one URL per language.
 */
export function withLanguage(href: string, language: Language): string {
  const url = new URL(href, "http://relative.invalid");
  if (language === DEFAULT_LANGUAGE) {
    url.searchParams.delete(LANGUAGE_PARAM);
  } else {
    url.searchParams.set(LANGUAGE_PARAM, language);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The same location, forcing a language: the parameter is set even for the default language,
 * which a page reached through a forcing URL carries on to the pages it links to. Nothing
 * prerendered links this way, so crawlers never see a second URL for the default language.
 */
export function withForcedLanguage(href: string, language: Language): string {
  const url = new URL(href, "http://relative.invalid");
  url.searchParams.set(LANGUAGE_PARAM, language);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * What a visitor without a language in the URL should get: their choice, else their browser's.
 * The same rule is in public/boot.js, which runs before any bundle.
 */
export function preferredLanguage(stored: string | null, browser: readonly string[]): Language {
  if (isLanguage(stored)) {
    return stored;
  }
  for (const tag of browser) {
    const code = tag.toLowerCase().split("-")[0];
    if (isLanguage(code)) {
      return code;
    }
  }
  return DEFAULT_LANGUAGE;
}
