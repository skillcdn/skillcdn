import { type HostRepository, type IndexEntry, NO_LICENSE } from "@skillcdn/core";
import {
  claimSnapshot,
  createBlobStore,
  type Database,
  ensureSnapshot,
  type SnapshotScope,
  saveCachedRef,
  saveRepository,
  writeSnapshotIndex,
} from "@skillcdn/db";
import { INDEX_VERSION } from "@skillcdn/indexer";

// Test support: a ready snapshot of a repository of its own, written into the database from a
// few files, outside every fixture of the git host: what a test of the embedding needs of a
// repository of any rank, without indexing one.

export interface MadeSnapshotOptions {
  readonly visibility: "public" | "private";
  /** The account's login; repositories of one owner share an account. */
  readonly owner?: string;
  /** The commit of the default branch, so served right now, when true. */
  readonly served?: boolean;
  readonly files: readonly {
    readonly path: string;
    readonly text: string;
    readonly kind?: "markdown" | "manifest" | "skill";
    readonly frontMatter?: IndexEntry["frontMatter"];
  }[];
}

let nextHostId = 8000;

export async function makeSnapshot(database: Database, options: MadeSnapshotOptions) {
  nextHostId += 1;
  const owner = options.owner ?? `owner-${nextHostId}`;
  const repository: HostRepository = {
    hostRepoId: String(nextHostId),
    name: `repo-${nextHostId}`,
    defaultBranch: "main",
    description: undefined,
    visibility: options.visibility,
    owner: { hostAccountId: `account-${owner}`, login: owner, kind: "organization" },
  };
  const now = new Date();
  const saved = await saveRepository(
    database,
    { host: "gh", owner, repo: repository.name },
    repository,
    now,
  );
  const repo = { accountId: saved.accountId, repoId: saved.id };
  const commit = nextHostId.toString(16).padStart(40, "0");
  const snapshot = await ensureSnapshot(database, repo, commit, INDEX_VERSION, now);
  const scope: SnapshotScope = { accountId: repo.accountId, snapshotId: snapshot.id };
  if ((await claimSnapshot(database, scope, "test", now, 60_000)) === undefined) {
    throw new Error("the snapshot could not be claimed");
  }
  const blobs = createBlobStore(database);
  const entries: IndexEntry[] = [];
  for (const file of options.files) {
    const bytes = new TextEncoder().encode(file.text);
    const blobSha = `blob-${nextHostId}-${entries.length}`;
    await blobs.write(blobSha, bytes);
    const skillDir = file.path.slice(0, file.path.lastIndexOf("/"));
    entries.push({
      path: file.path,
      kind: file.kind ?? "markdown",
      size: bytes.byteLength,
      blobSha,
      skillDir: file.kind === "skill" ? skillDir : undefined,
      name: file.kind === "skill" ? skillDir.split("/").at(-1) : undefined,
      title: undefined,
      description: undefined,
      frontMatter: file.frontMatter,
      searchable: file.kind !== "manifest",
      visible: true,
    });
  }
  const written = await writeSnapshotIndex(
    database,
    scope,
    "test",
    {
      entries,
      truncated: false,
      indexedBytes: 0,
      diagnostics: [],
      license: NO_LICENSE,
      version: INDEX_VERSION,
    },
    now,
  );
  if (!written) {
    throw new Error("the index of the snapshot was not written");
  }
  if (options.served) {
    await saveCachedRef(database, repo, "", commit, now);
  }
  return { scope, repo, commit, repository, entries };
}
