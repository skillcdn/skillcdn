import type { Client } from "@modelcontextprotocol/client";
import {
  type BrowseResult,
  type FileResult,
  type FindResult,
  restErrorSchema,
  restMountSchema,
  type SkillResult,
} from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness } from "./testing/harness.js";

const MAX_REPLY_BYTES = 24_576;
let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await database?.drop();
});

const manifest = (body = "", fields = ""): string =>
  `---\ndescription: Collection guidance.\ndocuments: []\n${fields}---\n${body}`;
const skill = (
  body: string,
  name = "write",
  fields = "",
  description = "Practical guidance.",
): string => `---\nname: ${name}\ndescription: ${description}\n${fields}---\n${body}`;

function repository(variant: string, files: Record<string, string>) {
  const fixture = createFixtureHost(variant);
  const host = {
    ...fixture,
    async getTree(...args: Parameters<typeof fixture.getTree>) {
      const tree = await fixture.getTree(...args);
      // Added files replace fixture paths, just as one git tree has one entry per path.
      return {
        ...tree,
        entries: [...new Map(tree.entries.map((entry) => [entry.path, entry])).values()],
      };
    },
  };
  for (const [path, text] of Object.entries(files))
    host.addFile(path, new TextEncoder().encode(text));
  return {
    host,
    h: createHarness(database, {
      host,
      indexWaitMs: 100,
      entitlements: {
        check: async () => ({
          allowed: true,
          limits: { maxIndexedFiles: 500, maxReadableFileBytes: 262_144 },
        }),
      },
    }),
    address: `/gh/acme/multi-skill@${fixtureCommits(variant).main}`,
  };
}

async function ready(h: Harness, address: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = restMountSchema.parse(await (await h.request(`/api/v1/mounts${address}`)).json());
    if (body.index.status === "ready") return;
    await h.snapshots.idle();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("fixture index did not become ready");
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(MAX_REPLY_BYTES);
  return result;
}

function data<T>(result: Awaited<ReturnType<typeof call>>): T {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as unknown as T;
}

describe("MCP discovery with bounded optional context", () => {
  it("offers original README introductions only for already discoverable folders", async () => {
    const rootReadme = "# Original overview\n\nOverviewquartz helps choose a skill.\n";
    const { h, address } = repository("mcp-readme-discovery", {
      "README.md": rootReadme,
      "README.ko.md": "# Translationonlyquartz\n",
      "department/README.md": "# Department introduction\n\nChoose a writing task.\n",
      "department/write/SKILL.md": skill("Write the requested document."),
      "source/README.md": "# Source internals\n",
      ".hidden/README.md": "# Hidden internals\n",
    });
    await ready(h, address);
    const client = await h.connect(address);
    try {
      const root = data<BrowseResult>(await call(client, "browse_repo", {}));
      expect(root.overview).toMatchObject({ path: "README.md", title: "Original overview" });
      expect(root.entries.find((entry) => entry.path === "department")).toMatchObject({
        overviewPath: "department/README.md",
        description: "Choose a writing task.",
      });
      for (const path of ["source", ".hidden"]) {
        expect(root.entries.map((entry) => entry.path)).not.toContain(path);
      }
      expect(root.entries.map((entry) => entry.path)).not.toContain("README.md");
      const folder = data<BrowseResult>(await call(client, "browse_repo", { path: "department" }));
      expect(folder.overview?.path).toBe("department/README.md");
      expect(
        data<FileResult>(await call(client, "read_repo_file", { path: "README.md" })).content,
      ).toBe(rootReadme);
      for (const path of ["README.ko.md", "source/README.md", ".hidden/README.md"]) {
        expect((await call(client, "read_repo_file", { path })).isError).toBe(true);
      }
      const loaded = data<SkillResult>(
        await call(client, "load_skill", { path: "department/write/SKILL.md" }),
      );
      expect(loaded.body).toBe("Write the requested document.");
      expect(loaded.ruleChain ?? []).toEqual([]);
      expect(loaded.included).toEqual([]);
      expect(JSON.stringify(loaded)).not.toContain("Overviewquartz");
      for (const query of ["overviewquartz", "translationonlyquartz"]) {
        expect(data<FindResult>(await call(client, "search_repo", { query })).items).toEqual([]);
      }
    } finally {
      await client.close();
    }
  });

  it("enforces local fixture exclusions on discovery, links, includes and nested mounts", async () => {
    const excluded = "internal/.fixtures";
    const skillPath = `${excluded}/sample/SKILL.md`;
    const { h, address } = repository("mcp-fixture-exclusion", {
      [`${excluded}/SKILLCDN.md`]: manifest(
        "Hidden collection rules.",
        "name: Hiddenquartz\nexclude: [.]\n",
      ),
      [skillPath]: skill("Hidden fixture instructions."),
      [`${excluded}/README.md`]: "# Hiddenquartz introduction\n",
      [`${excluded}/broken/SKILL.md`]: "An intentionally invalid fixture.",
      [`${excluded}/nested/SKILLCDN.md`]: "An intentionally invalid policy.",
      "public/write/SKILL.md": skill(
        `[Fixture](/${excluded}/README.md)`,
        "write",
        "skillcdn:\n  include: [private.md]\n",
      ),
      "public/write/SKILLCDN.md": manifest("", "exclude: [private.md]\n"),
      "public/write/private.md": "Hiddenquartz required file must stay private.",
    });
    await ready(h, address);
    const client = await h.connect(address);
    const nested = await h.connect(`${address}/${excluded}`);
    try {
      const root = data<BrowseResult>(await call(client, "browse_repo", {}));
      expect(root.entries.map((entry) => entry.path)).not.toContain("internal");
      expect(root.diagnostics ?? []).toEqual([]);
      expect(JSON.stringify(root)).not.toContain("Hiddenquartz");
      const hidden = data<BrowseResult>(await call(nested, "browse_repo", {}));
      expect(hidden.entries).toEqual([]);
      expect(hidden.diagnostics ?? []).toEqual([]);
      expect(JSON.stringify(hidden)).not.toContain("Hiddenquartz");
      const mount = restMountSchema.parse(
        await (await h.request(`/api/v1/mounts${address}/${excluded}`)).json(),
      );
      expect(JSON.stringify(mount)).not.toContain("Hiddenquartz");
      for (const target of [client, nested]) {
        expect((await call(target, "load_skill", { path: skillPath })).isError).toBe(true);
        for (const path of [skillPath, `${excluded}/README.md`, `${excluded}/SKILLCDN.md`]) {
          expect((await call(target, "read_repo_file", { path })).isError).toBe(true);
        }
      }
      const loaded = data<SkillResult>(
        await call(client, "load_skill", { path: "public/write/SKILL.md" }),
      );
      expect(loaded.complete).toBe(false);
      expect(loaded.included).toEqual([
        expect.objectContaining({ path: "public/write/private.md" }),
      ]);
      expect(loaded.included[0]?.content).toBeUndefined();
      expect(
        loaded.references?.find((reference) => reference.path === `${excluded}/README.md`)?.status,
      ).not.toBe("available");
      expect(
        (await call(client, "read_repo_file", { path: "public/write/private.md" })).isError,
      ).toBe(true);
      expect(
        data<FindResult>(await call(client, "search_repo", { query: "hiddenquartz" })).items,
      ).toEqual([]);
    } finally {
      await client.close();
      await nested.close();
    }
  });

  it("waits for publication decisions before cold file reads, then serves the same path", async () => {
    const { h, host, address } = repository("mcp-cold-publication", {
      "docs/fresh.md": "# Fresh overview\n\nFresh readable instructions.\n",
    });
    const release = host.holdTrees();
    const client = await h.connect(address);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const early = await Promise.race([
        call(client, "read_repo_file", { path: "docs/fresh.md" }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("cold read waited on an unvalidated tree")),
            3_000,
          );
        }),
      ]);
      expect(data<Record<string, unknown>>(early)).toMatchObject({ status: "indexing" });
      const response = await h.request(`/api/v1/files${address}?path=docs/fresh.md`);
      expect(response.status).toBe(503);
      expect(restErrorSchema.parse(await response.json()).error.code).toBe("index.indexing");
      release();
      await ready(h, address);
      expect(
        data<FileResult>(await call(client, "read_repo_file", { path: "docs/fresh.md" })).content,
      ).toContain("Fresh readable instructions.");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release();
      await h.snapshots.idle();
      await client.close();
    }
  });

  it("pages large Unicode browse and search results without missing or repeated skills", async () => {
    const emoji = String.fromCodePoint(0x1f642);
    const files: Record<string, string> = {};
    const expected: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const name = `skill-${String(index).padStart(2, "0")}`;
      const path = `large/${name}/SKILL.md`;
      expected.push(path);
      files[path] = skill(
        "Apply copper guidance.",
        name,
        "",
        `Copper ${emoji.repeat(440)} guidance.`,
      );
    }
    const { h, address } = repository("mcp-byte-list-pages", files);
    await ready(h, address);
    const client = await h.connect(address);
    try {
      for (const operation of ["browse_repo", "search_repo"] as const) {
        const paths: string[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        let pages = 0;
        do {
          const result = await call(client, operation, {
            path: "large",
            limit: operation === "browse_repo" ? 200 : 25,
            ...(operation === "search_repo" ? { query: "copper" } : {}),
            ...(cursor === undefined ? {} : { cursor }),
          });
          const page = data<BrowseResult & FindResult>(result);
          const items = operation === "browse_repo" ? page.entries : page.items;
          expect(items.length).toBeGreaterThan(0);
          for (const item of items) {
            expect(item.kind).toBe("skill");
            expect(item.path).toBeDefined();
            paths.push(item.path as string);
          }
          cursor = page.nextCursor;
          if (cursor !== undefined) {
            expect(cursors.has(cursor)).toBe(false);
            cursors.add(cursor);
          }
          pages += 1;
          expect(pages).toBeLessThanOrEqual(60);
        } while (cursor !== undefined);
        expect(pages).toBeGreaterThan(1);
        expect(paths.sort()).toEqual(expected);
        expect(new Set(paths).size).toBe(60);
      }
    } finally {
      await client.close();
    }
  });

  it("reconstructs every required skill section under the serialized response budget", async () => {
    const emoji = String.fromCodePoint(0x1f642);
    const escaped = `${emoji} "quoted"\t\\path\n`;
    const rules = `Rules begin.\n${escaped.repeat(2_000)}Rules end.`;
    const body = `[One](optional.md) [Same](/team/write/optional.md)\n${escaped.repeat(2_200)}Body end.`;
    const required = `Required begins.\n${escaped.repeat(2_500)}Required ends.`;
    const path = "team/write/SKILL.md";
    const { h, address } = repository("mcp-byte-skill-pages", {
      "SKILLCDN.md": manifest(rules),
      [path]: skill(
        body,
        "write",
        "metadata:\n  audience: Optionalpresentationmarker\nskillcdn:\n  include: [required.md]\n",
      ),
      "team/write/required.md": required,
      "team/write/optional.md": "# Optional details\n",
    });
    await ready(h, address);
    const client = await h.connect(address);
    try {
      let cursor: string | undefined;
      let allRules = "";
      let allBody = "";
      let allRequired = "";
      let pages = 0;
      const seen = new Set<string>();
      do {
        const result = await call(client, "load_skill", {
          path,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const page = data<SkillResult>(result);
        for (const rule of page.ruleChain ?? []) {
          expect(rule.path).toBe("SKILLCDN.md");
          allRules += rule.body;
        }
        allBody += page.body;
        for (const file of page.included) {
          expect(file.path).toBe("team/write/required.md");
          expect(file.content).toBeDefined();
          allRequired += file.content;
        }
        const references = page.references ?? [];
        expect(new Set(references.map((reference) => reference.path)).size).toBe(references.length);
        if (pages === 0) {
          expect(references).toEqual([expect.objectContaining({ path: "team/write/optional.md" })]);
          expect(page.metadata.audience).toBe("Optionalpresentationmarker");
        } else {
          expect(page.metadata).toEqual({});
          expect(page.files).toEqual([]);
          expect(references).toEqual([]);
        }
        expect(page.complete).toBe(page.nextCursor === undefined);
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          expect(seen.has(cursor)).toBe(false);
          seen.add(cursor);
        }
        pages += 1;
        expect(pages).toBeLessThan(80);
      } while (cursor !== undefined);
      expect(pages).toBeGreaterThan(2);
      expect(allRules).toBe(rules);
      expect(allBody).toBe(body);
      expect(allRequired).toBe(required);
    } finally {
      await client.close();
    }
  });

  it("reconstructs escaped Unicode file content across adaptive read_repo_file offsets", async () => {
    const emoji = String.fromCodePoint(0x1f642);
    const content = `[First](reference.md) [Same](/docs/reference.md)\n${`${emoji}\t"quoted"\\value\n`.repeat(5_000)}End.`;
    const { h, address } = repository("mcp-byte-file-pages", {
      "docs/long.md": content,
      "docs/reference.md": "# Reference\n",
    });
    await ready(h, address);
    const client = await h.connect(address);
    try {
      let reconstructed = "";
      let offset = 0;
      let pages = 0;
      while (true) {
        const page = data<FileResult>(
          await call(client, "read_repo_file", { path: "docs/long.md", offset, limit: 100_000 }),
        );
        expect(page.offset).toBe(offset);
        expect(page.totalLength).toBe(content.length);
        expect(page.content.length).toBeGreaterThan(0);
        const references = page.references ?? [];
        expect(new Set(references.map((reference) => reference.path)).size).toBe(references.length);
        reconstructed += page.content;
        pages += 1;
        expect(pages).toBeLessThan(80);
        if (page.nextOffset === undefined) break;
        expect(page.nextOffset).toBeGreaterThan(offset);
        offset = page.nextOffset;
      }
      expect(pages).toBeGreaterThan(1);
      expect(reconstructed).toBe(content);
    } finally {
      await client.close();
    }
  });
});
