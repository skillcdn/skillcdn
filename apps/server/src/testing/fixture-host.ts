import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type GitHost,
  type GitHostDirectory,
  GitHostError,
  type HostCredential,
  type HostRepository,
  parseRepoPath,
  type RepoCoordinates,
  type TreeEntry,
} from "@skillcdn/core";

// Test support: a git host whose repositories are the directories under fixtures/.repositories/.

const FIXTURES_ROOT = fileURLToPath(new URL("../../fixtures/.repositories", import.meta.url));

const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

/** What the host would show as the description of a fixture repository. */
const FIXTURE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "multi-skill": "Two skills and the documents next to them.",
  "single-skill": "One skill at the root of the repository.",
  "with-manifest": "What the host says, which the manifest replaces.",
  licensed: "Skills under different licenses.",
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

/** The host id a fixture repository has for good: derived from its name. */
export function fixtureRepoId(repo: string): string {
  return String(Number.parseInt(sha1(repo).slice(0, 8), 16));
}

/**
 * The repositories of `acme` that only the app's installation can read, by the fixture directory
 * each has the files of: what a private repository with the app installed looks like to us.
 */
export const INSTALLED_PRIVATE_REPOSITORIES: Readonly<Record<string, string>> = {
  "secret-skills": "multi-skill",
  "other-secrets": "single-skill",
};

export interface FixtureHost extends GitHost, GitHostDirectory {
  /** Calls per port method, to assert how often the host was asked. */
  readonly calls: Record<
    | "getRepository"
    | "resolveRef"
    | "getTree"
    | "readBlob"
    | "readArchive"
    | "getProfile"
    | "listPublicRepositories",
    number
  >;
  /** Every call that named a repository, with the credential it asked with, in order. */
  readonly asked: {
    readonly method: string;
    readonly repo: string;
    readonly credential: HostCredential;
  }[];
  /** Makes `getTree` wait until the returned function is called. */
  holdTrees(): () => void;
  /** Extra files that exist in every repository, for cases the committed fixtures do not cover. */
  addFile(path: string, bytes: Uint8Array): void;
  /**
   * Makes a public repository stop being one, as its owner making it private does: the host's
   * public list no longer names it, and the name is nothing to the deployment's credential.
   */
  hide(repo: string): void;
  /**
   * Moves `main`, and so the default branch, of every repository to a commit nobody has seen,
   * as a push does, and answers with that commit.
   */
  push(): string;
  /** Takes the app off a private repository: its installation reads it no longer. */
  uninstall(repo: string): void;
  /** Makes every later call of a method fail as an unreachable host does. */
  fail(method: "getRepository" | "resolveRef" | "getTree" | "readBlob" | "getProfile"): void;
}

/**
 * `acme/<fixture directory>` is a public repository; `acme/private-repo` exists but is
 * private, and visible even to the deployment's own credential; the repositories of
 * {@link INSTALLED_PRIVATE_REPOSITORIES} are private and exist only for the app's installation,
 * as on a real host; everything else is missing. Every repository has the refs `main` (the
 * default branch) and `release/1.2`; see {@link fixtureCommits}.
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
  const calls = {
    getRepository: 0,
    resolveRef: 0,
    getTree: 0,
    readBlob: 0,
    readArchive: 0,
    getProfile: 0,
    listPublicRepositories: 0,
  };
  const asked: FixtureHost["asked"] = [];
  const extra: FixtureFile[] = [];
  let gate: Promise<void> = Promise.resolve();
  const known = new Set(readdirSync(FIXTURES_ROOT).filter((name) => !name.includes(".")));
  const hidden = new Set<string>();
  const uninstalled = new Set<string>();
  const failing = new Set<string>();
  const commits: { main: string; release: string } = { ...fixtureCommits(variant) };
  let pushes = 0;
  /** What the host shows everyone: the fixture repositories nobody made private. */
  const listed = (): string[] => [...known].filter((name) => !hidden.has(name)).sort();

  /**
   * Notes the call, and refuses it when the repository is one the credential cannot see: a
   * private repository does not exist for the deployment's own credential.
   */
  const see = (method: string, coordinates: RepoCoordinates): void => {
    const credential = coordinates.credential ?? "deployment";
    asked.push({ method, repo: coordinates.repo, credential });
    if (failing.has(method)) {
      throw new GitHostError("transient", "the git host could not be reached");
    }
    if (
      (coordinates.repo in INSTALLED_PRIVATE_REPOSITORIES || hidden.has(coordinates.repo)) &&
      credential !== "installation"
    ) {
      throw new GitHostError("not_found", "not found on the git host");
    }
    if (credential === "installation" && uninstalled.has(coordinates.repo)) {
      throw new GitHostError("not_found", "not found on the git host");
    }
  };

  const filesOf = (repo: string): FixtureFile[] => {
    const directory = INSTALLED_PRIVATE_REPOSITORIES[repo] ?? repo;
    if (!known.has(directory)) {
      throw new GitHostError("not_found", "not found on the git host");
    }
    return [...readFixture(directory), ...extra];
  };

  return {
    calls,
    asked,

    async getProfile(_host, login) {
      calls.getProfile += 1;
      if (failing.has("getProfile")) {
        throw new GitHostError("transient", "the git host could not be reached");
      }
      if (login.toLowerCase() !== "acme") {
        throw new GitHostError("not_found", "not found on the git host");
      }
      return {
        hostAccountId: "42",
        login: "Acme",
        kind: "organization",
        name: "Acme Inc.",
        bio: "Skills for everything Acme makes.",
        publicRepositories: listed().length,
      };
    },

    async listPublicRepositories(_host, login, page) {
      calls.listPublicRepositories += 1;
      if (login.toLowerCase() !== "acme") {
        throw new GitHostError("not_found", "not found on the git host");
      }
      // Two to a page, so that paging is something a test can see.
      const names = listed();
      const start = (page - 1) * 2;
      return {
        repositories: names.slice(start, start + 2).map((name) => ({
          hostRepoId: fixtureRepoId(name),
          name,
          description: FIXTURE_DESCRIPTIONS[name],
          fork: false,
          archived: name === "hostile",
          stars: name.length,
          pushedAt: "2026-09-01T00:00:00.000Z",
        })),
        hasMore: start + 2 < names.length,
      };
    },
    hide(repo) {
      hidden.add(repo);
    },
    push() {
      pushes += 1;
      commits.main = sha1(`main ${variant} after push ${pushes}`);
      return commits.main;
    },
    uninstall(repo) {
      uninstalled.add(repo);
    },
    fail(method) {
      failing.add(method);
    },
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
      see("getRepository", coordinates);
      const installed = coordinates.repo in INSTALLED_PRIVATE_REPOSITORIES;
      const isPrivate = coordinates.repo === "private-repo" || installed;
      // The app is installed on some repositories and on no others: its credential names
      // nothing elsewhere, not even what is public.
      const reachable =
        coordinates.credential === "installation"
          ? installed
          : known.has(coordinates.repo) || isPrivate;
      if (coordinates.owner !== "acme" || !reachable) {
        throw new GitHostError("not_found", "not found on the git host");
      }
      return {
        // A host id belongs to one repository for good, so it is derived from the name.
        hostRepoId: fixtureRepoId(coordinates.repo),
        owner: { hostAccountId: "42", login: "Acme", kind: "organization" },
        name: coordinates.repo,
        defaultBranch: "main",
        description: installed
          ? "Skills only Acme's own people see."
          : FIXTURE_DESCRIPTIONS[coordinates.repo],
        visibility: isPrivate ? "private" : "public",
      };
    },

    async resolveRef(coordinates, ref): Promise<string> {
      calls.resolveRef += 1;
      see("resolveRef", coordinates);
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
      see("getTree", coordinates);
      await gate;
      return { entries: filesOf(coordinates.repo).map((file) => file.entry), truncated: false };
    },

    async readBlob(coordinates, hash, maxBytes): Promise<Uint8Array> {
      calls.readBlob += 1;
      see("readBlob", coordinates);
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
            see("readArchive", coordinates);
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
