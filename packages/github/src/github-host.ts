import {
  type AddressRef,
  type GitHost,
  GitHostError,
  type HostRepository,
  isFullCommitHash,
  parseRepoPath,
  type RepoCoordinates,
  type RepoTree,
  type TreeEntry,
} from "@skillcdn/core";
import * as z from "zod";
import { type FetchLike, GitHubHttp, type TokenProvider } from "./http.js";

export const GITHUB_API_BASE_URL = "https://api.github.com";

export interface GitHubHostOptions {
  /** Operator configuration. GitHub Enterprise Server uses `https://<host>/api/v3`. */
  readonly baseUrl?: string;
  /** Identifies the caller to GitHub, which requires a user agent. */
  readonly userAgent: string;
  /** Optional credential for public repositories: it only raises the rate limit. */
  readonly token?: TokenProvider;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly maxCacheEntries?: number;
}

const JSON_ACCEPT = "application/vnd.github+json";
const SHA_ACCEPT = "application/vnd.github.sha";
const RAW_ACCEPT = "application/vnd.github.raw+json";

// Only the fields we read are validated; GitHub adds fields freely.
const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  private: z.boolean(),
  visibility: z.string().optional(),
  default_branch: z.string().min(1),
  owner: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1),
    type: z.string(),
  }),
});

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

function decodeJson<Schema extends z.ZodType>(body: Uint8Array, schema: Schema): z.infer<Schema> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    throw new GitHostError("invalid", "the git host sent a reply that is not JSON", {
      cause: error,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GitHostError("invalid", "the git host sent a reply in an unexpected shape");
  }
  return parsed.data;
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

/** The GitHub implementation of the git-host port, for repositories readable with one credential. */
export function createGitHubHost(options: GitHubHostOptions): GitHost {
  const http = new GitHubHttp({
    baseUrl: options.baseUrl ?? GITHUB_API_BASE_URL,
    userAgent: options.userAgent,
    token: options.token,
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs: options.timeoutMs ?? 15_000,
    attempts: options.attempts ?? 3,
    retryBaseDelayMs: options.retryBaseDelayMs ?? 250,
    maxCacheEntries: options.maxCacheEntries ?? 1000,
  });

  return {
    async getRepository(coordinates: RepoCoordinates): Promise<HostRepository> {
      const reply = await http.get(repoPath(coordinates), {
        accept: JSON_ACCEPT,
        conditional: true,
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
        notFoundStatuses: [409, 422],
      });
      const tree = decodeJson(reply.body, treeSchema);
      const entries: TreeEntry[] = [];
      let dropped = 0;
      for (const raw of tree.tree) {
        const entry = toTreeEntry(raw);
        if (entry !== undefined) {
          entries.push(entry);
        } else if (raw.type !== "tree") {
          dropped += 1;
        }
      }
      return { entries, truncated: tree.truncated || dropped > 0 };
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
        maxBytes,
        notFoundStatuses: [422],
      });
      return reply.body;
    },
  };
}
