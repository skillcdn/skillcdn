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
  mountBody,
  parseAddress,
  REST_MOUNT_LIST_LIMIT,
  type RepoPath,
  ROOT_PATH,
  skillOutcome,
} from "@skillcdn/core";
import { readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, type MountContext, Reader } from "@skillcdn/reader";
import { type Pack, PackError } from "./pack.js";

// A directory on this machine as a pack (ADR-0053, ADR-0055): read as the indexer reads a
// commit, kept as an index in memory, read as a deployment reads its own, and answered in the
// REST API's shapes as a deployment answers them. The person chose the directory, so it is
// verified: its content is served in full under its license.

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

/**
 * Opens a directory as a pack: the index built in memory, and the reads over it. Answers the
 * error text and the exit code when the directory cannot be read or addressed.
 */
export async function openDirectory(options: {
  readonly directory: string;
  readonly as?: string | undefined;
  readonly limits: IndexLimits;
}): Promise<Pack | { readonly error: string; readonly exit: number }> {
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
    source: { kind: "directory", root },
    async mount() {
      return mountBody(
        {
          address: mount.address,
          repository: {
            host: address.host,
            owner: address.owner,
            name: address.repo,
            defaultBranch: "",
            description: null,
            avatar: "",
            visibility: "public",
          },
          commit: mount.commit,
          verified: mount.verified,
          image: () => null,
        },
        await reader.overview(mount, REST_MOUNT_LIST_LIMIT),
      );
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
