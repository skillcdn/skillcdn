import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Address,
  type IndexLimits,
  LOCAL_HOST_KEY,
  parseAddress,
  type RepoPath,
  ROOT_PATH,
} from "@skillcdn/core";
import { readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, type MountContext, Reader } from "@skillcdn/reader";

// A directory on this machine as a mount (ADR-0053): read as the indexer reads a commit, kept
// as an index in memory, and read as a deployment reads its own. The person chose the
// directory, so it is verified: its content is served in full under its license.

/** A mount of a directory: the context the reader needs, and where the files are. */
export interface LocalMount extends MountContext {
  readonly root: string;
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

export interface LocalPack {
  readonly mount: LocalMount;
  readonly reader: Reader<LocalMount>;
}

/**
 * Opens a directory as a pack: the index built in memory, and a reader over it. Rejects with
 * the error text when the directory cannot be read or addressed.
 */
export async function openDirectory(options: {
  readonly directory: string;
  readonly as?: string | undefined;
  readonly limits: IndexLimits;
}): Promise<LocalPack | { readonly error: string; readonly exit: number }> {
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
  const read = await readDirectory({
    directory: root,
    limits: options.limits,
    repository: { owner: address.owner, name: address.repo },
  });
  const index = createMemoryIndex({ index: read.index, blobs: read.blobs });
  const fileUrl = (path: RepoPath): string =>
    pathToFileURL(path.length === 0 ? root : join(root, ...path.split("/"))).href;
  const mount: LocalMount = {
    root,
    address: { ...address, path: ROOT_PATH },
    commit: read.commit,
    verified: true,
    limits: {},
    repository: `${address.owner}/${address.repo}`,
    description: undefined,
    sourceUrl: fileUrl,
    rawUrl: fileUrl,
  };
  const reader = new Reader<LocalMount>({
    limits: options.limits,
    index: async () => ({ status: "ready", index }),
  });
  return { mount, reader };
}
