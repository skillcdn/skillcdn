import type { LegalDocumentKind, LegalTexts } from "@skillcdn/core";
import { asc, eq, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { legalDocuments } from "../schema.js";

// The deployment's own pages: terms of service and privacy policy (ADR-0029). Operator data.

export interface LegalDocumentRecord {
  readonly kind: LegalDocumentKind;
  /** `YYYY-MM-DD`, as the operator states it, or `null`. */
  readonly revised: string | null;
  /** By language tag, as written through the admin API. */
  readonly texts: Record<string, LegalTexts>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const columns = {
  kind: legalDocuments.kind,
  revised: legalDocuments.revised,
  texts: legalDocuments.texts,
  createdAt: legalDocuments.createdAt,
  updatedAt: legalDocuments.updatedAt,
};

/** Every document there is, terms before privacy. */
export async function listLegalDocuments(database: Database): Promise<LegalDocumentRecord[]> {
  return drizzleOf(database).select(columns).from(legalDocuments).orderBy(asc(legalDocuments.kind));
}

export async function getLegalDocument(
  database: Database,
  kind: LegalDocumentKind,
): Promise<LegalDocumentRecord | undefined> {
  const [found] = await drizzleOf(database)
    .select(columns)
    .from(legalDocuments)
    .where(eq(legalDocuments.kind, kind))
    .limit(1);
  return found;
}

export interface LegalDocumentInput {
  readonly kind: LegalDocumentKind;
  readonly revised: string | null;
  readonly texts: Record<string, LegalTexts>;
}

/** Writes a document as a whole, replacing what was there under its kind. */
export async function putLegalDocument(
  database: Database,
  input: LegalDocumentInput,
): Promise<"created" | "updated"> {
  const rows = await drizzleOf(database)
    .insert(legalDocuments)
    .values({ kind: input.kind, revised: input.revised, texts: input.texts })
    .onConflictDoUpdate({
      target: legalDocuments.kind,
      set: { revised: input.revised, texts: input.texts, updatedAt: sql`now()` },
    })
    .returning({ createdAt: legalDocuments.createdAt, updatedAt: legalDocuments.updatedAt });
  const [written] = rows;
  // An insert sets both stamps in one statement; an update moves only the second.
  return written !== undefined && written.createdAt.getTime() === written.updatedAt.getTime()
    ? "created"
    : "updated";
}

/** True when the document was there. */
export async function removeLegalDocument(
  database: Database,
  kind: LegalDocumentKind,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(legalDocuments)
    .where(eq(legalDocuments.kind, kind))
    .returning({ id: legalDocuments.id });
  return rows.length > 0;
}
