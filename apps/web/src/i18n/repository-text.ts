import type { RestRepoTranslation, RestSkillTranslation } from "@skillcdn/core";
import type { Language } from "./languages.js";

// A skill's name and description, and a repository's, are written for agents in one language.
// An author may translate them for people; the page shows the translation in the visitor's
// language when there is one, and the original otherwise.

/** The translation for `language`, when the author gave one. */
export function translationFor<T>(
  translations: Readonly<Record<string, T>> | undefined,
  language: Language,
): T | undefined {
  return translations !== undefined && Object.hasOwn(translations, language)
    ? translations[language]
    : undefined;
}

export interface SkillText {
  readonly name: string;
  readonly description: string;
  readonly translations: Readonly<Record<string, RestSkillTranslation>>;
}

/** What a skill is called on the page: its translated title, else its name. */
export function skillTitle(skill: SkillText, language: Language): string {
  return translationFor(skill.translations, language)?.title ?? skill.name;
}

export function skillDescription(skill: SkillText, language: Language): string {
  return translationFor(skill.translations, language)?.description ?? skill.description;
}

export interface RepositoryText {
  readonly name: string | null;
  readonly description: string;
  readonly translations: Readonly<Record<string, RestRepoTranslation>>;
}

/** The name a repository gives itself, in the visitor's language when it has one. */
export function repositoryName(manifest: RepositoryText, language: Language): string | null {
  return translationFor(manifest.translations, language)?.name ?? manifest.name;
}

export function repositoryDescription(manifest: RepositoryText, language: Language): string {
  return translationFor(manifest.translations, language)?.description ?? manifest.description;
}
