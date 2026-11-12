import { type LexemeFrequencies, type LicenseFact, serializeSearchQuery } from "@skillcdn/core";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { type Database, type Drizzle, drizzleOf } from "../client.js";
import { accounts, indexEntries, repoRefs, repos, sectionVectors, snapshots } from "../schema.js";
import { BY_PATH, type EntryRecord, entryColumns, FINDABLE, rankOf, VISIBLE } from "./entries.js";
import { underKey, type VectorKey, vectorLiteral } from "./vectors.js";

// The search across every pack a deployment serves (ADR-0070): which snapshots it covers, the
// words over all of them at once, and the sections nearest in meaning over all of them. Every
// statement runs under a time limit of its own, since it reads every pack there is, and the
// caller decides what a search that ran out of time answers.

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
}

/**
 * The public repositories with an index to search, each at the snapshot a mount of its default
 * branch is served from: the ref's commit where that has an index, else the ref's previous
 * commit (ADR-0068); without the repositories whose root manifest keeps them out of the search
 * across packs (`search.hub: false`, ADR-0070). In the order of their addresses.
 */
export async function listSearchablePacks(database: Database): Promise<SearchablePack[]> {
  const served = sql`case when exists (select 1 from ${snapshots} n where n.repo_id = ${repos.id} and n.commit_sha = ${repoRefs.commitSha} and n.index_version > 0) then ${repoRefs.commitSha} else ${repoRefs.previousCommitSha} end`;
  const optedOut = sql`exists (select 1 from ${indexEntries} m where m.snapshot_id = ${snapshots.id} and m.path = 'SKILLCDN.md' and m.kind = 'manifest' and (m.front_matter -> 'search' ->> 'hub') = 'false')`;
  const hasManifest = sql<boolean>`exists (select 1 from ${indexEntries} m where m.snapshot_id = ${snapshots.id} and m.path = 'SKILLCDN.md' and m.kind = 'manifest')`;
  const skillCount = sql<number>`(select count(*)::int from ${indexEntries} k where k.snapshot_id = ${snapshots.id} and k.kind = 'skill' and k.visible)`;
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

// The entries that hold a word are taken from the index of the search vectors, and only then
// narrowed to the snapshots searched (ADR-0090). Left to choose, the planner turns that around
// where it expects a word in many entries: it reads the entries of the snapshots, or the table,
// and tests each vector, which is kept apart from its row and unpacked for every test. That is what
// the count across a deployment's packs ran out of time on, and it costs the same for a word
// that nothing holds. Two things keep the order: the word reaches the comparison as a value the
// planner does not look into, a row of a function or a subquery, so that it expects few entries
// to hold it and goes through the index; and the entries found are handed on as a whole, a
// `materialized` set or an array of ids, which no later condition is pushed into. A word then
// costs the entries that hold it.

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
  return sql`with holding as materialized (
      select asked.at, held.snapshot_id, held.visible
      from unnest(${asked}::text[]) with ordinality as asked (word, at)
      cross join lateral (
        select e.snapshot_id, e.visible from ${indexEntries} e where e.search @@ asked.word::tsquery
      ) held
    )
    ${total}
    union all
    select holding.at::int, count(*)::int from holding
    where holding.visible and holding.snapshot_id = any(${sql.param([...snapshotIds])}::uuid[])
    group by holding.at`;
}

function wordsStatement(
  runner: Runner,
  snapshotIds: readonly string[],
  lexemes: readonly string[],
  weights: readonly number[] | undefined,
  limit: number,
) {
  // The entries that hold a word, by their ids: the one place a vector is tested. Those of the
  // snapshots searched are then ranked, which is where a vector is unpacked.
  const holding = sql`array(select held.id from ${indexEntries} held where held.search @@ (select ${serializeSearchQuery(lexemes)}::tsquery))`;
  const rank = sql<number>`${rankOf(lexemes, weights)} * case when ${indexEntries.kind} = 'skill' then 1.5 else 1 end`;
  return runner
    .select({ ...entryColumns, snapshotId: indexEntries.snapshotId })
    .from(indexEntries)
    .where(and(sql`${indexEntries.id} = any(${holding})`, among(snapshotIds), VISIBLE))
    .orderBy(sql`${rank} desc`, indexEntries.snapshotId, BY_PATH)
    .limit(limit);
}

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
    .where(and(among(snapshotIds), FINDABLE, underKey(key)))
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
 * skill above a document, ties by pack and then by path. At most `limit`.
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
 * `limit`: an exact comparison with every section that has a vector under the key, as
 * `searchSectionVectors` compares inside one mount (ADR-0064), with the entry each belongs to.
 */
export async function searchHubSectionVectors(
  database: Database,
  snapshotIds: readonly string[],
  key: VectorKey,
  query: Float32Array,
  limit: number,
  timeoutMs: number,
): Promise<HubSectionMatch[]> {
  if (snapshotIds.length === 0) {
    return [];
  }
  if (query.length !== key.dimensions) {
    throw new RangeError(
      `a query of ${query.length} dimensions cannot be searched under a key of ${key.dimensions}`,
    );
  }
  const rows = await drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    return meaningStatement(tx, snapshotIds, key, query, limit);
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
}

/** A question to the search across packs, for {@link readHubStatements}. */
export interface HubQuestion {
  readonly snapshotIds: readonly string[];
  readonly lexemes: readonly string[];
  readonly weights?: readonly number[] | undefined;
  readonly limit: number;
  /** The key and the query's vector, where the meaning is measured as well. */
  readonly meaning?: { readonly key: VectorKey; readonly query: Float32Array } | undefined;
}

interface PlanNode {
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
  const walk = (node: PlanNode): void => {
    const loops = node["Actual Loops"] ?? 1;
    if (node["Relation Name"] === "index_entries") {
      entries +=
        ((node["Actual Rows"] ?? 0) +
          (node["Rows Removed by Filter"] ?? 0) +
          (node["Rows Removed by Index Recheck"] ?? 0)) *
        loops;
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
  const explain = async (statement: (tx: Runner) => SQL): Promise<HubStatementReading> =>
    drizzleOf(database).transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '0', true)`);
      const result = await tx.execute<{ "QUERY PLAN": unknown }>(
        sql`explain (analyze, buffers, timing off, format json) ${statement(tx)}`,
      );
      return readingOf(result.rows[0]?.["QUERY PLAN"]);
    });
  const { snapshotIds, lexemes, weights, limit, meaning } = question;
  return {
    count: await explain(() => countStatement(snapshotIds, lexemes)),
    words:
      lexemes.length === 0
        ? undefined
        : await explain((tx) => wordsStatement(tx, snapshotIds, lexemes, weights, limit).getSQL()),
    meaning:
      meaning === undefined
        ? undefined
        : await explain((tx) =>
            meaningStatement(tx, snapshotIds, meaning.key, meaning.query, limit).getSQL(),
          ),
  };
}
