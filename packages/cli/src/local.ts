import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Address,
  browseBody,
  describeLicense,
  describeSource,
  directoryBody,
  type Embedder,
  fileBody,
  findBody,
  GitHostError,
  type IndexLimits,
  LOCAL_HOST_KEY,
  parseAddress,
  REST_MOUNT_LIST_LIMIT,
  type ReadableIndex,
  type RepoPath,
  type Reranker,
  ROOT_PATH,
  skillOutcome,
} from "@skillcdn/core";
import { readDirectory, WORKING_TREE_COMMIT } from "@skillcdn/indexer";
import { createMemoryIndex, Reader, type ReaderMeaning } from "@skillcdn/reader";
import { localMountBody, type ServedMount } from "@skillcdn/serve";
import { type Pack, PackError } from "./pack.js";
import {
  createVectorSet,
  type EmbeddingOutcome,
  type VectorCache,
  type VectorSet,
} from "./vectors.js";

// A directory on this machine as a pack (ADR-0053, ADR-0055, ADR-0057): read as the indexer
// reads a commit, kept as an index in memory, read as a deployment reads its own, and answered
// or served as a deployment answers and serves. The person chose the directory, so it is
// verified: its content is served in full under its license. A working tree changes without a
// commit, so the index is read again when the files change, and nothing read from it is to be
// kept by a client.

/** A mount of a directory: what the edges need, where the files are, and the index of them now. */
export interface LocalMount extends ServedMount {
  readonly root: string;
  /** The index of the directory as its files are now; a reload replaces it. */
  readonly index: () => ReadableIndex;
  /**
   * The bytes of a file of the directory by its hash in the index, read from disk when the
   * tree did not read them (ADR-0077): what the reader asks for a body the index does not hold.
   */
  readonly readBlob: (hash: string, maxBytes: number) => Promise<Uint8Array>;
}

/**
 * The search by meaning over a directory (ADR-0064): the servers the person runs, as the reader
 * takes them, and where the vectors of the directory's sections are kept between runs.
 */
export interface LocalMeaning {
  readonly embedder: Embedder;
  readonly reranker?: Reranker | undefined;
  readonly rerankCandidates?: number | undefined;
  readonly cache: VectorCache;
  /** Where a line about the embedding goes: standard error. */
  readonly report: (line: string) => void;
}

export interface MountedDirectory {
  readonly mount: LocalMount;
  /** Reads the directory again and serves what it holds now; throws, and keeps the last index, when it cannot be read. */
  reload(): Promise<void>;
  /**
   * Embeds what the index names now that is not embedded yet, where the search by meaning is
   * configured, and resolves when that is done; the first call begins it, and every reload after
   * that continues with the files that changed. `undefined` without the configuration. A server
   * that fails is reported, never thrown: the words answer alone for what is not embedded.
   */
  embedding(): Promise<EmbeddingOutcome> | undefined;
  /** Ends the embedding after the calls in flight, for a command that is ending. */
  close(): void;
}

export interface MountFailure {
  readonly error: string;
  /** The exit code the failure means: 2 for a directory that cannot be read, 64 for one that cannot be addressed. */
  readonly exit: number;
}

/** What `--as` names a directory, else its parent's name and its own: `local/<owner>/<name>`. */
export function localAddress(
  root: string,
  as: string | undefined,
): { readonly address: Address } | { readonly error: string } {
  if (as !== undefined) {
    const written = as.startsWith("/") ? as : `/${as}`;
    const parsed = parseAddress(written);
    if (!parsed.ok) {
      return { error: `--as: ${parsed.error.message}` };
    }
    if (parsed.value.host !== LOCAL_HOST_KEY || parsed.value.ref !== undefined) {
      return {
        error: `--as: a directory is addressed as ${LOCAL_HOST_KEY}/<owner>/<name>, without a ref`,
      };
    }
    return { address: parsed.value };
  }
  const name = basename(root);
  const owner = basename(dirname(root));
  const parsed = parseAddress(
    `/${LOCAL_HOST_KEY}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  );
  return parsed.ok
    ? { address: parsed.value }
    : {
        error: `The directory's names do not make an address (${parsed.error.message}): say one with --as ${LOCAL_HOST_KEY}/<owner>/<name>`,
      };
}

/** Mounts a directory: its index built in memory, at its address, ready to be read or served. */
export async function mountDirectory(options: {
  readonly directory: string;
  readonly as?: string | undefined;
  readonly limits: IndexLimits;
  /** The search by meaning over the directory; left out, the words answer alone. */
  readonly meaning?: LocalMeaning | undefined;
}): Promise<MountedDirectory | MountFailure> {
  const root = resolve(options.directory);
  const info = await stat(root).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    return { error: `${options.directory}: not a directory that can be read`, exit: 2 };
  }
  const addressed = localAddress(root, options.as);
  if ("error" in addressed) {
    return { error: addressed.error, exit: 64 };
  }
  const { address } = addressed;
  const vectors: VectorSet | undefined =
    options.meaning === undefined ? undefined : createVectorSet(options.meaning);
  /** What was read last: the index, and the embedding of its bodies once that is asked for. */
  interface Reading {
    readonly index: ReadableIndex;
    readonly readBlob: (hash: string, maxBytes: number) => Promise<Uint8Array>;
    readonly embed: () => Promise<EmbeddingOutcome> | undefined;
    embedding: Promise<EmbeddingOutcome> | undefined;
  }
  const read = async (): Promise<Reading> => {
    const result = await readDirectory({
      directory: root,
      limits: options.limits,
      repository: { owner: address.owner, name: address.repo },
    });
    return {
      index: createMemoryIndex({ index: result.index, blobs: result.blobs, vectors }),
      readBlob: result.readBlob,
      embed: () => vectors?.update(result.index, result.blobs),
      embedding: undefined,
    };
  };
  let reading = await read();
  // Asked for once, the embedding goes on through every reload: a served directory keeps up
  // with its files, while a read that needs no vectors never calls the server.
  let asked = false;
  const embedding = (): Promise<EmbeddingOutcome> | undefined => {
    if (vectors === undefined) {
      return undefined;
    }
    asked = true;
    reading.embedding ??= reading.embed();
    return reading.embedding;
  };
  const fileUrl = (path: RepoPath): string =>
    pathToFileURL(path.length === 0 ? root : join(root, ...path.split("/"))).href;
  const mount: LocalMount = {
    root,
    address: { ...address, path: ROOT_PATH },
    commit: WORKING_TREE_COMMIT,
    verified: true,
    limits: {},
    repository: `${address.owner}/${address.repo}`,
    description: undefined,
    sourceUrl: fileUrl,
    rawUrl: fileUrl,
    // A working tree may change at any moment, and is one machine's own: a client keeps nothing.
    trustedUntil: new Date(0),
    visibility: "private",
    index: () => reading.index,
    readBlob: (hash, maxBytes) => reading.readBlob(hash, maxBytes),
  };
  return {
    mount,
    async reload() {
      reading = await read();
      if (asked) {
        void embedding();
      }
    },
    embedding,
    close() {
      vectors?.stop();
    },
  };
}

/**
 * The reader of mounted directories: every index is ready, since it is in memory, and a body the
 * index does not hold, a file the tree listed without reading, is read from disk (ADR-0077).
 */
export const localReader = (limits: IndexLimits, meaning?: LocalMeaning): Reader<LocalMount> =>
  new Reader<LocalMount>({
    limits,
    index: async (mount) => ({ status: "ready", index: mount.index() }),
    fetchBody: async (mount, hash, maxBytes) => {
      try {
        return await mount.readBlob(hash, maxBytes);
      } catch (error) {
        // A file that is not there to read any more has no body: the reader says so.
        if (error instanceof GitHostError) return undefined;
        throw error;
      }
    },
    meaning: meaning === undefined ? undefined : readerMeaningOf(meaning),
  });

const readerMeaningOf = (meaning: LocalMeaning): ReaderMeaning => ({
  embedder: meaning.embedder,
  reranker: meaning.reranker,
  rerankCandidates: meaning.rerankCandidates,
});

const WATCH_DELAY_MS = 250;
/**
 * How often a watched directory is looked at besides: one deleted and made anew in the same
 * place is another directory, which the watcher of the first does not follow, so it is watched
 * again and read again when that is seen.
 */
const WATCH_LIVENESS_MS = 5_000;

/** The directories the indexer does not read, so a change in them is not a change to the pack. */
const unread = (filename: string | Buffer | null): boolean => {
  if (typeof filename !== "string") {
    return false;
  }
  const first = filename.split(/[\\/]/, 1)[0];
  return first === ".git" || first === "node_modules";
};

/** What tells a directory from another made in its place: where it is on disk and when it was made. */
async function identityOf(root: string): Promise<string | undefined> {
  try {
    const info = await stat(root);
    return info.isDirectory()
      ? `${info.dev}:${info.ino}:${Math.floor(info.birthtimeMs)}`
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Calls `changed` once per burst of changes to the files under the root, never twice at once:
 * a change during a call is one more call after it. Where the files cannot be watched, `failed`
 * is told, and the directory is tried again every few seconds; a directory deleted and made
 * anew in the same place is watched again and read again then. The watcher does not keep the
 * process alive.
 */
export function watchDirectory(
  root: string,
  changed: () => Promise<void>,
  options: {
    readonly failed: (error: unknown) => void;
    readonly delayMs?: number | undefined;
    readonly livenessMs?: number | undefined;
  },
): { close(): void } {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let closed = false;
  let watcher: FSWatcher | undefined;
  let identity: string | undefined;
  const run = (): void => {
    if (running !== undefined) {
      again = true;
      return;
    }
    running = changed()
      .catch(options.failed)
      .finally(() => {
        running = undefined;
        if (again) {
          again = false;
          run();
        }
      });
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(run, options.delayMs ?? WATCH_DELAY_MS);
  };
  const disarm = (): void => {
    watcher?.close();
    watcher = undefined;
  };
  const arm = (): boolean => {
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (unread(filename)) {
          return;
        }
        schedule();
      });
    } catch (error) {
      watcher = undefined;
      options.failed(error);
      return false;
    }
    // A watcher whose directory went away is done: the liveness check arms another when the
    // directory is back.
    watcher.on("error", (error) => {
      options.failed(error);
      disarm();
    });
    watcher.unref();
    return true;
  };
  const liveness = setInterval(() => {
    void identityOf(root).then((now) => {
      if (closed) {
        return;
      }
      if (now === undefined) {
        disarm();
        return;
      }
      if (now !== identity || watcher === undefined) {
        identity = now;
        disarm();
        if (arm()) {
          schedule();
        }
      }
    });
  }, options.livenessMs ?? WATCH_LIVENESS_MS);
  liveness.unref();
  void identityOf(root).then((now) => {
    identity ??= now;
  });
  arm();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(liveness);
      disarm();
    },
  };
}

/**
 * Opens a directory as a pack: the index built in memory, and the reads over it. Answers the
 * error text and the exit code when the directory cannot be read or addressed.
 */
export async function openDirectory(options: {
  readonly directory: string;
  readonly as?: string | undefined;
  readonly limits: IndexLimits;
  readonly meaning?: LocalMeaning | undefined;
}): Promise<Pack | MountFailure> {
  const mounted = await mountDirectory(options);
  if ("error" in mounted) {
    return mounted;
  }
  const { mount } = mounted;
  const reader = localReader(options.limits, options.meaning);
  const ready = <T extends { readonly status: string }>(
    answer: T,
  ): Extract<T, { status: "ready" }> => {
    if (answer.status !== "ready") {
      throw new Error("the index of a directory is always ready");
    }
    return answer as Extract<T, { status: "ready" }>;
  };
  return {
    address: mount.address,
    source: { kind: "directory", root: mount.root },
    async mount() {
      return localMountBody(mount, await reader.overview(mount, REST_MOUNT_LIST_LIMIT));
    },
    async browse(query) {
      return browseBody(ready(await reader.browse(mount, query, 0)));
    },
    async find(query) {
      // A search with words waits for the vectors, so that the first run finds by meaning too;
      // a listing needs none, and calls no server.
      if (query.query !== undefined && query.query.trim().length > 0) {
        await mounted.embedding();
      }
      return findBody(ready(await reader.find(mount, query, 0)));
    },
    async skill(path, cursor) {
      const outcome = skillOutcome(ready(await reader.skill(mount, path, 0, cursor, true)));
      if ("failure" in outcome) {
        const { status, code, message, directories } = outcome.failure;
        throw new PackError(status, code, message, { directories });
      }
      return outcome.body;
    },
    async file(query) {
      const lookup = await reader.file(mount, query);
      switch (lookup.kind) {
        case "not_ready":
          throw new Error("the index of a directory is always ready");
        case "found":
          return fileBody(lookup.file);
        case "directory":
          return directoryBody(lookup.directory);
        case "invalid_path":
          throw new PackError(400, "request.invalid", `Not a valid path: ${lookup.reason}.`);
        case "not_found":
          throw new PackError(
            404,
            "file.not_found",
            `No file at that path in this pack.${lookup.suggestions?.length ? ` Candidates: ${lookup.suggestions.join(", ")}.` : ""}`,
          );
        case "too_large":
          throw new PackError(
            413,
            "file.too_large",
            `The file is too large to read here (${lookup.size} bytes; the limit is ${lookup.limit}). Read it at its source: ${lookup.sourceUrl}`,
            { sourceUrl: lookup.sourceUrl },
          );
        case "not_text":
          throw new PackError(
            415,
            "file.not_text",
            lookup.lfs === undefined
              ? `The file is not UTF-8 text, which is all this command carries. Read it at its source: ${lookup.sourceUrl}`
              : `The file is not readable here. ${describeSource(mount, lookup.sourceUrl, lookup.lfs)}`,
            { sourceUrl: lookup.sourceUrl },
          );
        case "not_served":
          throw new PackError(
            403,
            "file.not_served",
            `The file is described, not served: its license (${describeLicense(lookup.license)}) allows SkillCDN to say that it exists, not to pass its content on. Read it at its source: ${lookup.sourceUrl}`,
            { sourceUrl: lookup.sourceUrl },
          );
      }
    },
  };
}
