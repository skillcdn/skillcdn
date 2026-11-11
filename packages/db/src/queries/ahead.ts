import { LOCAL_HOST_KEY } from "@skillcdn/core";
import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, indexEntries, repoRefs, repos, snapshots } from "../schema.js";
import { EMBED_TIERS, type EmbedTier } from "./embeddings.js";
import { PINNED_REF_PREFIX } from "./repos.js";

// What the worker looks at ahead of requests (ADR-0085): the repositories with a moving ref that
// is due, because the git host announced a push, because the host was not asked about it for a
// while, or because the commit it points at has no index under the reading rules in force. Only
// refs somebody asked for are remembered, so nothing here names a repository no request ever did.

/** The place of a tier in {@link EMBED_TIERS}, as the rank computed in SQL names it. */
const tierAt = (rank: number): EmbedTier => EMBED_TIERS[Number(rank)] ?? "other";
const OTHER = EMBED_TIERS.indexOf("other");
const LISTED = EMBED_TIERS.indexOf("listed");

/**
 * The rank of a repository as the worker ranks it (ADR-0072), over `repos` joined with
 * `accounts`: a pack of the deployment's directory or a repository the operator lists; a
 * repository that is not public, or one whose index holds a manifest; one whose index holds a
 * skill; the rest. Any index of the repository says what it holds: a repository is a pack or it
 * is not, whichever commit was read.
 */
function rankOfRepository(listed: readonly string[]): SQL<number> {
  const keys = sql.param(listed.map((key) => key.toLowerCase()));
  const key = sql`lower('/' || ${repos.host} || '/' || ${accounts.login} || '/' || ${repos.name})`;
  const holds = (kind: "manifest" | "skill") =>
    sql`exists (select 1 from ${indexEntries} inner join ${snapshots} on ${snapshots.id} = ${indexEntries.snapshotId} where ${snapshots.repoId} = ${repos.id} and ${indexEntries.kind} = ${kind})`;
  return sql<number>`case
    when ${repos.host} = ${LOCAL_HOST_KEY} or ${key} = any(${keys}::text[]) then 0
    when ${repos.visibility} = 'private' or ${holds("manifest")} then 1
    when ${holds("skill")} then 2
    else 3
  end`;
}

export interface IndexAheadOptions {
  readonly now: Date;
  /** A ref the host was last asked about before this instant is due again. */
  readonly staleBefore: Date;
  /** The version of the reading rules in force: an index below it is to be rebuilt. */
  readonly indexVersion: number;
  /** The repositories the operator lists, `/gh/owner/repo` each. */
  readonly listed: readonly string[];
  /**
   * Whether every pack is looked at when its time is up, or only the packs of the deployment's
   * directory and the listed repositories. A push the host announced is followed for every pack
   * either way.
   */
  readonly everyPack: boolean;
  readonly limit: number;
}

/** A repository with a ref the worker is to ask the host about. */
export interface RepositoryToIndexAhead {
  readonly accountId: string;
  readonly repoId: string;
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  /** True when the host announced a push nobody has looked at yet. */
  readonly announced: boolean;
  readonly tier: EmbedTier;
}

/**
 * The repositories with a moving ref that is due (ADR-0085): those with an announced push first,
 * then by rank, then the one unasked the longest, at most `limit`. A repository that is no pack
 * is never among them: a request indexes it, as before.
 */
export async function listRepositoriesToIndexAhead(
  database: Database,
  options: IndexAheadOptions,
): Promise<RepositoryToIndexAhead[]> {
  const now = sql`${options.now.toISOString()}::timestamptz`;
  const staleBefore = sql`${options.staleBefore.toISOString()}::timestamptz`;
  const rank = rankOfRepository(options.listed);
  const moving = sql`${repoRefs.repoId} = ${repos.id} and ${repoRefs.ref} not like ${`${PINNED_REF_PREFIX}%`}`;
  const announced = sql<boolean>`exists (select 1 from ${repoRefs} where ${moving} and ${repoRefs.announcedAt} is not null)`;
  // The commit a ref points at is settled when its index is ready under the rules in force,
  // being built by a process whose claim still holds, or failed and not yet due for its retry:
  // the snapshot keeps its own schedule (ADR-0007). Anything else is the worker's to start.
  const settled = sql`exists (select 1 from ${snapshots} where ${snapshots.repoId} = ${repoRefs.repoId} and ${snapshots.commitSha} = ${repoRefs.commitSha} and (
      (${snapshots.status} = 'ready' and ${snapshots.indexVersion} >= ${options.indexVersion})
      or (${snapshots.status} = 'indexing' and ${snapshots.leaseExpiresAt} > ${now})
      or (${snapshots.status} = 'failed' and ${snapshots.retryAt} > ${now})
    ))`;
  const due = sql<boolean>`exists (select 1 from ${repoRefs} where ${moving} and (${repoRefs.checkedAt} < ${staleBefore} or not ${settled}))`;
  const oldest = sql`(select min(${repoRefs.checkedAt}) from ${repoRefs} where ${moving})`;
  const rows = await drizzleOf(database)
    .select({
      accountId: repos.accountId,
      repoId: repos.id,
      host: repos.host,
      owner: accounts.login,
      name: repos.name,
      announced,
      rank,
    })
    .from(repos)
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(
      or(
        and(announced, sql`${rank} < ${OTHER}`),
        and(due, sql`${rank} <= ${options.everyPack ? OTHER - 1 : LISTED}`),
      ),
    )
    .orderBy(sql`${announced} desc`, rank, oldest, repos.id)
    .limit(options.limit);
  return rows.map(({ rank: place, ...repository }) => ({ ...repository, tier: tierAt(place) }));
}
