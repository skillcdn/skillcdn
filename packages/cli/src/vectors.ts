import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BlobStore,
  type Embedder,
  embeddable,
  embeddingBatches,
  embeddingTextOf,
  meaningSearchOf,
  SECTIONING_VERSION,
  type SnapshotIndex,
  sectionsOf,
} from "@skillcdn/core";
import type { MemorySectionVector, MemoryVectors } from "@skillcdn/reader";

// The vectors of a directory's sections, for the search by meaning over a directory (ADR-0064,
// ADR-0066): made by the embeddings server the person runs, of the same text a deployment embeds,
// keyed as a deployment keys them, by the model, its dimensions and the version of the sectioning
// rules, and kept in the person's cache directory by the hash of the body. A body is embedded once
// on a machine: a directory of thousands of documents costs one pass, a run after an edit embeds
// the files that changed, and a served directory answers by meaning as its vectors arrive.

/** What the vectors of a body are keyed by: the same three things as a deployment's column. */
export interface VectorKey {
  readonly model: string;
  readonly dimensions: number;
  readonly sectioningVersion: number;
}

export function vectorKeyOf(embedder: Pick<Embedder, "model" | "dimensions">): VectorKey {
  return {
    model: embedder.model,
    dimensions: embedder.dimensions,
    sectioningVersion: SECTIONING_VERSION,
  };
}

/** The vectors of one body: its sections in order, each with its vector; none for a body without prose. */
export type CachedSections = readonly MemorySectionVector[];

export interface VectorCache {
  /** Where the vectors are kept, for what the command says of them; nowhere a person can look, when unset. */
  readonly location: string | undefined;
  /** What is kept for a body under a key, or nothing; nothing as well for a file that cannot be read as one. */
  read(key: VectorKey, blobSha: string): Promise<CachedSections | undefined>;
  write(key: VectorKey, blobSha: string, sections: CachedSections): Promise<void>;
}

/** The directory the command's cache lives in: under `XDG_CACHE_HOME`, or `~/.cache`. */
export function defaultCacheDir(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const base = env.XDG_CACHE_HOME;
  return join(base === undefined || base.length === 0 ? join(home, ".cache") : base, "skillcdn");
}

/** The one shape of a file; another is read as nothing and written over. */
const FILE_VERSION = 1;
/** A thousand sections of a thousand dimensions, and some: a file beyond it is not one of ours. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** A body's hash as the indexer names one; anything else never becomes a file name. */
const BLOB_SHA = /^[0-9a-f]{40,64}$/;

/**
 * The directory of a key: the model's name made safe for a file system, a digest of the name
 * against two that read the same once made safe, then the dimensions and the sectioning version.
 */
export function keyDirectoryOf(key: VectorKey): string {
  const safe = key.model.replaceAll(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48);
  const digest = createHash("sha256").update(key.model).digest("hex").slice(0, 8);
  return `${safe}-${digest}-${key.dimensions}-v${key.sectioningVersion}`;
}

/** A body's sections as one file: the sections, and their vectors one after another as 32-bit floats. */
export function serializeSections(key: VectorKey, sections: CachedSections): string {
  const all = new Float32Array(sections.length * key.dimensions);
  sections.forEach((section, at) => {
    all.set(section.vector.subarray(0, key.dimensions), at * key.dimensions);
  });
  return JSON.stringify({
    version: FILE_VERSION,
    dimensions: key.dimensions,
    sections: sections.map(({ heading, offset, length }) => ({
      heading: [...heading],
      offset,
      length,
    })),
    vectors: Buffer.from(all.buffer, all.byteOffset, all.byteLength).toString("base64"),
  });
}

/** What a file says, when it is one of ours for this key and its vectors add up; nothing otherwise. */
export function parseSections(json: unknown, key: VectorKey): CachedSections | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  const { version, dimensions, sections, vectors } = json as Record<string, unknown>;
  if (
    version !== FILE_VERSION ||
    dimensions !== key.dimensions ||
    !Array.isArray(sections) ||
    typeof vectors !== "string"
  ) {
    return undefined;
  }
  const bytes = Buffer.from(vectors, "base64");
  if (bytes.byteLength !== sections.length * key.dimensions * 4) {
    return undefined;
  }
  // Copied: a buffer decoded from text may not start where a 32-bit float can.
  const floats = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const read: MemorySectionVector[] = [];
  for (const [at, section] of (sections as readonly unknown[]).entries()) {
    if (typeof section !== "object" || section === null) {
      return undefined;
    }
    const { heading, offset, length } = section as Record<string, unknown>;
    if (
      !Array.isArray(heading) ||
      !heading.every((part): part is string => typeof part === "string") ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      return undefined;
    }
    read.push({
      heading,
      offset,
      length,
      section: at,
      vector: floats.subarray(at * key.dimensions, (at + 1) * key.dimensions),
    });
  }
  return read;
}

/** The cache in the person's cache directory: `vectors/<key>/<hash>.json`, one file per body. */
export function createFileVectorCache(directory: string, pid: number): VectorCache {
  const root = join(directory, "vectors");
  const pathOf = (key: VectorKey, blobSha: string): string =>
    join(root, keyDirectoryOf(key), `${blobSha}.json`);
  return {
    location: root,
    async read(key, blobSha) {
      if (!BLOB_SHA.test(blobSha)) {
        return undefined;
      }
      const path = pathOf(key, blobSha);
      let text: string;
      try {
        if ((await stat(path)).size > MAX_FILE_BYTES) {
          return undefined;
        }
        text = await readFile(path, "utf8");
      } catch {
        return undefined;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return undefined;
      }
      return parseSections(json, key);
    },
    async write(key, blobSha, sections) {
      if (!BLOB_SHA.test(blobSha)) {
        return;
      }
      const path = pathOf(key, blobSha);
      await mkdir(join(root, keyDirectoryOf(key)), { recursive: true });
      // Written beside the file and moved over it in one step: a command that stops half-way
      // leaves no half file, and two commands writing the same body both leave it whole.
      const draft = `${path}.${pid}.tmp`;
      await writeFile(draft, serializeSections(key, sections));
      await rename(draft, path);
    },
  };
}

/** A cache in memory, for a test, and for a run that keeps nothing. */
export function createMemoryVectorCache(): VectorCache {
  const kept = new Map<string, CachedSections>();
  const nameOf = (key: VectorKey, blobSha: string): string => `${keyDirectoryOf(key)}/${blobSha}`;
  return {
    location: undefined,
    async read(key, blobSha) {
      return kept.get(nameOf(key, blobSha));
    },
    async write(key, blobSha, sections) {
      kept.set(nameOf(key, blobSha), sections);
    },
  };
}

/** What one pass of embedding did. */
export interface EmbeddingOutcome {
  /** Bodies whose vectors the cache had. */
  readonly cached: number;
  /** Bodies embedded in this pass, and the sections they had. */
  readonly embedded: number;
  readonly sections: number;
  /** The failure that stopped the pass, when one did; what was embedded before it is kept. */
  readonly failed: Error | undefined;
}

export interface VectorSet extends MemoryVectors {
  readonly key: VectorKey;
  /**
   * Brings the vectors to what the index names: the bodies of its findable documents whose
   * manifest does not keep them to the words, from the cache where it has them, else embedded now
   * and kept, each answering searches as it arrives. Resolves when every body is done or the
   * server failed, which is reported and never thrown; a pass after a failure tries the rest again.
   */
  update(index: SnapshotIndex, blobs: Pick<BlobStore, "read">): Promise<EmbeddingOutcome>;
  /** Ends a pass after the calls in flight, for a command that is ending. */
  stop(): void;
}

/** Bodies embedded at once: as many calls as the adapter lets run at once unless told otherwise. */
const BODIES_IN_FLIGHT = 2;
/** A line of progress every this many bodies, for a directory that takes a while. */
const PROGRESS_EVERY = 100;

export function createVectorSet(options: {
  readonly embedder: Embedder;
  readonly cache: VectorCache;
  /** Where a line about the embedding goes: standard error, so that the report and the protocol stay what they are. */
  readonly report: (line: string) => void;
}): VectorSet {
  const { embedder, cache, report } = options;
  const key = vectorKeyOf(embedder);
  const vectors = new Map<string, CachedSections>();
  /** The bodies a pass is embedding right now, so that a pass begun during another leaves them to it. */
  const pending = new Set<string>();
  let stopped = false;
  /** The bodies the latest index names: what a finished pass keeps, whichever index it began from. */
  let latest: ReadonlySet<string> = new Set();

  /** The vectors of one body, or nothing when the set was stopped before the body was whole. */
  const embedBody = async (
    title: string | undefined,
    text: string,
  ): Promise<CachedSections | undefined> => {
    const sections = sectionsOf(text);
    const texts = sections.map((section) => embeddingTextOf(title, section, text));
    const made: MemorySectionVector[] = [];
    for (const batch of embeddingBatches(texts, embedder)) {
      if (stopped) {
        return undefined;
      }
      const embedded = await embedder.embed(
        batch.map((at) => texts[at] ?? ""),
        "document",
      );
      batch.forEach((at, position) => {
        const section = sections[at];
        const vector = embedded.vectors[position];
        if (section !== undefined && vector !== undefined) {
          made.push({ ...section, section: at, vector });
        }
      });
    }
    return made;
  };

  const plural = (count: number, word: string): string =>
    `${count} ${count === 1 ? word : `${word}s`}`;

  return {
    key,
    sectionsOf: (blobSha) => vectors.get(blobSha),
    stop() {
      stopped = true;
    },
    async update(index, blobs) {
      const allowed = meaningSearchOf(index.entries);
      const wanted = new Map<string, string | undefined>();
      for (const entry of index.entries) {
        if (
          entry.visible &&
          embeddable(entry) &&
          allowed(entry.path) &&
          !wanted.has(entry.blobSha)
        ) {
          wanted.set(entry.blobSha, entry.title ?? entry.name);
        }
      }
      latest = new Set(wanted.keys());
      let cached = 0;
      let embedded = 0;
      let sections = 0;
      let unkept: Error | undefined;
      let failed: Error | undefined;
      const missing: { readonly blobSha: string; readonly title: string | undefined }[] = [];
      try {
        for (const [blobSha, title] of wanted) {
          if (vectors.has(blobSha) || pending.has(blobSha)) {
            continue;
          }
          const kept = await cache.read(key, blobSha);
          if (kept === undefined) {
            missing.push({ blobSha, title });
          } else {
            vectors.set(blobSha, kept);
            cached += 1;
          }
        }
        if (missing.length > 0 && !stopped) {
          report(
            `Embedding ${plural(missing.length, "document")} with ${embedder.model}${cache.location === undefined ? "" : `; the vectors are kept in ${cache.location}`}.`,
          );
        }
        const queue = [...missing];
        const embedNext = async (): Promise<void> => {
          for (;;) {
            const next = queue.shift();
            if (next === undefined || stopped || failed !== undefined) {
              return;
            }
            if (pending.has(next.blobSha) || vectors.has(next.blobSha)) {
              continue;
            }
            pending.add(next.blobSha);
            try {
              const text = await blobs.read(next.blobSha);
              if (text === undefined) {
                continue;
              }
              const made = await embedBody(next.title, text);
              if (made === undefined) {
                return;
              }
              vectors.set(next.blobSha, made);
              embedded += 1;
              sections += made.length;
              await cache.write(key, next.blobSha, made).catch((error: unknown) => {
                unkept ??= error instanceof Error ? error : new Error(String(error));
              });
              if (embedded % PROGRESS_EVERY === 0) {
                report(`Embedded ${embedded} of ${missing.length} documents so far.`);
              }
            } catch (error) {
              failed ??= error instanceof Error ? error : new Error(String(error));
            } finally {
              pending.delete(next.blobSha);
            }
          }
        };
        await Promise.all(Array.from({ length: BODIES_IN_FLIGHT }, embedNext));
      } catch (error) {
        failed ??= error instanceof Error ? error : new Error(String(error));
      }
      // What the latest index no longer names is let go; a pass still going adds what it finishes.
      for (const blobSha of vectors.keys()) {
        if (!latest.has(blobSha)) {
          vectors.delete(blobSha);
        }
      }
      if (stopped) {
        return { cached, embedded, sections, failed };
      }
      if (unkept !== undefined) {
        report(`The vectors could not be kept for the next run: ${unkept.message}`);
      }
      if (failed !== undefined) {
        report(
          `The search by meaning is off for what is not embedded yet: ${failed.message} (${embedded} of ${plural(missing.length, "document")} embedded in this pass; the next read tries the rest again).`,
        );
      } else if (embedded > 0) {
        report(`Embedded ${plural(embedded, "document")} (${plural(sections, "section")}).`);
      }
      return { cached, embedded, sections, failed };
    },
  };
}
