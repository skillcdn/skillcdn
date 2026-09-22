import { createContext, useContext } from "react";
import type { Language } from "./languages.js";
import { en, type Messages } from "./messages/en.js";
import { ko } from "./messages/ko.js";

// Both packs ship in the bundle: they are small, and the server-rendered page has to hydrate in
// whichever language the URL asked for without waiting for a second request.
const PACKS: Record<Language, Messages> = { en, ko };

export function messagesFor(language: Language): Messages {
  return PACKS[language];
}

export interface I18n {
  readonly language: Language;
  readonly t: Messages;
}

export const I18nContext = createContext<I18n>({ language: "en", t: en });

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/**
 * The language the visitor prefers, and how to change it. A preference is what a URL without a
 * language shows; the language switcher sets it. On the server there is none.
 */
export interface LanguagePreference {
  readonly preferred: Language | undefined;
  readonly setPreferred: (language: Language) => void;
}

export const LanguagePreferenceContext = createContext<LanguagePreference>({
  preferred: undefined,
  setPreferred: () => undefined,
});

export function useLanguagePreference(): LanguagePreference {
  return useContext(LanguagePreferenceContext);
}
