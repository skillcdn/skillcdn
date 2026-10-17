import { McpServer, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import {
  browseTool,
  type Clock,
  catalogDescription,
  compactSummary,
  describeLicense,
  formatAddress,
  GitHostError,
  getSkillInputSchema,
  getSkillTool,
  ICON_ROUTE,
  ICON_SIZE,
  INDEXING_NOTICE,
  type IndexedFile,
  type IndexNotReady,
  MCP_BROWSE_DEFAULT_LIMIT,
  MCP_SEARCH_DEFAULT_LIMIT,
  readFileTool,
  renderDiagnostics,
  renderInstructions,
  searchTool,
} from "@skillcdn/core";
import { type Reader, ReaderInputError } from "@skillcdn/reader";
import * as z from "zod";
import type { ServedMount } from "./mount.js";
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

// The MCP surface of a mount (docs/specs/tools.md): the four tools, the prompt, and the skills
// extension, over the reader. One server instance per connection or request, bound to one
// mount; what a deployment counts of its use arrives through hooks, which the command serving
// a directory leaves out.

/** What is logged of a failure: the fields a structured logger takes, and a message. */
export interface ServeLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/** What a deployment counts of what an agent does; every hook is optional. */
export interface UsageHooks<M extends ServedMount> {
  /** A connection to the mount was opened (the earlier protocol revisions say so once). */
  readonly connection?: ((mount: M) => void) | undefined;
  /** A tool or an extension method was called. */
  readonly call?: ((mount: M, subject: string) => void) | undefined;
  /** A skill at `directory` was loaded, through a tool or the extension. */
  readonly skillLoad?: ((mount: M, directory: string) => void) | undefined;
  /** A file at `path` was read, through a tool or the extension. */
  readonly fileRead?: ((mount: M, path: string) => void) | undefined;
  /** The client named itself, or did not, from the request's address. */
  readonly client?:
    | ((mount: M, clientAddress: string | undefined, app: string | undefined) => void)
    | undefined;
}

export interface ToolDependencies<M extends ServedMount> {
  readonly reader: Reader<M>;
  readonly clock: Clock;
  readonly logger: ServeLogger;
  /** How long a read waits for an index that is being built. */
  readonly indexWaitMs: number;
  readonly hooks?: UsageHooks<M> | undefined;
  /** What the server calls itself and which version it is. */
  readonly server: { readonly name: string; readonly version: string };
}

export interface ToolRequest {
  /**
   * The origin the request came to, where the server's page and icon are; left out for a
   * server with no origin, as over stdio, which then names neither.
   */
  readonly origin?: string | undefined;
  /** The client's network address, as resolved behind trusted proxies; counted, never kept. */
  readonly clientAddress?: string | undefined;
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/** The MCP skills extension this server implements (ADR-0024). */
export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
/** How long a client may keep what a pinned address serves: the commit never changes. */
const PINNED_TTL_MS = 86_400_000;
/** How long a client may keep an answer given while the commit is still being indexed. */
const INDEXING_TTL_MS = 5_000;

function notReady(outcome: IndexNotReady): ToolReply {
  return outcome.status === "indexing"
    ? reply(INDEXING_NOTICE)
    : problem(`This commit could not be indexed (${outcome.errorCode}). Try again later.`);
}

/** The cache fields every list and read result of the current protocol revision carries. */
function cacheHint(
  mount: ServedMount,
  now: Date,
): { ttlMs: number; cacheScope: "public" | "private" } {
  const ttlMs =
    mount.trustedUntil === undefined
      ? PINNED_TTL_MS
      : Math.max(0, mount.trustedUntil.getTime() - now.getTime());
  return { ttlMs, cacheScope: mount.visibility === "public" ? "public" : "private" };
}

/**
 * What was read, for the statistics: a skill's document counts as a load of the skill
 * whichever way it was asked for, and any other file as a read of its path.
 */
export function recordRead<M extends ServedMount>(
  hooks: UsageHooks<M>,
  mount: M,
  indexed: IndexedFile,
): void {
  if (indexed.kind === "skill") {
    hooks.skillLoad?.(mount, indexed.skillDir ?? "");
  } else {
    hooks.fileRead?.(mount, indexed.path);
  }
}

/** One fixed, stateless tool surface for every mount, independent of its skill count. */
export async function createMountServer<M extends ServedMount>(
  mount: M,
  dependencies: ToolDependencies<M>,
  request: ToolRequest = {},
): Promise<McpServer> {
  const { reader, clock, indexWaitMs, logger } = dependencies;
  const hooks = dependencies.hooks ?? {};
  const catalog = await reader.catalog(mount);
  const manifest = catalog.status === "ready" ? catalog.catalog.manifest : undefined;
  const address = formatAddress(mount.address);
  const server = new McpServer(
    {
      name: dependencies.server.name,
      version: dependencies.server.version,
      title:
        manifest?.name ??
        `${mount.repository}${mount.address.path ? `/${mount.address.path}` : ""}`,
      description: compactSummary(
        (catalog.status === "ready" ? catalogDescription(catalog.catalog) : undefined) ??
          mount.description ??
          `Skills and documents from ${mount.repository}.`,
        360,
      ),
      ...(request.origin === undefined
        ? {}
        : {
            websiteUrl: `${request.origin}${address}`,
            // The owner's picture, served from this origin at `ICON_ROUTE` (specs/tools.md): a
            // client fetches a server's icon from the server's own origin and from nowhere else.
            icons: [
              {
                src: `${request.origin}${ICON_ROUTE}${address}`,
                sizes: [`${ICON_SIZE}x${ICON_SIZE}`],
              },
            ],
          }),
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
  // Who used the repository: the client at the request's address, through the app it names in
  // its handshake (the earlier revisions) or in every request (the current one). The SDK gives
  // the name either way; what it gives for a request of the earlier revisions after the
  // handshake is nothing, which the recorder takes as "not said".
  const noteClient = (): void =>
    hooks.client?.(mount, request.clientAddress, server.server.getClientVersion()?.name);
  server.server.oninitialized = () => {
    hooks.connection?.(mount);
    noteClient();
  };
  const record = (subject: string): void => {
    hooks.call?.(mount, subject);
    noteClient();
  };
  const countRead = (indexed: IndexedFile): void => recordRead(hooks, mount, indexed);
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
        logger.error({ err: error, tool }, "tool call failed");
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
        if (input.cursor === undefined) hooks.skillLoad?.(mount, lookup.skill.directory);
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
          if (input.offset === undefined || input.offset === 0) countRead(lookup.indexed);
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
            `${lookup.path} is too large to read here (${lookup.size} bytes; the limit is ${lookup.limit}). Fetch it from the source: ${lookup.sourceUrl}`,
          );
        case "not_text":
          return problem(
            `${lookup.path} is not a UTF-8 text file, which is all this tool carries. Fetch it from the source: ${lookup.sourceUrl}`,
          );
        case "not_served":
          return problem(
            `${lookup.path} is described, not served: its license (${describeLicense(lookup.license)}) allows SkillCDN to say that it exists, not to pass its content on. Read it at its source: ${lookup.sourceUrl}`,
          );
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
  const notIndexed = (outcome: IndexNotReady): ProtocolError =>
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
      logger.error({ err: error, method }, "extension request failed");
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
        hooks.skillLoad?.(mount, answer.directory ?? "");
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
      if (answer.indexed !== undefined) countRead(answer.indexed);
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
