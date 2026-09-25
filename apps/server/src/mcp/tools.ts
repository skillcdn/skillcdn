import { McpServer, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import {
  browseTool,
  type Clock,
  catalogDescription,
  compactSummary,
  formatAddress,
  GitHostError,
  getSkillInputSchema,
  getSkillTool,
  INDEXING_NOTICE,
  MCP_BROWSE_DEFAULT_LIMIT,
  MCP_SEARCH_DEFAULT_LIMIT,
  readFileTool,
  renderDiagnostics,
  renderInstructions,
  searchTool,
  type UsageSink,
} from "@skillcdn/core";
import * as z from "zod";
import type { Logger } from "../logger.js";
import { ReaderInputError } from "../mounts/continuation.js";
import type { MountReader, NotReady } from "../mounts/mount-reader.js";
import type { Mount } from "../mounts/mount-service.js";
import type { UsageStats } from "../stats/usage-recorder.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";
import {
  browseReply,
  fileReply,
  fitsReply,
  problem,
  reply,
  searchReply,
  skillReply,
  type ToolReply,
} from "./replies.js";

export interface ToolDependencies {
  readonly reader: MountReader;
  readonly usage: UsageSink;
  readonly stats: UsageStats;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly indexWaitMs: number;
  readonly publicUrl: string | undefined;
}
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/** The MCP skills extension this server implements (ADR-0024). */
export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
/** How long a client may keep what a pinned address serves: the commit never changes. */
const PINNED_TTL_MS = 86_400_000;
/** How long a client may keep an answer given while the commit is still being indexed. */
const INDEXING_TTL_MS = 5_000;

function notReady(outcome: NotReady): ToolReply {
  return outcome.status === "indexing"
    ? reply(INDEXING_NOTICE, { status: "indexing" })
    : problem(`This commit could not be indexed (${outcome.errorCode}). Try again later.`);
}

/** The cache fields every list and read result of the current protocol revision carries. */
function cacheHint(mount: Mount, now: Date): { ttlMs: number; cacheScope: "public" | "private" } {
  const ttlMs =
    mount.trustedUntil === undefined
      ? PINNED_TTL_MS
      : Math.max(0, mount.trustedUntil.getTime() - now.getTime());
  return {
    ttlMs,
    cacheScope: mount.repo.repository.visibility === "public" ? "public" : "private",
  };
}

/** One fixed, stateless tool surface for every repository, independent of its skill count. */
export async function createMountServer(
  mount: Mount,
  dependencies: ToolDependencies,
  request: { readonly origin: string },
): Promise<McpServer> {
  const { reader, usage, stats, clock, indexWaitMs } = dependencies;
  const repository = `${mount.repo.repository.owner.login}/${mount.repo.repository.name}`;
  const log = dependencies.logger.child({
    repo: repository,
    commit: mount.commit,
    account: mount.repo.accountId,
  });
  const catalog = await reader.catalog(mount);
  const manifest = catalog.status === "ready" ? catalog.catalog.manifest : undefined;
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: manifest?.name ?? `${repository}${mount.address.path ? `/${mount.address.path}` : ""}`,
      description: compactSummary(
        (catalog.status === "ready" ? catalogDescription(catalog.catalog) : undefined) ??
          mount.repo.repository.description ??
          `Skills and documents from ${repository}.`,
        360,
      ),
      websiteUrl: `${request.origin}${formatAddress(mount.address)}`,
    },
    {
      // The surface of a mount never changes within a connection, so no client needs to
      // subscribe to list changes; the SDK would advertise them otherwise.
      capabilities: {
        prompts: { listChanged: false },
        tools: { listChanged: false },
        resources: { listChanged: false },
        extensions: { [SKILLS_EXTENSION]: { directoryRead: true } },
      },
      instructions: renderInstructions(catalog),
    },
  );
  server.server.oninitialized = () => stats.count(mount, "connection");
  const record = (subject: string): void => {
    usage.record({
      type: "tool_call",
      at: clock.now(),
      hostAccountId: mount.repo.repository.owner.hostAccountId,
      hostRepoId: mount.repo.repository.hostRepoId,
      subject,
      quantity: 1,
      unit: "call",
    });
    stats.count(mount, "tool_call", subject);
  };
  const guarded =
    <Input>(tool: string, handler: (input: Input) => Promise<ToolReply>) =>
    async (input: Input): Promise<ToolReply> => {
      record(tool);
      try {
        const result = await handler(input);
        return fitsReply(result)
          ? result
          : problem(
              "This result exceeds the context budget. Use a narrower folder or read an exact source file.",
            );
      } catch (error) {
        if (error instanceof ReaderInputError) return problem(error.message);
        if (error instanceof GitHostError && error.kind === "rate_limited")
          return problem("The git host is rate limiting requests. Try again later.");
        log.error({ err: error, tool }, "tool call failed");
        return problem("The tool failed on the server side. Try again later.");
      }
    };
  server.registerTool(
    browseTool.name,
    { ...browseTool, annotations: READ_ONLY },
    guarded(browseTool.name, async (input) => {
      const answer = await reader.browse(
        mount,
        { ...input, limit: input.limit ?? MCP_BROWSE_DEFAULT_LIMIT },
        indexWaitMs,
        (result) => fitsReply(browseReply(result)),
      );
      return answer.status === "ready" ? browseReply(answer.result) : notReady(answer);
    }),
  );
  server.registerTool(
    searchTool.name,
    { ...searchTool, annotations: READ_ONLY },
    guarded(searchTool.name, async (input) => {
      const answer = await reader.find(
        mount,
        { ...input, limit: input.limit ?? MCP_SEARCH_DEFAULT_LIMIT },
        indexWaitMs,
        (result) => fitsReply(searchReply(result)),
      );
      return answer.status === "ready" ? searchReply(answer.result) : notReady(answer);
    }),
  );
  const loadSkill = guarded<{ path: string; cursor?: string }>(getSkillTool.name, async (input) => {
    const continuation = input.cursor !== undefined;
    const answer = await reader.skill(
      mount,
      input.path,
      indexWaitMs,
      input.cursor,
      true,
      (result) => fitsReply(skillReply(result, continuation)),
    );
    if (answer.status !== "ready") return notReady(answer);
    const { lookup } = answer;
    switch (lookup.kind) {
      case "found": {
        if (input.cursor === undefined) stats.count(mount, "skill_load", lookup.skill.directory);
        return skillReply(lookup.skill, continuation);
      }
      case "not_found":
        return problem(
          `No skill at ${JSON.stringify(input.path)}. Use browse_repo or search_repo for its exact SKILL.md path.${lookup.available.length === 0 ? "" : ` Available: ${lookup.available.join(", ")}.`}\n${renderDiagnostics(lookup.diagnostics, true) ?? ""}`,
        );
      case "ambiguous":
        return problem("Use the exact SKILL.md path returned by browse_repo or search_repo.");
      case "unavailable":
        return problem("The skill's content is unavailable. Try again later.");
    }
  });
  server.registerTool(getSkillTool.name, { ...getSkillTool, annotations: READ_ONLY }, loadSkill);
  server.registerTool(
    readFileTool.name,
    { ...readFileTool, annotations: READ_ONLY },
    guarded(readFileTool.name, async (input) => {
      const lookup = await reader.file(mount, input, (result) => fitsReply(fileReply(result)));
      switch (lookup.kind) {
        case "not_ready":
          return notReady(lookup.outcome);
        case "found":
          return fileReply(lookup.file);
        case "directory":
          return problem(
            `This path is a folder. Call browse_repo with path ${JSON.stringify(lookup.directory.path)}.`,
          );
        case "invalid_path":
          return problem(
            `Invalid repository-root path: ${lookup.reason}. Use a path returned by browse_repo or search_repo.`,
          );
        case "not_found":
          return problem(
            `No readable file at ${lookup.path} in this mount. Use browse_repo, or load_skill for resolved references.${lookup.suggestions?.length ? ` Candidates: ${lookup.suggestions.join(", ")}.` : ""}`,
          );
        case "too_large":
          return problem(
            `${lookup.path} is too large to read (${lookup.size} bytes; limit ${lookup.limit}).`,
          );
        case "not_text":
          return problem(`${lookup.path} is not a UTF-8 text file.`);
      }
    }),
  );
  server.registerPrompt(
    "use_skill",
    {
      title: "Use a skill",
      description:
        "Load one skill by its repository-root SKILL.md path. Continue load_skill if the context is paged.",
      argsSchema: { path: getSkillInputSchema.shape.path },
    },
    async ({ path }) => {
      const answer = await loadSkill({ path });
      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: answer.content[0]?.text ?? INDEXING_NOTICE },
          },
        ],
      };
    },
  );

  // The skills extension: the same index, served as skills and resources (ADR-0024). Every
  // answer carries the cache fields of the current revision; while the commit is being indexed,
  // the listing is empty and short-lived, and a read is a transient failure.
  const invalid = (message: string): ProtocolError =>
    new ProtocolError(ProtocolErrorCode.InvalidParams, message);
  const notIndexed = (outcome: NotReady): ProtocolError =>
    new ProtocolError(
      ProtocolErrorCode.InternalError,
      outcome.status === "indexing"
        ? "The commit is being indexed; retry shortly."
        : `This commit could not be indexed (${outcome.errorCode}).`,
    );
  const served = async <Output>(method: string, work: () => Promise<Output>): Promise<Output> => {
    record(method);
    try {
      return await work();
    } catch (error) {
      if (error instanceof ReaderInputError) throw invalid(error.message);
      if (error instanceof ProtocolError) throw error;
      log.error({ err: error, method }, "extension request failed");
      throw new ProtocolError(
        ProtocolErrorCode.InternalError,
        "The request failed on the server side.",
      );
    }
  };
  const cursor = z.string().max(4096).optional();
  const uri = z.string().min(1).max(2048);
  const listSkills = async (input: { cursor?: string | undefined }) => {
    const answer = await reader.listSkills(mount, { cursor: input.cursor }, indexWaitMs);
    if (answer.status !== "ready") {
      return { skills: [], nextCursor: undefined, ttlMs: INDEXING_TTL_MS };
    }
    return { skills: answer.result.skills, nextCursor: answer.result.nextCursor, ttlMs: undefined };
  };

  server.server.setRequestHandler(
    "skills/list",
    { params: z.object({ cursor }) },
    (params: { cursor?: string | undefined }) =>
      served("skills/list", async () => {
        const page = await listSkills(params);
        return {
          skills: page.skills,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          ...cacheHint(mount, clock.now()),
          ...(page.ttlMs === undefined ? {} : { ttlMs: page.ttlMs }),
        };
      }),
  );
  server.server.setRequestHandler(
    "skills/get",
    { params: z.object({ uri }) },
    (params: { uri: string }) =>
      served("skills/get", async () => {
        const answer = await reader.getSkill(mount, params.uri, indexWaitMs);
        if (answer.status !== "ready") throw notIndexed(answer);
        if (answer.skill === undefined) throw invalid(`No listed skill at ${params.uri}.`);
        const name = answer.skill.frontmatter.name;
        stats.count(mount, "skill_load", typeof name === "string" ? name : "");
        return { skill: answer.skill, ...cacheHint(mount, clock.now()) };
      }),
  );
  server.server.setRequestHandler(
    "resources/directory/read",
    { params: z.object({ uri, cursor }) },
    (params: { uri: string }) =>
      served("resources/directory/read", async () => {
        const answer = await reader.readDirectory(mount, params.uri, indexWaitMs);
        if (answer.status !== "ready") throw notIndexed(answer);
        if (answer.entries === undefined) throw invalid(`No directory at ${params.uri}.`);
        return {
          resources: answer.entries,
          ...cacheHint(mount, clock.now()),
        };
      }),
  );
  server.server.setRequestHandler("resources/list", (request) =>
    served("resources/list", async () => {
      const page = await listSkills({ cursor: request.params?.cursor });
      return {
        resources: page.skills.map((skill) => ({
          uri: skill.uri,
          name: typeof skill.frontmatter.name === "string" ? skill.frontmatter.name : skill.uri,
          mimeType: "text/markdown",
          ...(typeof skill.frontmatter.description === "string"
            ? { description: skill.frontmatter.description }
            : {}),
        })),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        ...cacheHint(mount, clock.now()),
        ...(page.ttlMs === undefined ? {} : { ttlMs: page.ttlMs }),
      };
    }),
  );
  server.server.setRequestHandler("resources/templates/list", async () => ({
    resourceTemplates: [],
    ...cacheHint(mount, clock.now()),
  }));
  server.server.setRequestHandler("resources/read", (request) =>
    served("resources/read", async () => {
      const answer = await reader.readResource(mount, request.params.uri, indexWaitMs);
      if (answer.status !== "ready") throw notIndexed(answer);
      if (answer.resource === undefined) throw invalid(`No served file at ${request.params.uri}.`);
      const { uri: found, mimeType, text, blob } = answer.resource;
      const content =
        text !== undefined
          ? { uri: found, mimeType, text }
          : { uri: found, mimeType, blob: blob ?? "" };
      return { contents: [content], ...cacheHint(mount, clock.now()) };
    }),
  );
  return server;
}
