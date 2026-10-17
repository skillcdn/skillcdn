import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Address,
  browseBody,
  describeLicense,
  directoryBody,
  fileBody,
  findBody,
  type IndexLimits,
  LOCAL_HOST_KEY,
  parseAddress,
  REST_MOUNT_LIST_LIMIT,
  type ReadableIndex,
  type RepoPath,
  ROOT_PATH,
  skillOutcome,
} from "@skillcdn/core";
import { readDirectory, WORKING_TREE_COMMIT } from "@skillcdn/indexer";
import { createMemoryIndex, Reader } from "@skillcdn/reader";
import { localMountBody, type ServedMount } from "@skillcdn/serve";
import { type Pack, PackError } from "./pack.js";

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
}

export interface MountedDirectory {
  readonly mount: LocalMount;
  /** Reads the directory again and serves what it holds now; throws, and keeps the last index, when it cannot be read. */
  reload(): Promise<void>;
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
  const read = async (): Promise<ReadableIndex> => {
    const result = await readDirectory({
      directory: root,
      limits: options.limits,
      repository: { owner: address.owner, name: address.repo },
    });
    return createMemoryIndex({ index: result.index, blobs: result.blobs });
  };
  let index = await read();
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
    index: () => index,
  };
  return {
    mount,
    async reload() {
      index = await read();
    },
  };
}

/** The reader of mounted directories: every index is ready, since it is in memory. */
export const localReader = (limits: IndexLimits): Reader<LocalMount> =>
  new Reader<LocalMount>({
    limits,
    index: async (mount) => ({ status: "ready", index: mount.index() }),
  });

const WATCH_DELAY_MS = 250;

/** The directories the indexer does not read, so a change in them is not a change to the pack. */
const unread = (filename: string | Buffer | null): boolean => {
  if (typeof filename !== "string") {
    return false;
  }
  const first = filename.split(/[\\/]/, 1)[0];
  return first === ".git" || first === "node_modules";
};

/**
 * Calls `changed` once per burst of changes to the files under the root, never twice at once:
 * a change during a call is one more call after it. Where the files cannot be watched, `failed`
 * is told and nothing is called. The watcher does not keep the process alive.
 */
export function watchDirectory(
  root: string,
  changed: () => Promise<void>,
  options: { readonly failed: (error: unknown) => void; readonly delayMs?: number | undefined },
): { close(): void } {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let again = false;
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
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (unread(filename)) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(run, options.delayMs ?? WATCH_DELAY_MS);
    });
  } catch (error) {
    options.failed(error);
    return { close() {} };
  }
  watcher.on("error", options.failed);
  watcher.unref();
  return {
    close() {
      clearTimeout(timer);
      watcher.close();
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
}): Promise<Pack | MountFailure> {
  const mounted = await mountDirectory(options);
  if ("error" in mounted) {
    return mounted;
  }
  const { mount } = mounted;
  const reader = localReader(options.limits);
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
            `The file is not UTF-8 text, which is all this command carries. Read it at its source: ${lookup.sourceUrl}`,
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
