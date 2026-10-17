import type { McpServer } from "@modelcontextprotocol/server";
import type { Clock, UsageSink } from "@skillcdn/core";
import type { Reader } from "@skillcdn/reader";
import { createMountServer as createServedMountServer, type UsageHooks } from "@skillcdn/serve";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";
import type { UsageStats } from "../stats/usage-recorder.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

// The MCP surface of this deployment: the tools and the skills extension of @skillcdn/serve
// over the deployment's reader, with what the deployment counts of their use (ADR-0050) as the
// hooks the package offers.

export interface ToolDependencies {
  readonly reader: Reader<Mount>;
  readonly usage: UsageSink;
  readonly stats: UsageStats;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly indexWaitMs: number;
  readonly publicUrl: string | undefined;
}

export { SKILLS_EXTENSION } from "@skillcdn/serve";

/** What the deployment counts of what an agent does with a mount, over MCP and over the REST API alike. */
export function usageHooksOf(
  dependencies: Pick<ToolDependencies, "usage" | "stats" | "clock">,
): UsageHooks<Mount> {
  const { usage, stats, clock } = dependencies;
  return {
    connection: (mount) => stats.count(mount, "connection"),
    call: (mount, subject) => {
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
    },
    skillLoad: (mount, directory) => stats.count(mount, "skill_load", directory),
    fileRead: (mount, path) => stats.count(mount, "file_read", path),
    client: (mount, address, app) => stats.client(mount, address, app),
  };
}

/** One fixed, stateless tool surface for every repository, independent of its skill count. */
export async function createMountServer(
  mount: Mount,
  dependencies: ToolDependencies,
  request: {
    readonly origin: string;
    /** The client's network address, as resolved behind trusted proxies; counted, never kept. */
    readonly clientAddress?: string | undefined;
  },
): Promise<McpServer> {
  const log = dependencies.logger.child({
    repo: mount.repository,
    commit: mount.commit,
    account: mount.repo.accountId,
  });
  return createServedMountServer(
    mount,
    {
      reader: dependencies.reader,
      clock: dependencies.clock,
      logger: log,
      indexWaitMs: dependencies.indexWaitMs,
      hooks: usageHooksOf(dependencies),
      server: { name: SERVER_NAME, version: SERVER_VERSION },
    },
    request,
  );
}
