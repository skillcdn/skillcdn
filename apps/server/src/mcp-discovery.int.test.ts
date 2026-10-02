import type { Client } from "@modelcontextprotocol/client";
import { INDEXING_NOTICE, restErrorSchema, restMountSchema } from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness } from "./testing/harness.js";
import {
  continuationOf,
  filePageOf,
  listedPaths,
  skillSectionsOf,
  textOf,
} from "./testing/tool-text.js";

const MAX_REPLY_BYTES = 24_576;
/** A line of the resolved references a page lists. */
const REFERENCE_LINE = / -> \S+ \((?:available|outside_mount|missing|blocked)\)$/;
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
  // One representation, the text (ADR-0034).
  expect(result.structuredContent).toBeUndefined();
  return result;
}

/** The text of a result that is not an error. */
function text(result: Awaited<ReturnType<typeof call>>): string {
  expect(result.isError).not.toBe(true);
  return textOf(result);
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
      const root = text(await call(client, "browse_repo", {}));
      expect(root).toContain("Original overview");
      expect(root).toContain("Optional overview: read_repo_file README.md.");
      expect(root).toMatch(
        /^- directory: department.*; overview: department\/README\.md\n {2}Choose a writing task\.$/m,
      );
      const paths = listedPaths(root);
      expect(paths).toContain("department");
      for (const path of ["source", ".hidden", "README.md"]) expect(paths).not.toContain(path);
      const folder = text(await call(client, "browse_repo", { path: "department" }));
      expect(folder).toContain("Optional overview: read_repo_file department/README.md.");
      expect(
        filePageOf(text(await call(client, "read_repo_file", { path: "README.md" }))).content,
      ).toBe(rootReadme);
      for (const path of ["README.ko.md", "source/README.md", ".hidden/README.md"]) {
        expect((await call(client, "read_repo_file", { path })).isError).toBe(true);
      }
      const loaded = text(await call(client, "load_skill", { path: "department/write/SKILL.md" }));
      expect(skillSectionsOf(loaded)).toEqual({
        rules: [],
        body: "Write the requested document.",
        included: [],
      });
      expect(loaded).not.toContain("Overviewquartz");
      for (const query of ["overviewquartz", "translationonlyquartz"]) {
        expect(text(await call(client, "search_repo", { query }))).toContain("No results for");
      }
    } finally {
      await client.close();
    }
  });

  it("keeps the files of hidden copies out of search along with the copies", async () => {
    const { h, address } = repository("mcp-hidden-copy-files", {
      "plugin/skills/write/SKILL.md": skill("Write it."),
      "plugin/skills/write/reference/notes.md": "# Notes\n\nSharedquartz guidance.\n",
      ".claude/skills/write/SKILL.md": skill("Write it, for one harness."),
      ".claude/skills/write/reference/notes.md":
        "# Notes\n\nSharedquartz guidance. Hiddenonlyquartz too.\n",
    });
    await ready(h, address);
    const client = await h.connect(address);
    try {
      const shared = text(await call(client, "search_repo", { query: "sharedquartz" }));
      expect(listedPaths(shared)).toEqual(["plugin/skills/write/SKILL.md"]);
      expect(text(await call(client, "search_repo", { query: "hiddenonlyquartz" }))).toContain(
        "No results for",
      );
      // The copy stays loadable by its exact path, and says what it is.
      const hidden = text(
        await call(client, "load_skill", { path: ".claude/skills/write/SKILL.md" }),
      );
      expect(hidden).toContain("Warnings for the skill author:");
      expect(hidden).toContain("hidden directory");
      // Counts and the overview cover what can be discovered: the copy's folder is not introduced,
      // and browsing shows it with nothing to discover.
      expect(client.getInstructions()).toContain("plugin/: 1 skill\n");
      expect(client.getInstructions()).not.toContain(".claude/");
      const root = text(await call(client, "browse_repo", {}));
      expect(root).toMatch(/^- directory: \.claude(?: \(.*\))?; 0 skills/m);
      expect(root).toMatch(/^- directory: plugin(?: \(.*\))?; 1 skill/m);
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
      const root = text(await call(client, "browse_repo", {}));
      expect(listedPaths(root)).not.toContain("internal");
      expect(root).not.toContain("Index diagnostics");
      expect(root).not.toContain("Hiddenquartz");
      const hidden = text(await call(nested, "browse_repo", {}));
      expect(listedPaths(hidden)).toEqual([]);
      expect(hidden).not.toContain("Index diagnostics");
      expect(hidden).not.toContain("Hiddenquartz");
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
      const loaded = text(await call(client, "load_skill", { path: "public/write/SKILL.md" }));
      expect(loaded).toContain("Skill context is incomplete.");
      expect(skillSectionsOf(loaded).included).toEqual([
        { path: "public/write/private.md", content: undefined, continues: false },
      ]);
      const reference = loaded
        .split("\n")
        .find((line) => line.includes(`-> ${excluded}/README.md (`));
      expect(reference ?? "").not.toContain("(available)");
      expect(
        (await call(client, "read_repo_file", { path: "public/write/private.md" })).isError,
      ).toBe(true);
      expect(text(await call(client, "search_repo", { query: "hiddenquartz" }))).toContain(
        "No results for",
      );
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
      expect(text(early)).toBe(INDEXING_NOTICE);
      const response = await h.request(`/api/v1/files${address}?path=docs/fresh.md`);
      expect(response.status).toBe(503);
      expect(restErrorSchema.parse(await response.json()).error.code).toBe("index.indexing");
      release();
      await ready(h, address);
      expect(
        filePageOf(text(await call(client, "read_repo_file", { path: "docs/fresh.md" }))).content,
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
          const page = text(result);
          const items = listedPaths(page);
          expect(items.length).toBeGreaterThan(0);
          for (const item of items) {
            expect(item).toMatch(/^large\/skill-\d{2}\/SKILL\.md$/);
            paths.push(item);
          }
          cursor = continuationOf(page);
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
        const page = text(result);
        const sections = skillSectionsOf(page);
        for (const rule of sections.rules) {
          expect(rule.path).toBe("SKILLCDN.md");
          allRules += rule.body;
        }
        allBody += sections.body ?? "";
        for (const file of sections.included) {
          expect(file.path).toBe("team/write/required.md");
          expect(file.content).toBeDefined();
          allRequired += file.content ?? "";
        }
        const references = page.split("\n").filter((line) => REFERENCE_LINE.test(line));
        expect(new Set(references).size).toBe(references.length);
        if (pages === 0) {
          expect(references).toHaveLength(1);
          expect(references[0]).toContain("-> team/write/optional.md (");
          expect(page).toContain("Metadata: audience: Optionalpresentationmarker");
        } else {
          expect(page).not.toContain("Metadata:");
          expect(page).not.toContain("Supporting files");
          expect(references).toEqual([]);
        }
        cursor = continuationOf(page);
        expect(page.includes("Skill context is incomplete.")).toBe(cursor !== undefined);
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
        const read = text(
          await call(client, "read_repo_file", { path: "docs/long.md", offset, limit: 100_000 }),
        );
        const page = filePageOf(read);
        expect(page.offset).toBe(offset);
        expect(page.totalLength).toBe(content.length);
        expect(page.content.length).toBeGreaterThan(0);
        const references = read.split("\n").filter((line) => REFERENCE_LINE.test(line));
        expect(new Set(references).size).toBe(references.length);
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
