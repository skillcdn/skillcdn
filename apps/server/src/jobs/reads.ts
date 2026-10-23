import {
  type BlobStore,
  type Clock,
  formatAddress,
  parseAddress,
  SECTIONING_VERSION,
} from "@skillcdn/core";
import {
  countSnapshotsToEmbed,
  type Database,
  type EmbeddedRepository,
  type EmbeddingUsageDay,
  type FailedJob,
  type JobQueue,
  listEmbeddedRepositories,
  listEmbeddingUsage,
  type QueueCounts,
  type SectionVector,
  type UsageDay,
  type VectorKey,
  writeSectionVectors,
} from "@skillcdn/db";
import * as z from "zod";
import type { EmbeddingScope } from "../config/config.js";
import { JOB_QUEUES, sendIndexJob } from "./queues.js";

// What the operator reads and does about the search by meaning through the admin API (ADR-0064,
// point 5): how the queues stand and what failed, where the embedding went and what it took per
// day, a repository indexed on request, and vectors computed elsewhere brought in against the
// stored bodies and the model in use.

/** How many failed jobs a read of the state lists per queue. */
const FAILURES_LISTED = 20;
/** The most repositories one read of where the embedding went answers. */
export const MAX_REPOSITORIES = 500;
export const DEFAULT_REPOSITORIES = 50;
/** The most vectors one import takes. */
export const MAX_IMPORTED_VECTORS = 2000;

export interface EmbeddingsConfigured {
  readonly model: string;
  readonly dimensions: number;
  readonly scope: EmbeddingScope;
  /** The reranking model, where one is configured. */
  readonly reranker: string | null;
}

export interface EmbeddingReadsDependencies {
  readonly database: Database;
  readonly blobs: Pick<BlobStore, "missing">;
  readonly clock: Clock;
  /** What the deployment embeds with; `undefined` where the search by meaning is not configured. */
  readonly configured: EmbeddingsConfigured | undefined;
  /** Whether the database keeps vectors: the `vector` extension was there when it was migrated. */
  readonly vectors: boolean;
  /** The queue, where this process opened it. */
  readonly jobs: JobQueue | undefined;
}

export interface QueueFailure extends Omit<FailedJob, "data"> {
  readonly queue: string;
  /** What the job carried, as it was sent. */
  readonly job: unknown;
}

export interface EmbeddingState {
  readonly configured: EmbeddingsConfigured | null;
  readonly vectors: boolean;
  /** Served snapshots within the scope without a complete embedding under the model; null without a model. */
  readonly pending: number | null;
  /** The queues as they stand; null where this process has no queue. */
  readonly queues: QueueCounts[] | null;
  /** The jobs that failed for good, newest first, over every queue; null where there is no queue. */
  readonly failures: QueueFailure[] | null;
}

const vectorKeySchema = z.object({
  model: z.string().min(1).max(200),
  dimensions: z.number().int().min(1).max(4096),
  sectioningVersion: z.number().int().min(0),
});

const importSchema = vectorKeySchema.extend({
  items: z
    .array(
      z.object({
        /** The git blob hash of the body the section is of, as the index names it. */
        blobSha: z.string().regex(/^[0-9a-f]{40}$/),
        section: z.number().int().min(0),
        heading: z.array(z.string().max(1000)).max(100),
        offset: z.number().int().min(0),
        length: z.number().int().min(0),
        vector: z.array(z.number().finite()),
      }),
    )
    .min(1)
    .max(MAX_IMPORTED_VECTORS),
});

export type VectorImport = z.infer<typeof importSchema>;

export type ImportOutcome =
  | { readonly status: "written"; readonly written: number; readonly skipped: number }
  /** The search by meaning is not configured, or the database keeps no vectors. */
  | { readonly status: "unavailable" }
  /** The body is not an import. */
  | { readonly status: "invalid"; readonly problems: readonly string[] }
  /** The vectors are of another model, other dimensions or other sectioning rules than the deployment's. */
  | { readonly status: "other_key"; readonly key: VectorKey }
  /** Some bodies are not stored here: a vector of a body nobody indexed has nothing to be reached through. */
  | { readonly status: "unknown_bodies"; readonly blobShas: readonly string[] };

export class EmbeddingReads {
  readonly #deps: EmbeddingReadsDependencies;

  constructor(dependencies: EmbeddingReadsDependencies) {
    this.#deps = dependencies;
  }

  /** The key the deployment embeds under, where it embeds. */
  get key(): VectorKey | undefined {
    const { configured } = this.#deps;
    return configured === undefined
      ? undefined
      : {
          model: configured.model,
          dimensions: configured.dimensions,
          sectioningVersion: SECTIONING_VERSION,
        };
  }

  async state(): Promise<EmbeddingState> {
    const { configured, jobs, vectors, database } = this.#deps;
    const key = this.key;
    const pending =
      key === undefined || configured === undefined || !vectors || configured.scope === "none"
        ? null
        : await countSnapshotsToEmbed(database, key, {
            visibility: configured.scope === "public" ? "public" : undefined,
          });
    let queues: QueueCounts[] | null = null;
    let failures: QueueFailure[] | null = null;
    if (jobs !== undefined) {
      queues = await jobs.counts(JOB_QUEUES);
      failures = [];
      for (const name of JOB_QUEUES) {
        for (const failed of await jobs.failures(name, FAILURES_LISTED)) {
          const { data, ...rest } = failed;
          failures.push({ queue: name, job: data, ...rest });
        }
      }
      failures.sort((a, b) => (b.failedAt?.getTime() ?? 0) - (a.failedAt?.getTime() ?? 0));
    }
    return { configured: configured ?? null, vectors, pending, queues, failures };
  }

  /** Where the embedding went, the most bytes first; nothing without a model. */
  async repositories(
    limit: number,
  ): Promise<(EmbeddedRepository & { readonly address: string })[]> {
    const key = this.key;
    if (key === undefined || !this.#deps.vectors) {
      return [];
    }
    const rows = await listEmbeddedRepositories(this.#deps.database, key, limit);
    return rows.map((row) => {
      const parsed = parseAddress(`/${row.host}/${row.owner}/${row.name}`);
      return {
        ...row,
        address: parsed.ok ? formatAddress(parsed.value) : `/${row.host}/${row.owner}/${row.name}`,
      };
    });
  }

  /** What was embedded per day over every account, both days included. */
  usage(from: UsageDay, to: UsageDay): Promise<EmbeddingUsageDay[]> {
    return listEmbeddingUsage(this.#deps.database, from, to);
  }

  /**
   * Queues the indexing of an address now, and its embedding ahead of everything else where the
   * deployment embeds. `queued` is false when the same address waits in the queue already;
   * `undefined` where this process has no queue. With the repository's row, from a caller that
   * checked who asked, the worker indexes that repository whatever the name is to everyone.
   */
  async designate(
    written: string,
    repository?: { readonly accountId: string; readonly repoId: string },
  ): Promise<{ readonly address: string; readonly queued: boolean } | "unavailable" | "invalid"> {
    const parsed = parseAddress(written.startsWith("/") ? written : `/${written}`);
    if (!parsed.ok || parsed.value.path.length > 0) {
      return "invalid";
    }
    const { jobs } = this.#deps;
    if (jobs === undefined) {
      return "unavailable";
    }
    const address = formatAddress(parsed.value);
    const queued = await sendIndexJob(jobs, { address, ...(repository ?? {}) });
    return { address, queued };
  }

  /**
   * Writes vectors computed elsewhere, checked against the model the deployment embeds with and
   * the bodies it holds: every body must be stored here, under the git blob hash the index names
   * it by, and every vector must be of the key's dimensions. What is there already stays.
   */
  async importVectors(body: unknown): Promise<ImportOutcome> {
    const key = this.key;
    if (key === undefined || !this.#deps.vectors) {
      return { status: "unavailable" };
    }
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: "invalid",
        problems: parsed.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    const given = parsed.data;
    if (
      given.model !== key.model ||
      given.dimensions !== key.dimensions ||
      given.sectioningVersion !== key.sectioningVersion
    ) {
      return { status: "other_key", key };
    }
    const wrong = given.items.filter((item) => item.vector.length !== key.dimensions);
    if (wrong.length > 0) {
      return {
        status: "invalid",
        problems: [`${wrong.length} vectors are not of ${key.dimensions} dimensions`],
      };
    }
    const missing = await this.#deps.blobs.missing(given.items.map((item) => item.blobSha));
    if (missing.size > 0) {
      return { status: "unknown_bodies", blobShas: [...missing].slice(0, 20) };
    }
    const items: SectionVector[] = given.items.map((item) => ({
      blobSha: item.blobSha,
      section: item.section,
      heading: item.heading,
      offset: item.offset,
      length: item.length,
      vector: Float32Array.from(item.vector),
    }));
    const written = await writeSectionVectors(this.#deps.database, key, items);
    return { status: "written", written, skipped: items.length - written };
  }
}
