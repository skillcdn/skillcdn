import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createHubServer, type HubServerOptions } from "./hub.js";
import { SURFACE_TTL_MS } from "./mount.js";

// What a client is told to keep of what the root of a deployment says of itself: its
// `server/discover` and its list of tools (docs/specs/tools.md).

async function clientOf(
  options: Partial<HubServerOptions>,
  revision: "current" | "earlier" = "current",
): Promise<Client> {
  const handler = createMcpHandler(async () =>
    createHubServer({
      search: async () => {
        throw new Error("no search is made here");
      },
      packs: async () => 3,
      server: { name: "skillcdn", version: "0.0.0-test" },
      logger: { warn: () => {}, error: () => {} },
      origin: "http://deployment.test",
      ...options,
    }),
  );
  const client = new Client(
    { name: "skillcdn-test", version: "0.0.0" },
    revision === "current" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://deployment.test/"), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    }),
  );
  return client;
}

const cacheFields = z.looseObject({
  ttlMs: z.number().optional(),
  cacheScope: z.string().optional(),
});

async function kept(client: Client) {
  const fields = (result: z.infer<typeof cacheFields>) => ({
    ttlMs: result.ttlMs,
    cacheScope: result.cacheScope,
  });
  const answers = {
    discover: fields(cacheFields.parse(await client.discover())),
    tools: fields(await client.request({ method: "tools/list", params: {} }, cacheFields)),
  };
  await client.close();
  return answers;
}

describe("the cache fields of the root of a deployment", () => {
  it("keeps discovery and the list of tools for everyone, as long as the deployment says", async () => {
    const hour = { ttlMs: SURFACE_TTL_MS, cacheScope: "public" };
    const client = await clientOf({ surfaceTtlMs: SURFACE_TTL_MS });
    expect(client.getInstructions()).toContain("3 public packs");
    expect(await kept(client)).toEqual({ discover: hour, tools: hour });
  });

  it("does not have a count kept that could not be had", async () => {
    const client = await clientOf({
      surfaceTtlMs: SURFACE_TTL_MS,
      packs: async () => {
        throw new Error("the database is away");
      },
    });
    expect(client.getInstructions()).toContain("0 public packs");
    expect(await kept(client)).toEqual({
      discover: { ttlMs: 0, cacheScope: "public" },
      tools: { ttlMs: SURFACE_TTL_MS, cacheScope: "public" },
    });
  });

  it("says to keep nothing where whoever composes the server gives no lifetime", async () => {
    const nothing = { ttlMs: 0, cacheScope: "public" };
    expect(await kept(await clientOf({}))).toEqual({ discover: nothing, tools: nothing });
  });

  it("adds nothing to the answers of the revisions before the current one", async () => {
    const client = await clientOf({ surfaceTtlMs: SURFACE_TTL_MS }, "earlier");
    expect(client.getNegotiatedProtocolVersion()).not.toBe("2026-07-28");
    const tools = await client.request({ method: "tools/list", params: {} }, cacheFields);
    await client.close();
    expect(tools).not.toHaveProperty("ttlMs");
    expect(tools).not.toHaveProperty("cacheScope");
  });
});
