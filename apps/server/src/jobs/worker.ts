import { randomUUID } from "node:crypto";
import { type Clock, discardUsage, type Embedder, type GitHost } from "@skillcdn/core";
import {
  createBlobStore,
  type Database,
  type JobQueue,
  type QueuedJob,
  supportsSectionVectors,
} from "@skillcdn/db";
import type * as z from "zod";
import { vectorKeyOf } from "../adapters/meaning.js";
import type { Config } from "../config/config.js";
import { SnapshotService } from "../indexer/snapshot-service.js";
import type { Logger } from "../logger.js";
import { MountService } from "../mounts/mount-service.js";
import { createOperatorEntitlements } from "../operator/entitlements.js";
import { OperatorLists } from "../operator/lists.js";
import { embedSnapshotSlice } from "./embed-snapshot.js";
import { indexRepositoryJob } from "./index-repository.js";
import {
  EMBED_QUEUE,
  embedJobSchema,
  ensureJobQueues,
  INDEX_QUEUE,
  indexJobSchema,
  SWEEP_QUEUE,
  SWEEP_SCHEDULE,
  SWEEP_SCHEDULE_KEY,
  sendEmbedJob,
  sendSweepJob,
  sweepJobSchema,
} from "./queues.js";
import { sweepEmbeddings } from "./sweep.js";

// What the worker role does with the queue (ADR-0064, point 3), wired to its ports so that a
// test runs it against a fixture git host and a fake embedder as the role runs it against the
// real ones: the designated indexing always, and where an embedder is configured and the
// database keeps vectors, the slices of embedding and the hourly sweep.

/** How much older than its TTL a cached fact may be when the git host cannot be asked. */
const STALE_GRACE_FACTOR = 10;

export type WorkerConfig = Pick<Config, "mounts" | "indexing"> & {
  /** Slices embedded at once by this process: the calls the embedder has in flight at once. */
  readonly embedConcurrency: number;
};

export interface WorkerPorts {
  readonly database: Database;
  readonly jobs: JobQueue;
  readonly gitHost: GitHost;
  /** Left out, the worker indexes on request and embeds nothing. */
  readonly embedder: Embedder | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How often the queues are looked at; for tests. */
  readonly pollSeconds?: number | undefined;
  /** How many sections one slice embeds; for tests. */
  readonly sliceSections?: number | undefined;
}

export interface Worker {
  /** How this worker resolves an address, as everyone sees the name. */
  readonly mounts: MountService;
  /** The indexing this worker does on request, for a test to wait on. */
  readonly snapshots: SnapshotService;
  /** Takes the queues up. Answers which. */
  start(): Promise<{ readonly queues: readonly string[] }>;
  /** Stops taking jobs, waits for the running ones up to `graceMs`, and hands unfinished indexing back. */
  close(graceMs: number): Promise<void>;
}

export function createWorker(config: WorkerConfig, ports: WorkerPorts): Worker {
  const { database, jobs, gitHost, embedder, clock, logger } = ports;
  const blobs = createBlobStore(database);
  const lists = new OperatorLists({ database, clock });
  const mounts = new MountService({
    database,
    gitHost,
    clock,
    entitlements: createOperatorEntitlements(lists),
    repoTtlMs: config.mounts.repoTtlMs,
    refTtlMs: config.mounts.refTtlMs,
    staleGraceMs: Math.max(config.mounts.repoTtlMs, config.mounts.refTtlMs) * STALE_GRACE_FACTOR,
    // Neither decides what is indexed; both are the pages' and the results' business.
    isVerified: async () => false,
    imageOf: async () => undefined,
  });
  const snapshots = new SnapshotService({
    database,
    gitHost,
    blobStore: blobs,
    clock,
    usage: discardUsage,
    logger,
    limits: config.indexing.limits,
    // A worker indexes what it is asked to, whatever the api processes are told to.
    concurrency: Math.max(1, config.indexing.concurrency),
    leaseMs: config.indexing.leaseMs,
    newLeaseOwner: randomUUID,
  });
  const key = embedder === undefined ? undefined : vectorKeyOf(embedder);
  const pollSeconds = ports.pollSeconds;

  /** A handler over the job's data as the schema reads it; data that is not a job of the queue fails it. */
  const handling =
    <T>(schema: z.ZodType<T>, run: (data: T, job: QueuedJob) => Promise<unknown>) =>
    async (job: QueuedJob): Promise<void> => {
      const parsed = schema.safeParse(job.data);
      if (!parsed.success) {
        logger.error({ job: job.id }, "a job carries data this build does not read");
        throw new Error("the job's data is not what the queue carries");
      }
      try {
        await run(parsed.data, job);
      } catch (error) {
        logger.warn({ err: error, job: job.id, attempt: job.attempt }, "a job failed");
        throw error;
      }
    };

  return {
    mounts,
    snapshots,
    async start() {
      await ensureJobQueues(jobs);
      const supported = embedder === undefined ? false : await supportsSectionVectors(database);
      if (embedder !== undefined && !supported) {
        logger.warn(
          { model: embedder.model },
          "the database has no vector extension, so the sections of indexed commits are not embedded",
        );
      }
      const embedding = embedder !== undefined && supported && key !== undefined;
      await jobs.work(
        INDEX_QUEUE,
        { concurrency: 1, pollSeconds },
        handling(indexJobSchema, (job) =>
          indexRepositoryJob(
            { mounts, snapshots, jobs, key: embedding ? key : undefined, clock, logger },
            job,
          ),
        ),
      );
      if (!embedding) {
        return { queues: [INDEX_QUEUE] };
      }
      await jobs.work(
        EMBED_QUEUE,
        { concurrency: config.embedConcurrency, pollSeconds },
        handling(embedJobSchema, async (job) => {
          const log = logger.child({
            snapshot: job.snapshotId,
            commit: job.commitSha,
            account: job.accountId,
          });
          const outcome = await embedSnapshotSlice(
            { database, blobs, embedder, clock, logger: log, sliceSections: ports.sliceSections },
            job,
          );
          if (outcome.status === "embedded" && outcome.next !== undefined) {
            // The rest of the snapshot takes its turn behind the slices of the others.
            await sendEmbedJob(jobs, { ...job, after: outcome.next });
          }
          log.info({ reason: job.reason, ...outcome }, "embedding slice done");
        }),
      );
      await jobs.work(
        SWEEP_QUEUE,
        { concurrency: 1, pollSeconds },
        handling(sweepJobSchema, () => sweepEmbeddings({ database, jobs, key, logger })),
      );
      await jobs.schedule(SWEEP_QUEUE, SWEEP_SCHEDULE, {}, SWEEP_SCHEDULE_KEY);
      // And once now: what a deployment that was down, or that changed its model, has to catch up on.
      await sendSweepJob(jobs);
      return { queues: [INDEX_QUEUE, EMBED_QUEUE, SWEEP_QUEUE] };
    },
    async close(graceMs) {
      await jobs.stop({ timeoutMs: graceMs });
      await snapshots.close();
    },
  };
}
