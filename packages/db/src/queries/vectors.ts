import type { DocumentSection } from "@skillcdn/core";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import { indexEntries, sectionVectors } from "../schema.js";
import { BY_PATH, FINDABLE, inSnapshot, underPath } from "./entries.js";
import type { SnapshotScope } from "./snapshots.js";

// The vectors of the meaning of sections (ADR-0064): kept under the content they were computed
// from and the model that computed them, and searched exactly over the sections of one mount's
// entries. The table exists only where the `vector` extension does: a caller asks
// `supportsSectionVectors` once and leaves the search by meaning off where the answer is no.

/** What a set of vectors was computed with. A change of any part is a new key and a backfill (ADR-0065). */
export interface VectorKey {
  /** The model's id, as the embedder names it. */
  readonly model: string;
  readonly dimensions: number;
  /** `SECTIONING_VERSION` of @skillcdn/core when the sections were cut. */
  readonly sectioningVersion: number;
}

/** The vector of one section of one body, to write. */
export interface SectionVector extends DocumentSection {
  readonly blobSha: string;
  /** The section's index in the order `sectionsOf` lists them, from 0. */
  readonly section: number;
  readonly vector: Float32Array;
}

/** A section of one of a mount's entries, as near to the query as the search found it. */
export interface SectionMatch extends DocumentSection {
  /** The entry's repository-root path. */
  readonly path: string;
  readonly blobSha: string;
  readonly section: number;
  /** Cosine similarity to the query: 1 for the same direction, 0 for none, -1 for the opposite. */
  readonly similarity: number;
}

const WRITE_BATCH_SIZE = 100;
const HASH_BATCH_SIZE = 1000;

/** True in a database whose migration found the extension and made the table. */
async function present(db: Drizzle): Promise<boolean> {
  const result = await db.execute<{ present: boolean }>(
    sql`select to_regclass('section_vectors') is not null as present`,
  );
  return result.rows[0]?.present === true;
}

/**
 * True when this database keeps section vectors: the `vector` extension was available when it
 * was migrated. Where it is not, the search by meaning stays off and nothing else here is called.
 */
export function supportsSectionVectors(database: Database): Promise<boolean> {
  return present(drizzleOf(database));
}

const underKey = (key: VectorKey) =>
  and(
    eq(sectionVectors.model, key.model),
    eq(sectionVectors.dimensions, key.dimensions),
    eq(sectionVectors.sectioningVersion, key.sectioningVersion),
  );

/** The text form the extension reads. A value that is not a number has no place in a vector. */
function vectorLiteral(vector: Float32Array): string {
  const parts: string[] = [];
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new RangeError("a vector holds finite numbers only");
    }
    parts.push(String(value));
  }
  return `[${parts.join(",")}]`;
}

/**
 * Writes the vectors of sections under one key, all of them or none, and says how many were new.
 * A section already there is left as it is: the same bytes under the same model and rules give
 * the same vector. A vector of other dimensions than the key's is refused by the table. The
 * caller writes a body's sections together, since a body with any section written counts as
 * done ({@link blobsWithoutVectors}); one transaction keeps that true through an interruption.
 */
export async function writeSectionVectors(
  database: Database,
  key: VectorKey,
  items: readonly SectionVector[],
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }
  return drizzleOf(database).transaction(async (tx) => {
    let written = 0;
    for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
      const rows = items.slice(start, start + WRITE_BATCH_SIZE).map((item) => ({
        blobSha: item.blobSha,
        model: key.model,
        dimensions: key.dimensions,
        sectioningVersion: key.sectioningVersion,
        section: item.section,
        heading: [...item.heading],
        offset: item.offset,
        length: item.length,
        vector: item.vector,
      }));
      const inserted = await tx
        .insert(sectionVectors)
        .values(rows)
        .onConflictDoNothing()
        .returning({ section: sectionVectors.section });
      written += inserted.length;
    }
    return written;
  });
}

/**
 * Which of these bodies have no vector under the key: what is left to embed. A body with any
 * section written counts as done, since a body's sections are written together; a body that
 * cuts into no section is never written and stays here, so the caller leaves those out.
 */
export async function blobsWithoutVectors(
  database: Database,
  key: VectorKey,
  blobShas: Iterable<string>,
): Promise<Set<string>> {
  const db = drizzleOf(database);
  const missing = new Set(blobShas);
  const unique = [...missing];
  for (let start = 0; start < unique.length; start += HASH_BATCH_SIZE) {
    const rows = await db
      .selectDistinct({ sha: sectionVectors.blobSha })
      .from(sectionVectors)
      .where(
        and(
          underKey(key),
          inArray(sectionVectors.blobSha, unique.slice(start, start + HASH_BATCH_SIZE)),
        ),
      );
    for (const row of rows) {
      missing.delete(row.sha);
    }
  }
  return missing;
}

/**
 * The sections of a mount nearest to a query vector, best first and at most `limit`: an exact
 * comparison with every section of the mount's searchable entries that has a vector under the
 * key, by cosine distance, with no approximate index (ADR-0064). Two entries of the same bytes
 * are two results. Ties are broken by path, then section, so that the order is the same on
 * every database. The query must have the key's dimensions.
 */
export async function searchSectionVectors(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
  key: VectorKey,
  query: Float32Array,
  limit: number,
): Promise<SectionMatch[]> {
  if (query.length !== key.dimensions) {
    throw new RangeError(
      `a query of ${query.length} dimensions cannot be searched under a key of ${key.dimensions}`,
    );
  }
  const distance = sql<number>`${sectionVectors.vector} <=> ${vectorLiteral(query)}::vector`;
  const rows = await drizzleOf(database)
    .select({
      path: indexEntries.path,
      blobSha: sectionVectors.blobSha,
      section: sectionVectors.section,
      heading: sectionVectors.heading,
      offset: sectionVectors.offset,
      length: sectionVectors.length,
      distance,
    })
    .from(indexEntries)
    .innerJoin(sectionVectors, eq(sectionVectors.blobSha, indexEntries.blobSha))
    .where(and(inSnapshot(scope), underPath(indexEntries.path, mountPath), FINDABLE, underKey(key)))
    .orderBy(distance, BY_PATH, sectionVectors.section)
    .limit(limit);
  return rows.map((row) => ({
    path: row.path,
    blobSha: row.blobSha,
    section: row.section,
    heading: row.heading,
    offset: row.offset,
    length: row.length,
    similarity: 1 - Number(row.distance),
  }));
}

/**
 * Drops the vectors of those of these bodies that no index entry names any more: for the purge
 * of a repository, with the bodies it referred to, once its entries are gone (ADR-0064). Says how
 * many rows went. Nothing to do where the table is not.
 */
export async function deleteUnreferencedSectionVectors(
  db: Drizzle,
  blobShas: readonly string[],
): Promise<number> {
  if (blobShas.length === 0 || !(await present(db))) {
    return 0;
  }
  let removed = 0;
  for (let start = 0; start < blobShas.length; start += HASH_BATCH_SIZE) {
    const rows = await db
      .delete(sectionVectors)
      .where(
        and(
          inArray(sectionVectors.blobSha, blobShas.slice(start, start + HASH_BATCH_SIZE)),
          notExists(
            db
              .select({ sha: indexEntries.blobSha })
              .from(indexEntries)
              .where(eq(indexEntries.blobSha, sectionVectors.blobSha)),
          ),
        ),
      )
      .returning({ sha: sectionVectors.blobSha });
    removed += rows.length;
  }
  return removed;
}
