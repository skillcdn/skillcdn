import { McpServer } from "@modelcontextprotocol/server";
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
function notReady(outcome: NotReady): ToolReply {
  return outcome.status === "indexing"
    ? reply(INDEXING_NOTICE, { status: "indexing" })
    : problem(`This commit could not be indexed (${outcome.errorCode}). Try again later.`);
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
    { capabilities: { prompts: {} }, instructions: renderInstructions(catalog) },
  );
  server.server.oninitialized = () => stats.count(mount, "connection");
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
      stats.count(mount, "tool_call", tool);
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
          `No skill at ${JSON.stringify(input.path)}. Use browse or search for its exact SKILL.md path.${lookup.available.length === 0 ? "" : ` Available: ${lookup.available.join(", ")}.`}\n${renderDiagnostics(lookup.diagnostics, true) ?? ""}`,
        );
      case "ambiguous":
        return problem("Use the exact SKILL.md path returned by browse or search.");
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
            `This path is a folder. Call browse with path ${JSON.stringify(lookup.directory.path)}.`,
          );
        case "invalid_path":
          return problem(
            `Invalid repository-root path: ${lookup.reason}. Use a path returned by browse or search.`,
          );
        case "not_found":
          return problem(
            `No readable file at ${lookup.path} in this mount. Use browse, or get_skill for resolved references.${lookup.suggestions?.length ? ` Candidates: ${lookup.suggestions.join(", ")}.` : ""}`,
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
        "Load one skill by its repository-root SKILL.md path. Continue get_skill if the context is paged.",
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
  return server;
}
