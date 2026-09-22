import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type GitHost,
  GitHostError,
  type HostRepository,
  parseRepoPath,
  type TreeEntry,
} from "@skillcdn/core";

// Test support: a git host whose repositories are the directories under skills/.

const FIXTURES_ROOT = fileURLToPath(new URL("../../../../skills", import.meta.url));

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

/** What the host would show as the description of a fixture repository. */
const FIXTURE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "multi-skill": "Two skills and the documents next to them.",
  "single-skill": "One skill at the root of the repository.",
};

/**
 * The commits behind the two refs every fixture repository has. Tests share one database, and a
 * commit is indexed once: a host that adds files of its own takes a `variant`, which gives it
 * commits nobody else has indexed.
 */
export function fixtureCommits(variant = ""): { readonly main: string; readonly release: string } {
  return { main: sha1(`main ${variant}`), release: sha1(`release/1.2 ${variant}`) };
}

interface FixtureFile {
  readonly entry: TreeEntry;
  readonly bytes: Uint8Array;
}

function gitBlobHash(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function readFixture(name: string): FixtureFile[] {
  const files: FixtureFile[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const child of readdirSync(directory).sort()) {
      const absolute = join(directory, child);
      const relative = prefix.length === 0 ? child : `${prefix}/${child}`;
      if (statSync(absolute).isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      const path = parseRepoPath(relative);
      if (path.ok) {
        const bytes = new Uint8Array(readFileSync(absolute));
        files.push({
          entry: {
            path: path.value,
            type: "file",
            size: bytes.byteLength,
            hash: gitBlobHash(bytes),
          },
          bytes,
        });
      }
    }
  };
  walk(join(FIXTURES_ROOT, name), "");
  return files;
}

export interface FixtureHost extends GitHost {
  /** Calls per port method, to assert how often the host was asked. */
  readonly calls: Record<
    "getRepository" | "resolveRef" | "getTree" | "readBlob" | "readArchive",
    number
  >;
  /** Makes `getTree` wait until the returned function is called. */
  holdTrees(): () => void;
  /** Extra files that exist in every repository, for cases the committed fixtures do not cover. */
  addFile(path: string, bytes: Uint8Array): void;
}

/**
 * `acme/<directory under skills/>` is a public repository; `acme/private-repo` exists but is
 * private; everything else is missing. Every repository has the refs `main` (the default branch)
 * and `release/1.2`; see {@link fixtureCommits}.
 */
export function createFixtureHost(
  variant = "",
  options: {
    /** Offer the optional archive transport. */
    readonly archive?: boolean;
    /** Paths whose archived copy differs from the blob, as line-ending conversion would cause. */
    readonly archiveAlters?: (path: string) => boolean;
  } = {},
): FixtureHost {
  const calls = { getRepository: 0, resolveRef: 0, getTree: 0, readBlob: 0, readArchive: 0 };
  const extra: FixtureFile[] = [];
  let gate: Promise<void> = Promise.resolve();
  const known = new Set(readdirSync(FIXTURES_ROOT).filter((name) => !name.includes(".")));
  const commits = fixtureCommits(variant);

  const filesOf = (repo: string): FixtureFile[] => {
    if (!known.has(repo)) {
      throw new GitHostError("not_found", "not found on the git host");
    }
    return [...readFixture(repo), ...extra];
  };

  return {
    calls,
    holdTrees() {
      let release: () => void = () => {};
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    addFile(path, bytes) {
      const parsed = parseRepoPath(path);
      if (!parsed.ok) {
        throw new Error(`invalid fixture path ${path}`);
      }
      extra.push({
        entry: {
          path: parsed.value,
          type: "file",
          size: bytes.byteLength,
          hash: gitBlobHash(bytes),
        },
        bytes,
      });
    },

    async getRepository(coordinates): Promise<HostRepository> {
      calls.getRepository += 1;
      const isPrivate = coordinates.repo === "private-repo";
      if (coordinates.owner !== "acme" || (!known.has(coordinates.repo) && !isPrivate)) {
        throw new GitHostError("not_found", "not found on the git host");
      }
      return {
        // A host id belongs to one repository for good, so it is derived from the name.
        hostRepoId: String(Number.parseInt(sha1(coordinates.repo).slice(0, 8), 16)),
        owner: { hostAccountId: "42", login: "Acme", kind: "organization" },
        name: coordinates.repo,
        defaultBranch: "main",
        description: FIXTURE_DESCRIPTIONS[coordinates.repo],
        visibility: isPrivate ? "private" : "public",
      };
    },

    async resolveRef(_coordinates, ref): Promise<string> {
      calls.resolveRef += 1;
      if (ref === undefined) {
        return commits.main;
      }
      const byName: Record<string, string> = { main: commits.main, "release/1.2": commits.release };
      const commit =
        ref.kind === "commit"
          ? Object.values(byName).find((candidate) => candidate === ref.hash)
          : byName[ref.name];
      if (commit === undefined) {
        throw new GitHostError("not_found", "not found on the git host");
      }
      return commit;
    },

    async getTree(coordinates) {
      calls.getTree += 1;
      await gate;
      return { entries: filesOf(coordinates.repo).map((file) => file.entry), truncated: false };
    },

    async readBlob(coordinates, hash, maxBytes): Promise<Uint8Array> {
      calls.readBlob += 1;
      const file = filesOf(coordinates.repo).find((candidate) => candidate.entry.hash === hash);
      if (file === undefined) {
        throw new GitHostError("not_found", "not found on the git host");
      }
      if (file.bytes.byteLength > maxBytes) {
        throw new GitHostError("invalid", "the git host sent more data than allowed");
      }
      return file.bytes;
    },

    ...(options.archive === true
      ? {
          async *readArchive(coordinates, _commit, request) {
            calls.readArchive += 1;
            for (const file of filesOf(coordinates.repo)) {
              if (request.wants(file.entry.path, file.entry.size)) {
                const altered = options.archiveAlters?.(file.entry.path) === true;
                yield {
                  path: file.entry.path,
                  bytes: altered ? new TextEncoder().encode("converted line endings") : file.bytes,
                };
              }
            }
          },
        }
      : {}),
  };
}
