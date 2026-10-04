import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import {
  type AddressRef,
  type ArchiveFile,
  type ArchiveRequest,
  type GitHost,
  type GitHostDirectory,
  GitHostError,
  type GitHostKey,
  type HostProfile,
  type HostRepository,
  type HostRepositoryPage,
  hasForbiddenCodePoint,
  isFullCommitHash,
  parseRepoPath,
  REPO_MANIFEST_FILE,
  type RepoCoordinates,
  type RepoTree,
  type TreeEntry,
} from "@skillcdn/core";
import * as z from "zod";
import { GitHubApp, type GitHubAppCredentials } from "./app.js";
import { type FetchLike, GitHubHttp, type RequestCredential, type TokenProvider } from "./http.js";
import { decodeJson } from "./json.js";
import { readTar, TarError } from "./tar.js";

export const GITHUB_API_BASE_URL = "https://api.github.com";
/** Where github.com serves archives from. Other installations serve them from their own origin. */
const GITHUB_DOWNLOAD_ORIGIN = "https://codeload.github.com";

export interface GitHubHostOptions {
  /** Operator configuration. GitHub Enterprise Server uses `https://<host>/api/v3`. */
  readonly baseUrl?: string;
  /** Identifies the caller to GitHub, which requires a user agent. */
  readonly userAgent: string;
  /** Optional credential for public repositories: it only raises the rate limit. */
  readonly token?: TokenProvider;
  /**
   * The app whose installations private repositories are read through. Left out, coordinates
   * that ask for the installation's credential name nothing.
   */
  readonly app?: GitHubAppCredentials;
  /** Milliseconds since the epoch; the system clock when left out. */
  readonly now?: () => number;
  /**
   * Origins the API may redirect an archive download to, besides its own. Defaults to the
   * download host of github.com when the base URL is github.com, and to none otherwise.
   */
  readonly downloadOrigins?: readonly string[];
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  /** Ceiling for one archive download, from the first byte to the last. */
  readonly downloadTimeoutMs?: number;
  readonly attempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly maxCacheEntries?: number;
}

const JSON_ACCEPT = "application/vnd.github+json";
const SHA_ACCEPT = "application/vnd.github.sha";
const RAW_ACCEPT = "application/vnd.github.raw+json";

/** GitHub caps a description at 350 characters. Anything unprintable is not a description. */
const MAX_DESCRIPTION_LENGTH = 350;
/** How many repositories a page of an account's listing holds: the host's own maximum. */
const LISTING_PAGE_SIZE = 100;
/** The host stops paging a listing long before this. */
const MAX_LISTING_PAGE = 100;

/** One line of what the host says about something, or nothing when it is not printable. */
export function cleanDescription(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.replaceAll(/\s+/g, " ").trim();
  return text.length === 0 || hasForbiddenCodePoint(text)
    ? undefined
    : text.slice(0, MAX_DESCRIPTION_LENGTH);
}

// Only the fields we read are validated; GitHub adds fields freely.
const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  private: z.boolean(),
  visibility: z.string().optional(),
  default_branch: z.string().min(1),
  description: z.string().nullable().optional(),
  owner: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1),
    type: z.string(),
  }),
});

const profileSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  type: z.string(),
  name: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  public_repos: z.number().int().nonnegative().optional(),
});

/** An organization says what it is in a field an account's profile does not have. */
const organizationSchema = z.object({ description: z.string().nullable().optional() });

const listingSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    private: z.boolean(),
    visibility: z.string().optional(),
    fork: z.boolean().optional(),
    archived: z.boolean().optional(),
    description: z.string().nullable().optional(),
    stargazers_count: z.number().int().nonnegative().optional(),
    pushed_at: z.string().nullable().optional(),
  }),
);

const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.string(),
      sha: z.string(),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});

const SYMLINK_MODE = "120000";

/** Ends quietly once `maxBytes` have passed: what came before is still good. */
async function* upTo(
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      return;
    }
    yield chunk;
  }
}

/** An instant the host wrote, as an ISO 8601 instant, or nothing when it is not one. */
function instantOf(value: string | null | undefined): string | undefined {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function repoPath(coordinates: RepoCoordinates): string {
  // Owner and repository were validated by the address parser; encoding is the second fence.
  return `/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}`;
}

function toTreeEntry(entry: z.infer<typeof treeSchema>["tree"][number]): TreeEntry | undefined {
  if (entry.type === "tree" || !isFullCommitHash(entry.sha)) {
    return undefined;
  }
  // The tree is repository content: a path that fails validation is dropped, not repaired.
  const path = parseRepoPath(entry.path);
  if (!path.ok || path.value.length === 0) {
    return undefined;
  }
  if (entry.type === "commit") {
    return { path: path.value, type: "submodule", size: 0, hash: entry.sha };
  }
  if (entry.type !== "blob") {
    return undefined;
  }
  if (entry.mode === SYMLINK_MODE) {
    return { path: path.value, type: "symlink", size: 0, hash: entry.sha };
  }
  return { path: path.value, type: "file", size: entry.size ?? 0, hash: entry.sha };
}

/** The last segment of a raw host path, before any validation. */
function baseNameOf(rawPath: string): string {
  return rawPath.slice(rawPath.lastIndexOf("/") + 1);
}

/**
 * What every call to the host goes through: the HTTP behavior they share and, when the operator
 * registered one, the app. The repository adapter and the login adapter of one deployment share
 * a connection, so that they share its caches and its tokens.
 */
export interface GitHubConnection {
  readonly http: GitHubHttp;
  readonly app: GitHubApp | undefined;
}

export function connectGitHub(options: GitHubHostOptions): GitHubConnection {
  const baseUrl = options.baseUrl ?? GITHUB_API_BASE_URL;
  const http = new GitHubHttp({
    baseUrl,
    downloadOrigins:
      options.downloadOrigins ?? (baseUrl === GITHUB_API_BASE_URL ? [GITHUB_DOWNLOAD_ORIGIN] : []),
    userAgent: options.userAgent,
    token: options.token,
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs: options.timeoutMs ?? 15_000,
    attempts: options.attempts ?? 3,
    retryBaseDelayMs: options.retryBaseDelayMs ?? 250,
    maxCacheEntries: options.maxCacheEntries ?? 1000,
  });
  const app =
    options.app === undefined
      ? undefined
      : new GitHubApp(http, options.app, options.now ?? (() => Date.now()));
  return { http, app };
}

/** The GitHub implementation of the git-host port and of its directory of accounts. */
export interface GitHubHost extends GitHost, GitHostDirectory {}

/**
 * Repositories are read with the deployment's own credential or, when their coordinates say
 * so, with the one the host issues the app for its installation on them.
 */
export function createGitHubHost(
  options: GitHubHostOptions,
  connection: GitHubConnection = connectGitHub(options),
): GitHubHost {
  const { http, app } = connection;

  /**
   * The credential the coordinates ask for. An installation that is not there is a repository
   * that is not there: the caller cannot tell the two apart, and must not.
   */
  const credentialFor = async (
    coordinates: RepoCoordinates,
  ): Promise<RequestCredential | undefined> => {
    if (coordinates.credential !== "installation") {
      return undefined;
    }
    const credential = await app?.installationCredential(coordinates);
    if (credential === undefined) {
      throw new GitHostError("not_found", "not found on the git host");
    }
    return credential;
  };

  return {
    async getProfile(_host: GitHostKey, login: string): Promise<HostProfile> {
      const reply = await http.get(`/users/${encodeURIComponent(login)}`, {
        accept: JSON_ACCEPT,
        conditional: true,
      });
      const profile = decodeJson(reply.body, profileSchema);
      const organization = profile.type === "Organization";
      let bio = cleanDescription(profile.bio);
      if (organization && bio === undefined) {
        // What an organization says about itself is worth one more request, not a failed page.
        bio = await http
          .get(`/orgs/${encodeURIComponent(login)}`, { accept: JSON_ACCEPT, conditional: true })
          .then(
            (answer) => cleanDescription(decodeJson(answer.body, organizationSchema).description),
            () => undefined,
          );
      }
      return {
        hostAccountId: String(profile.id),
        login: profile.login,
        kind: organization ? "organization" : "user",
        name: cleanDescription(profile.name),
        bio,
        publicRepositories: profile.public_repos ?? 0,
      };
    },

    async listPublicRepositories(
      _host: GitHostKey,
      login: string,
      page: number,
    ): Promise<HostRepositoryPage> {
      if (!Number.isInteger(page) || page < 1 || page > MAX_LISTING_PAGE) {
        throw new GitHostError("invalid", "a listing is read by page, from 1");
      }
      const reply = await http.get(
        `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&direction=desc&per_page=${LISTING_PAGE_SIZE}&page=${page}`,
        { accept: JSON_ACCEPT, conditional: true },
      );
      const listed = decodeJson(reply.body, listingSchema);
      return {
        // Whatever credential asked, only what the host reports as public is passed on.
        repositories: listed
          .filter((entry) => !entry.private && (entry.visibility ?? "public") === "public")
          .map((entry) => ({
            hostRepoId: String(entry.id),
            name: entry.name,
            description: cleanDescription(entry.description),
            fork: entry.fork === true,
            archived: entry.archived === true,
            stars: entry.stargazers_count ?? 0,
            pushedAt: instantOf(entry.pushed_at),
          })),
        hasMore: /rel="next"/.test(reply.headers.get("link") ?? ""),
      };
    },

    async getRepository(coordinates: RepoCoordinates): Promise<HostRepository> {
      const reply = await http.get(repoPath(coordinates), {
        accept: JSON_ACCEPT,
        conditional: true,
        credential: await credentialFor(coordinates),
      });
      const repository = decodeJson(reply.body, repositorySchema);
      return {
        hostRepoId: String(repository.id),
        owner: {
          hostAccountId: String(repository.owner.id),
          login: repository.owner.login,
          kind: repository.owner.type === "Organization" ? "organization" : "user",
        },
        name: repository.name,
        defaultBranch: repository.default_branch,
        description: cleanDescription(repository.description),
        // "internal" is visible to a whole enterprise, which is still not public.
        visibility:
          !repository.private && (repository.visibility ?? "public") === "public"
            ? "public"
            : "private",
      };
    },

    async resolveRef(coordinates: RepoCoordinates, ref: AddressRef | undefined): Promise<string> {
      const name = ref === undefined ? "HEAD" : ref.kind === "commit" ? ref.hash : ref.name;
      const encoded = name.split("/").map(encodeURIComponent).join("/");
      const reply = await http.get(`${repoPath(coordinates)}/commits/${encoded}`, {
        accept: SHA_ACCEPT,
        credential: await credentialFor(coordinates),
        // A pinned commit never changes, so there is nothing to revalidate.
        conditional: ref?.kind !== "commit",
        maxBytes: 1024,
        // 422: no commit for this ref. 409: the repository is empty.
        notFoundStatuses: [409, 422],
      });
      const commit = new TextDecoder().decode(reply.body).trim().toLowerCase();
      if (!isFullCommitHash(commit)) {
        throw new GitHostError("invalid", "the git host did not answer with a commit hash");
      }
      return commit;
    },

    async getTree(coordinates: RepoCoordinates, commit: string): Promise<RepoTree> {
      if (!isFullCommitHash(commit)) {
        throw new GitHostError("invalid", "a tree is listed by full commit hash");
      }
      const reply = await http.get(`${repoPath(coordinates)}/git/trees/${commit}?recursive=1`, {
        accept: JSON_ACCEPT,
        credential: await credentialFor(coordinates),
        notFoundStatuses: [409, 422],
      });
      const tree = decodeJson(reply.body, treeSchema);
      const entries: TreeEntry[] = [];
      // An entry that cannot be named or trusted is left out. When it would have declared a
      // policy, the listing is reported as incomplete, as nothing below it can be published.
      let lostDeclaration = false;
      for (const raw of tree.tree) {
        const entry = toTreeEntry(raw);
        if (entry !== undefined) {
          entries.push(entry);
        } else if (raw.type !== "tree" && baseNameOf(raw.path) === REPO_MANIFEST_FILE) {
          lostDeclaration = true;
        }
      }
      return { entries, truncated: tree.truncated || lostDeclaration };
    },

    async readBlob(
      coordinates: RepoCoordinates,
      hash: string,
      maxBytes: number,
    ): Promise<Uint8Array> {
      if (!isFullCommitHash(hash)) {
        throw new GitHostError("invalid", "a blob is read by full object hash");
      }
      const reply = await http.get(`${repoPath(coordinates)}/git/blobs/${hash}`, {
        accept: RAW_ACCEPT,
        credential: await credentialFor(coordinates),
        maxBytes,
        notFoundStatuses: [422],
      });
      return reply.body;
    },

    async *readArchive(
      coordinates: RepoCoordinates,
      commit: string,
      request: ArchiveRequest,
    ): AsyncGenerator<ArchiveFile> {
      if (!isFullCommitHash(commit)) {
        throw new GitHostError("invalid", "an archive is read by full commit hash");
      }
      const response = await http.open(`${repoPath(coordinates)}/tarball/${commit}`, {
        accept: JSON_ACCEPT,
        credential: await credentialFor(coordinates),
        signal: AbortSignal.timeout(options.downloadTimeoutMs ?? 120_000),
        notFoundStatuses: [409, 422],
      });
      if (response.body === null) {
        return;
      }
      const source = Readable.fromWeb(response.body);
      const unpacked = createGunzip();
      // `pipe` passes data on and failures not: a connection that breaks midway would be an
      // error nobody listens for. The failure goes to the consumer instead.
      source.on("error", (error) => unpacked.destroy(error));
      source.pipe(unpacked);
      try {
        // Archive paths start with one directory named after the repository and the commit.
        const files = readTar(upTo(unpacked, request.maxArchiveBytes), (tarPath, size) => {
          const path = parseRepoPath(tarPath.slice(tarPath.indexOf("/") + 1));
          return path.ok && path.value.length > 0 && request.wants(path.value, size);
        });
        for await (const file of files) {
          const path = parseRepoPath(file.path.slice(file.path.indexOf("/") + 1));
          if (path.ok) {
            yield { path: path.value, bytes: file.bytes };
          }
        }
      } catch (error) {
        if (error instanceof GitHostError) {
          throw error;
        }
        // A corrupt stream is the host's problem and not worth a retry; a broken connection is.
        throw new GitHostError(
          error instanceof TarError || (error as { code?: string }).code === "Z_DATA_ERROR"
            ? "invalid"
            : "transient",
          "the archive could not be read",
          { cause: error },
        );
      } finally {
        unpacked.destroy();
        // A consumer that stops early leaves the rest of the download unread; cancelling the
        // source releases the connection.
        source.destroy();
      }
    },
  };
}
