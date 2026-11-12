import {
  type Database,
  deleteEmbeddingsOutsideKey,
  type EmbedTier,
  fillPartVectors,
  type JobQueue,
  listSnapshotsToEmbed,
  type SnapshotToEmbed,
  type VectorKey,
} from "@skillcdn/db";
import type { EmbeddingScope } from "../config/config.js";
import type { Logger } from "../logger.js";
import type { OperatorLists } from "../operator/lists.js";
import { EMBED_QUEUE, embedJobSchema, embedPriority, sendEmbedJob } from "./queues.js";

// The sweep (ADR-0064, ADR-0065, ADR-0072, ADR-0073): what is served and not yet embedded under
// the configured key is queued as the backfill, by the repository's rank, the operator's lists
// first, then the declared packs, then the repositories with skills, and never the rest, which a
// search or a request brings in; after a change of model that is every served pack. Before it
// queues anything, it puts what waits in the order of this build: a job that an older build
// queued, or that waits since its repository's rank changed, is given the priority the rank gives
// it now, in place. Once nothing is left to embed, what was embedded under other keys goes. And
// the vectors of the parts of what is embedded are made where they are missing (ADR-0092): a
// slice writes them with the sections, so this is for the sections written before there were
// any, and it calls no model.

/** How many snapshots one sweep queues: the rest wait for the next, an hour on. */
export const SWEEP_LIMIT = 1000;
/** How many of the jobs that wait one sweep looks through to put in order. */
export const WAITING_LIMIT = 5000;
/** How many bodies one statement makes part vectors for, and how many statements one sweep runs. */
export const PART_FILL_BODIES = 500;
export const PART_FILL_STEPS = 200;

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
  /** How many of them this sweep queued; the others had a slice waiting already. */
  readonly queued: number;
  /** How many waiting jobs it gave the priority their repository's rank gives them now. */
  readonly reordered: number;
  /** How many of the pending snapshots are of each rank. */
  readonly tiers: Readonly<Record<SweptTier, number>>;
  /** What went of other keys, when nothing was pending. */
  readonly dropped: { readonly vectors: number; readonly snapshots: number } | undefined;
  /** How many bodies this sweep made the part vectors of, from their section vectors. */
  readonly parts: number;
}

const sameKey = (a: VectorKey, b: VectorKey): boolean =>
  a.model === b.model &&
  a.dimensions === b.dimensions &&
  a.sectioningVersion === b.sectioningVersion;

/**
 * Gives every job that waits under the key the priority this build gives it, and answers the
 * snapshots that have one: a designation first of all, the rest by the rank their repository has
 * now, where the sweep knows it. A job of a snapshot the sweep does not rank, a repository that is
 * no pack among them, is left as it is: the worker asks the rank again before it embeds.
 */
async function reorderWaiting(
  deps: SweepDependencies,
  ranked: ReadonlyMap<string, SnapshotToEmbed>,
): Promise<{ readonly waiting: ReadonlySet<string>; readonly reordered: number }> {
  const waiting = new Set<string>();
  let reordered = 0;
  for (const queued of await deps.jobs.waiting(EMBED_QUEUE, WAITING_LIMIT)) {
    const parsed = embedJobSchema.safeParse(queued.data);
    if (!parsed.success || !sameKey(parsed.data.key, deps.key)) {
      continue;
    }
    const job = parsed.data;
    waiting.add(job.snapshotId);
    const tier = job.reason === "designated" ? job.tier : ranked.get(job.snapshotId)?.tier;
    if (job.reason !== "designated" && tier === undefined) {
      continue;
    }
    const priority = embedPriority(job.reason, tier);
    if (queued.priority === priority) {
      continue;
    }
    // What the job carries is kept as it was sent, whatever this build reads of it, and the rank
    // goes with the priority, so that the slices after it keep it.
    const data = {
      ...(queued.data as Record<string, unknown>),
      ...(tier === undefined ? {} : { tier }),
    };
    if (await deps.jobs.reorder(EMBED_QUEUE, queued.id, priority, data)) {
      reordered += 1;
    }
  }
  return { waiting, reordered };
}

/**
 * Makes the part vectors of the bodies that have section vectors under the key and none of
 * these, a batch a statement, and says for how many bodies. What one sweep does not reach, the
 * next goes on with.
 */
async function fillParts(deps: SweepDependencies): Promise<number> {
  let filled = 0;
  for (let step = 0; step < PART_FILL_STEPS; step += 1) {
    const made = await fillPartVectors(deps.database, deps.key, PART_FILL_BODIES);
    filled += made;
    if (made < PART_FILL_BODIES) {
      break;
    }
  }
  return filled;
}

export async function sweepEmbeddings(deps: SweepDependencies): Promise<SweepOutcome> {
  const { database, jobs, key } = deps;
  const tiers: Record<SweptTier, number> = { listed: 0, declared: 0, skills: 0 };
  // Whatever is embedded now, what was embedded before is searched, and by its parts.
  const parts = await fillParts(deps);
  if (deps.scope === "none") {
    if (parts > 0) {
      deps.logger.info({ model: key.model, parts }, "part vectors made");
    }
    return { pending: 0, queued: 0, reordered: 0, tiers, dropped: undefined, parts };
  }
  const pending = await listSnapshotsToEmbed(database, key, deps.limit ?? SWEEP_LIMIT, {
    visibility: deps.scope === "public" ? "public" : undefined,
    listed: await deps.lists.listedKeys(),
  });
  const { waiting, reordered } = await reorderWaiting(
    deps,
    new Map(pending.map((snapshot) => [snapshot.snapshotId, snapshot])),
  );
  let queued = 0;
  for (const snapshot of pending) {
    if (snapshot.tier !== "other") {
      tiers[snapshot.tier] += 1;
    }
    // A snapshot with a slice waiting goes on from there; a first slice beside it would only
    // race it through the same bodies.
    if (
      !waiting.has(snapshot.snapshotId) &&
      (await sendEmbedJob(jobs, { ...snapshot, key, reason: "backfill" }))
    ) {
      queued += 1;
    }
  }
  // A model replaced: its vectors are dropped only once everything is embedded under the new one,
  // so that a search never finds less than it did before the change.
  const dropped =
    pending.length === 0 ? await deleteEmbeddingsOutsideKey(database, key) : undefined;
  deps.logger.info(
    { model: key.model, pending: pending.length, queued, reordered, ...tiers, dropped, parts },
    "embeddings swept",
  );
  return { pending: pending.length, queued, reordered, tiers, dropped, parts };
}
