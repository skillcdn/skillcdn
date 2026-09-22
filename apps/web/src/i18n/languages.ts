// Languages of the UI. Adding one: a pack in messages/, an entry here, the list in public/boot.js,
// and a social-preview image in public/og/. Tests fail until all four agree.

export const LANGUAGES = ["en", "ko"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language of a URL that does not name one. */
export const DEFAULT_LANGUAGE: Language = "en";

/** The query parameter that selects the language. Paths are the same in every language. */
export const LANGUAGE_PARAM = "lang";

export const LANGUAGE_STORAGE_KEY = "skillcdn.lang";

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

/** The language a URL asks for: its `lang` parameter when that is a language we have. */
export function languageOfSearch(search: string): Language {
  const value = new URLSearchParams(search).get(LANGUAGE_PARAM);
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
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

/** What a visitor without a language in the URL should get: their choice, else their browser's. */
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
