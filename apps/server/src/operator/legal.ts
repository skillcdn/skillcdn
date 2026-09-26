import {
  type Clock,
  isLegalDocumentKind,
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentKind,
  legalDocumentInputSchema,
  type RestLegalDocument,
} from "@skillcdn/core";
import {
  type Database,
  type LegalDocumentRecord,
  listLegalDocuments,
  putLegalDocument,
  removeLegalDocument,
} from "@skillcdn/db";

/** How long a process trusts what it read; a change made elsewhere shows within it. */
const LEGAL_TTL_MS = 30_000;

export class LegalDocumentError extends Error {
  readonly code: "legal.invalid_kind" | "legal.invalid";
  /** What is wrong, one line each, for the operator. */
  readonly problems: readonly string[];

  constructor(code: LegalDocumentError["code"], message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "LegalDocumentError";
    this.code = code;
    this.problems = problems;
  }
}

/**
 * The deployment's own pages (ADR-0029): its terms of service and privacy policy as the operator
 * wrote them, read from the database and kept for a short while. Writes go through here too, so
 * that this process sees them at once.
 */
export class LegalDocuments {
  readonly #database: Database;
  readonly #clock: Clock;
  #loaded:
    | { readonly until: number; readonly documents: Promise<readonly LegalDocumentRecord[]> }
    | undefined;

  constructor(options: { readonly database: Database; readonly clock: Clock }) {
    this.#database = options.database;
    this.#clock = options.clock;
  }

  /** The kind a path segment names, or why it names none. */
  static kindOf(value: string): LegalDocumentKind {
    if (!isLegalDocumentKind(value)) {
      throw new LegalDocumentError(
        "legal.invalid_kind",
        `A document is one of ${LEGAL_DOCUMENT_KINDS.join(", ")}.`,
      );
    }
    return value;
  }

  async all(): Promise<readonly RestLegalDocument[]> {
    return (await this.#documents()).map(toRest);
  }

  async get(kind: LegalDocumentKind): Promise<RestLegalDocument | undefined> {
    const found = (await this.#documents()).find((document) => document.kind === kind);
    return found === undefined ? undefined : toRest(found);
  }

  /** The pages that have been written, terms before privacy. */
  async written(): Promise<readonly LegalDocumentKind[]> {
    return (await this.#documents()).map((document) => document.kind);
  }

  /** Writes the document of `kind` from what the admin API was sent, replacing what was there. */
  async put(kind: LegalDocumentKind, body: unknown): Promise<RestLegalDocument> {
    const parsed = legalDocumentInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new LegalDocumentError(
        "legal.invalid",
        "The document is not valid.",
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
      );
    }
    await putLegalDocument(this.#database, {
      kind,
      revised: parsed.data.revised ?? null,
      texts: parsed.data.texts,
    });
    this.#loaded = undefined;
    const written = await this.get(kind);
    if (written === undefined) {
      throw new Error("the document was written but cannot be read back");
    }
    return written;
  }

  /** True when the document was there. */
  async remove(kind: LegalDocumentKind): Promise<boolean> {
    const removed = await removeLegalDocument(this.#database, kind);
    this.#loaded = undefined;
    return removed;
  }

  /** Forget what was read, so that the next question asks the database. */
  invalidate(): void {
    this.#loaded = undefined;
  }

  #documents(): Promise<readonly LegalDocumentRecord[]> {
    const now = this.#clock.now().getTime();
    if (this.#loaded === undefined || this.#loaded.until <= now) {
      const documents = listLegalDocuments(this.#database);
      this.#loaded = { until: now + LEGAL_TTL_MS, documents };
      documents.catch(() => {
        this.#loaded = undefined;
      });
    }
    return this.#loaded.documents;
  }
}

function toRest(document: LegalDocumentRecord): RestLegalDocument {
  return { kind: document.kind, revised: document.revised, texts: document.texts };
}
