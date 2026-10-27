import { type LexemeFrequencies, type LicenseFact, serializeSearchQuery } from "@skillcdn/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
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
  const within = and(inArray(indexEntries.snapshotId, [...snapshotIds]), FINDABLE);
  return drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    if (lexemes.length === 0) {
      const [row] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(indexEntries)
        .where(within);
      return { total: row?.total ?? 0, counts: [] };
    }
    const counted = sql.join(
      lexemes.map(
        (lexeme) =>
          sql`(count(*) filter (where ${indexEntries.search} @@ ${serializeSearchQuery([lexeme])}::tsquery))::int`,
      ),
      sql`, `,
    );
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        counts: sql<number[]>`array[${counted}]::int[]`,
      })
      .from(indexEntries)
      .where(within);
    return { total: row?.total ?? 0, counts: row?.counts ?? lexemes.map(() => 0) };
  });
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
  const tsquery = sql`${serializeSearchQuery(lexemes)}::tsquery`;
  const rank = sql<number>`${rankOf(lexemes, weights)} * case when ${indexEntries.kind} = 'skill' then 1.5 else 1 end`;
  return drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    return tx
      .select({ ...entryColumns, snapshotId: indexEntries.snapshotId })
      .from(indexEntries)
      .where(
        and(
          inArray(indexEntries.snapshotId, [...snapshotIds]),
          VISIBLE,
          sql`${indexEntries.search} @@ ${tsquery}`,
        ),
      )
      .orderBy(sql`${rank} desc`, indexEntries.snapshotId, BY_PATH)
      .limit(limit);
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
  const distance = sql<number>`${sectionVectors.vector} <=> ${vectorLiteral(query)}::vector`;
  const rows = await drizzleOf(database).transaction(async (tx) => {
    await tx.execute(bounded(timeoutMs));
    return tx
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
      .where(and(inArray(indexEntries.snapshotId, [...snapshotIds]), FINDABLE, underKey(key)))
      .orderBy(distance, indexEntries.snapshotId, BY_PATH, sectionVectors.section)
      .limit(limit);
  });
  return rows.map(({ distance: away, ...row }) => ({ ...row, similarity: 1 - Number(away) }));
}
