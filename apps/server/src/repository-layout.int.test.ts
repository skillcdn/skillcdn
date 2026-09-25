import type { Client } from "@modelcontextprotocol/client";
import {
  allowEverything,
  type IndexLimits,
  parseAddress,
  restBrowseSchema,
  restErrorSchema,
  restFileSchema,
  restFindSchema,
  restMountSchema,
  restSkillSchema,
  type SkillResult,
} from "@skillcdn/core";
import { createBlobStore } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INDEX_LIMIT_DEFAULTS } from "./config/config.js";
import { gitBlobHash } from "./indexer/git-hash.js";
import { MountReader } from "./mounts/mount-reader.js";
import { MountService } from "./mounts/mount-service.js";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness } from "./testing/harness.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await database?.drop();
});

const manifest = (body: string, fields = ""): string =>
  `---\ndescription: Shared collection.\ndocuments: []\n${fields}---\n${body}`;
const skill = (body: string, name = "write", fields = ""): string =>
  `---\nname: ${name}\ndescription: Practical copper guidance.\n${fields}---\n${body}`;

async function repository(
  variant: string,
  files: Record<string, string>,
  limits: Partial<IndexLimits> = {},
) {
  const host = createFixtureHost(variant);
  for (const [path, body] of Object.entries(files))
    host.addFile(path, new TextEncoder().encode(body));
  const h = createHarness(database, {
    host,
    entitlements: {
      check: async () => ({ allowed: true, limits: { maxIndexedFiles: 500, ...limits } }),
    },
  });
  const address = `/gh/acme/multi-skill@${fixtureCommits(variant).main}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = restMountSchema.parse(
      await (await h.request(`/api/v1/mounts${address}`)).json(),
    );
    if (response.index.status === "ready") return { h, address };
    await h.snapshots.idle();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("index did not become ready");
}

async function load(h: Harness, address: string, path: string, cursor?: string) {
  const query = new URLSearchParams({ path, ...(cursor === undefined ? {} : { cursor }) });
  const response = await h.request(`/api/v1/skills${address}?${query}`);
  expect(response.status).toBe(200);
  const body = restSkillSchema.parse(await response.json());
  if (body.status !== "ready") throw new Error("skill not ready");
  return body.skill;
}

async function tool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return {
    error: result.isError === true,
    text: JSON.stringify(result.content),
    data: result.structuredContent as Record<string, unknown> | undefined,
  };
}

describe("repository-root publication and progressive loading", () => {
  it("searches canonical metadata and bodies while translations stay display-only", async () => {
    const translated = String.fromCodePoint(0xd64d, 0xbcf4, 0x20, 0xc601, 0xc0c1);
    const original = String.fromCodePoint(0xd68c, 0xc758);
    const path = "media/compose/SKILL.md";
    const { h, address } = await repository("canonical-search-language", {
      [path]: skill(
        `Plan a storyboard. ${original}`,
        "compose",
        `skillcdn:\n  translations:\n    ko:\n      title: ${translated}\n      description: Presentationonlyquartz\n`,
      ),
      "media/compose/reference.md":
        "---\ntitle: Canonical guidance\ntranslations:\n  ko:\n    title: Presentationonlyquartz\n---\nReference details.",
    });
    const client = await h.connect(address);
    for (const query of ["compose", "copper", "storyboard", original]) {
      const found = await tool(client, "search_repo", { query, path: "media" });
      expect(found.error).toBe(false);
      expect(found.data?.items).toEqual([expect.objectContaining({ kind: "skill", path })]);
    }
    for (const query of [translated, "presentationonlyquartz"]) {
      const found = await tool(client, "search_repo", { query, path: "media" });
      expect(found.error).toBe(false);
      expect(found.data?.items).toEqual([]);
      const params = new URLSearchParams({ query, path: "media" });
      const human = restFindSchema.parse(
        await (await h.request(`/api/v1/find${address}?${params}`)).json(),
      );
      expect(human.status).toBe("ready");
      if (human.status === "ready") expect(human.items).toEqual([]);
    }
    expect((await load(h, address, path)).translations.ko?.title).toBe(translated);
    await client.close();
  });

  it("applies the same ancestor rule chain through whole-repository and nested mounts", async () => {
    const { h, address } = await repository("nested-rules", {
      "SKILLCDN.md": manifest("Company rules.", "language: en\n"),
      "marketing/SKILLCDN.md": manifest("Marketing rules.", "name: Marketing\nlanguage: ko\n"),
      "marketing/skills/write/SKILL.md": skill("Write the result."),
    });
    const path = "marketing/skills/write/SKILL.md";
    const whole = await load(h, address, path);
    const nested = await load(h, `${address}/marketing/skills/write`, path);
    expect(whole.path).toBe(path);
    expect(whole.ruleChain).toEqual([
      { path: "SKILLCDN.md", body: "Company rules.", truncated: false },
      { path: "marketing/SKILLCDN.md", body: "Marketing rules.", truncated: false },
    ]);
    expect(nested.ruleChain).toEqual(whole.ruleChain);
    expect(nested.directory).toBe("marketing/skills/write");
    expect(nested.complete).toBe(true);
    const outside = await h.request(
      `/api/v1/files${address}/marketing/skills/write?path=SKILLCDN.md`,
    );
    expect(outside.status).toBe(404);
    const browse = restBrowseSchema.parse(
      await (await h.request(`/api/v1/browse${address}`)).json(),
    );
    expect(
      browse.status === "ready"
        ? browse.entries.find((entry) => entry.path === "marketing")
        : undefined,
    ).toMatchObject({
      name: "Marketing",
      manifestPath: "marketing/SKILLCDN.md",
      language: "ko",
      skillCount: 1,
    });
  });

  it("continues long ancestor rules outside the mount without losing their content or provenance", async () => {
    const company = `Company begins. ${"a".repeat(55_000)} Company ends.`;
    const team = `Team begins. ${"b".repeat(31_000)} Team ends.`;
    const body = `Skill begins. ${"c".repeat(12_000)} Skill ends.`;
    const required = `Required file begins. ${"d".repeat(110_000)} Required file ends.`;
    const { h, address } = await repository("rule-continuation", {
      "SKILLCDN.md": manifest(company),
      "team/SKILLCDN.md": manifest(team),
      "team/skills/write/SKILL.md": skill(
        body,
        "write",
        "skillcdn:\n  include: [references/required.md]\n",
      ),
      "team/skills/write/references/required.md": required,
    });
    const mount = `${address}/team/skills/write`;
    const path = "team/skills/write/SKILL.md";
    const rules = new Map<string, string>();
    let instructions = "";
    let included = "";
    let cursor: string | undefined;
    let pages = 0;
    const seen = new Set<string>();
    do {
      const page = await load(h, mount, path, cursor);
      expect(page.ruleChain).toBeDefined();
      for (const rule of page.ruleChain ?? [])
        rules.set(rule.path, (rules.get(rule.path) ?? "") + rule.body);
      instructions += page.body;
      for (const file of page.includedContents ?? []) {
        expect(file.path).toBe("team/skills/write/references/required.md");
        expect(file.content).not.toBeNull();
        included += file.content ?? "";
      }
      pages += 1;
      expect(page.complete).toBe(page.nextCursor === null);
      if (page.nextCursor !== null && page.nextCursor !== undefined) {
        expect(seen.has(page.nextCursor)).toBe(false);
        seen.add(page.nextCursor);
      }
      cursor = page.nextCursor ?? undefined;
      expect(pages).toBeLessThan(20);
    } while (cursor !== undefined);
    expect(pages).toBeGreaterThan(2);
    expect(rules.get("SKILLCDN.md")).toBe(company);
    expect(rules.get("team/SKILLCDN.md")).toBe(team);
    expect(instructions).toBe(body);
    expect(included).toBe(required);
    expect((await h.request(`/api/v1/files${mount}?path=SKILLCDN.md`)).status).toBe(404);
  });

  it("loads a large skill through bounded MCP responses without duplicate presentation fields", async () => {
    const body = "Write a clear campaign story.\n".repeat(1_500).slice(0, 24 * 1024);
    const required = "Keep each scene concise.\n".repeat(3_000).slice(0, 54 * 1024);
    const path = "media/compose/SKILL.md";
    const includePath = "media/compose/reference.md";
    const { h, address } = await repository("large-mcp-context", {
      "SKILLCDN.md": manifest("Use the common editorial rules."),
      [path]: skill(
        body,
        "compose",
        "skillcdn:\n  include: [reference.md]\n  translations:\n    ko:\n      title: Presentationonlyquartz\n",
      ),
      [includePath]: required,
    });
    const client = await h.connect(address);
    let cursor: string | undefined;
    let allBody = "";
    let allIncluded = "";
    let allRules = "";
    let count = 0;
    do {
      const result = await client.callTool({
        name: "load_skill",
        arguments: { path, ...(cursor === undefined ? {} : { cursor }) },
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(40 * 1024);
      expect(result.structuredContent).not.toHaveProperty("translations");
      expect(result.structuredContent).not.toHaveProperty("rules");
      const page = result.structuredContent as unknown as SkillResult;
      allBody += page.body;
      for (const rule of page.ruleChain ?? []) allRules += rule.body;
      for (const included of page.included) {
        expect(included.path).toBe(includePath);
        allIncluded += included.content ?? "";
      }
      expect(page.complete).toBe(page.nextCursor === undefined);
      cursor = page.nextCursor;
      count += 1;
      expect(count).toBeLessThan(10);
    } while (cursor !== undefined);
    expect(count).toBeGreaterThan(1);
    expect(allBody).toBe(body);
    expect(allIncluded).toBe(required);
    expect(allRules).toBe("Use the common editorial rules.");
    await client.close();
  });

  it.each(["inside", "between"])(
    "keeps context pages bounded around surrogate pairs %s sections",
    async (boundary) => {
      const emoji = String.fromCodePoint(0x1f642);
      const company =
        boundary === "inside" ? `${"a".repeat(16_383)}${emoji} company tail` : "a".repeat(16_383);
      const body =
        boundary === "inside"
          ? `${"b".repeat(16_366)}${emoji} skill tail`
          : `${emoji}${"b".repeat(45_000)}`;
      const required = `${emoji} Required text.`;
      const { h, address } = await repository(`unicode-context-${boundary}`, {
        "SKILLCDN.md": manifest(company),
        "team/write/SKILL.md": skill(body, "write", "skillcdn:\n  include: [required.md]\n"),
        "team/write/required.md": required,
      });
      let cursor: string | undefined;
      let allRules = "";
      let allBody = "";
      let allIncluded = "";
      let count = 0;
      do {
        const page = await load(h, address, "team/write/SKILL.md", cursor);
        const ruleText = (page.ruleChain ?? []).map((rule) => rule.body).join("");
        const includedText = (page.includedContents ?? [])
          .map((file) => file.content ?? "")
          .join("");
        expect(Buffer.byteLength(ruleText + page.body + includedText, "utf8")).toBeLessThanOrEqual(
          16_384,
        );
        allRules += ruleText;
        allBody += page.body;
        allIncluded += includedText;
        cursor = page.nextCursor ?? undefined;
        count += 1;
        expect(count).toBeLessThan(10);
      } while (cursor !== undefined);
      expect(allRules).toBe(company);
      expect(allBody).toBe(body);
      expect(allIncluded).toBe(required);
    },
  );

  it("keeps an unindexed required file unavailable after a raw read warms its blob", async () => {
    const required = `Not indexed: ${"r".repeat(270_000)}`;
    const path = "team/write/SKILL.md";
    const includePath = "team/write/required.md";
    const { h, address } = await repository(
      "unindexed-include-cache",
      {
        [path]: skill("b".repeat(45_000), "write", "skillcdn:\n  include: [required.md]\n"),
        [includePath]: required,
      },
      { maxReadableFileBytes: 400_000 },
    );
    const first = await load(h, address, path);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).toBeNull();
    expect(first.includedContents).toEqual([
      { path: includePath, content: null, truncated: false },
    ]);
    const raw = await h.request(
      `/api/v1/files${address}?${new URLSearchParams({ path: includePath })}`,
    );
    expect(raw.status).toBe(200);
    expect(restFileSchema.parse(await raw.json()).kind).toBe("file");
    const warmed = await load(h, address, path);
    expect(warmed.complete).toBe(false);
    expect(warmed.nextCursor).toBeNull();
    expect(warmed.includedContents).toEqual(first.includedContents);
    expect(warmed.warnings.join("\n")).toContain(includePath);
  });

  it("withholds continuation while an indexed required blob is unavailable", async () => {
    const path = "team/write/SKILL.md";
    const required = "Required blob temporarily unavailable.";
    const { h, address } = await repository("missing-required-blob", {
      [path]: skill("b".repeat(45_000), "write", "skillcdn:\n  include: [required.md]\n"),
      "team/write/required.md": required,
    });
    const parsed = parseAddress(address);
    if (!parsed.ok) throw new Error("invalid fixture address");
    const mounts = new MountService({
      database: database.database,
      gitHost: h.host,
      clock: { now: () => new Date() },
      entitlements: allowEverything,
      repoTtlMs: 60_000,
      refTtlMs: 60_000,
      staleGraceMs: 60_000,
      verifiedRepositories: new Set(),
    });
    const mount = await mounts.resolve(parsed.value);
    const stored = createBlobStore(database.database);
    const missingHash = gitBlobHash(new TextEncoder().encode(required));
    let unavailable = true;
    const reader = new MountReader({
      database: database.database,
      gitHost: h.host,
      snapshots: h.snapshots,
      limits: INDEX_LIMIT_DEFAULTS,
      blobStore: {
        ...stored,
        read: async (hash) => (unavailable && hash === missingHash ? undefined : stored.read(hash)),
      },
    });
    const missing = await reader.skill(mount, path, 0, undefined, true);
    if (missing.status !== "ready" || missing.lookup.kind !== "found")
      throw new Error("skill not ready");
    expect(missing.lookup.skill.complete).toBe(false);
    expect(missing.lookup.skill.nextCursor).toBeUndefined();
    expect(missing.lookup.skill.warnings.join("\n")).toContain("team/write/required.md");
    unavailable = false;
    const restored = await reader.skill(mount, path, 0, undefined, true);
    if (restored.status !== "ready" || restored.lookup.kind !== "found")
      throw new Error("skill not ready");
    expect(restored.lookup.skill.complete).toBe(false);
    expect(restored.lookup.skill.nextCursor).toBeDefined();
  });

  it("pages folder contents and folded search results completely without duplicate skills", async () => {
    const files: Record<string, string> = { "SKILLCDN.md": manifest("Shared policy.") };
    for (let i = 0; i < 37; i += 1) {
      const name = `write-${String(i).padStart(2, "0")}`;
      files[`department/${name}/SKILL.md`] = skill("Apply copper guidance.", name);
      files[`department/${name}/references/one.md`] = "# Copper guide\nA copper support document.";
      files[`department/${name}/references/two.md`] = "# Copper examples\nMore copper support.";
    }
    for (let i = 0; i < 215; i += 1)
      files[`department/write-00/references/appendix-${String(i).padStart(3, "0")}.md`] =
        `# Appendix ${i}\nAdditional reference.`;
    const { h, address } = await repository("complete-pagination", files);
    const browsed: string[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({
        path: "department",
        limit: "7",
        ...(cursor === undefined ? {} : { cursor }),
      });
      const page = restBrowseSchema.parse(
        await (await h.request(`/api/v1/browse${address}?${query}`)).json(),
      );
      if (page.status !== "ready") throw new Error("browse not ready");
      expect(page.entries.length).toBeLessThanOrEqual(7);
      browsed.push(...page.entries.map((entry) => entry.path));
      cursor = page.nextCursor ?? undefined;
      expect(browsed.length).toBeLessThanOrEqual(37);
    } while (cursor !== undefined);
    expect(browsed).toHaveLength(37);
    expect(new Set(browsed).size).toBe(37);
    const found: string[] = [];
    cursor = undefined;
    do {
      const query = new URLSearchParams({
        query: "copper",
        path: "department",
        limit: "5",
        ...(cursor === undefined ? {} : { cursor }),
      });
      const page = restFindSchema.parse(
        await (await h.request(`/api/v1/find${address}?${query}`)).json(),
      );
      if (page.status !== "ready") throw new Error("search not ready");
      expect(page.items.length).toBeLessThanOrEqual(5);
      for (const item of page.items) {
        expect(item.kind).toBe("skill");
        if (item.kind === "skill") {
          expect(item.files).toHaveLength(2);
          found.push(item.directory);
        }
      }
      cursor = page.nextCursor ?? undefined;
      expect(found.length).toBeLessThanOrEqual(37);
    } while (cursor !== undefined);
    expect(found).toHaveLength(37);
    expect(new Set(found).size).toBe(37);
    const loaded = await load(h, address, "department/write-00/SKILL.md");
    expect(loaded.filesTruncated).toBe(true);
    const support: string[] = [];
    cursor = undefined;
    do {
      const query = new URLSearchParams({
        path: "department/write-00/references",
        ...(cursor === undefined ? {} : { cursor }),
      });
      const page = restBrowseSchema.parse(
        await (await h.request(`/api/v1/browse${address}?${query}`)).json(),
      );
      if (page.status !== "ready") throw new Error("support browse not ready");
      support.push(...page.entries.map((entry) => entry.path));
      cursor = page.nextCursor ?? undefined;
      expect(support.length).toBeLessThanOrEqual(217);
    } while (cursor !== undefined);
    expect(support).toHaveLength(217);
    expect(new Set(support).size).toBe(217);
  });

  it("resolves shared and hidden references while keeping link-only files outside discovery", async () => {
    const { h, address } = await repository("shared-reference-graph", {
      "SKILLCDN.md": manifest("[Policy](/shared/policy.md)"),
      ".agents/.curated/write/SKILL.md": skill(
        "[Shared](/shared/guide.md) [Hidden](/.context/guide.md) [Missing](/missing.md)",
      ),
      ".agents/.curated/write/references/style.md": "# Style\nNormal support.",
      "shared/guide.md": "# Copper reference\n[Policy](policy.md)",
      "shared/policy.md": "# Copper policy\n[Guide](guide.md)",
      ".context/guide.md": "# Copper hidden reference\n",
      ".context/unpublished.md": "# Copper unpublished\n",
    });
    const loaded = await load(h, address, ".agents/.curated/write/SKILL.md");
    expect(loaded.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: "/shared/guide.md",
          path: "shared/guide.md",
          status: "available",
        }),
        expect.objectContaining({
          href: "/.context/guide.md",
          path: ".context/guide.md",
          status: "available",
        }),
        expect.objectContaining({ href: "/missing.md", path: "missing.md", status: "missing" }),
      ]),
    );
    const nested = await load(
      h,
      `${address}/.agents/.curated/write`,
      ".agents/.curated/write/SKILL.md",
    );
    expect(
      nested.references?.find((reference) => reference.path === "shared/guide.md")?.status,
    ).toBe("outside_mount");
    for (const path of ["shared/guide.md", "shared/policy.md", ".context/guide.md"]) {
      const response = await h.request(`/api/v1/files${address}?${new URLSearchParams({ path })}`);
      expect(response.status).toBe(200);
      expect(restFileSchema.parse(await response.json()).kind).toBe("file");
    }
    expect((await h.request(`/api/v1/files${address}?path=.context/unpublished.md`)).status).toBe(
      404,
    );
    const root = restBrowseSchema.parse(await (await h.request(`/api/v1/browse${address}`)).json());
    expect(root.status === "ready" ? root.entries.map((entry) => entry.path) : []).toContain(
      ".agents",
    );
    expect(root.status === "ready" ? root.entries.map((entry) => entry.path) : []).not.toContain(
      "shared",
    );
    const search = restFindSchema.parse(
      await (await h.request(`/api/v1/find${address}?query=copper`)).json(),
    );
    expect(
      search.status === "ready" ? search.items.every((item) => item.kind === "skill") : false,
    ).toBe(true);
  });

  it("binds cursors to commit, scope, operation and query and rejects path escapes", async () => {
    const { h, address } = await repository("cursor-validation", {
      "team/one/SKILL.md": skill("First."),
      "team/two/SKILL.md": skill("Second.", "second"),
    });
    const first = restBrowseSchema.parse(
      await (await h.request(`/api/v1/browse${address}?path=team&limit=1`)).json(),
    );
    if (first.status !== "ready" || first.nextCursor === null)
      throw new Error("expected browse continuation");
    const cursor = encodeURIComponent(first.nextCursor);
    const searched = restFindSchema.parse(
      await (await h.request(`/api/v1/find${address}?path=team&query=copper&limit=1`)).json(),
    );
    if (
      searched.status !== "ready" ||
      searched.nextCursor === null ||
      searched.nextCursor === undefined
    )
      throw new Error("expected search continuation");
    for (const endpoint of [
      `/api/v1/browse${address}?path=skills&cursor=${cursor}`,
      `/api/v1/find${address}?query=copper&path=team&cursor=${cursor}`,
      `/api/v1/browse${address}?cursor=not-a-cursor`,
      `/api/v1/browse${address}/team?path=skills`,
      `/api/v1/browse${address}?path=../outside`,
      `/api/v1/find${address}/team?query=copper&path=skills`,
      `/api/v1/find${address}?path=team&query=changed&cursor=${encodeURIComponent(searched.nextCursor)}`,
    ]) {
      const response = await h.request(endpoint);
      expect(response.status, endpoint).toBe(400);
      expect(restErrorSchema.parse(await response.json()).error.code).toBe("request.invalid");
    }
    const client = await h.connect(`${address}/team`);
    expect((await tool(client, "browse_repo", { path: "skills" })).error).toBe(true);
    expect(
      (await tool(client, "load_skill", { path: "skills/release-notes/SKILL.md" })).error,
    ).toBe(true);
    expect(
      (await tool(client, "read_repo_file", { path: "team/../skills/release-notes/SKILL.md" }))
        .error,
    ).toBe(true);
    await client.close();
    const changed = await h.connect(
      `/gh/acme/multi-skill@${fixtureCommits("cursor-validation").release}`,
    );
    expect(
      (await tool(changed, "browse_repo", { path: "team", cursor: first.nextCursor })).error,
    ).toBe(true);
    await changed.close();
  });

  it("withholds skills and linked documents behind a failed policy manifest", async () => {
    const { h, address } = await repository("failed-boundary", {
      "SKILLCDN.md": manifest("[Restricted](/restricted/docs/guide.md)"),
      "restricted/SKILLCDN.md": "---\nname: Broken\n---\nNo description.",
      "restricted/docs/guide.md": "# Not published\n",
      "restricted/skills/write/SKILL.md": skill("Perform the task."),
      "restricted/reopened/SKILLCDN.md": manifest(
        "A nearer policy cannot reopen a failed boundary.",
      ),
      "restricted/reopened/SKILL.md": skill("Still not published.", "reopened"),
    });
    for (const path of ["restricted/skills/write/SKILL.md", "restricted/reopened/SKILL.md"]) {
      expect((await h.request(`/api/v1/skills${address}?path=${path}`)).status).toBe(404);
      expect((await h.request(`/api/v1/files${address}?path=${path}`)).status).toBe(404);
    }
    expect((await h.request(`/api/v1/files${address}?path=restricted/docs/guide.md`)).status).toBe(
      404,
    );
    expect((await h.request(`/api/v1/files${address}?path=restricted/SKILLCDN.md`)).status).toBe(
      200,
    );
    expect(
      (await h.request(`/api/v1/files${address}?path=restricted/reopened/SKILLCDN.md`)).status,
    ).toBe(404);
    const restricted = restBrowseSchema.parse(
      await (await h.request(`/api/v1/browse${address}?path=restricted`)).json(),
    );
    expect(restricted.status === "ready" ? restricted.entries : undefined).toEqual([]);
    const nested = restBrowseSchema.parse(
      await (await h.request(`/api/v1/browse${address}/restricted?path=restricted`)).json(),
    );
    expect(nested.status === "ready" ? nested.entries : undefined).toEqual([]);
  });
});
