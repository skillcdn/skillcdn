import { type DocumentSection, HEAD_SECTION } from "@skillcdn/core";
import { type AnyColumn, and, eq, inArray, notExists, type SQL, sql } from "drizzle-orm";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import { indexEntries, partVectors, sectionVectors } from "../schema.js";
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
  /** The section's index in the order `sectionsOf` lists them, from 0; `HEAD_SECTION` for a skill's head. */
  readonly section: number;
  readonly vector: Float32Array;
  /**
   * SHA-256, in hex, of the text the model was given for the section, where the writer knows it:
   * what {@link vectorsOfTexts} finds the vector by, for another body that says the same.
   */
  readonly textHash?: string | undefined;
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

/**
 * How many consecutive sections of a body one part vector is the mean of (ADR-0092). A change
 * of it is a migration that empties `part_vectors`, for the sweep to make them again.
 */
export const PART_SECTIONS = 8;

/**
 * The part a skill's head is, alone (ADR-0094): before the parts of the body's sections, so that
 * what a skill is named and says it does is compared as it stands, and not as a ninth of a mean.
 */
export const HEAD_PART = -1;

/** The part a section stands in, by its number: the head a part of its own, the sections after it {@link PART_SECTIONS} to a part. */
export const partOfSection = (section: SQL | AnyColumn): SQL<number> =>
  sql<number>`case when ${section} < 0 then ${sql.raw(String(HEAD_PART))} else ${section} / ${sql.raw(String(PART_SECTIONS))} end`;

/**
 * What a search by meaning compares of an entry (ADR-0094): every section of its body, and the
 * head only where the entry is a skill. A body two entries hold, a skill here and a document
 * there, has the head for the skill alone: a head names no passage for a document to show.
 */
export const COMPARED = sql`(${sectionVectors.section} >= 0 or ${indexEntries.kind} = 'skill')`;

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
 * True in a database that keeps the vectors of parts: one with section vectors whose extension
 * has the half-precision type (0.7.0 on). Where it is not, nothing makes them and a search
 * across the packs compares every section.
 */
export async function partVectorsPresent(db: Pick<Drizzle, "execute">): Promise<boolean> {
  const result = await db.execute<{ present: boolean }>(
    sql`select to_regclass('part_vectors') is not null as present`,
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

export const underKey = (key: VectorKey) =>
  and(
    eq(sectionVectors.model, key.model),
    eq(sectionVectors.dimensions, key.dimensions),
    eq(sectionVectors.sectioningVersion, key.sectioningVersion),
  );

/** The text form the extension reads. A value that is not a number has no place in a vector. */
export function vectorLiteral(vector: Float32Array): string {
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
 * done ({@link blobsWithoutVectors}); one transaction keeps that true through an interruption,
 * and the vectors of the body's parts are made in it from what is then stored (ADR-0092).
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
        textHash: item.textHash ?? null,
      }));
      const inserted = await tx
        .insert(sectionVectors)
        .values(rows)
        .onConflictDoNothing()
        .returning({ section: sectionVectors.section });
      written += inserted.length;
    }
    await writePartVectors(tx, key, [...new Set(items.map((item) => item.blobSha))]);
    return written;
  });
}

/**
 * Makes the vectors of the parts of these bodies from the vectors of their sections under the
 * key, as they are stored: the mean of every {@link PART_SECTIONS} consecutive sections, which
 * the cosine distance reads as their direction whatever its length, and a skill's head as a part
 * of its own. A part already there is made again, so that a body whose sections were added to
 * has the mean of them all.
 */
async function writePartVectors(
  db: Drizzle,
  key: VectorKey,
  blobShas: readonly string[],
): Promise<void> {
  if (blobShas.length === 0 || !(await partVectorsPresent(db))) {
    return;
  }
  for (let start = 0; start < blobShas.length; start += HASH_BATCH_SIZE) {
    await db.execute(sql`
      insert into ${partVectors} (blob_sha, model, dimensions, sectioning_version, part, sections, vector)
      select v.blob_sha, v.model, v.dimensions, v.sectioning_version,
        ${partOfSection(sql.raw("v.section"))}, count(*)::integer, avg(v.vector)::halfvec
      from ${sectionVectors} v
      where v.blob_sha = any(${sql.param(blobShas.slice(start, start + HASH_BATCH_SIZE))}::text[])
        and v.model = ${key.model} and v.dimensions = ${key.dimensions}
        and v.sectioning_version = ${key.sectioningVersion}
      group by 1, 2, 3, 4, 5
      on conflict (blob_sha, model, dimensions, sectioning_version, part)
        do update set sections = excluded.sections, vector = excluded.vector
    `);
  }
}

/**
 * Makes the part vectors of bodies that have section vectors under the key and none of these,
 * at most `limit` bodies, and says for how many: what the worker's sweep calls until nothing is
 * left, on a database whose section vectors were written before part vectors were (ADR-0092).
 * Nothing to do where the tables are not.
 */
export async function fillPartVectors(
  database: Database,
  key: VectorKey,
  limit: number,
): Promise<number> {
  const db = drizzleOf(database);
  if (!(await partVectorsPresent(db))) {
    return 0;
  }
  const without = await db.execute<{ blob_sha: string }>(sql`
    select distinct v.blob_sha
    from ${sectionVectors} v
    where v.model = ${key.model} and v.dimensions = ${key.dimensions}
      and v.sectioning_version = ${key.sectioningVersion}
      and not exists (
        select 1 from ${partVectors} p
        where p.blob_sha = v.blob_sha and p.model = v.model and p.dimensions = v.dimensions
          and p.sectioning_version = v.sectioning_version)
    limit ${limit}
  `);
  const blobShas = without.rows.map((row) => row.blob_sha);
  await writePartVectors(db, key, blobShas);
  return blobShas.length;
}

/** A skill's body whose sections have vectors and whose head has none, with what the head says. */
export interface HeadlessSkill {
  readonly blobSha: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * The bodies of findable skills that have vectors under the key and none of the head, at most
 * `limit`, in the order of their hashes: what the worker's sweep gives a head, on a database
 * whose skills were embedded before a head was (ADR-0094). A body whose sections have no vector
 * is not here: whether it is embedded at all is the slice's to decide, which writes the head
 * with the sections. A body several entries hold is named once, as the first of them names it.
 */
export async function skillBodiesWithoutHead(
  database: Database,
  key: VectorKey,
  limit: number,
): Promise<HeadlessSkill[]> {
  const db = drizzleOf(database);
  if (!(await present(db))) {
    return [];
  }
  const ofKey = sql`v.model = ${key.model} and v.dimensions = ${key.dimensions}
    and v.sectioning_version = ${key.sectioningVersion}`;
  const found = await db.execute<{ blob_sha: string; name: string; description: string | null }>(
    sql`
    select distinct on (e.blob_sha) e.blob_sha, e.name, e.description
    from ${indexEntries} e
    where e.kind = 'skill' and e.visible and e.search is not null
      and e.name is not null and e.name <> ''
      and exists (
        select 1 from ${sectionVectors} v where v.blob_sha = e.blob_sha and ${ofKey})
      and not exists (
        select 1 from ${sectionVectors} v
        where v.blob_sha = e.blob_sha and ${ofKey} and v.section = ${HEAD_SECTION})
    order by e.blob_sha, e.snapshot_id, e.path
    limit ${limit}
  `,
  );
  return found.rows.map((row) => ({
    blobSha: row.blob_sha,
    name: row.name,
    description: row.description,
  }));
}

/**
 * The vectors already made of these texts under the key's model and dimensions, by the hash of
 * each text (ADR-0093): one for every hash that has any, whichever body it was written for and
 * under whichever version of the sectioning rules, since a vector is the model's reading of the
 * text and of nothing else. What the caller embeds is then the texts that are not here.
 */
export async function vectorsOfTexts(
  database: Database,
  key: VectorKey,
  textHashes: Iterable<string>,
): Promise<Map<string, Float32Array>> {
  const db = drizzleOf(database);
  const found = new Map<string, Float32Array>();
  const unique = [...new Set(textHashes)];
  for (let start = 0; start < unique.length; start += HASH_BATCH_SIZE) {
    const rows = await db
      .selectDistinctOn([sectionVectors.textHash], {
        textHash: sectionVectors.textHash,
        vector: sectionVectors.vector,
      })
      .from(sectionVectors)
      .where(
        and(
          eq(sectionVectors.model, key.model),
          eq(sectionVectors.dimensions, key.dimensions),
          inArray(sectionVectors.textHash, unique.slice(start, start + HASH_BATCH_SIZE)),
        ),
      );
    for (const row of rows) {
      if (row.textHash !== null) {
        found.set(row.textHash, row.vector);
      }
    }
  }
  return found;
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
 * key, and with the head of every skill among them (ADR-0094), by cosine distance, with no
 * approximate index (ADR-0064). Two entries of the same bytes are two results. Ties are broken
 * by path, then section, so that the order is the same on every database. The query must have
 * the key's dimensions.
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
    .where(
      and(
        inSnapshot(scope),
        underPath(indexEntries.path, mountPath),
        FINDABLE,
        underKey(key),
        COMPARED,
      ),
    )
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
 * many rows went; the vectors of their parts go with them. Nothing to do where the table is not.
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
    if (!(await partVectorsPresent(db))) {
      continue;
    }
    await db
      .delete(partVectors)
      .where(
        and(
          inArray(partVectors.blobSha, blobShas.slice(start, start + HASH_BATCH_SIZE)),
          notExists(
            db
              .select({ sha: indexEntries.blobSha })
              .from(indexEntries)
              .where(eq(indexEntries.blobSha, partVectors.blobSha)),
          ),
        ),
      );
  }
  return removed;
}
