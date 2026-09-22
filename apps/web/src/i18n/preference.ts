import { LANGUAGE_STORAGE_KEY, type Language } from "./languages.js";

// The visitor's language preference, kept in the browser's storage. Browser only: the server
// knows nothing of it (ADR-0013), and nothing here is reached from the render module.

/** The language the visitor chose, as stored; `null` without one, or without storage. */
export function storedLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps a language as the visitor's preference: what a URL without a language is shown in from
 * now on. The switcher and a URL that forces a language both set it; the last one wins.
 */
export function rememberLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Without storage the choice still holds until the page is left.
  }
}
