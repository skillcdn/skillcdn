import type { LegalTexts, RestLegalDocument } from "@skillcdn/core";
import { DEFAULT_LANGUAGE, type Language } from "./i18n/languages.js";

// The deployment's own pages (ADR-0029): its terms and its privacy policy, as the operator wrote
// them through the admin API and as the pages read them through the REST API.

/** The words of a document in a language: the visitor's, else the default language's, else any. */
export function legalTexts(
  document: RestLegalDocument,
  language: Language,
): LegalTexts | undefined {
  return (
    document.texts[language] ?? document.texts[DEFAULT_LANGUAGE] ?? Object.values(document.texts)[0]
  );
}

/** The first paragraph of a Markdown body as one plain line, for a description. */
export function firstParagraph(markdown: string): string {
  const block = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith("#"));
  return (block ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
