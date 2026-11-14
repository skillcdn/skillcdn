import { type LexemeFrequencies, type LicenseFact, serializeSearchQuery } from "@skillcdn/core";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import {
  accounts,
  indexEntries,
  partVectors,
  repoAliases,
  repoRefs,
  repos,
  sectionHalves,
  sectionVectors,
  snapshots,
} from "../schema.js";
import { BY_PATH, type EntryRecord, entryColumns, FINDABLE, rankOf } from "./entries.js";
import {
  COMPARED,
  partOfSection,
  partVectorsPresent,
  underKey,
  type VectorKey,
  vectorLiteral,
} from "./vectors.js";

// The search across every pack a deployment serves (ADR-0070): which snapshots it covers, the
// words over all of them at once, and the sections nearest in meaning, of the parts of their
// bodies nearest in meaning (ADR-0092), compared at half precision (ADR-0103). Every statement
// runs under a time limit of its own, since it reads every pack there is, and the caller decides
// what a search that ran out of time answers.

/** A pack the search across packs covers: the snapshot it is served from, and how it is addressed. */
export interface SearchablePack {
  readonly snapshotId: string;
  readonly accountId: string;
  readonly repoId: string;
  readonly host: string;
  /** The owner's login, as the host spells it. */
  readonly owner: string;
  /** The owner's id at the host, which its picture is served under. */
  readonly hostAccountId: string;
  /** The repository's name, as the host spells it. */
  readonly name: string;
  /** The license that governs the repository outside its skills (ADR-0026); null before indexed. */
  readonly license: LicenseFact | null;
  /** Whether the snapshot has a root manifest: what makes a repository a pack of its own saying. */
  readonly hasManifest: boolean;
  /** How many skills the snapshot lists. */
  readonly skillCount: number;
  /**
   * When the git host last confirmed a name of the repository, which is when it was last seen
   * to be what the index says it is; null where no name of it is kept. What the index calls
   * public is public as of then (ADR-0097).
   */
  readonly confirmedAt: Date | null;
}

/**
 * The public repositories with an index to search, each at the snapshot a mount of its default
 * branch is served from: the ref's commit where that has an index, else the ref's previous
 * commit (ADR-0068); without the repositories whose root manifest keeps them out of the search
 * across packs (`search.hub: false`, ADR-0070). In the order of their addresses. Public is what
 * the index recorded when the host was last asked: whoever shows a result to everyone asks
 * again where `confirmedAt` is long ago (ADR-0097).
 */
export async function listSearchablePacks(database: Database): Promise<SearchablePack[]> {
  const served = sql`case when exists (select 1 from ${snapshots} n where n.repo_id = ${repos.id} and n.commit_sha = ${repoRefs.commitSha} and n.index_version > 0) then ${repoRefs.commitSha} else ${repoRefs.previousCommitSha} end`;
  const optedOut = sql`exists (select 1 from ${indexEntries} m where m.snapshot_id = ${snapshots.id} and m.path = 'SKILLCDN.md' and m.kind = 'manifest' and (m.front_matter -> 'search' ->> 'hub') = 'false')`;
  const hasManifest = sql<boolean>`exists (select 1 from ${indexEntries} m where m.snapshot_id = ${snapshots.id} and m.path = 'SKILLCDN.md' and m.kind = 'manifest')`;
  const skillCount = sql<number>`(select count(*)::int from ${indexEntries} k where k.snapshot_id = ${snapshots.id} and k.kind = 'skill' and k.visible)`;
  const confirmedAt =
    sql<Date | null>`(select max(a.checked_at) from ${repoAliases} a where a.repo_id = ${repos.id})`.mapWith(
      (value: string | Date | null) => (value === null ? null : new Date(value)),
    );
  return drizzleOf(database)
    .select({
      snapshotId: snapshots.id,
      accountId: snapshots.accountId,
      repoId: repos.id,
      host: repos.host,
      owner: accounts.login,
      hostAccountId: accounts.hostAccountId,
      name: repos.name,
      license: snapshots.license,
      hasManifest,
      skillCount,
      confirmedAt,
    })
    .from(repos)
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .innerJoin(repoRefs, and(eq(repoRefs.repoId, repos.id), eq(repoRefs.ref, "")))
    .innerJoin(
      snapshots,
      and(
        eq(snapshots.repoId, repos.id),
        sql`${snapshots.commitSha} = ${served}`,
        sql`${snapshots.indexVersion} > 0`,
      ),
    )
    .where(and(eq(repos.visibility, "public"), sql`not ${optedOut}`))
    .orderBy(accounts.login, repos.name);
}

/** An entry of one of the packs searched, with the snapshot it belongs to. */
export interface HubEntryRecord extends EntryRecord {
  readonly snapshotId: string;
}

/** A section of an entry of one of the packs searched, as near to the query as the search found it. */
export interface HubSectionMatch extends HubEntryRecord {
  readonly section: number;
  readonly heading: readonly string[];
  readonly offset: number;
  readonly length: number;
  /** Cosine similarity to the query: 1 for the same direction, 0 for none. */
  readonly similarity: number;
}

/** Bounds the statements of the transaction to `timeoutMs`, after which the server cancels them. */
const bounded = (timeoutMs: number) =>
  sql`select set_config('statement_timeout', ${String(Math.max(1, Math.round(timeoutMs)))}, true)`;

/** The server cancelled a statement that ran out of its time (`query_canceled`). */
export function isStatementTimeout(error: unknown): boolean {
  const codeOf = (value: unknown): string | undefined =>
    typeof value === "object" && value !== null && "code" in value
      ? String((value as { code: unknown }).code)
      : undefined;
  if (codeOf(error) === "57014") {
    return true;
  }
  const cause =
    typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return codeOf(cause) === "57014";
}

/** What runs a statement: the pool, or a transaction of it. */
type Runner = Pick<Drizzle, "select" | "execute">;

/**
 * The entries of the snapshots searched. The snapshots travel as one array however many there
 * are, so a statement that names them more than once grows by an array and not by a parameter
 * for each.
 */
const among = (snapshotIds: readonly string[]) =>
  sql`${indexEntries.snapshotId} = any(${sql.param([...snapshotIds])}::uuid[])`;

// The entries that hold a word are taken from the index of the search vectors, and narrowed to
// the snapshots searched as they are read (ADR-0090, ADR-0098). Three things in how the
// statements are written keep a word to what it has to cost.
//
// The word reaches the comparison as a value the planner does not look into, a row of a function
// or a subquery, so that it expects few entries to hold it and goes through the index. Left to
// expect a word in many entries, it reads the entries of the snapshots, or the table, and tests
// each vector.
//
// The read of the index stands alone behind an `offset 0`, which nothing is pushed into: with
// the snapshots or what makes an entry findable beside the word in one read, the planner takes
// an index that names those and tests every vector it finds there, whatever the word, which is
// what the count across a deployment's packs once ran out of time on. What the read hands on is
// narrowed at once, on the row it has in hand. Narrowed later, by the ids of every entry that
// holds a word, each of those entries was read a second time to be turned away, and most of
// them belong to commits kept from before and to repositories no search covers.
//
// And a vector is unpacked once a row. It is kept apart from its row, and whatever names the
// column fetches it again, so that a rank of ten words fetched it ten times. The entries kept
// hand on a copy of it, behind a second `offset 0` that keeps the planner from writing the
// column back into every use.

/**
 * `offset 0` for a read made with the query builder, which leaves an offset of the number 0 out
 * of what it writes, and with it the one thing the offset is here for: the planner writes
 * nothing into a read that has one. The builder writes whatever it is handed that is not zero
 * to it, so it is handed the text.
 */
const FENCE = sql`0` as unknown as number;

/**
 * The stored vector as a value of its own: a copy that changes nothing, since the weight is set
 * on the lexemes of an empty list. A concatenation with an empty vector says the same and
 * costs several times the copy, where it was measured.
 */
const unpackedOf = (vector: SQL): SQL => sql`setweight(${vector}, 'D', '{}'::text[])`;

/**
 * The count of the findable entries, as row 0, and of those that hold each lexeme, as the row of
 * its place from 1; a lexeme no entry holds has no row. The total is read from the index of the
 * findable entries alone.
 */
function countStatement(snapshotIds: readonly string[], lexemes: readonly string[]): SQL {
  const total = sql`select 0 as at, count(*)::int as entries from ${indexEntries} where ${and(among(snapshotIds), FINDABLE)}`;
  if (lexemes.length === 0) {
    return total;
  }
  const asked = sql.param(lexemes.map((lexeme) => serializeSearchQuery([lexeme])));
  return sql`${total}
    union all
    select asked.at::int, held.entries
    from unnest(${asked}::text[]) with ordinality as asked (word, at)
    cross join lateral (
      select count(*)::int as entries
      from (
        select e.snapshot_id, e.visible from ${indexEntries} e
        where e.search @@ asked.word::tsquery
        offset 0
      ) holding
      where holding.visible and holding.snapshot_id = any(${sql.param([...snapshotIds])}::uuid[])
    ) held
    where held.entries > 0`;
}

function wordsStatement(
  runner: Runner,
  snapshotIds: readonly string[],
  lexemes: readonly string[],
  weights: readonly number[] | undefined,
  limit: number,
) {
  // The entries that hold a word, as the index of the vectors names them.
  const holding = runner
    .select({
      ...entryColumns,
      // Every entry with a vector is searchable; said by a name, for the reads around this one.
      searchable: sql<boolean>`true`.as("searchable"),
      snapshotId: indexEntries.snapshotId,
      visible: indexEntries.visible,
      search: indexEntries.search,
    })
    .from(indexEntries)
    .where(sql`${indexEntries.search} @@ (select ${serializeSearchQuery(lexemes)}::tsquery)`)
    .offset(FENCE)
    .as("holding");
  // Those of the snapshots searched, each with its vector unpacked once.
  const { visible, search, ...kept } = holding._.selectedFields;
  const found = runner
    .select({ ...kept, unpacked: unpackedOf(sql`${search}`).as("unpacked") })
    .from(holding)
    .where(
      and(
        sql`${visible}`,
        sql`${holding.snapshotId} = any(${sql.param([...snapshotIds])}::uuid[])`,
      ),
    )
    .offset(FENCE)
    .as("found");
  const { unpacked, ...columns } = found._.selectedFields;
  return runner
    .select(columns)
    .from(found)
    .orderBy(
      sql`${rankOf(lexemes, weights, sql`${unpacked}`)} desc`,
      found.snapshotId,
      sql`${found.path} collate "C"`,
    )
    .limit(limit);
}

/** A part of a body a search picked: the body, the part's place in it, and how many sections it has. */
interface PickedPart {
  readonly blobSha: string;
  readonly part: number;
  readonly sections: number;
}

/**
 * The two statements of the comparison by meaning read their tables in the order they are
 * stored (ADR-0103). Told nothing, the planner reads the parts of the bodies searched, or the
 * sections of the parts picked, through their primary key, in the order of the bodies' hashes:
 * one page at a time and each somewhere else, which a database that has them in memory does not
 * feel and one that reads them from its storage waits for page by page, three and a half seconds
 * where it was measured. Without a plain index scan it marks the pages first and reads them in
 * order, which the database reads ahead of, and the same where they are in memory.
 */
const READ_AS_STORED = sql`select set_config('enable_indexscan', 'off', true)`;
const READ_ANY_WAY = sql`select set_config('enable_indexscan', 'on', true)`;

/**
 * The parts nearest the query among the bodies of the findable entries searched, at most
 * `parts` (ADR-0092): an exact comparison with the vector of every such part, an eighth of the
 * sections and fewer. A body two packs hold is one body here. The bodies searched are handed on
 * as one array, as the entries that hold a word are (ADR-0090): joined in, the planner looks the
 * parts of each body up one body at a time, which took three times as long where it was measured.
 * Run after {@link READ_AS_STORED}.
 */
function partsStatement(
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  parts: number,
): SQL {
  return sql`
    select p.blob_sha, p.part, p.sections
    from ${partVectors} p
    where p.model = ${key.model} and p.dimensions = ${key.dimensions}
      and p.sectioning_version = ${key.sectioningVersion}
      and p.blob_sha = any(array(
        select distinct e.blob_sha from ${indexEntries} e
        where e.snapshot_id = any(${sql.param([...snapshotIds])}::uuid[])
          and e.visible and e.search is not null))
    order by p.vector <=> ${vectorLiteral(query)}::halfvec, p.blob_sha, p.part
    limit ${parts}`;
}

const pickedOf = (
  rows: readonly { blob_sha: string; part: number; sections: number }[],
): PickedPart[] =>
  rows.map((row) => ({
    blobSha: row.blob_sha,
    part: Number(row.part),
    sections: Number(row.sections),
  }));

/** A section the second step compared, with the entry it belongs to, as the database answers it. */
interface ComparedRow extends HubEntryRecord {
  readonly section: number;
  readonly heading: string[];
  readonly offset: number;
  readonly length: number;
  readonly distance: number;
}

/**
 * The sections of the parts picked, nearest the query first, at most `limit`, with the entry
 * each belongs to (ADR-0103): compared with the copies of their vectors at half precision, which
 * lie in their rows, a part's together, where a section's own vector lies beside its row and is
 * read alone. Where the copies of a part's sections are not all made, as on a database the sweep
 * has not been through since it was given their table, that part's sections are compared with
 * their own vectors, so an answer that says it is by meaning has looked. The heading, offset and
 * length of a section are read for the sections answered alone. Run after {@link READ_AS_STORED}.
 */
function halvesStatement(
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
  picked: readonly PickedPart[],
): SQL {
  const literal = vectorLiteral(query);
  const blobs = sql.param(picked.map((part) => part.blobSha));
  const ofKey = (alias: string) =>
    sql`${sql.raw(alias)}.model = ${key.model} and ${sql.raw(alias)}.dimensions = ${key.dimensions}
      and ${sql.raw(alias)}.sectioning_version = ${key.sectioningVersion}`;
  const columns = sql.join(
    Object.entries(entryColumns).map(([name, column]) => sql`${column} as ${sql.identifier(name)}`),
    sql`, `,
  );
  return sql`
    with picked (blob_sha, part, sections) as (
      select * from unnest(${blobs}::text[], ${sql.param(picked.map((part) => part.part))}::integer[],
        ${sql.param(picked.map((part) => part.sections))}::integer[])
    ),
    halved as (
      select h.blob_sha, ${partOfSection(sql.raw("h.section"))} as part, h.section,
        h.vector <=> ${literal}::halfvec as distance
      from ${sectionHalves} h
      where ${ofKey("h")} and h.blob_sha = any(${blobs}::text[])
        and (h.blob_sha, ${partOfSection(sql.raw("h.section"))}) in (select blob_sha, part from picked)
    ),
    counted as (
      select blob_sha, part, count(*) as halves from halved group by blob_sha, part
    ),
    whole as (
      select p.blob_sha, p.part from picked p
      left join counted c on c.blob_sha = p.blob_sha and c.part = p.part
      where p.sections > coalesce(c.halves, 0)
    ),
    near as (
      select blob_sha, section, distance from halved
      union all
      select v.blob_sha, v.section, v.vector <=> ${literal}::vector
      from ${sectionVectors} v
      where ${ofKey("v")}
        and (v.blob_sha, ${partOfSection(sql.raw("v.section"))}) in (select blob_sha, part from whole)
        and not exists (select 1 from halved x where x.blob_sha = v.blob_sha and x.section = v.section)
    ),
    top as (
      select ${columns}, ${indexEntries.snapshotId} as "snapshotId", near.blob_sha as matched,
        near.section, near.distance
      from near join ${indexEntries} on ${indexEntries.blobSha} = near.blob_sha
      where ${among(snapshotIds)} and ${FINDABLE}
        and (near.section >= 0 or ${indexEntries.kind} = 'skill')
      order by near.distance, ${indexEntries.snapshotId}, ${BY_PATH}, near.section
      limit ${limit}
    )
    select top.*, v.heading, v."offset", v.length
    from top join ${sectionVectors} v
      on v.blob_sha = top.matched and ${ofKey("v")} and v.section = top.section
    order by top.distance, top."snapshotId", top.path collate "C", top.section`;
}

/** Every section of the packs searched compared with the query, exactly: where no part is picked. */
function meaningStatement(
  runner: Runner,
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
) {
  const distance = sql<number>`${sectionVectors.vector} <=> ${vectorLiteral(query)}::vector`;
  return runner
    .select({
      ...entryColumns,
      snapshotId: indexEntries.snapshotId,
      section: sectionVectors.section,
      heading: sectionVectors.heading,
      offset: sectionVectors.offset,
      length: sectionVectors.length,
      distance,
    })
    .from(indexEntries)
    .innerJoin(sectionVectors, eq(sectionVectors.blobSha, indexEntries.blobSha))
    .where(and(among(snapshotIds), FINDABLE, underKey(key), COMPARED))
    .orderBy(distance, indexEntries.snapshotId, BY_PATH, sectionVectors.section)
    .limit(limit);
}

/**
 * How many findable entries the packs hold together, and how many of them hold each lexeme
 * (ADR-0069): what a query's words are weighed by across every pack.
 */
export async function countHubLexemes(
  database: Database,
  snapshotIds: readonly string[],
  lexemes: readonly string[],
  timeoutMs: number,
): Promise<LexemeFrequencies> {
  if (snapshotIds.length === 0) {
    return { total: 0, counts: lexemes.map(() => 0) };
  }
  const rows = await drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    const result = await tx.execute<{ at: number; entries: number }>(
      countStatement(snapshotIds, lexemes),
    );
    return result.rows;
  });
  const counted = new Map(rows.map((row) => [Number(row.at), Number(row.entries)]));
  return { total: counted.get(0) ?? 0, counts: lexemes.map((_, at) => counted.get(at + 1) ?? 0) };
}

/**
 * The findable entries of the packs whose vector holds any of the query's lexemes, best first
 * across every pack, as `searchEntries` ranks them inside one (ADR-0069): the weighed rank, a
 * skill ranked as a document is (ADR-0095), ties by pack and then by path. At most `limit`.
 */
export async function searchHubEntries(
  database: Database,
  snapshotIds: readonly string[],
  lexemes: readonly string[],
  weights: readonly number[] | undefined,
  limit: number,
  timeoutMs: number,
): Promise<HubEntryRecord[]> {
  if (snapshotIds.length === 0 || lexemes.length === 0) {
    return [];
  }
  return drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    return wordsStatement(tx, snapshotIds, lexemes, weights, limit);
  });
}

/**
 * The sections of the packs' findable entries nearest to a query vector, best first and at most
 * `limit`, with the entry each belongs to, in two steps (ADR-0092): the `parts` parts of their
 * bodies nearest the query are picked by the vector of each part, the mean of its sections',
 * a skill's head being a part of its own (ADR-0094), and the sections of those parts are then
 * compared at half precision (ADR-0103), both read in the order their tables are stored. The
 * two statements share the one time limit. A body without part vectors yet is not found beside
 * bodies that have theirs, which is the sweep's to end (`fillPartVectors`). With `parts` at 0,
 * in a database that keeps no part vectors, and where none of the bodies searched has a part
 * yet, as after an update that brought the parts or an import of vectors made elsewhere, every
 * section of the packs is compared exactly, as `searchSectionVectors` compares inside one mount
 * (ADR-0064): an answer that says it is by meaning has looked.
 */
export async function searchHubSectionVectors(
  database: Database,
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
  timeoutMs: number,
  parts: number,
): Promise<HubSectionMatch[]> {
  if (snapshotIds.length === 0) {
    return [];
  }
  if (query.length !== key.dimensions) {
    throw new RangeError(
      `a query of ${query.length} dimensions cannot be searched under a key of ${key.dimensions}`,
    );
  }
  const rows = await drizzleOf(database).transaction(async (tx): Promise<ComparedRow[]> => {
    await tx.execute(bounded(timeoutMs));
    if (parts <= 0 || !(await partVectorsPresent(tx))) {
      return meaningStatement(tx, snapshotIds, key, query, limit);
    }
    const started = performance.now();
    await tx.execute(READ_AS_STORED);
    const picked = await tx.execute<{ blob_sha: string; part: number; sections: number }>(
      partsStatement(snapshotIds, key, query, parts),
    );
    await tx.execute(bounded(timeoutMs - (performance.now() - started)));
    if (picked.rows.length === 0) {
      await tx.execute(READ_ANY_WAY);
      return meaningStatement(tx, snapshotIds, key, query, limit);
    }
    const compared = await tx.execute<Record<string, unknown>>(
      halvesStatement(snapshotIds, key, query, limit, pickedOf(picked.rows)),
    );
    // The statement names its columns as the record does, and adds the body it matched by.
    const answered = compared.rows as unknown as readonly (ComparedRow & { matched: string })[];
    return answered.map(({ matched: _, ...row }) => row);
  });
  return rows.map(({ distance: away, ...row }) => ({ ...row, similarity: 1 - Number(away) }));
}

/** What one statement of the search across packs read to answer, as the database counted it. */
export interface HubStatementReading {
  /** How long the statement ran, in milliseconds. */
  readonly ms: number;
  /** The rows of `index_entries` it visited: those it kept and those a condition turned away. */
  readonly entries: number;
  /** The pages it read, wherever they were. */
  readonly pages: number;
  /** Those of the pages that were not in the database's memory. */
  readonly pagesFromDisk: number;
  /** The indexes it went through. */
  readonly indexes: readonly string[];
  /** How it read each table it read, as `Bitmap Heap Scan on part_vectors`: once each, sorted. */
  readonly scans: readonly string[];
}

/** A question to the search across packs, for {@link readHubStatements}. */
export interface HubQuestion {
  readonly snapshotIds: readonly string[];
  readonly lexemes: readonly string[];
  readonly weights?: readonly number[] | undefined;
  readonly limit: number;
  /**
   * The key and the query's vector, where the meaning is measured as well, and how many parts
   * are picked before their sections are compared; 0 or left out, every section is compared.
   */
  readonly meaning?:
    | { readonly key: VectorKey; readonly query: Float32Array; readonly parts?: number | undefined }
    | undefined;
}

interface PlanNode {
  readonly "Node Type"?: string;
  readonly "Relation Name"?: string;
  readonly "Index Name"?: string;
  readonly "Actual Rows"?: number;
  readonly "Actual Loops"?: number;
  readonly "Rows Removed by Filter"?: number;
  readonly "Rows Removed by Index Recheck"?: number;
  readonly "Shared Hit Blocks"?: number;
  readonly "Shared Read Blocks"?: number;
  readonly Plans?: readonly PlanNode[];
}

function readingOf(explained: unknown): HubStatementReading {
  const [top] = explained as readonly [
    { readonly Plan: PlanNode; readonly "Execution Time": number },
  ];
  let entries = 0;
  const indexes = new Set<string>();
  const scans = new Set<string>();
  const walk = (node: PlanNode): void => {
    const loops = node["Actual Loops"] ?? 1;
    if (node["Relation Name"] === "index_entries") {
      entries +=
        ((node["Actual Rows"] ?? 0) +
          (node["Rows Removed by Filter"] ?? 0) +
          (node["Rows Removed by Index Recheck"] ?? 0)) *
        loops;
    }
    if (node["Relation Name"] !== undefined) {
      scans.add(`${node["Node Type"]} on ${node["Relation Name"]}`);
    }
    if (node["Index Name"] !== undefined) {
      indexes.add(node["Index Name"]);
    }
    for (const child of node.Plans ?? []) {
      walk(child);
    }
  };
  walk(top.Plan);
  const hit = top.Plan["Shared Hit Blocks"] ?? 0;
  const read = top.Plan["Shared Read Blocks"] ?? 0;
  return {
    ms: top["Execution Time"],
    entries: Math.round(entries),
    pages: hit + read,
    pagesFromDisk: read,
    indexes: [...indexes].sort(),
    scans: [...scans].sort(),
  };
}

/**
 * Runs the statements of a search across packs as the functions above run them, and says what
 * each read: for the measurement that keeps a search's cost from following what a deployment
 * holds beside what it searches (`eval:hub`), and for the tests of the same. Without a time
 * limit, so that a statement that would be cancelled is measured to its end.
 */
export async function readHubStatements(
  database: Database,
  question: HubQuestion,
): Promise<{
  readonly count: HubStatementReading;
  readonly words: HubStatementReading | undefined;
  readonly meaning: HubStatementReading | undefined;
}> {
  const explain = async (
    statement: (tx: Runner) => SQL,
    asStored = false,
  ): Promise<HubStatementReading> =>
    drizzleOf(database).transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '0', true)`);
      if (asStored) {
        await tx.execute(READ_AS_STORED);
      }
      const result = await tx.execute<{ "QUERY PLAN": unknown }>(
        sql`explain (analyze, buffers, timing off, format json) ${statement(tx)}`,
      );
      return readingOf(result.rows[0]?.["QUERY PLAN"]);
    });
  const { snapshotIds, lexemes, weights, limit, meaning } = question;
  /** The two steps of the meaning as one reading, or the one statement that compares everything. */
  const explainMeaning = async (
    asked: NonNullable<HubQuestion["meaning"]>,
  ): Promise<HubStatementReading> => {
    const parts = asked.parts ?? 0;
    const everySection = () =>
      explain((tx) => meaningStatement(tx, snapshotIds, asked.key, asked.query, limit).getSQL());
    if (parts <= 0 || !(await partVectorsPresent(drizzleOf(database)))) {
      return everySection();
    }
    const statement = partsStatement(snapshotIds, asked.key, asked.query, parts);
    const picking = await explain(() => statement, true);
    const picked = await drizzleOf(database).execute<{
      blob_sha: string;
      part: number;
      sections: number;
    }>(statement);
    if (picked.rows.length === 0) {
      return everySection();
    }
    const comparing = await explain(
      () => halvesStatement(snapshotIds, asked.key, asked.query, limit, pickedOf(picked.rows)),
      true,
    );
    return {
      ms: picking.ms + comparing.ms,
      entries: picking.entries + comparing.entries,
      pages: picking.pages + comparing.pages,
      pagesFromDisk: picking.pagesFromDisk + comparing.pagesFromDisk,
      indexes: [...new Set([...picking.indexes, ...comparing.indexes])].sort(),
      scans: [...new Set([...picking.scans, ...comparing.scans])].sort(),
    };
  };
  return {
    count: await explain(() => countStatement(snapshotIds, lexemes)),
    words:
      lexemes.length === 0
        ? undefined
        : await explain((tx) => wordsStatement(tx, snapshotIds, lexemes, weights, limit).getSQL()),
    meaning: meaning === undefined ? undefined : await explainMeaning(meaning),
  };
}
