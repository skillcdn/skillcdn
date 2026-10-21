import type { JobQueue, QueueSettings } from "@skillcdn/db";
import * as z from "zod";

// The jobs of the deployment (ADR-0064, point 3): what the queues are named, what a job carries,
// in which order the queue takes them, and how each queue treats a failure. The `api` role sends;
// the `worker` role sends and runs them.

/** The sections of one snapshot, embedded under one key, a slice at a time. */
export const EMBED_QUEUE = "embed-sections";
/** A repository indexed because somebody asked for it, and then embedded first of all. */
export const INDEX_QUEUE = "index-repository";
/** The pass that queues what is served and not yet embedded under the configured key. */
export const SWEEP_QUEUE = "sweep-embeddings";
export const JOB_QUEUES = [EMBED_QUEUE, INDEX_QUEUE, SWEEP_QUEUE] as const;

/**
 * Why a snapshot is embedded, and the order the queue takes them in: what was asked for first,
 * what was just indexed next, the backfill of what was served before last. Among equals, the
 * oldest job first, and each job is one slice of one snapshot, so that the repositories of every
 * account take turns.
 */
export const EMBED_PRIORITY = { designated: 3, indexed: 2, backfill: 1 } as const;
export type EmbedReason = keyof typeof EMBED_PRIORITY;

/**
 * How each queue treats its jobs. A failed attempt is tried again after a delay that doubles
 * each time, so that an inference server that is away is asked again in minutes, not at once;
 * an attempt that runs past its time is counted as failed and tried again.
 */
export const QUEUE_SETTINGS: Readonly<Record<(typeof JOB_QUEUES)[number], QueueSettings>> = {
  [EMBED_QUEUE]: { retryLimit: 5, retryDelaySeconds: 30, expireInSeconds: 1800 },
  [INDEX_QUEUE]: { retryLimit: 5, retryDelaySeconds: 60, expireInSeconds: 1800 },
  [SWEEP_QUEUE]: { retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 600 },
};

/** Makes sure every queue exists with its settings: run by each process at start. */
export async function ensureJobQueues(
  jobs: JobQueue,
  settings: typeof QUEUE_SETTINGS = QUEUE_SETTINGS,
): Promise<void> {
  for (const name of JOB_QUEUES) {
    await jobs.ensureQueue(name, settings[name]);
  }
}

const vectorKeySchema = z.object({
  model: z.string().min(1).max(200),
  dimensions: z.number().int().min(1).max(4096),
  sectioningVersion: z.number().int().min(0),
});

/** A slice of the embedding of one snapshot: the job data of {@link EMBED_QUEUE}. */
export const embedJobSchema = z.object({
  accountId: z.uuid(),
  repoId: z.uuid(),
  snapshotId: z.uuid(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  /** The key the vectors are written under: the job is for the worker that embeds under it. */
  key: vectorKeySchema,
  reason: z.enum(["designated", "indexed", "backfill"]),
  /** The path the slice before ended at; the first slice has none. */
  after: z.string().min(1).max(4096).optional(),
});
export type EmbedJob = z.infer<typeof embedJobSchema>;

/** A repository to index now, by its address: the job data of {@link INDEX_QUEUE}. */
export const indexJobSchema = z.object({
  address: z.string().min(1).max(2048),
});
export type IndexJob = z.infer<typeof indexJobSchema>;

/** A sweep carries nothing; the schedule's row and a send at start both make one. */
export const sweepJobSchema = z.record(z.string(), z.unknown());

/** Hourly, at the top of the hour. */
export const SWEEP_SCHEDULE = "0 * * * *";
export const SWEEP_SCHEDULE_KEY = "hourly";

/**
 * What makes two embed jobs the same job: the snapshot, the key and where the slice starts. One
 * is queued at a time; another sent while it waits is not queued again.
 */
export function embedJobKey(job: EmbedJob): string {
  return [
    job.snapshotId,
    job.key.model,
    job.key.dimensions,
    job.key.sectioningVersion,
    job.after ?? "",
  ].join(":");
}

/** Queues a slice. False when the same slice was queued already. */
export async function sendEmbedJob(jobs: JobQueue, job: EmbedJob): Promise<boolean> {
  const id = await jobs.send(EMBED_QUEUE, job, {
    priority: EMBED_PRIORITY[job.reason],
    singletonKey: embedJobKey(job),
  });
  return id !== undefined;
}

/** Queues the indexing of an address, ahead of everything else. False when it was queued already. */
export async function sendIndexJob(jobs: JobQueue, job: IndexJob): Promise<boolean> {
  const id = await jobs.send(INDEX_QUEUE, job, {
    priority: EMBED_PRIORITY.designated,
    singletonKey: job.address,
  });
  return id !== undefined;
}

/** Queues a sweep. False when one is waiting already. */
export async function sendSweepJob(jobs: JobQueue): Promise<boolean> {
  const id = await jobs.send(SWEEP_QUEUE, {}, { singletonKey: SWEEP_SCHEDULE_KEY });
  return id !== undefined;
}
