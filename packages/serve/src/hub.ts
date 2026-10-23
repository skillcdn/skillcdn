import { McpServer } from "@modelcontextprotocol/server";
import {
  HUB_DEFAULT_LIMIT,
  type HubResult,
  renderHubInstructions,
  renderHubResult,
  searchPacksTool,
} from "@skillcdn/core";
import { fitsReply, problem, reply } from "./replies.js";
import type { ServeLogger } from "./tools.js";

// The MCP server of a deployment's root (ADR-0070): one tool, the search across every public pack
// the deployment serves, answering the packs an agent connects to for the rest. The search itself
// is the deployment's; this is its surface, as the mount server is the surface of a reader.

export interface HubServerOptions {
  /** The search across every pack: the query, and how many results at most. */
  readonly search: (query: string, limit: number) => Promise<HubResult>;
  /** How many packs the search covers right now, for the instructions. */
  readonly packs: () => Promise<number>;
  /** What the server calls itself and which version it is. */
  readonly server: { readonly name: string; readonly version: string };
  readonly logger: ServeLogger;
  /** The origin the request came to, where the packs are; left out, the instructions name none. */
  readonly origin?: string | undefined;
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/** One stateless tool surface for the root of a deployment. One instance per connection or request. */
export async function createHubServer(options: HubServerOptions): Promise<McpServer> {
  const { search, logger, origin } = options;
  const packs = await options.packs().catch((error: unknown) => {
    logger.warn({ err: error }, "the packs could not be counted for the instructions");
    return 0;
  });
  const server = new McpServer(
    {
      name: options.server.name,
      version: options.server.version,
      title: "Every pack served here",
      description:
        "Search across every public pack this deployment serves, and connect to a pack by its address for its skills and documents.",
      ...(origin === undefined ? {} : { websiteUrl: origin }),
    },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: renderHubInstructions(packs, origin),
    },
  );
  server.registerTool(
    searchPacksTool.name,
    { ...searchPacksTool, annotations: READ_ONLY },
    async (input) => {
      try {
        let limit = input.limit ?? HUB_DEFAULT_LIMIT;
        const result = await search(input.query, limit);
        let answer = reply(renderHubResult(result, origin));
        // A page is cut to what the context budget takes, as the mount's tools cut theirs.
        while (!fitsReply(answer) && limit > 1) {
          limit = Math.ceil(limit / 2);
          answer = reply(
            renderHubResult({ ...result, items: result.items.slice(0, limit) }, origin),
          );
        }
        return answer;
      } catch (error) {
        logger.error({ err: error, tool: searchPacksTool.name }, "tool call failed");
        return problem("The search failed on the server side. Try again later.");
      }
    },
  );
  return server;
}
