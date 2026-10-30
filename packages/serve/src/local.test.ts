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
import { INDEX_LIMIT_DEFAULTS, openWorkingTreeFile, readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, Reader } from "@skillcdn/reader";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createLocalApp, localMountBody, serveOverStdio } from "./local.js";
import type { ServedMount } from "./mount.js";
import { clientAppOf, registerAddressRoutes } from "./rest.js";

// A directory served from a machine, as an MCP client and a REST client meet it: the tools,
// the prompt, the skills extension and the address routes, over an index in memory.

interface LocalMount extends ServedMount {
  readonly index: ReadableIndex;
}

const OUTLINE_SECTIONS = 25;

/** A document of more headings than a folder page lists, with a link in its first and last section. */
function outlineDocument(): string {
  const sections = Array.from({ length: OUTLINE_SECTIONS }, (_, index) => {
    const number = index + 1;
    const link =
      number === 1
        ? " It opens with [the guide](guide.md)."
        : number === OUTLINE_SECTIONS
          ? " It ends with [the ads](../marketing/ads/SKILL.md)."
          : "";
    return `## Section ${number}\n\nThe text of section ${number}.${link}\n`;
  });
  return ["# Outline", "", "A guide with many headings.", "", ...sections].join("\n");
}

async function pack(
  extra: Record<string, string | Uint8Array> = {},
): Promise<{ readonly root: string; readonly mount: LocalMount }> {
  const parent = await mkdtemp(join(tmpdir(), "skillcdn-serve-"));
  const root = join(parent, "acme");
  const files: Record<string, string | Uint8Array> = {
    "SKILLCDN.md": "---\nname: Acme skills\ndescription: The skills of Acme.\n---\nBe brief.\n",
    "marketing/ads/SKILL.md":
      "---\nname: ads\ndescription: Writes ad copy for a product page.\n---\n# Ads\n\nWrite three variants.\n",
    "docs/guide.md": "# Guide\n\nHow the skills are used.\n",
    "docs/outline.md": outlineDocument(),
    ...extra,
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

  it("outlines a file in one page and tells a section read only of its own links", async () => {
    const { mount } = await pack();
    const app = appOf(mount);
    const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://local.test/local/packs/acme"), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      }),
    );
    const call = async (name: string, args: Record<string, unknown>): Promise<string> =>
      text(await client.callTool({ name, arguments: args }));
    // An outline page holds what the response budget takes, not the twenty entries of a folder page.
    const outline = await call("browse_repo", { path: "docs/outline.md" });
    expect(outline).toContain(`; ${OUTLINE_SECTIONS + 1} headings)`);
    expect(outline).toContain(`- ## Section ${OUTLINE_SECTIONS} (offset `);
    expect(outline).not.toContain("nextCursor");
    const section = (number: number): { offset: number; limit: number } => {
      const found = new RegExp(`- ## Section ${number} \\(offset (\\d+), limit (\\d+)\\)`).exec(
        outline,
      );
      if (found === null) throw new Error(`section ${number} is not in the outline`);
      return { offset: Number(found[1]), limit: Number(found[2]) };
    };
    // A section read delivers the range it was asked for, and is told where the file goes on,
    // not that more follows; it lists the links of its own text and no other.
    const first = await call("read_repo_file", { path: "docs/outline.md", ...section(1) });
    expect(first).toContain("--- content ---\n## Section 1\n");
    expect(first).toContain("The file continues at offset ");
    expect(first).not.toContain("More follows");
    expect(first).toContain("- guide.md -> docs/guide.md (available)");
    expect(first).not.toContain("marketing/ads/SKILL.md");
    const middle = await call("read_repo_file", { path: "docs/outline.md", ...section(2) });
    expect(middle).not.toContain("Resolved references");
    const whole = await call("read_repo_file", { path: "docs/outline.md" });
    expect(whole).toContain("- guide.md -> docs/guide.md (available)");
    expect(whole).toContain("- ../marketing/ads/SKILL.md -> marketing/ads/SKILL.md (available)");
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
  it("counts the reads through the routes as the tools count theirs, with the app the user agent names", async () => {
    const { mount } = await pack();
    const calls: string[] = [];
    const loads: string[] = [];
    const reads: string[] = [];
    const clients: string[] = [];
    const app = new Hono();
    registerAddressRoutes(app, {
      reader: options().reader,
      logger: options().logger,
      mountAt: async () => mount,
      mountBody: localMountBody,
      clientAddress: (c) => c.req.header("x-test-peer"),
      hooks: {
        call: (_mount, subject) => calls.push(subject),
        skillLoad: (_mount, directory) => loads.push(directory),
        fileRead: (_mount, path) => reads.push(path),
        client: (_mount, address, named) => clients.push(`${address ?? "-"} ${named ?? "-"}`),
      },
    });
    const read = (path: string, agent?: string, peer = "203.0.113.7") =>
      app.request(path, {
        headers: { ...(agent === undefined ? {} : { "user-agent": agent }), "x-test-peer": peer },
      });
    const cli = "skillcdn-cli/0.2.0 (node 24.0.0; linux)";
    const at = "/local/packs/acme";
    expect((await read(`/api/v1/mounts${at}`, cli)).status).toBe(200);
    expect((await read(`/api/v1/browse${at}?path=marketing`, cli)).status).toBe(200);
    expect((await read(`/api/v1/find${at}?query=ad`, cli)).status).toBe(200);
    expect((await read(`/api/v1/skills${at}?path=marketing%2Fads%2FSKILL.md`, cli)).status).toBe(
      200,
    );
    // A skill that is not there is a call and no load.
    expect((await read(`/api/v1/skills${at}?path=marketing%2Fseo%2FSKILL.md`, cli)).status).toBe(
      404,
    );
    expect((await read(`/api/v1/files${at}?path=docs%2Fguide.md`, cli)).status).toBe(200);
    // The next page of a file is the same read; a skill's document read as a file is a load of
    // the skill.
    expect(
      (await read(`/api/v1/files${at}?path=docs%2Fguide.md&offset=5&limit=5`, cli)).status,
    ).toBe(200);
    expect((await read(`/api/v1/files${at}?path=marketing%2Fads%2FSKILL.md`, cli)).status).toBe(
      200,
    );
    // A browser, whichever it is, and a program that says nothing of itself.
    const browser =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    await read(`/api/v1/mounts${at}`, browser, "203.0.113.8");
    await read(`/api/v1/mounts${at}`, undefined, "203.0.113.9");
    expect(calls).toEqual([
      "rest/mounts",
      "rest/browse",
      "rest/find",
      "rest/skills",
      "rest/skills",
      "rest/files",
      "rest/files",
      "rest/files",
      "rest/mounts",
      "rest/mounts",
    ]);
    expect(loads).toEqual(["marketing/ads", "marketing/ads"]);
    expect(reads).toEqual(["docs/guide.md"]);
    expect(clients.slice(0, 2)).toEqual(["203.0.113.7 skillcdn-cli", "203.0.113.7 skillcdn-cli"]);
    expect(clients.slice(-2)).toEqual(["203.0.113.8 browser", "203.0.113.9 -"]);
    expect(clientAppOf("curl/8.5.0")).toBe("curl");
    expect(clientAppOf("node")).toBe("node");
    expect(clientAppOf("  ")).toBeUndefined();
  });
});

describe("the bytes of a file served from a machine (ADR-0077)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const pictured = () =>
    pack({
      "docs/ch3.md": "# Chapter 3\n\n![A figure](images/a.png)\n",
      "docs/images/a.png": PNG,
    });

  it("sends a served file as an attachment from its own route, and names that route over HTTP", async () => {
    const { root, mount } = await pictured();
    const app = createLocalApp({
      mounts: [mount],
      ...options(),
      rawFile: (_mount, path) => openWorkingTreeFile(root, path),
    });
    const sent = await app.request(
      "http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fimages%2Fa.png",
    );
    expect(sent.status).toBe(200);
    expect(sent.headers.get("content-type")).toBe("application/octet-stream");
    expect(sent.headers.get("content-disposition")).toBe(
      `attachment; filename="a.png"; filename*=UTF-8''a.png`,
    );
    expect(sent.headers.get("x-content-type-options")).toBe("nosniff");
    expect(sent.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(sent.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(PNG);
    // What is not a file of the pack is not sent, whatever is on the disk beside the pack.
    expect(
      (await app.request("http://local.test/api/v1/raw/local/packs/acme?path=nothing.png")).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "http://local.test/api/v1/raw/local/packs/acme?path=..%2Facme%2FSKILLCDN.md",
        )
      ).status,
    ).toBe(400);
    // A read of the picture sends the reader to that route, at the origin it asked at.
    const refused = await app.request(
      "http://local.test/api/v1/files/local/packs/acme?path=docs%2Fimages%2Fa.png",
    );
    expect(refused.status).toBe(415);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "file.not_text",
        sourceUrl: "http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fimages%2Fa.png",
      },
    });
    const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://local.test/local/packs/acme"), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      }),
    );
    const read = await client.callTool({
      name: "read_repo_file",
      arguments: { path: "docs/images/a.png" },
    });
    expect(read.isError).toBe(true);
    expect(text(read)).toContain(
      "Fetch it from the source: http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fimages%2Fa.png",
    );
    // The outline of the chapter names its picture with its words.
    const outlined = await client.callTool({
      name: "browse_repo",
      arguments: { path: "docs/ch3.md" },
    });
    expect(text(outlined)).toContain(
      "1 image, read as text where the document describes them:\n- docs/images/a.png: A figure",
    );
    await client.close();
  });

  it("sends the reader to the source where it has no bytes to send", async () => {
    const { mount } = await pictured();
    const app = appOf(mount);
    const sent = await app.request(
      "http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fimages%2Fa.png",
      { redirect: "manual" },
    );
    expect(sent.status).toBe(302);
    expect(sent.headers.get("location")).toBe(
      "http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fimages%2Fa.png",
    );
  });
});
