import type { GitHostKey, StoredTranslation } from "@skillcdn/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, indexEntries, repoRefs, repos, snapshots } from "../schema.js";

// What the page of an account leads with (docs/adr/0037): the repositories of the account that
// are indexed and hold skills, read from the index alone. Asking never touches the git host and
// never starts indexing.

export interface IndexedRepository {
  readonly host: GitHostKey;
  /** As the host spells them. */
  readonly owner: string;
  readonly name: string;
  readonly hostRepoId: string;
  readonly defaultBranch: string;
  readonly description: string | undefined;
  /** The commit of the default branch the index is of. */
  readonly commit: string;
  /** How many skills can be discovered in it: what a mount of its root counts. */
  readonly skillCount: number;
  /** The first of them by path, by name. */
  readonly skills: readonly string[];
  /** What the manifest at its root says it is, when it has one. */
  readonly manifest:
    | {
        readonly name: string | undefined;
        readonly description: string;
        readonly translations: Readonly<Record<string, StoredTranslation>>;
        /** The picture it declares: a repository-root path, or an `https` URL. */
        readonly image: string | undefined;
      }
    | undefined;
}

/** A skill that can be found: what `countEntries` counts for the root of a repository. */
const DISCOVERABLE_SKILL = and(
  eq(indexEntries.kind, "skill"),
  eq(indexEntries.visible, true),
  sql`${indexEntries.search} is not null`,
);

/**
 * The public repositories of an account whose default branch is indexed and holds skills, most
 * skills first. Scoped to the account by the host's immutable id, and limited to repositories
 * that were public when the host was last asked about them. That may be a while ago: whoever
 * shows the result to everyone confirms with the host that each still is.
 */
export async function listIndexedRepositories(
  database: Database,
  owner: { readonly host: GitHostKey; readonly hostAccountId: string },
  limits: { readonly repositories: number; readonly skillNames: number },
): Promise<IndexedRepository[]> {
  const db = drizzleOf(database);
  const skillCount = sql<number>`(select count(*)::integer from ${indexEntries} where ${indexEntries.snapshotId} = ${snapshots.id} and ${DISCOVERABLE_SKILL})`;
  const rows = await db
    .select({
      accountId: repos.accountId,
      login: accounts.login,
      name: repos.name,
      hostRepoId: repos.hostRepoId,
      defaultBranch: repos.defaultBranch,
      description: repos.description,
      snapshotId: snapshots.id,
      commit: snapshots.commitSha,
      skillCount,
    })
    .from(repos)
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    // The empty ref is the default branch: its cached commit is the one the page of the
    // repository shows.
    .innerJoin(repoRefs, and(eq(repoRefs.repoId, repos.id), eq(repoRefs.ref, "")))
    .innerJoin(
      snapshots,
      and(
        eq(snapshots.repoId, repos.id),
        eq(snapshots.accountId, repos.accountId),
        eq(snapshots.commitSha, repoRefs.commitSha),
        eq(snapshots.status, "ready"),
      ),
    )
    .where(
      and(
        eq(accounts.host, owner.host),
        eq(accounts.hostAccountId, owner.hostAccountId),
        eq(repos.visibility, "public"),
        sql`${skillCount} > 0`,
      ),
    )
    .orderBy(sql`${skillCount} desc`, sql`${repos.name} collate "C"`)
    .limit(limits.repositories);
  const [first] = rows;
  if (first === undefined) {
    return [];
  }
  const inSnapshots = and(
    eq(indexEntries.accountId, first.accountId),
    inArray(
      indexEntries.snapshotId,
      rows.map((row) => row.snapshotId),
    ),
  );

  const ranked = db
    .select({
      snapshotId: indexEntries.snapshotId,
      name: indexEntries.name,
      position:
        sql<number>`row_number() over (partition by ${indexEntries.snapshotId} order by ${indexEntries.path} collate "C")`.as(
          "position",
        ),
    })
    .from(indexEntries)
    .where(and(inSnapshots, DISCOVERABLE_SKILL))
    .as("ranked");
  const [names, manifests] = await Promise.all([
    db
      .select({ snapshotId: ranked.snapshotId, name: ranked.name })
      .from(ranked)
      .where(sql`${ranked.position} <= ${limits.skillNames}`)
      .orderBy(ranked.snapshotId, ranked.position),
    db
      .select({
        snapshotId: indexEntries.snapshotId,
        name: indexEntries.name,
        description: indexEntries.description,
        frontMatter: indexEntries.frontMatter,
      })
      .from(indexEntries)
      .where(
        and(
          inSnapshots,
          eq(indexEntries.kind, "manifest"),
          eq(indexEntries.path, "SKILLCDN.md"),
          eq(indexEntries.visible, true),
        ),
      ),
  ]);

  return rows.map((row) => {
    const manifest = manifests.find((entry) => entry.snapshotId === row.snapshotId);
    return {
      // The only host there is; a second one arrives with its adapter and its key.
      host: owner.host,
      owner: row.login,
      name: row.name,
      hostRepoId: row.hostRepoId,
      defaultBranch: row.defaultBranch,
      description: row.description ?? undefined,
      commit: row.commit,
      skillCount: row.skillCount,
      skills: names.flatMap((entry) =>
        entry.snapshotId === row.snapshotId && entry.name !== null ? [entry.name] : [],
      ),
      manifest:
        manifest === undefined || manifest.description === null
          ? undefined
          : {
              name: manifest.name ?? undefined,
              description: manifest.description,
              translations: manifest.frontMatter?.translations ?? {},
              image: manifest.frontMatter?.image,
            },
    };
  });
}
