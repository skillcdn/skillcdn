import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  parseAddress,
  type ReadableIndex,
  type RepoPath,
  ROOT_PATH,
  restBrowseSchema,
  restMountSchema,
  restSkillSchema,
} from "@skillcdn/core";
import { INDEX_LIMIT_DEFAULTS, readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, Reader } from "@skillcdn/reader";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createLocalApp, serveOverStdio } from "./local.js";
import type { ServedMount } from "./mount.js";

// A directory served from a machine, as an MCP client and a REST client meet it: the tools,
// the prompt, the skills extension and the address routes, over an index in memory.

interface LocalMount extends ServedMount {
  readonly index: ReadableIndex;
}

async function pack(): Promise<{ readonly root: string; readonly mount: LocalMount }> {
  const parent = await mkdtemp(join(tmpdir(), "skillcdn-serve-"));
  const root = join(parent, "acme");
  const files: Record<string, string> = {
    "SKILLCDN.md": "---\nname: Acme skills\ndescription: The skills of Acme.\n---\nBe brief.\n",
    "marketing/ads/SKILL.md":
      "---\nname: ads\ndescription: Writes ad copy for a product page.\n---\n# Ads\n\nWrite three variants.\n",
    "docs/guide.md": "# Guide\n\nHow the skills are used.\n",
  };
  for (const [file, contents] of Object.entries(files)) {
    const parts = file.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  const read = await readDirectory({
    directory: root,
    limits: INDEX_LIMIT_DEFAULTS,
    repository: { owner: "packs", name: "acme" },
  });
  const address = parseAddress("/local/packs/acme");
  if (!address.ok) throw new Error("invalid test address");
  const fileUrl = (path: RepoPath): string =>
    pathToFileURL(path.length === 0 ? root : join(root, ...path.split("/"))).href;
  const mount: LocalMount = {
    address: { ...address.value, path: ROOT_PATH },
    commit: read.commit,
    verified: true,
    limits: {},
    repository: "packs/acme",
    description: undefined,
    sourceUrl: fileUrl,
    rawUrl: fileUrl,
    trustedUntil: new Date(0),
    visibility: "private",
    index: createMemoryIndex({ index: read.index, blobs: read.blobs }),
  };
  return { root, mount };
}

const options = () => ({
  reader: new Reader<LocalMount>({
    limits: INDEX_LIMIT_DEFAULTS,
    index: async (served) => ({ status: "ready", index: served.index }),
  }),
  clock: { now: () => new Date("2026-10-18T00:00:00Z") },
  logger: { warn: () => {}, error: () => {} },
  server: { name: "skillcdn", version: "0.0.0-test" },
});

function appOf(mount: LocalMount) {
  return createLocalApp({ mounts: [mount], ...options() });
}

/** The responses on a stream, one JSON object per line, by id. */
function responsesOf(stream: PassThrough): (id: number) => Promise<Record<string, unknown>> {
  const waiting = new Map<number, (value: Record<string, unknown>) => void>();
  const arrived = new Map<number, Record<string, unknown>>();
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim().length === 0) {
        continue;
      }
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.id !== "number") {
        continue;
      }
      const waiter = waiting.get(message.id);
      if (waiter === undefined) {
        arrived.set(message.id, message);
      } else {
        waiting.delete(message.id);
        waiter(message);
      }
    }
  });
  return (id) => {
    const known = arrived.get(id);
    if (known !== undefined) {
      arrived.delete(id);
      return Promise.resolve(known);
    }
    return new Promise((resolve) => {
      waiting.set(id, resolve);
    });
  };
}

const text = (result: { content?: unknown }): string => {
  const content = result.content as { type: string; text?: string }[] | undefined;
  return content?.map((block) => block.text ?? "").join("") ?? "";
};

describe("a directory served from a machine", () => {
  it("serves the tools, the prompt and the skills extension to an MCP client", async () => {
    const { mount } = await pack();
    const app = appOf(mount);
    const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://local.test/local/packs/acme"), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "browse_repo",
      "load_skill",
      "read_repo_file",
      "search_repo",
    ]);
    expect(client.getInstructions()).toContain("Acme skills: The skills of Acme.");
    const loaded = await client.callTool({
      name: "load_skill",
      arguments: { path: "marketing/ads/SKILL.md" },
    });
    expect(text(loaded)).toContain("Skill: ads");
    expect(text(loaded)).toContain("--- applicable rules: SKILLCDN.md ---\nBe brief.");
    expect(text(loaded)).toContain("--- instructions ---\n# Ads");
    expect(text(loaded)).not.toContain("Unverified repository content");
    const found = await client.callTool({ name: "search_repo", arguments: { query: "ad copy" } });
    expect(text(found)).toContain("1. skill: ads (marketing/ads/SKILL.md)");
    const read = await client.callTool({
      name: "read_repo_file",
      arguments: { path: "docs/guide.md" },
    });
    expect(text(read)).toContain("--- content ---\n# Guide");
    const skills = await client.request(
      { method: "skills/list", params: {} },
      z.object({
        skills: z.array(z.object({ uri: z.string() })),
        ttlMs: z.number(),
        cacheScope: z.string(),
      }),
    );
    expect(skills.skills.map((skill) => skill.uri)).toEqual([
      "skill://local/packs/acme/marketing/ads/SKILL.md",
    ]);
    // A working tree may change at any moment, and is one machine's own.
    expect(skills.ttlMs).toBe(0);
    expect(skills.cacheScope).toBe("private");
    await client.close();
  });

  it("answers the REST routes of the address, and nothing at another", async () => {
    const { mount } = await pack();
    const app = appOf(mount);
    const mounted = restMountSchema.parse(
      await (await app.request("/api/v1/mounts/local/packs/acme")).json(),
    );
    expect(mounted.address).toBe("/local/packs/acme");
    expect(mounted.repository.host).toBe("local");
    expect(mounted.verified).toBe(true);
    if (mounted.index.status !== "ready") throw new Error("not ready");
    expect(mounted.index.skills.map((skill) => skill.path)).toEqual(["marketing/ads/SKILL.md"]);
    const browsed = restBrowseSchema.parse(
      await (await app.request("/api/v1/browse/local/packs/acme?path=marketing")).json(),
    );
    if (browsed.status !== "ready") throw new Error("not ready");
    expect(browsed.entries.map((entry) => entry.path)).toEqual(["marketing/ads/SKILL.md"]);
    const skill = restSkillSchema.parse(
      await (
        await app.request("/api/v1/skills/local/packs/acme?path=marketing%2Fads%2FSKILL.md")
      ).json(),
    );
    if (skill.status !== "ready") throw new Error("not ready");
    expect(skill.skill.name).toBe("ads");
    expect(skill.commit).toBe("0".repeat(40));
    const elsewhere = await app.request("/api/v1/mounts/local/packs/other");
    expect(elsewhere.status).toBe(404);
    const pinned = await app.request("/api/v1/mounts/local/packs/acme@main");
    expect(pinned.status).toBe(404);
    const home = await app.request("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("/local/packs/acme  packs/acme");
  });
  it("serves one mount to the client at the other end of standard input and output", async () => {
    const { mount } = await pack();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const answer = responsesOf(stdout);
    const served = await serveOverStdio(mount, { ...options(), stdin, stdout });
    const ask = (id: number, method: string, params: unknown): Promise<Record<string, unknown>> => {
      const waited = answer(id);
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return waited;
    };
    const initialized = await ask(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "skillcdn-test", version: "0.0.0" },
    });
    const serverInfo = (initialized.result as { serverInfo: { name: string } }).serverInfo;
    expect(serverInfo.name).toBe("skillcdn");
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await ask(2, "tools/list", {});
    const names = (tools.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names.sort()).toEqual(["browse_repo", "load_skill", "read_repo_file", "search_repo"]);
    const loaded = await ask(3, "tools/call", {
      name: "load_skill",
      arguments: { path: "marketing/ads/SKILL.md" },
    });
    expect(text(loaded.result as { content?: unknown })).toContain("Skill: ads");
    // The client closes its end: the transport closes, and the command may return.
    stdin.end();
    await served.closed;
  });
});
