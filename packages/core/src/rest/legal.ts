// The mini build of zod, as in contracts.ts: these schemas also run in the browser.
import * as z from "zod/mini";
import { REST_ROUTES } from "./contracts.js";
import { SHOWCASE_LANGUAGE_PATTERN } from "./showcase.js";

// The deployment's own pages (ADR-0029): its terms of service and its privacy policy, written
// through the admin API as Markdown in each language the operator has, and served on the
// deployment's own origin. Contract: docs/specs/rest.md and the admin API in deploy/README.md.

export const LEGAL_DOCUMENT_KINDS = ["terms", "privacy"] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

/** Where each page is served, on the deployment's own origin. */
export const LEGAL_PAGE_PATHS: Readonly<Record<LegalDocumentKind, string>> = {
  terms: "/terms",
  privacy: "/privacy",
};

/** A policy is long; this is far more than any needs, and keeps a mistake from filling a row. */
export const MAX_LEGAL_BODY_LENGTH = 200_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isLegalDocumentKind(value: string): value is LegalDocumentKind {
  return (LEGAL_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** The REST path of a document. */
export function legalPath(kind: LegalDocumentKind): string {
  return `${REST_ROUTES.legal}/${kind}`;
}

/** The words of a document in one language: its title, and its body as Markdown. */
export const legalTextsSchema = z.object({
  title: z.string().check(z.minLength(1), z.maxLength(120)),
  body: z.string().check(z.minLength(1), z.maxLength(MAX_LEGAL_BODY_LENGTH)),
});
export type LegalTexts = z.infer<typeof legalTextsSchema>;

export const restLegalDocumentSchema = z.object({
  kind: z.enum(LEGAL_DOCUMENT_KINDS),
  /** When the text was last revised, `YYYY-MM-DD`, as the operator states it; or `null`. */
  revised: z.nullable(z.string()),
  /** By language tag. The pages fall back to the default language, then to any language. */
  texts: z.record(z.string(), legalTextsSchema),
});
export type RestLegalDocument = z.infer<typeof restLegalDocumentSchema>;

/** A document as the operator sends it to the admin API. */
export const legalDocumentInputSchema = z
  .object({
    revised: z.optional(z.nullable(z.string().check(z.regex(DATE_PATTERN)))),
    texts: z.record(z.string().check(z.regex(SHOWCASE_LANGUAGE_PATTERN)), legalTextsSchema),
  })
  .check(
    z.refine((document) => Object.keys(document.texts).length > 0, {
      message: "texts must have at least one language",
      path: ["texts"],
    }),
  );
export type LegalDocumentInput = z.infer<typeof legalDocumentInputSchema>;
