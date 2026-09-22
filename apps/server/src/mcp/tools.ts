import { McpServer } from "@modelcontextprotocol/server";
import {
  type CatalogSkill,
  type Clock,
  describeFindTool,
  findTool,
  formatAddress,
  GitHostError,
  getTool,
  INDEXING_NOTICE,
  joinRepoPath,
  readFileTool,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderInstructions,
  renderSkillResult,
  type UsageSink,
} from "@skillcdn/core";
import type { Logger } from "../logger.js";
import type { MountReader, NotReady } from "../mounts/mount-reader.js";
import type { Mount } from "../mounts/mount-service.js";
import type { UsageStats } from "../stats/usage-recorder.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

export interface ToolDependencies {
  readonly reader: MountReader;
  readonly usage: UsageSink;
  /** Daily counts per public repository, for everyone to see. Not the same as `usage`. */
  readonly stats: UsageStats;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How long `find` and `get` wait for an index that is still being built. */
  readonly indexWaitMs: number;
  /** Where the pages live, for the link a client may show. Unset: the origin of each request. */
  readonly publicUrl: string | undefined;
}

interface ToolReply {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const reply = (text: string): ToolReply => ({ content: [{ type: "text", text }] });
/** A problem the model can act on. It is a tool result, not a protocol error. */
const problem = (text: string): ToolReply => ({ content: [{ type: "text", text }], isError: true });

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function notReady(outcome: NotReady): ToolReply {
  if (outcome.status === "indexing") {
    return reply(INDEXING_NOTICE);
  }
  return problem(
    `This commit could not be indexed (${outcome.errorCode}). It is retried automatically; try again later. read_file still works.`,
  );
}

/** A prompt is named after its skill; skills that share a name are named after their directory. */
function promptNameOf(skill: CatalogSkill, skills: readonly CatalogSkill[]): string {
  const shared = skills.some((other) => other !== skill && other.name === skill.name);
  return shared && skill.directory.length > 0 ? skill.directory.replaceAll("/", "-") : skill.name;
}

/** How a client may show the server: the repository, then the ref and the path when there are any. */
function titleOf(mount: Mount): string {
  const { repository } = mount.repo;
  const ref = mount.address.ref;
  const refPart =
    ref === undefined ? "" : `@${ref.kind === "commit" ? ref.hash.slice(0, 7) : ref.name}`;
  const pathPart = mount.address.path.length === 0 ? "" : `/${mount.address.path}`;
  return `${repository.owner.login}/${repository.name}${refPart}${pathPart}`;
}

/**
 * Builds the MCP server for one request: the fixed tool set, bound to one resolved mount, and
 * told what the mount holds so that the client learns it as it connects.
 */
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
      stats.count(mount, "tool_call", tool);
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

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      // A repository with a manifest is shown under the name it gives itself.
      title: manifest?.name ?? titleOf(mount),
      description:
        manifest?.description ??
        `The skills and documents of ${repository}, served over MCP by SkillCDN.`,
      websiteUrl: `${request.origin}${formatAddress(mount.address)}`,
    },
    // Prompts are declared even while the index is being built, so that every client sees the
    // same shape of server; the list is empty until then.
    { capabilities: { prompts: {} }, instructions: renderInstructions(catalog) },
  );

  // Requests share no session, so a connection is counted when a client says it has finished
  // introducing itself, which it does once.
  server.server.oninitialized = () => stats.count(mount, "connection");

  server.registerTool(
    findTool.name,
    {
      title: findTool.title,
      description: describeFindTool(catalog),
      inputSchema: findTool.inputSchema,
      annotations: READ_ONLY,
    },
    guarded(findTool.name, async (input) => {
      const found = await reader.find(mount, input, indexWaitMs);
      return found.status === "ready" ? reply(renderFindResult(found.result)) : notReady(found);
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
      const answer = await reader.skill(mount, input.name, indexWaitMs);
      if (answer.status !== "ready") {
        return notReady(answer);
      }
      const { lookup } = answer;
      const name = JSON.stringify(input.name.trim());
      switch (lookup.kind) {
        case "found":
          // Counted by where the skill lives in the repository, whatever directory was mounted.
          stats.count(
            mount,
            "skill_load",
            joinRepoPath(mount.address.path, lookup.skill.directory),
          );
          return reply(renderSkillResult(lookup.skill));
        case "not_found":
          return problem(
            lookup.available.length === 0
              ? `No skill named ${name}. This mount has no skills; use find and read_file to read its documents.`
              : `No skill named ${name}. Available skills: ${lookup.available.join(", ")}.`,
          );
        case "ambiguous":
          return problem(
            `Several skills are named ${name}. Call get with one of these directories as the name: ${lookup.directories.join(", ")}.`,
          );
        case "unavailable":
          return problem("The skill is indexed but its content is not available. Try again later.");
      }
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
      const lookup = await reader.file(mount, input);
      switch (lookup.kind) {
        case "found":
          return reply(renderFileResult(lookup.file));
        case "directory":
          return reply(renderDirectoryResult(lookup.directory));
        case "invalid_path":
          return problem(
            `Not a valid path: ${lookup.reason}. Paths are relative to the mounted root, for example skills/ads/SKILL.md.`,
          );
        case "not_found":
          return problem(
            `No file at ${lookup.path}. Use find to search, or get to see the files of a skill.`,
          );
        case "too_large":
          return problem(
            `${lookup.path} is too large to read (${lookup.size} bytes; the limit is ${lookup.limit}).`,
          );
        case "not_text":
          return problem(`${lookup.path} is not a UTF-8 text file, so it cannot be read here.`);
      }
    }),
  );

  // Every skill is also a prompt, so that a person can call one up by name in a client that
  // turns prompts into commands. The list is what the index knows as the client connects.
  if (catalog.status === "ready") {
    const { skills } = catalog.catalog;
    const taken = new Set<string>();
    for (const skill of skills) {
      const name = promptNameOf(skill, skills);
      if (taken.has(name)) {
        continue;
      }
      taken.add(name);
      const wanted = skill.directory.length === 0 ? skill.name : skill.directory;
      server.registerPrompt(
        name,
        { title: skill.name, description: skill.description },
        async () => {
          usage.record({
            type: "tool_call",
            at: clock.now(),
            hostAccountId: mount.repo.repository.owner.hostAccountId,
            hostRepoId: mount.repo.repository.hostRepoId,
            subject: "prompt",
            quantity: 1,
            unit: "call",
          });
          stats.count(mount, "tool_call", "prompt");
          let text: string;
          try {
            const answer = await reader.skill(mount, wanted, indexWaitMs);
            if (answer.status !== "ready") {
              text = notReady(answer).content[0]?.text ?? INDEXING_NOTICE;
            } else if (answer.lookup.kind !== "found") {
              text = `The skill ${skill.name} is not available right now. Call get with the name ${JSON.stringify(wanted)} to load it.`;
            } else {
              stats.count(
                mount,
                "skill_load",
                joinRepoPath(mount.address.path, answer.lookup.skill.directory),
              );
              text = renderSkillResult(answer.lookup.skill);
            }
          } catch (error) {
            log.error({ err: error, prompt: name }, "prompt failed");
            text = "The skill could not be loaded on the server side. Try again later.";
          }
          return {
            description: skill.description,
            messages: [{ role: "user", content: { type: "text", text } }],
          };
        },
      );
    }
  }

  return server;
}
