import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatAddress, parseAddress } from "@skillcdn/core";
import { originOf } from "./credentials.js";

// What a working directory says about the pack its work reads: `.skillcdn.json` in it or in a
// directory above it, as `.nvmrc` and its kind are found (ADR-0056). Written by `skillcdn use`
// and meant to be committed, so that everyone who works in the checkout, and every agent they
// run in it, reads the same pack without saying so. It names the pack's address and, where the
// pack is not at the default deployment, the deployment's origin. Never a token or anything
// secret: a key this file does not know is dropped on reading.

/** The file's name, in the working directory or one above it. */
export const DIRECTORY_FILE = ".skillcdn.json";

/** How large the file may be before it is not read: two names, never more. */
const MAX_FILE_CHARS = 16 * 1024;

export interface DirectorySettings {
  /** The canonical address of the pack the directory's work reads. */
  readonly pack: string;
  /** The origin of the deployment the pack is read at; the default deployment when left out. */
  readonly url?: string | undefined;
}

export interface DirectoryStore {
  /** The settings of the working directory, or of the nearest directory above it that has them. */
  load(): Promise<DirectorySettings | undefined>;
  /** Writes the settings into the working directory and answers where. */
  save(settings: DirectorySettings): Promise<string>;
}

/** What a file says, with nothing but the two settings kept; nothing for anything else. */
export function parseDirectorySettings(json: unknown): DirectorySettings | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  const { pack, url } = json as { readonly pack?: unknown; readonly url?: unknown };
  if (typeof pack !== "string") {
    return undefined;
  }
  const address = parseAddress(pack.startsWith("/") ? pack : `/${pack}`);
  if (!address.ok) {
    return undefined;
  }
  if (url !== undefined && (typeof url !== "string" || originOf(url) !== url)) {
    return undefined;
  }
  return { pack: formatAddress(address.value), ...(url === undefined ? {} : { url }) };
}

export function createDirectoryStore(cwd: string): DirectoryStore {
  return {
    async load() {
      let directory = cwd;
      for (;;) {
        const path = join(directory, DIRECTORY_FILE);
        let text: string | undefined;
        try {
          text = await readFile(path, "utf8");
        } catch {
          text = undefined;
        }
        if (text !== undefined) {
          if (text.length > MAX_FILE_CHARS) {
            return undefined;
          }
          try {
            return parseDirectorySettings(JSON.parse(text));
          } catch {
            return undefined;
          }
        }
        const parent = dirname(directory);
        if (parent === directory) {
          return undefined;
        }
        directory = parent;
      }
    },
    async save(settings) {
      const path = join(cwd, DIRECTORY_FILE);
      const file = {
        pack: settings.pack,
        ...(settings.url === undefined ? {} : { url: settings.url }),
      };
      await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
      return path;
    },
  };
}

/** A store in memory, for a test. */
export function createMemoryDirectoryStore(initial?: DirectorySettings): DirectoryStore {
  let kept = initial;
  return {
    async load() {
      return kept;
    },
    async save(settings) {
      kept = settings;
      return `(memory)/${DIRECTORY_FILE}`;
    },
  };
}
