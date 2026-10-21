import {
  type BlobStore,
  type Embedder,
  type GitHost,
  type IndexLimits,
  type IndexOutcome,
  NO_LICENSE,
  type Reranker,
} from "@skillcdn/core";
import { createIndexStore, type Database, type VectorKey } from "@skillcdn/db";
import { Reader } from "@skillcdn/reader";
import type { SnapshotService } from "../indexer/snapshot-service.js";
import type { Mount } from "./mount-service.js";

// The reader of this deployment (ADR-0054): the reads of @skillcdn/reader over the index the
// database keeps of a commit, waiting for one that is being built as the snapshot service says,
// with the git host behind it for a body the blob store does not hold yet, and the search by
// meaning where the deployment has an embedder and the database keeps vectors (ADR-0064).

/** The search by meaning of a deployment, as the configuration and the database allow it. */
export interface MountMeaning {
  readonly embedder: Embedder;
  readonly reranker: Reranker | undefined;
  /** How many of the first results the reranker scores. */
  readonly rerankCandidates: number | undefined;
  /**
   * The key the vectors are searched under, or `undefined` where the database keeps none: then no
   * query is embedded, and the words answer alone without saying anything of meaning.
   */
  readonly key: VectorKey | undefined;
}

export interface MountReaderOptions {
  readonly database: Database;
  readonly blobStore: BlobStore;
  readonly gitHost: GitHost;
  readonly snapshots: SnapshotService;
  readonly limits: IndexLimits;
  /** Left out, the search is by words alone. */
  readonly meaning?: MountMeaning | undefined;
}

export function createMountReader(options: MountReaderOptions): Reader<Mount> {
  const { database, blobStore, gitHost, snapshots, limits, meaning } = options;
  const vectors = meaning?.key;
  return new Reader<Mount>({
    limits,
    index: async (mount, waitMs): Promise<IndexOutcome> => {
      const outcome = await snapshots.ready(mount, waitMs);
      if (outcome.status !== "ready") {
        return outcome;
      }
      const { snapshot } = outcome;
      return {
        status: "ready",
        index: {
          // A rebuilt index keeps its snapshot id, so everything cached keys on both.
          id: snapshot.id,
          version: snapshot.indexVersion,
          truncated: snapshot.truncated,
          license: snapshot.license ?? NO_LICENSE,
          store: createIndexStore(
            database,
            { accountId: snapshot.accountId, snapshotId: snapshot.id },
            { vectors },
          ),
          blobs: blobStore,
        },
      };
    },
    // A body the index names but the store does not hold yet is fetched from the host and kept.
    fetchBody: async (mount, hash, maxBytes) => {
      const bytes = await gitHost.readBlob(mount.coordinates, hash, maxBytes);
      await blobStore.write(hash, bytes);
      return bytes;
    },
    ...(meaning === undefined || vectors === undefined
      ? {}
      : {
          meaning: {
            embedder: meaning.embedder,
            reranker: meaning.reranker,
            rerankCandidates: meaning.rerankCandidates,
          },
        }),
  });
}
