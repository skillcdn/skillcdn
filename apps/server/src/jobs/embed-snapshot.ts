import {
  type BlobStore,
  type Clock,
  type Embedder,
  type EmbedLimits,
  embeddable,
  embeddingBatches,
  embeddingTextOf,
  meaningSearchOf,
  sectionsOf,
  type UsageSink,
} from "@skillcdn/core";
import {
  addEmbeddingUsage,
  blobsWithoutVectors,
  type Database,
  type EmbedTier,
  embeddedBytesOfRepository,
  getEmbeddingUsage,
  getRepo,
  getSnapshot,
  recordSnapshotEmbedding,
  type SectionVector,
  type SnapshotScope,
  servedEntries,
  tierOfSnapshot,
  usageDayOf,
  type VectorKey,
  writeSectionVectors,
} from "@skillcdn/db";
import { compareByteOrder } from "@skillcdn/reader";
import { vectorKeyOf } from "../adapters/meaning.js";
import type { Logger } from "../logger.js";
import type { OperatorLists } from "../operator/lists.js";
import type { EmbedJob } from "./queues.js";
import { decideEmbedding, type EmbedPolicy } from "./scope.js";

// One slice of the embedding of a snapshot (ADR-0064): the sections of its bodies, in the order
// of its entries, embedded and written body by body, for as many sections as a slice takes, and
// the rest handed back to the queue as the next slice. The vectors already written are the
// checkpoint: a slice that runs again after an interruption skips the bodies that are done. What
// may be embedded at all is the scope's and the entitlements' to say, a repository that is no
// pack is embedded only for a search or a request (ADR-0072), and a manifest may keep the
// documents it governs out; the bounds are measured in the bytes of the bodies.

/**
 * How many sections one job embeds before it hands the rest back: a minute or two on a CPU
 * server, so that a large pack takes turns with the others and a restart loses little. A body is
 * finished whole, so a slice may run over by one body.
 */
export const SLICE_SECTIONS = 256;

export interface EmbedSliceDependencies {
  readonly database: Database;
  readonly blobs: Pick<BlobStore, "read">;
  readonly embedder: Embedder;
  readonly policy: EmbedPolicy;
  /** The operator's lists, which rank a repository first. */
  readonly lists: Pick<OperatorLists, "listedKeys">;
  readonly usage: UsageSink;
  readonly clock: Clock;
  readonly logger: Logger;
  /** In place of {@link SLICE_SECTIONS}; for tests. */
  readonly sliceSections?: number | undefined;
}

/** What a slice wrote: bodies whose sections were written, their sections, bytes and tokens. */
export interface EmbeddedCounts {
  /** A body already done is not counted. */
  readonly bodies: number;
  readonly sections: number;
  readonly tokens: number;
  readonly bytes: number;
}

export type EmbedSliceOutcome =
  | (EmbeddedCounts & {
      readonly status: "embedded";
      /** The path the next slice continues after; `undefined` when the snapshot is done. */
      readonly next: string | undefined;
      /**
       * The rank the slice found the repository at, where it asked, for a backfill or an index:
       * the slice after it carries it, whatever the job was queued with (ADR-0073).
       */
      readonly tier?: EmbedTier | undefined;
    })
  | (EmbeddedCounts & {
      readonly status: "limited";
      /** Which bound stopped the slice: the repository's, or the account's for the day. */
      readonly bound: "repository" | "account";
    })
  | {
      readonly status: "skipped";
      /**
       * `other_key`: the job is for another model than this worker embeds with. `not_ready`: the
       * snapshot is gone, or being built again. `another_commit`: the snapshot row is another
       * commit's now. `out_of_scope`: the deployment does not embed repositories like this one.
       * `refused`: the entitlements said no. `unasked`: the repository is no pack, and the job
       * came from the backfill or an index, not from a search or a request.
       */
      readonly reason:
        | "other_key"
        | "not_ready"
        | "another_commit"
        | "out_of_scope"
        | "refused"
        | "unasked";
    };

const sameKey = (a: VectorKey, b: VectorKey): boolean =>
  a.model === b.model &&
  a.dimensions === b.dimensions &&
  a.sectioningVersion === b.sectioningVersion;

/** Embeds every section of one body and writes them together. */
async function embedBody(
  deps: EmbedSliceDependencies,
  key: VectorKey,
  blobSha: string,
  title: string | undefined,
  text: string,
): Promise<{ readonly sections: number; readonly tokens: number }> {
  const sections = sectionsOf(text);
  if (sections.length === 0) {
    return { sections: 0, tokens: 0 };
  }
  const texts = sections.map((section) => embeddingTextOf(title, section, text));
  const items: SectionVector[] = [];
  let tokens = 0;
  for (const batch of embeddingBatches(texts, deps.embedder)) {
    const embedded = await deps.embedder.embed(
      batch.map((at) => texts[at] ?? ""),
      "document",
    );
    batch.forEach((at, position) => {
      const section = sections[at];
      const vector = embedded.vectors[position];
      if (section !== undefined && vector !== undefined) {
        items.push({ ...section, blobSha, section: at, vector });
      }
    });
    tokens += embedded.tokens ?? 0;
  }
  await writeSectionVectors(deps.database, key, items);
  return { sections: items.length, tokens };
}

/** The bytes already embedded that a bound counts, read once per slice where the bound exists. */
async function embeddedSoFar(
  deps: EmbedSliceDependencies,
  job: EmbedJob,
  key: VectorKey,
  limits: Partial<EmbedLimits>,
  day: string,
): Promise<{ repository: number; account: number }> {
  const [repository, usage] = await Promise.all([
    limits.maxBytesPerRepository === undefined
      ? 0
      : embeddedBytesOfRepository(
          deps.database,
          { accountId: job.accountId, repoId: job.repoId },
          key,
        ),
    limits.maxBytesPerAccountPerDay === undefined
      ? undefined
      : getEmbeddingUsage(deps.database, job.accountId, day),
  ]);
  return { repository, account: usage?.bytes ?? 0 };
}

/**
 * Runs one slice of `job`: embeds the bodies of the snapshot's entries after `job.after`, in
 * path order, until a slice's worth of sections is written or a bound is reached, and records
 * the progress, the account's day and a usage event. A failure of the embedder is thrown, for
 * the queue to try the slice again; what was written stays.
 */
export async function embedSnapshotSlice(
  deps: EmbedSliceDependencies,
  job: EmbedJob,
): Promise<EmbedSliceOutcome> {
  const { database, embedder, clock, logger } = deps;
  const key = vectorKeyOf(embedder);
  if (!sameKey(job.key, key)) {
    return { status: "skipped", reason: "other_key" };
  }
  const scope: SnapshotScope = { accountId: job.accountId, snapshotId: job.snapshotId };
  const [snapshot, repo] = await Promise.all([
    getSnapshot(database, scope),
    getRepo(database, { accountId: job.accountId, repoId: job.repoId }),
  ]);
  if (snapshot === undefined || snapshot.status !== "ready" || repo === undefined) {
    return { status: "skipped", reason: "not_ready" };
  }
  if (snapshot.commitSha !== job.commitSha) {
    return { status: "skipped", reason: "another_commit" };
  }
  const decision = await decideEmbedding(deps.policy, repo.host, repo.repository);
  if (!decision.allowed) {
    return { status: "skipped", reason: decision.reason === "scope" ? "out_of_scope" : "refused" };
  }
  // The rank is asked again as the scope is (ADR-0072): a repository that is no pack is embedded
  // for a search or a request, never for the backfill or an index, whatever queued the job.
  const tier =
    job.reason === "backfill" || job.reason === "indexed"
      ? await tierOfSnapshot(database, scope, await deps.lists.listedKeys())
      : undefined;
  if (tier === "other") {
    return { status: "skipped", reason: "unasked" };
  }

  const served = await servedEntries(database, scope);
  const allowed = meaningSearchOf(served);
  const entries = served.filter(
    (entry) =>
      embeddable(entry) &&
      allowed(entry.path) &&
      (job.after === undefined || compareByteOrder(entry.path, job.after) > 0),
  );
  const missing = await blobsWithoutVectors(
    database,
    key,
    entries.map((entry) => entry.blobSha),
  );
  // The first slice says at once that the snapshot is being embedded, before a body is written:
  // a slice of hundreds of sections takes minutes on a CPU, and until it ended the page and the
  // instructions showed no embedding at all. The counts stay at zero until the slice adds its own.
  if (job.after === undefined && missing.size > 0) {
    await recordSnapshotEmbedding(
      database,
      scope,
      key,
      { bodies: 0, sections: 0, tokens: 0, bytes: 0, completed: false },
      clock.now(),
    );
  }
  const day = usageDayOf(clock.now());
  const soFar = await embeddedSoFar(deps, job, key, decision.limits, day);
  const limit = deps.sliceSections ?? SLICE_SECTIONS;
  const seen = new Set<string>();
  const counts = { bodies: 0, sections: 0, tokens: 0, bytes: 0 };
  let next: string | undefined;
  let bound: "repository" | "account" | undefined;
  for (const [index, entry] of entries.entries()) {
    if (missing.has(entry.blobSha) && !seen.has(entry.blobSha)) {
      const { maxBytesPerRepository, maxBytesPerAccountPerDay } = decision.limits;
      if (
        maxBytesPerRepository !== undefined &&
        soFar.repository + counts.bytes + entry.size > maxBytesPerRepository
      ) {
        bound = "repository";
        break;
      }
      if (
        maxBytesPerAccountPerDay !== undefined &&
        soFar.account + counts.bytes + entry.size > maxBytesPerAccountPerDay
      ) {
        bound = "account";
        break;
      }
      seen.add(entry.blobSha);
      const text = await deps.blobs.read(entry.blobSha);
      if (text === undefined) {
        logger.warn(
          { path: entry.path },
          "the body of an entry is not stored, so it is not embedded",
        );
      } else {
        const done = await embedBody(
          deps,
          key,
          entry.blobSha,
          entry.title ?? entry.name ?? undefined,
          text,
        );
        if (done.sections > 0) {
          counts.bodies += 1;
          counts.bytes += entry.size;
        }
        counts.sections += done.sections;
        counts.tokens += done.tokens;
      }
    }
    if (counts.sections >= limit && index < entries.length - 1) {
      next = entry.path;
      break;
    }
  }
  const now = clock.now();
  await recordSnapshotEmbedding(
    database,
    scope,
    key,
    { ...counts, completed: bound === undefined && next === undefined },
    now,
  );
  if (counts.sections > 0) {
    await addEmbeddingUsage(database, job.accountId, day, counts, now);
    deps.usage.record({
      type: "embedding",
      at: now,
      hostAccountId: repo.repository.owner.hostAccountId,
      hostRepoId: repo.repository.hostRepoId,
      subject: key.model,
      quantity: counts.tokens,
      unit: "token",
    });
  }
  if (bound !== undefined) {
    logger.info({ bound, ...counts }, "the embedding stopped at a bound");
    return { status: "limited", bound, ...counts };
  }
  return { status: "embedded", ...counts, next, ...(tier === undefined ? {} : { tier }) };
}
