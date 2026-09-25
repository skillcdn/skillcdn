import { createHash } from "node:crypto";
import type { Client } from "@modelcontextprotocol/client";
import { renderSkillSections, restMountSchema } from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as z from "zod";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness } from "./testing/harness.js";

// The MCP skills extension (ADR-0024, ADR-0025): what a host that implements it gets.

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await database?.drop();
});

const manifest = (body = "", fields = ""): string =>
  `---\ndescription: Collection guidance.\ndocuments: []\n${fields}---\n${body}`;
const skill = (body: string, name = "write", fields = ""): string =>
  `---\nname: ${name}\ndescription: Practical guidance.\n${fields}---\n${body}`;

function repository(variant: string, files: Record<string, string | Uint8Array>) {
  const host = createFixtureHost(variant);
  for (const [path, body] of Object.entries(files)) {
    host.addFile(path, typeof body === "string" ? new TextEncoder().encode(body) : body);
  }
  return {
    host,
    h: createHarness(database, { host, indexWaitMs: 100 }),
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

const cacheable = {
  ttlMs: z.number().int().nonnegative(),
  cacheScope: z.enum(["public", "private"]),
};
const resource = z.object({ uri: z.string(), digest: z.string(), size: z.number().int() });
const entry = z.object({
  uri: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  resources: z.array(resource),
});
const listSchema = z.object({
  skills: z.array(entry),
  nextCursor: z.string().optional(),
  ...cacheable,
});
const getSchema = z.object({ skill: entry, ...cacheable });
const directorySchema = z.object({
  resources: z.array(z.object({ uri: z.string(), name: z.string(), mimeType: z.string() })),
  ...cacheable,
});

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Reads a resource the way a host does: the bytes, whether they came as text or as base64. */
async function readBytes(client: Client, uri: string): Promise<Uint8Array> {
  const read = await client.readResource({ uri });
  const [content] = read.contents;
  if (content === undefined) throw new Error(`nothing at ${uri}`);
  return "text" in content && typeof content.text === "string"
    ? new TextEncoder().encode(content.text)
    : new Uint8Array(Buffer.from(String((content as { blob?: string }).blob ?? ""), "base64"));
}

describe("the MCP skills extension", () => {
  it("lists skills whose every file reads back as the digest and size it declared", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const { h, address } = repository("ext-list", {
      "SKILLCDN.md": manifest("# Rules\n\nAsk first."),
      "skills/write/SKILL.md": skill(
        "Write the document.",
        "write",
        "skillcdn:\n  include: [style.md]\n",
      ),
      "skills/write/style.md": "Short sentences.",
      "skills/write/assets/logo.png": png,
    });
    await ready(h, address);
    const client = await h.connect(address);
    try {
      expect(client.getServerCapabilities()).toMatchObject({
        resources: {},
        extensions: { "io.modelcontextprotocol/skills": { directoryRead: true } },
      });
      const listed = listSchema.parse(
        await client.request({ method: "skills/list", params: {} }, listSchema),
      );
      expect(listed.cacheScope).toBe("public");
      expect(listed.ttlMs).toBeGreaterThan(0);
      expect(listed.nextCursor).toBeUndefined();
      const prefix = "skill://gh/acme/multi-skill";
      expect(listed.skills.map((item) => item.uri)).toEqual([
        `${prefix}/skills/incident-review/SKILL.md`,
        `${prefix}/skills/release-notes/SKILL.md`,
        `${prefix}/skills/write/SKILL.md`,
      ]);
      const write = listed.skills.find((item) => item.uri.endsWith("/write/SKILL.md"));
      if (write === undefined) throw new Error("the added skill must be listed");
      // The listing declares the served front matter: the author's fields, without what
      // SkillCDN adds, and the files of the skill with digests over what a read returns.
      expect(write.frontmatter).toEqual({ name: "write", description: "Practical guidance." });
      expect(write.resources.map((file) => file.uri)).toEqual([
        `${prefix}/skills/write/SKILL.md`,
        `${prefix}/skills/write/assets/logo.png`,
        `${prefix}/skills/write/style.md`,
      ]);
      for (const item of listed.skills) {
        for (const file of item.resources) {
          const bytes = await readBytes(client, file.uri);
          expect(sha256(bytes), file.uri).toBe(file.digest);
          expect(bytes.byteLength, file.uri).toBe(file.size);
        }
      }
      const logo = await client.readResource({ uri: `${prefix}/skills/write/assets/logo.png` });
      expect(logo.contents[0]).toMatchObject({ mimeType: "image/png" });
      expect(logo.contents[0]).not.toHaveProperty("text");

      // The SKILL.md is the assembled document: a plain skill with the rules and the included
      // file inside it, and the same sections the tool serves.
      const read = await client.readResource({ uri: write.uri });
      const document = (read.contents[0] as { text?: string }).text ?? "";
      expect(read.contents[0]).toMatchObject({ mimeType: "text/markdown" });
      expect(
        document.startsWith('---\nname: "write"\ndescription: "Practical guidance."\n---\n'),
      ).toBe(true);
      expect(document).not.toContain("skillcdn");
      expect(document).toContain(
        "> Assembled by SkillCDN from `SKILLCDN.md`, `skills/write/SKILL.md` and `skills/write/style.md` at commit `",
      );
      const sections = renderSkillSections({
        rules: [{ path: "SKILLCDN.md", body: "# Rules\n\nAsk first." }],
        body: "Write the document.",
        included: [{ path: "skills/write/style.md", content: "Short sentences." }],
      });
      expect(document).toContain(sections);
      const loaded = await client.callTool({
        name: "load_skill",
        arguments: { path: "skills/write/SKILL.md" },
      });
      const text = (loaded.content as { text?: string }[])
        .map((block) => block.text ?? "")
        .join("");
      expect(text).toContain(sections);

      // skills/get answers for a listed skill and refuses anything else with invalid params.
      const got = getSchema.parse(
        await client.request({ method: "skills/get", params: { uri: write.uri } }, getSchema),
      );
      expect(got.skill).toEqual(write);
      for (const uri of [
        `${prefix}/skills/nowhere/SKILL.md`,
        `${prefix}/skills/write/style.md`,
        "skill://gh/acme/other/skills/write/SKILL.md",
        "not a uri",
      ]) {
        await expect(
          client.request({ method: "skills/get", params: { uri } }, getSchema),
        ).rejects.toMatchObject({ code: -32602 });
      }
      await expect(
        client.readResource({ uri: `${prefix}/skills/write/missing.md` }),
      ).rejects.toMatchObject({ code: -32602 });

      // Directory reads, and the resource list of the current revision's own catalog.
      const folder = directorySchema.parse(
        await client.request(
          { method: "resources/directory/read", params: { uri: `${prefix}/skills/write` } },
          directorySchema,
        ),
      );
      expect(folder.resources).toEqual([
        { uri: `${prefix}/skills/write/assets`, name: "assets", mimeType: "inode/directory" },
        { uri: `${prefix}/skills/write/SKILL.md`, name: "SKILL.md", mimeType: "text/markdown" },
        { uri: `${prefix}/skills/write/style.md`, name: "style.md", mimeType: "text/markdown" },
      ]);
      await expect(
        client.request(
          { method: "resources/directory/read", params: { uri: `${prefix}/skills/nowhere` } },
          directorySchema,
        ),
      ).rejects.toMatchObject({ code: -32602 });
      const resources = await client.listResources();
      expect(resources.resources.map((item) => item.uri)).toEqual(
        listed.skills.map((item) => item.uri),
      );
      expect(resources.resources[2]).toMatchObject({ name: "write", mimeType: "text/markdown" });
    } finally {
      await client.close();
    }
  });

  it("names a root skill's files after the skill, and says so in the instructions", async () => {
    const host = createFixtureHost("ext-root");
    const h = createHarness(database, { host, indexWaitMs: 100 });
    const address = `/gh/acme/single-skill@${fixtureCommits("ext-root").main}`;
    await ready(h, address);
    const client = await h.connect(address);
    try {
      const prefix = "skill://gh/acme/single-skill";
      expect(client.getInstructions()).toContain(
        `Skills are also served through the MCP skills extension as ${prefix}/<path>.`,
      );
      const listed = listSchema.parse(
        await client.request({ method: "skills/list", params: {} }, listSchema),
      );
      expect(listed.skills).toHaveLength(1);
      const [root] = listed.skills;
      expect(root?.uri).toBe(`${prefix}/commit-messages/SKILL.md`);
      expect(root?.resources.map((file) => file.uri)).toEqual([
        `${prefix}/commit-messages/SKILL.md`,
        `${prefix}/commit-messages/references/checklist.md`,
      ]);
      for (const file of root?.resources ?? []) {
        expect(sha256(await readBytes(client, file.uri))).toBe(file.digest);
      }
      const folder = directorySchema.parse(
        await client.request(
          { method: "resources/directory/read", params: { uri: `${prefix}/commit-messages` } },
          directorySchema,
        ),
      );
      expect(folder.resources.map((item) => item.name)).toEqual(["references", "SKILL.md"]);
    } finally {
      await client.close();
    }
  });

  it("lists a skill that a host could not hold whole through the tools only", async () => {
    const { h, address } = repository("ext-unlisted", {
      "skills/ad-copy/SKILL.md": skill("Named write, in a directory that is not.", "write"),
    });
    await ready(h, address);
    const client = await h.connect(address);
    try {
      const listed = listSchema.parse(
        await client.request({ method: "skills/list", params: {} }, listSchema),
      );
      expect(listed.skills.map((item) => item.uri)).not.toContainEqual(
        expect.stringContaining("ad-copy"),
      );
      const loaded = await client.callTool({
        name: "load_skill",
        arguments: { path: "skills/ad-copy/SKILL.md" },
      });
      expect(loaded.isError).not.toBe(true);
      const text = (loaded.content as { text?: string }[])
        .map((block) => block.text ?? "")
        .join("");
      expect(text).toContain("directory must be named after the skill");
    } finally {
      await client.close();
    }
  });

  it("answers an empty, short-lived listing while the commit is being indexed", async () => {
    const host = createFixtureHost("ext-indexing");
    const release = host.holdTrees();
    const h = createHarness(database, { host, indexWaitMs: 50 });
    const client = await h.connect(`/gh/acme/multi-skill@${fixtureCommits("ext-indexing").main}`);
    try {
      const listed = listSchema.parse(
        await client.request({ method: "skills/list", params: {} }, listSchema),
      );
      expect(listed.skills).toEqual([]);
      expect(listed.ttlMs).toBeLessThanOrEqual(5_000);
      await expect(
        client.readResource({ uri: "skill://gh/acme/multi-skill/skills/release-notes/SKILL.md" }),
      ).rejects.toMatchObject({ code: -32603 });
    } finally {
      release();
      await client.close();
      await h.snapshots.idle();
    }
  });
});
