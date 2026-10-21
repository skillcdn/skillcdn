import {
  type BlobStore,
  type Clock,
  type Embedder,
  embeddingTextOf,
  sectionsOf,
} from "@skillcdn/core";
import {
  blobsWithoutVectors,
  type Database,
  type EntryRecord,
  getSnapshot,
  recordSnapshotEmbedding,
  type SectionVector,
  type SnapshotScope,
  servedEntries,
  type VectorKey,
  writeSectionVectors,
} from "@skillcdn/db";
import { compareByteOrder } from "@skillcdn/reader";
import { vectorKeyOf } from "../adapters/meaning.js";
import type { Logger } from "../logger.js";
import type { EmbedJob } from "./queues.js";

// One slice of the embedding of a snapshot (ADR-0064): the sections of its bodies, in the order
// of its entries, embedded and written body by body, for as many sections as a slice takes, and
// the rest handed back to the queue as the next slice. The vectors already written are the
// checkpoint: a slice that runs again after an interruption skips the bodies that are done.

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
  readonly clock: Clock;
  readonly logger: Logger;
  /** In place of {@link SLICE_SECTIONS}; for tests. */
  readonly sliceSections?: number | undefined;
}

export type EmbedSliceOutcome =
  | {
      readonly status: "embedded";
      /** Bodies whose sections were written by this slice; a body already done is not counted. */
      readonly bodies: number;
      readonly sections: number;
      readonly tokens: number;
      /** The path the next slice continues after; `undefined` when the snapshot is done. */
      readonly next: string | undefined;
    }
  | {
      readonly status: "skipped";
      /**
       * `other_key`: the job is for another model than this worker embeds with. `not_ready`: the
       * snapshot is gone, or being built again. `another_commit`: the snapshot row is another
       * commit's now.
       */
      readonly reason: "other_key" | "not_ready" | "another_commit";
    };

/** What has sections to embed: a searchable Markdown document, or a skill's manifest, which is Markdown too. */
const embeddable = (entry: EntryRecord): boolean =>
  entry.searchable && (entry.kind === "markdown" || entry.kind === "skill");

const sameKey = (a: VectorKey, b: VectorKey): boolean =>
  a.model === b.model &&
  a.dimensions === b.dimensions &&
  a.sectioningVersion === b.sectioningVersion;

/**
 * The texts in calls of what the embedder takes at once: at most `maxTexts` texts and
 * `maxBatchChars` characters, each text counted as the embedder will cut it. One text alone is
 * always a call, however long: the embedder cuts it to what it embeds.
 */
export function batchesOf(
  texts: readonly string[],
  embedder: Pick<Embedder, "maxTexts" | "maxBatchChars" | "maxTextChars">,
): number[][] {
  const batches: number[][] = [];
  let batch: number[] = [];
  let chars = 0;
  texts.forEach((text, at) => {
    const length = Math.min(text.length, embedder.maxTextChars);
    if (
      batch.length > 0 &&
      (batch.length >= embedder.maxTexts || chars + length > embedder.maxBatchChars)
    ) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(at);
    chars += length;
  });
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

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
  for (const batch of batchesOf(texts, deps.embedder)) {
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

/**
 * Runs one slice of `job`: embeds the bodies of the snapshot's entries after `job.after`, in
 * path order, until a slice's worth of sections is written, and records the progress. A failure
 * of the embedder is thrown, for the queue to try the slice again; what was written stays.
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
  const snapshot = await getSnapshot(database, scope);
  if (snapshot === undefined || snapshot.status !== "ready") {
    return { status: "skipped", reason: "not_ready" };
  }
  if (snapshot.commitSha !== job.commitSha) {
    return { status: "skipped", reason: "another_commit" };
  }

  const entries = (await servedEntries(database, scope)).filter(
    (entry) =>
      embeddable(entry) && (job.after === undefined || compareByteOrder(entry.path, job.after) > 0),
  );
  const missing = await blobsWithoutVectors(
    database,
    key,
    entries.map((entry) => entry.blobSha),
  );
  const limit = deps.sliceSections ?? SLICE_SECTIONS;
  const seen = new Set<string>();
  let bodies = 0;
  let sections = 0;
  let tokens = 0;
  let next: string | undefined;
  for (const [index, entry] of entries.entries()) {
    if (missing.has(entry.blobSha) && !seen.has(entry.blobSha)) {
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
          bodies += 1;
        }
        sections += done.sections;
        tokens += done.tokens;
      }
    }
    if (sections >= limit && index < entries.length - 1) {
      next = entry.path;
      break;
    }
  }
  await recordSnapshotEmbedding(
    database,
    scope,
    key,
    { bodies, sections, tokens, completed: next === undefined },
    clock.now(),
  );
  return { status: "embedded", bodies, sections, tokens, next };
}
