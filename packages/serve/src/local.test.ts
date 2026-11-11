import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import {
  parseAddress,
  type ReadableIndex,
  type RepoPath,
  ROOT_PATH,
  restBrowseSchema,
  restCodeSchema,
  restListedSchema,
  restListingSchema,
  restMountSchema,
  restRowsSchema,
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

  it("lists, gets and reads its skills as the SDK's own skills client verifies them", async () => {
    // A skill whose metadata holds a value YAML would read as a number: the listing serves the
    // front matter as data and the document as YAML, and the client parses the one to compare
    // it with the other, so both have to say the string the author wrote.
    const { mount } = await pack({
      "design/decks/SKILL.md":
        "---\nname: decks\ndescription: Makes a deck from an outline.\nmetadata:\n  version: 2\n  audience: founders\n---\n# Decks\n\nTen slides at most.\n",
    });
    const app = appOf(mount);
    const client = new Client(
      { name: "skillcdn-test", version: "0.0.0" },
      // The current revision, where the cache fields are required and the client checks them.
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://local.test/local/packs/acme"), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      }),
    );
    const skills = new SkillsClient(client);
    expect(skills.supported).toBe(true);
    expect(skills.directoryRead).toBe(true);
    const listing = await skills.list();
    expect(listing.invalid).toEqual([]);
    expect(listing.skills.map((skill) => skill.uri)).toEqual([
      "skill://local/packs/acme/design/decks/SKILL.md",
      "skill://local/packs/acme/marketing/ads/SKILL.md",
    ]);
    expect(listing).toMatchObject({ ttlMs: 0, cacheScope: "private" });
    for (const entry of listing.skills) {
      const got = await skills.get(entry.uri);
      expect(got.skill).toEqual(entry);
      // The skill's own document: its size, digest and front matter checked against the entry.
      const document = await skills.read(entry);
      expect(document.verified).toBe(true);
      expect(document.frontmatter).toEqual(entry.frontmatter);
      expect(document.body).toContain("Be brief.");
    }
    const directory = await skills.readDirectory("skill://local/packs/acme/marketing/ads");
    expect(directory.resources.map((resource) => resource.name)).toEqual(["SKILL.md"]);
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
    expect(first).toContain("Resolved references:\n- docs/guide.md");
    expect(first).not.toContain("marketing/ads/SKILL.md");
    const middle = await call("read_repo_file", { path: "docs/outline.md", ...section(2) });
    expect(middle).not.toContain("Resolved references");
    const whole = await call("read_repo_file", { path: "docs/outline.md" });
    expect(whole).toContain("Resolved references:\n- docs/guide.md\n- marketing/ads/SKILL.md");
    await client.close();
  });

  it("answers the tables and the code blocks of a document as data, and an outline says where (ADR-0080)", async () => {
    // One table in two sections under the same header, and a definition in a notation of its own.
    const codes = [
      "# Codes",
      "",
      "## Codes: A to B",
      "",
      "| Code | Meaning |",
      "|---|---|",
      '| A | open, or "ajar" |',
      "| B | closed |",
      "",
      "## Codes: C to D",
      "",
      "| Code | Meaning |",
      "|---|---|",
      "| C | held |",
      "| D | lost |",
      "",
      "## Definition",
      "",
      "```tln",
      "Code ::= ENUMERATED { a, b, c, d }",
      "```",
      "",
    ].join("\n");
    const { mount } = await pack({ "docs/codes.md": codes });
    const app = appOf(mount);
    const at = "http://local.test/api/v1";
    const rows = async (query: string) => app.request(`${at}/rows/local/packs/acme?${query}`);

    const one = restRowsSchema.parse(await (await rows("path=docs%2Fcodes.md")).json());
    if (one.status !== "ready") throw new Error("not ready");
    expect(one).toMatchObject({ path: "docs/codes.md", rowCount: 4, nextCursor: null });
    expect(one.tables).toEqual([
      {
        path: "docs/codes.md",
        heading: ["Codes", "Codes: A to B"],
        columns: ["Code", "Meaning"],
        rows: [
          ["A", 'open, or "ajar"'],
          ["B", "closed"],
        ],
      },
      {
        path: "docs/codes.md",
        heading: ["Codes", "Codes: C to D"],
        columns: ["Code", "Meaning"],
        rows: [
          ["C", "held"],
          ["D", "lost"],
        ],
      },
    ]);
    // A heading keeps the tables whose heading path holds its words, whatever the case.
    const kept = restRowsSchema.parse(await (await rows("path=docs&heading=c+TO+d")).json());
    if (kept.status !== "ready") throw new Error("not ready");
    expect(kept.tables.map((table) => table.heading.at(-1))).toEqual(["Codes: C to D"]);

    // As CSV the table that stands in two sections is one, under one header.
    const csv = await rows("path=docs%2Fcodes.md&format=csv");
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("x-next-cursor")).toBeNull();
    expect(await csv.text()).toBe(
      [
        "path,heading,Code,Meaning",
        'docs/codes.md,Codes > Codes: A to B,A,"open, or ""ajar"""',
        "docs/codes.md,Codes > Codes: A to B,B,closed",
        "docs/codes.md,Codes > Codes: C to D,C,held",
        "docs/codes.md,Codes > Codes: C to D,D,lost",
        "",
      ].join("\r\n"),
    );

    // A folder is read in pages of whole files: the first file with rows fills a page of one.
    const first = await rows("path=docs&limit=1&format=csv");
    const cursor = first.headers.get("x-next-cursor");
    expect(cursor).not.toBeNull();
    expect((await first.text()).split("\r\n")).toHaveLength(6);
    const rest = restRowsSchema.parse(
      await (await rows(`path=docs&limit=1&cursor=${encodeURIComponent(cursor ?? "")}`)).json(),
    );
    expect(rest).toMatchObject({ status: "ready", tables: [], rowCount: 0, nextCursor: null });

    // What names no document is refused, as a path that leaves the pack and a page limit past the most.
    expect((await rows("path=docs%2Fnothing.md")).status).toBe(404);
    expect((await rows("path=..%2Facme")).status).toBe(400);
    expect((await rows("path=docs&limit=5001")).status).toBe(400);
    expect((await rows("path=docs&format=xml")).status).toBe(400);

    const code = restCodeSchema.parse(
      await (await app.request(`${at}/code/local/packs/acme?path=docs`)).json(),
    );
    if (code.status !== "ready") throw new Error("not ready");
    expect(code.blocks).toEqual([
      {
        path: "docs/codes.md",
        heading: ["Codes", "Definition"],
        language: "tln",
        text: "Code ::= ENUMERATED { a, b, c, d }",
      },
    ]);
    expect((await app.request(`${at}/code/local/packs/acme?path=docs%2Fnothing.md`)).status).toBe(
      404,
    );

    // The outline of the document says what it holds as data and where a program gets it, the
    // rows of each section beside what reads the section.
    const browsed = restBrowseSchema.parse(
      await (await app.request(`${at}/browse/local/packs/acme?path=docs%2Fcodes.md`)).json(),
    );
    if (browsed.status !== "ready") throw new Error("not ready");
    expect(browsed.outline).toMatchObject({
      tables: { count: 2, rows: 4 },
      codeBlocks: 1,
      data: {
        rows: "http://local.test/api/v1/rows/local/packs/acme?path=docs%2Fcodes.md",
        code: "http://local.test/api/v1/code/local/packs/acme?path=docs%2Fcodes.md",
      },
    });
    expect(browsed.outline?.headings.map((heading) => heading.rows)).toEqual([
      undefined,
      2,
      2,
      undefined,
    ]);
    const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://local.test/local/packs/acme"), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      }),
    );
    const outline = text(
      await client.callTool({ name: "browse_repo", arguments: { path: "docs/codes.md" } }),
    );
    expect(outline).toContain(
      "Tables: 2 with 4 rows; as data: http://local.test/api/v1/rows/local/packs/acme?path=docs%2Fcodes.md",
    );
    expect(outline).toContain(
      "Code blocks: 1; as data: http://local.test/api/v1/code/local/packs/acme?path=docs%2Fcodes.md",
    );
    expect(outline).toMatch(/- ## Codes: A to B \(offset \d+, limit \d+; 2 rows\)/);
    expect(outline).toMatch(/- ## Definition \(offset \d+, limit \d+\)/);
    // A document without either says nothing of it.
    const plain = text(
      await client.callTool({ name: "browse_repo", arguments: { path: "docs/guide.md" } }),
    );
    expect(plain).not.toContain("as data");
    await client.close();
  });

  it("resolves a link that names a section to what reads the section (ADR-0082)", async () => {
    const procedures = [
      "# 4 Link control",
      "",
      "## 4.2.6 Link resumption",
      "",
      "A lost link is taken up again.",
      "",
      "### 4.2.6.1 Initiation",
      "",
      "The buoy asks in its next window.",
      "",
      "## 4.2.7 Detection of carrier loss",
      "",
      "A station counts the windows without carrier.",
      "",
    ].join("\n");
    const clauses = Array.from({ length: 14 }, (_, at) => `## 9.${at + 1} Clause\n\nText.\n`);
    const { mount } = await pack({
      "docs/procedures.md": procedures,
      "docs/clauses.md": ["# 9 Clauses", "", ...clauses].join("\n"),
      "docs/overview.md": [
        "# Overview",
        "",
        "Resumption is [4.2.6](procedures.md#4.2.6); the loss is [4.2.7](procedures.md#4.2.7).",
        "The whole chapter is [here](procedures.md), and [the guide](guide.md) says how to read it.",
        "Nothing is numbered [9.99](procedures.md#9.99).",
        "",
      ].join("\n"),
      "docs/index.md": [
        "# Index",
        "",
        ...Array.from({ length: 14 }, (_, at) => `- [9.${at + 1}](clauses.md#9.${at + 1})`),
        "",
      ].join("\n"),
    });
    const app = appOf(mount);
    const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://local.test/local/packs/acme"), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
      }),
    );
    const call = async (name: string, args: Record<string, unknown>): Promise<string> =>
      text(await client.callTool({ name, arguments: args }));

    // The links of the page, by the file each names: a file once, with its sections.
    const overview = await call("read_repo_file", { path: "docs/overview.md" });
    const start = procedures.indexOf("## 4.2.6");
    const next = procedures.indexOf("## 4.2.7");
    expect(overview).toContain(
      [
        "Resolved references; a section is read with read_repo_file: the path, its offset and its limit.",
        `- docs/procedures.md: 4.2.6 (offset ${start}, limit ${next - start}); 4.2.7 (offset ${next}, limit ${procedures.length - next})`,
        "- docs/guide.md",
      ].join("\n"),
    );
    // The section read by what the reference gave: the clause with the clause under it.
    const section = await call("read_repo_file", {
      path: "docs/procedures.md",
      offset: start,
      limit: next - start,
    });
    expect(section).toContain("--- content ---\n## 4.2.6 Link resumption\n");
    expect(section).toContain("### 4.2.6.1 Initiation");
    expect(section).not.toContain("4.2.7 Detection");

    // A dozen links are listed, the rest counted: an index of one chapter names it once.
    const index = await call("read_repo_file", { path: "docs/index.md" });
    expect(index).toMatch(/- docs\/clauses\.md: 9\.1 \(offset \d+, limit \d+\); 9\.2 /);
    expect(index).toContain("; 9.12 (offset ");
    expect(index).not.toContain("9.13 (offset");
    expect(index).toContain("- ... (2 more)");

    // Over REST every reference carries its section, and the one that names none says so in the diagnostics.
    const read = (await (
      await app.request("/api/v1/files/local/packs/acme?path=docs%2Foverview.md")
    ).json()) as {
      references: { href: string; path: string; section?: { offset: number; length: number } }[];
    };
    expect(read.references.map((reference) => [reference.href, reference.section])).toEqual([
      ["procedures.md#4.2.6", { offset: start, length: next - start }],
      ["procedures.md#4.2.7", { offset: next, length: procedures.length - next }],
      ["procedures.md", undefined],
      ["guide.md", undefined],
      ["procedures.md#9.99", undefined],
    ]);
    const browsed = restBrowseSchema.parse(
      await (await app.request("/api/v1/browse/local/packs/acme?path=docs")).json(),
    );
    if (browsed.status !== "ready") throw new Error("not ready");
    expect(browsed.diagnostics).toEqual([
      {
        path: "docs/overview.md",
        code: "fragment_not_found",
        message: expect.stringContaining(
          "a link names a section its file does not have (procedures.md#9.99)",
        ),
      },
    ]);
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
    const refusal = (await refused.json()) as { error: { message: string } };
    expect(refusal).toMatchObject({
      error: {
        code: "file.not_text",
        sourceUrl: "http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fimages%2Fa.png",
      },
    });
    // The pack is one machine's, so the mount is private, but the route asks for no credential:
    // the line a private repository of a git host gets would send the reader looking for one.
    expect(refusal.error.message).not.toContain("credential");
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
    expect(text(read)).not.toContain("credential");
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

describe("the listing of a directory served from a machine (REST)", () => {
  it("lists the skills with their digests, and answers one URI as a skill, a file or a directory", async () => {
    const { mount } = await pack({ "marketing/ads/references/tone.md": "# Tone\n\nFriendly.\n" });
    const app = appOf(mount);
    const base = "http://local.test/api/v1/listing/local/packs/acme";
    const listing = restListingSchema.parse(await (await app.request(base)).json());
    if (listing.status !== "ready") throw new Error("expected a ready index");
    expect(listing.total).toBe(1);
    expect(listing.nextCursor).toBeNull();
    const [ads] = listing.skills;
    if (ads === undefined) throw new Error("expected the ads skill");
    expect(ads.uri).toBe("skill://local/packs/acme/marketing/ads/SKILL.md");
    expect(ads.frontmatter).toMatchObject({ name: "ads" });
    expect(ads.resources.map((resource) => resource.uri).sort()).toEqual([
      "skill://local/packs/acme/marketing/ads/SKILL.md",
      "skill://local/packs/acme/marketing/ads/references/tone.md",
    ]);
    for (const resource of ads.resources) {
      expect(resource.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    const listed = async (uri: string) =>
      restListedSchema.parse(
        await (await app.request(base + "?uri=" + encodeURIComponent(uri))).json(),
      );
    const skill = await listed(ads.uri);
    if (skill.status !== "ready" || skill.item.kind !== "skill")
      throw new Error("expected the skill");
    expect(skill.item.skill).toEqual(ads);
    expect(skill.item.document).toContain("# Ads");
    expect(skill.item.document).toContain("Be brief.");
    expect(skill.item.digest).toBe(
      ads.resources.find((resource) => resource.uri === ads.uri)?.digest,
    );
    const file = await listed("skill://local/packs/acme/marketing/ads/references/tone.md");
    if (file.status !== "ready" || file.item.kind !== "file") throw new Error("expected the file");
    expect(file.item).toMatchObject({
      mimeType: "text/markdown",
      text: "# Tone\n\nFriendly.\n",
      blob: null,
    });
    const directory = await listed("skill://local/packs/acme/marketing/ads");
    if (directory.status !== "ready" || directory.item.kind !== "directory") {
      throw new Error("expected the directory");
    }
    expect(directory.item.resources.map((resource) => resource.name).sort()).toEqual([
      "SKILL.md",
      "references",
    ]);
    const nothing = await app.request(
      base + "?uri=" + encodeURIComponent("skill://local/packs/acme/nothing/SKILL.md"),
    );
    expect(nothing.status).toBe(404);
    expect(await nothing.json()).toMatchObject({ error: { code: "listing.not_found" } });
    // A page and a URI at once is a malformed request.
    expect((await app.request(base + "?cursor=c&uri=x")).status).toBe(400);
    // A working tree is one machine's: nothing of it is kept.
    expect((await app.request(base)).headers.get("cache-control")).toBe("no-store");
  });
});
