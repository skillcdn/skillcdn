import {
  type Database,
  deleteEmbeddingsOutsideKey,
  type EmbedTier,
  type JobQueue,
  listSnapshotsToEmbed,
  type VectorKey,
} from "@skillcdn/db";
import type { EmbeddingScope } from "../config/config.js";
import type { Logger } from "../logger.js";
import type { OperatorLists } from "../operator/lists.js";
import { sendEmbedJob } from "./queues.js";

// The sweep (ADR-0064, ADR-0065, ADR-0072): what is served and not yet embedded under the
// configured key is queued as the backfill, by the repository's rank, the operator's lists first,
// then the declared packs, then the repositories with skills, and never the rest, which a search
// or a request brings in; after a change of model that is every served pack. Once nothing is left
// to embed, what was embedded under other keys goes.

/** How many snapshots one sweep queues: the rest wait for the next, an hour on. */
export const SWEEP_LIMIT = 1000;

/** The ranks the sweep queues: every one but the rest. */
type SweptTier = Exclude<EmbedTier, "other">;

export interface SweepDependencies {
  readonly database: Database;
  readonly jobs: JobQueue;
  readonly key: VectorKey;
  /** Which repositories are embedded: under `public`, the snapshots of private ones are not looked at. */
  readonly scope: EmbeddingScope;
  /** The operator's lists: what they name is embedded first. */
  readonly lists: Pick<OperatorLists, "listedKeys">;
  readonly logger: Logger;
  readonly limit?: number | undefined;
}

export interface SweepOutcome {
  /** Served snapshots of the ranked repositories without a complete embedding under the key. */
  readonly pending: number;
  /** How many of them this sweep queued; the others were queued already. */
  readonly queued: number;
  /** How many of the pending snapshots are of each rank. */
  readonly tiers: Readonly<Record<SweptTier, number>>;
  /** What went of other keys, when nothing was pending. */
  readonly dropped: { readonly vectors: number; readonly snapshots: number } | undefined;
}

export async function sweepEmbeddings(deps: SweepDependencies): Promise<SweepOutcome> {
  const { database, jobs, key } = deps;
  const tiers: Record<SweptTier, number> = { listed: 0, declared: 0, skills: 0 };
  if (deps.scope === "none") {
    return { pending: 0, queued: 0, tiers, dropped: undefined };
  }
  const pending = await listSnapshotsToEmbed(database, key, deps.limit ?? SWEEP_LIMIT, {
    visibility: deps.scope === "public" ? "public" : undefined,
    listed: await deps.lists.listedKeys(),
  });
  let queued = 0;
  for (const snapshot of pending) {
    if (snapshot.tier !== "other") {
      tiers[snapshot.tier] += 1;
    }
    if (await sendEmbedJob(jobs, { ...snapshot, key, reason: "backfill" })) {
      queued += 1;
    }
  }
  // A model replaced: its vectors are dropped only once everything is embedded under the new one,
  // so that a search never finds less than it did before the change.
  const dropped =
    pending.length === 0 ? await deleteEmbeddingsOutsideKey(database, key) : undefined;
  deps.logger.info(
    { model: key.model, pending: pending.length, queued, ...tiers, dropped },
    "embeddings swept",
  );
  return { pending: pending.length, queued, tiers, dropped };
}
