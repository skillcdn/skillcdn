import { McpServer } from "@modelcontextprotocol/server";
import {
  type BlobStore,
  type Clock,
  FIND_DEFAULT_LIMIT,
  type FindItem,
  findTool,
  type GitHost,
  GitHostError,
  getTool,
  INDEXING_NOTICE,
  type IndexLimits,
  joinRepoPath,
  type MountSummary,
  pageOfText,
  parseRepoPath,
  READ_FILE_DEFAULT_LIMIT,
  type RepoPath,
  type RepoTree,
  readFileTool,
  relativeRepoPath,
  renderFileResult,
  renderFindResult,
  renderSkillResult,
  splitFrontMatter,
  type UsageSink,
} from "@skillcdn/core";
import {
  type Database,
  type EntryRecord,
  findSkills,
  getEntry,
  listEntries,
  listSkillFiles,
  type SnapshotRecord,
  searchEntries,
} from "@skillcdn/db";
import type { SnapshotOutcome, SnapshotService } from "../indexer/snapshot-service.js";
import { decodeText } from "../indexer/text.js";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

export interface ToolDependencies {
  readonly database: Database;
  readonly blobStore: BlobStore;
  readonly gitHost: GitHost;
  readonly snapshots: SnapshotService;
  readonly usage: UsageSink;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly limits: IndexLimits;
  /** How long `find` and `get` wait for an index that is still being built. */
  readonly indexWaitMs: number;
}

interface ToolReply {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const MAX_LISTED_SKILL_FILES = 50;
const MAX_SUGGESTED_SKILLS = 20;
const MAX_CACHED_TREES = 8;

const reply = (text: string): ToolReply => ({ content: [{ type: "text", text }] });
/** A problem the model can act on. It is a tool result, not a protocol error. */
const problem = (text: string): ToolReply => ({ content: [{ type: "text", text }], isError: true });

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function notReady(outcome: Exclude<SnapshotOutcome, { status: "ready" }>): ToolReply {
  if (outcome.status === "indexing") {
    return reply(INDEXING_NOTICE);
  }
  return problem(
    `This commit could not be indexed (${outcome.errorCode}). It is retried automatically; try again later. read_file still works.`,
  );
}

/** A path stored by the indexer, relative to the mounted root. */
function belowMount(mount: Mount, stored: string | null): RepoPath | undefined {
  const parsed = stored === null ? undefined : parseRepoPath(stored);
  return parsed?.ok === true ? relativeRepoPath(mount.address.path, parsed.value) : undefined;
}

/**
 * Trees of commits whose index is not ready yet, so that `read_file` can answer in the meantime.
 * A commit's tree never changes; the cache is small and only saves repeated upstream calls.
 */
const treeCache = new Map<string, Promise<RepoTree>>();

function treeOf(mount: Mount, gitHost: GitHost): Promise<RepoTree> {
  const key = `${mount.repo.id} ${mount.commit}`;
  const cached = treeCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const loading = gitHost.getTree(mount.coordinates, mount.commit);
  loading.catch(() => {
    treeCache.delete(key);
  });
  treeCache.set(key, loading);
  if (treeCache.size > MAX_CACHED_TREES) {
    const oldest = treeCache.keys().next().value;
    if (oldest !== undefined) {
      treeCache.delete(oldest);
    }
  }
  return loading;
}

/** Builds the MCP server for one request: the fixed tool set, bound to one resolved mount. */
export function createMountServer(mount: Mount, dependencies: ToolDependencies): McpServer {
  const { database, blobStore, gitHost, snapshots, usage, clock, limits, indexWaitMs } =
    dependencies;
  const repository = `${mount.repo.repository.owner.login}/${mount.repo.repository.name}`;
  const log = dependencies.logger.child({
    repo: repository,
    commit: mount.commit,
    account: mount.repo.accountId,
  });
  const effectiveLimits = { ...limits, ...mount.limits };

  const summary = (snapshot: SnapshotRecord | undefined): MountSummary => ({
    repository,
    ref:
      mount.address.ref === undefined
        ? undefined
        : mount.address.ref.kind === "commit"
          ? mount.address.ref.hash
          : mount.address.ref.name,
    commit: mount.commit,
    path: mount.address.path,
    // Verification arrives with the GitHub App. Until then every repository is unverified.
    verified: false,
    truncated: snapshot?.truncated ?? false,
  });

  /** Runs a handler with usage accounting, and keeps unexpected failures away from the caller. */
  const guarded =
    <Input>(tool: string, handler: (input: Input) => Promise<ToolReply>) =>
    async (input: Input): Promise<ToolReply> => {
      usage.record({
        type: "tool_call",
        at: clock.now(),
        hostAccountId: mount.repo.repository.owner.hostAccountId,
        hostRepoId: mount.repo.repository.hostRepoId,
        subject: tool,
        quantity: 1,
        unit: "call",
      });
      try {
        return await handler(input);
      } catch (error) {
        if (error instanceof GitHostError && error.kind === "rate_limited") {
          return problem("The git host is rate limiting requests. Try again later.");
        }
        log.error({ err: error, tool }, "tool call failed");
        return problem("The tool failed on the server side. Try again later.");
      }
    };

  const toFindItem = (row: EntryRecord): FindItem | undefined => {
    if (row.kind === "skill") {
      const directory = belowMount(mount, row.skillDir);
      return directory === undefined || row.name === null
        ? undefined
        : { kind: "skill", name: row.name, directory, description: row.description ?? "" };
    }
    const path = belowMount(mount, row.path);
    return path === undefined
      ? undefined
      : {
          kind: "document",
          path,
          title: row.title ?? undefined,
          summary: row.description ?? undefined,
        };
  };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        `This server serves the skills and documents of the git repository ${repository}. ` +
        "Call find to see what is available, get to load a skill, and read_file to read a file " +
        "that a skill or a search result points to.",
    },
  );

  server.registerTool(
    findTool.name,
    {
      title: findTool.title,
      description: findTool.description,
      inputSchema: findTool.inputSchema,
      annotations: READ_ONLY,
    },
    guarded(findTool.name, async (input) => {
      const outcome = await snapshots.ready(mount, indexWaitMs);
      if (outcome.status !== "ready") {
        return notReady(outcome);
      }
      const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
      const query = input.query?.trim();
      const limit = input.limit ?? FIND_DEFAULT_LIMIT;
      const rows =
        query === undefined || query.length === 0
          ? await listEntries(database, scope, mount.address.path, limit)
          : await searchEntries(database, scope, mount.address.path, query, limit);
      return reply(
        renderFindResult({
          mount: summary(outcome.snapshot),
          query: query === undefined || query.length === 0 ? undefined : query,
          items: rows.map(toFindItem).filter((item) => item !== undefined),
        }),
      );
    }),
  );

  server.registerTool(
    getTool.name,
    {
      title: getTool.title,
      description: getTool.description,
      inputSchema: getTool.inputSchema,
      annotations: READ_ONLY,
    },
    guarded(getTool.name, async (input) => {
      const outcome = await snapshots.ready(mount, indexWaitMs);
      if (outcome.status !== "ready") {
        return notReady(outcome);
      }
      const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
      const name = input.name.trim();
      const asDirectory = parseRepoPath(name);
      const directory = asDirectory.ok
        ? joinRepoPath(mount.address.path, asDirectory.value)
        : undefined;
      const found = await findSkills(database, scope, mount.address.path, { name, directory }, 10);
      const exact = found.filter((row) => row.name === name || row.skillDir === directory);
      const matches = exact.length > 0 ? exact : found;

      if (matches.length === 0) {
        const available = (
          await listEntries(database, scope, mount.address.path, MAX_SUGGESTED_SKILLS)
        )
          .filter((row) => row.kind === "skill" && row.name !== null)
          .map((row) => row.name);
        return problem(
          available.length === 0
            ? `No skill named ${JSON.stringify(name)}. This mount has no skills; use find and read_file to read its documents.`
            : `No skill named ${JSON.stringify(name)}. Available skills: ${available.join(", ")}.`,
        );
      }
      const [skill, ...others] = matches;
      if (skill === undefined || others.length > 0) {
        const directories = matches.map((row) => belowMount(mount, row.skillDir) ?? ".");
        return problem(
          `Several skills are named ${JSON.stringify(name)}. Call get with one of these directories as the name: ${directories.join(", ")}.`,
        );
      }

      const text = await blobStore.read(skill.blobSha);
      const skillDirectory = belowMount(mount, skill.skillDir);
      if (text === undefined || skillDirectory === undefined || skill.name === null) {
        return problem("The skill is indexed but its content is not available. Try again later.");
      }
      const split = splitFrontMatter(text);
      const files = await listSkillFiles(
        database,
        scope,
        skill.skillDir ?? "",
        MAX_LISTED_SKILL_FILES + 1,
      );
      return reply(
        renderSkillResult({
          mount: summary(outcome.snapshot),
          name: skill.name,
          directory: skillDirectory,
          description: skill.description ?? "",
          license: skill.frontMatter?.license,
          compatibility: skill.frontMatter?.compatibility,
          allowedTools: skill.frontMatter?.allowedTools,
          metadata: skill.frontMatter?.metadata ?? {},
          body: split.kind === "found" ? split.body : text,
          files: files
            .slice(0, MAX_LISTED_SKILL_FILES)
            .map((file) => belowMount(mount, file))
            .filter((file) => file !== undefined),
          filesTruncated: files.length > MAX_LISTED_SKILL_FILES,
          warnings: skill.frontMatter?.warnings ?? [],
        }),
      );
    }),
  );

  server.registerTool(
    readFileTool.name,
    {
      title: readFileTool.title,
      description: readFileTool.description,
      inputSchema: readFileTool.inputSchema,
      annotations: READ_ONLY,
    },
    guarded(readFileTool.name, async (input) => {
      const relative = parseRepoPath(input.path);
      if (!relative.ok || relative.value.length === 0) {
        return problem(
          `Not a valid path: ${relative.ok ? "the path is empty" : relative.error.message}. Paths are relative to the mounted root, for example skills/ads/SKILL.md.`,
        );
      }
      const path = joinRepoPath(mount.address.path, relative.value);

      // The index answers when it is ready right now; otherwise the commit's tree does, so that
      // reading never waits for indexing.
      const outcome = await snapshots.ready(mount, 0);
      let file: { readonly size: number; readonly hash: string } | undefined;
      if (outcome.status === "ready") {
        const scope = { accountId: outcome.snapshot.accountId, snapshotId: outcome.snapshot.id };
        const entry = await getEntry(database, scope, path);
        file = entry === undefined ? undefined : { size: entry.size, hash: entry.blobSha };
      } else {
        const tree = await treeOf(mount, gitHost);
        const entry = tree.entries.find(
          (candidate) => candidate.type === "file" && candidate.path === path,
        );
        file = entry === undefined ? undefined : { size: entry.size, hash: entry.hash };
      }
      if (file === undefined) {
        return problem(
          `No file at ${relative.value}. Use find to search, or get to see the files of a skill.`,
        );
      }
      if (file.size > effectiveLimits.maxReadableFileBytes) {
        return problem(
          `${relative.value} is too large to read (${file.size} bytes; the limit is ${effectiveLimits.maxReadableFileBytes}).`,
        );
      }

      let text = await blobStore.read(file.hash);
      if (text === undefined) {
        const bytes = await gitHost.readBlob(
          mount.coordinates,
          file.hash,
          effectiveLimits.maxReadableFileBytes,
        );
        text = decodeText(bytes);
        if (text === undefined) {
          return problem(`${relative.value} is not a UTF-8 text file, so it cannot be read here.`);
        }
        await blobStore.write(file.hash, text);
      }
      return reply(
        renderFileResult({
          mount: summary(outcome.status === "ready" ? outcome.snapshot : undefined),
          path: relative.value,
          ...pageOfText(text, input.offset ?? 0, input.limit ?? READ_FILE_DEFAULT_LIMIT),
        }),
      );
    }),
  );

  return server;
}
