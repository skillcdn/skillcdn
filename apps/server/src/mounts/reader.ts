import {
  type BlobStore,
  decodeText,
  type Embedder,
  type GitHost,
  type IndexLimits,
  type IndexOutcome,
  NO_LICENSE,
  type RepoPath,
  type Reranker,
} from "@skillcdn/core";
import { createIndexStore, type Database, type SnapshotRecord, type VectorKey } from "@skillcdn/db";
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
  /**
   * Told of every snapshot a search by meaning asks for, so that one never embedded is queued
   * (ADR-0064, point 4). Never waited for.
   */
  readonly onSearched?: ((mount: Mount, snapshot: SnapshotRecord) => void) | undefined;
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
      // The commit's own index, or one served in its place while that is not ready (ADR-0068).
      const outcome = await snapshots.serving(mount, waitMs);
      if (outcome.status !== "ready") {
        return outcome;
      }
      const { snapshot, substitute } = outcome;
      const base = createIndexStore(
        database,
        { accountId: snapshot.accountId, snapshotId: snapshot.id },
        { vectors },
      );
      const search = base.searchByMeaning;
      const onSearched = meaning?.onSearched;
      // A search by meaning says which snapshot it searched, so that one never embedded is queued.
      const store =
        search === undefined || onSearched === undefined
          ? base
          : {
              ...base,
              searchByMeaning: (mountPath: RepoPath, vector: Float32Array, limit: number) => {
                onSearched(mount, snapshot);
                return search.call(base, mountPath, vector, limit);
              },
            };
      return {
        status: "ready",
        ...(substitute === undefined ? {} : { substitute }),
        index: {
          // A rebuilt index keeps its snapshot id, so everything cached keys on both.
          id: snapshot.id,
          version: snapshot.indexVersion,
          truncated: snapshot.truncated,
          license: snapshot.license ?? NO_LICENSE,
          store,
          blobs: blobStore,
        },
      };
    },
    // A body the index names but the store does not hold yet is fetched from the host and kept,
    // when it is text: the bytes of a picture or an original are not stored (ADR-0077); the
    // reader remembers that they are not text, and a result sends the reader to the source.
    fetchBody: async (mount, hash, maxBytes) => {
      const bytes = await gitHost.readBlob(mount.coordinates, hash, maxBytes);
      if (decodeText(bytes) !== undefined) {
        await blobStore.write(hash, bytes);
      }
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
