import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  allowEverything,
  type Entitlements,
  INDEXING_NOTICE,
  PROVENANCE_NOTICE,
  type UsageEvent,
} from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import type { Hono } from "hono";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SnapshotService } from "./indexer/snapshot-service.js";
import { createApi } from "./roles/api.js";
import { createFixtureHost, type FixtureHost, fixtureCommits } from "./testing/fixture-host.js";

const BASE_URL = "http://skillcdn.test";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

interface Harness {
  readonly app: Hono;
  readonly host: FixtureHost;
  readonly snapshots: SnapshotService;
  readonly usage: UsageEvent[];
  connect(address: string): Promise<Client>;
  request(path: string, init?: RequestInit): Promise<Response>;
}

function harness(
  options: { indexWaitMs?: number; entitlements?: Entitlements; host?: FixtureHost } = {},
): Harness {
  const host = options.host ?? createFixtureHost();
  const usage: UsageEvent[] = [];
  const { app, snapshots } = createApi(
    {
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
      indexing: {
        waitMs: options.indexWaitMs ?? 10_000,
        concurrency: 2,
        leaseMs: 60_000,
        limits: {
          maxTreeEntries: 1000,
          maxIndexedFiles: 100,
          maxIndexedFileBytes: 262_144,
          maxIndexedTotalBytes: 1_048_576,
          maxReadableFileBytes: 4096,
          maxArchiveBytes: 10_000_000,
        },
      },
    },
    {
      database: testDatabase.database,
      gitHost: host,
      clock: { now: () => new Date() },
      entitlements: options.entitlements ?? allowEverything,
      usage: { record: (event) => usage.push(event) },
      logger: pino({ level: "silent" }),
      isShuttingDown: () => false,
    },
  );
  const request = async (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${BASE_URL}${path}`, init));
  return {
    app,
    host,
    snapshots,
    usage,
    request,
    async connect(address) {
      const client = new Client({ name: "skillcdn-test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${BASE_URL}${address}`), {
          fetch: async (input, init) => app.fetch(new Request(input, init)),
        }),
      );
      return client;
    },
  };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return {
    text: content.map((block) => block.text ?? "").join("\n"),
    isError: result.isError === true,
  };
}

describe("process endpoints", () => {
  it("reports liveness and readiness", async () => {
    const { request } = harness();
    expect((await request("/healthz")).status).toBe(200);
    const ready = await request("/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    expect((await request("/nothing-here")).status).toBe(404);
  });
});

describe("a multi-skill repository", () => {
  it("serves find, get and read_file to an MCP client", async () => {
    const { connect, host, usage } = harness();
    const client = await connect("/gh/acme/multi-skill");

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["find", "get", "read_file"]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const listing = await call(client, "find");
    expect(listing.isError).toBe(false);
    expect(listing.text).toContain(
      `in Acme/multi-skill (commit ${fixtureCommits().main.slice(0, 7)})`,
    );
    expect(listing.text).toContain("1. skill: incident-review (skills/incident-review)");
    expect(listing.text).toContain("2. skill: release-notes (skills/release-notes)");
    expect(listing.text).toContain("document: docs/getting-started.md - Getting started");
    expect(listing.text).toContain(PROVENANCE_NOTICE);

    const search = await call(client, "find", { query: "how do I run a blameless review?" });
    expect(search.text).toContain("1. skill: incident-review");

    const skill = await call(client, "get", { name: "release-notes" });
    expect(skill.isError).toBe(false);
    expect(skill.text).toContain("Skill: release-notes");
    expect(skill.text).toContain("- skills/release-notes/references/style.md");
    expect(skill.text).toContain("Group them into");
    expect(skill.text).not.toContain("name: release-notes");

    const byDirectory = await call(client, "get", { name: "skills/incident-review" });
    expect(byDirectory.text).toContain("Skill: incident-review");
    expect(byDirectory.text).toContain("- skills/incident-review/scripts/collect.sh");

    const reference = await call(client, "read_file", {
      path: "skills/release-notes/references/style.md",
    });
    expect(reference.text).toContain("Lead with the benefit to the reader.");

    // A script is not searchable, but it is readable: fetched on demand, as text, never run.
    const script = await call(client, "read_file", {
      path: "skills/incident-review/scripts/collect.sh",
    });
    expect(script.text).toContain("#!/bin/sh");

    expect(host.calls.getTree).toBe(1);
    expect(
      usage.filter((event) => event.type === "tool_call").map((event) => event.subject),
    ).toEqual(["find", "find", "get", "get", "read_file", "read_file"]);
    expect(usage.some((event) => event.type === "index_completed")).toBe(true);
    await client.close();
  });

  it("pages long files and explains what it cannot read", async () => {
    const host = createFixtureHost("paging");
    host.addFile("docs/long.md", new TextEncoder().encode(`# Long\n\n${"0123456789".repeat(200)}`));
    host.addFile("docs/huge.md", new Uint8Array(5000).fill(0x61));
    host.addFile("assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]));
    const client = await harness({ host }).connect(
      `/gh/acme/single-skill@${fixtureCommits("paging").main}`,
    );

    const first = await call(client, "read_file", { path: "docs/long.md", limit: 1000 });
    expect(first.text).toContain("characters 0 to 1000 of 2008");
    expect(first.text).toContain("call read_file with offset 1000");
    const second = await call(client, "read_file", { path: "docs/long.md", offset: 1000 });
    expect(second.text).toContain("characters 1000 to 2008 of 2008");

    for (const [path, reason] of [
      ["docs/huge.md", "too large to read"],
      ["assets/logo.png", "not a UTF-8 text file"],
      ["docs/missing.md", "No file at docs/missing.md"],
      ["docs", "No file at docs"],
      ["../single-skill/SKILL.md", "Not a valid path"],
      ["/etc/passwd", "Not a valid path"],
    ] as const) {
      const result = await call(client, "read_file", { path });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(reason);
    }
    await client.close();
  });

  it("confines a sub-path mount to its directory", async () => {
    const client = await harness().connect("/gh/acme/multi-skill@main/skills/release-notes");

    const listing = await call(client, "find");
    expect(listing.text).toContain("under skills/release-notes");
    expect(listing.text).toContain("1. skill: release-notes (.)");
    expect(listing.text).toContain("document: references/style.md");
    expect(listing.text).not.toContain("incident-review");

    expect((await call(client, "get", { name: "release-notes" })).text).toContain(
      "- references/style.md",
    );
    expect((await call(client, "get", { name: "incident-review" })).isError).toBe(true);
    expect((await call(client, "read_file", { path: "references/style.md" })).isError).toBe(false);
    // The file exists in the repository, outside the mount: it must look like it does not exist.
    expect((await call(client, "read_file", { path: "docs/getting-started.md" })).isError).toBe(
      true,
    );
    await client.close();
  });

  it("resolves refs that contain a slash", async () => {
    const client = await harness().connect("/gh/acme/multi-skill@release/1.2:docs");
    const listing = await call(client, "find");
    expect(listing.text).toContain(
      `Acme/multi-skill@release/1.2 (commit ${fixtureCommits().release.slice(0, 7)}, under docs)`,
    );
    expect(listing.text).toContain("document: getting-started.md");
    await client.close();
  });
});

describe("other repository shapes", () => {
  it("treats a root manifest as one skill that owns the repository", async () => {
    const client = await harness().connect("/gh/acme/single-skill");
    const skill = await call(client, "get", { name: "commit-messages" });
    expect(skill.text).toContain("Relative paths in the instructions start at the mounted root.");
    expect(skill.text).toContain("- references/checklist.md");
    expect(skill.text).toContain("License: Apache-2.0");
    await client.close();
  });

  it("skips broken manifests and keeps serving the rest", async () => {
    const client = await harness().connect("/gh/acme/hostile");
    const listing = await call(client, "find", { limit: 25 });
    expect(listing.text).toContain("skill: Loud Name (skills/Loud_Name)");
    expect(listing.text).toContain("skill: valid-neighbor (skills/valid-neighbor)");
    expect(listing.text).not.toContain("skill: alias-bomb");
    expect(listing.text).not.toContain("skill: tagged");
    // A manifest that does not parse is still a document.
    expect(listing.text).toContain("document: skills/no-front-matter/SKILL.md - No front-matter");

    const loud = await call(client, "get", { name: "loud name" });
    expect(loud.isError).toBe(false);
    expect(loud.text).toContain("Warnings for the skill author:");

    const unknown = await call(client, "get", { name: "alias-bomb" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Available skills: Loud Name, valid-neighbor.");
    await client.close();
  });
});

describe("addresses that cannot be served", () => {
  it("answers a missing and a private repository identically", async () => {
    const { request } = harness();
    const missing = await request("/gh/acme/does-not-exist", { method: "POST", body: "{}" });
    const hidden = await request("/gh/acme/private-repo", { method: "POST", body: "{}" });
    expect(missing.status).toBe(404);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
  });

  it("remembers that a name does not exist instead of asking the host every time", async () => {
    const { request, host } = harness();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request("/gh/acme/never-existed", { method: "POST", body: "{}" });
      expect(response.status).toBe(404);
    }
    expect(host.calls.getRepository).toBe(1);
  });

  it("rejects malformed addresses before touching the git host", async () => {
    const { request, host } = harness();
    for (const path of [
      "/gh/acme",
      "/gh/acme/multi-skill/",
      "/gh/acme/multi-skill@release%2F1.2",
    ]) {
      const response = await request(path, { method: "POST", body: "{}" });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toMatch(
        /^address\./,
      );
    }
    expect(host.calls.getRepository).toBe(0);
  });

  it("points at the ref terminator when a ref is not found", async () => {
    const { request } = harness();
    const response = await request("/gh/acme/multi-skill@release/1.3", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("mount.ref_not_found");
    expect(body.error.message).toContain('"@release/1.3:"');
  });

  it("asks the entitlements port before serving", async () => {
    const { request } = harness({
      entitlements: { check: async () => ({ allowed: false, reason: "Not available." }) },
    });
    const response = await request("/gh/acme/multi-skill", { method: "POST", body: "{}" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "mount.not_allowed", message: "Not available." },
    });
  });

  it("refuses oversized request bodies", async () => {
    const { request } = harness();
    const response = await request("/gh/acme/multi-skill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(1024 * 1024 + 1) }),
    });
    expect(response.status).toBe(413);
  });
});

describe("while a commit is being indexed", () => {
  it("answers find with a notice after the budget, keeps read_file working, then serves", async () => {
    const host = createFixtureHost("indexing");
    host.addFile("docs/only-here.md", new TextEncoder().encode("# Only here\n\nFresh content.\n"));
    const release = host.holdTrees();
    const { connect, snapshots } = harness({ host, indexWaitMs: 200 });
    const client = await connect(`/gh/acme/hostile@${fixtureCommits("indexing").release}`);

    const early = await call(client, "find", { query: "fresh" });
    expect(early.isError).toBe(false);
    expect(early.text).toBe(INDEXING_NOTICE);

    const reading = call(client, "read_file", { path: "docs/only-here.md" });
    release();
    expect((await reading).text).toContain("Fresh content.");

    await snapshots.idle();
    const late = await call(client, "find", { query: "fresh" });
    expect(late.text).toContain("document: docs/only-here.md - Only here");
    await client.close();
  });
});

describe("indexing through the archive transport", () => {
  it("fetches a new commit in one request and checks every body against the tree", async () => {
    const host = createFixtureHost("archive", {
      archive: true,
      archiveAlters: (path) => path === "notes/note-0.md",
    });
    // Bodies are content-addressed and other tests already stored the fixture files, so the
    // commit needs files of its own for there to be anything to fetch.
    for (let index = 0; index < 6; index += 1) {
      const note = `# Archive note ${index}

Only the archive test has this text: zeppelin ${index}.
`;
      host.addFile(`notes/note-${index}.md`, new TextEncoder().encode(note));
    }
    const { connect } = harness({ host });
    // Pinned: the default branch of this repository is already cached at another test's commit.
    const client = await connect(`/gh/acme/multi-skill@${fixtureCommits("archive").main}`);

    const found = await call(client, "find", { query: "zeppelin" });
    expect(found.text).toContain("6 results");
    expect(host.calls.readArchive).toBe(1);
    // Only the file whose archived copy did not match its hash went the slow way.
    expect(host.calls.readBlob).toBe(1);

    const altered = await call(client, "read_file", { path: "notes/note-0.md" });
    expect(altered.text).toContain("zeppelin 0");
    expect(altered.text).not.toContain("converted");
    await client.close();
  });

  it("does not bother with an archive for a handful of files", async () => {
    const host = createFixtureHost("archive-small", { archive: true });
    const client = await harness({ host }).connect(
      `/gh/acme/single-skill@${fixtureCommits("archive-small").main}`,
    );
    expect((await call(client, "get", { name: "commit-messages" })).isError).toBe(false);
    expect(host.calls.readArchive).toBe(0);
    await client.close();
  });
});

describe("clients from the previous protocol era", () => {
  it("serves stateless JSON-RPC without a session", async () => {
    const { request } = harness();
    const post = async (message: unknown) => {
      const response = await request("/gh/acme/single-skill", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(message),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      // Clients of that era accept either framing; the stateless fallback answers as an event stream.
      const body = await response.text();
      const payload = response.headers.get("content-type")?.includes("text/event-stream")
        ? (/^data: (.*)$/m.exec(body)?.[1] ?? "")
        : body;
      return JSON.parse(payload) as { result: Record<string, unknown> };
    };

    const initialized = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "legacy-client", version: "1.0.0" },
      },
    });
    expect(initialized.result.serverInfo).toMatchObject({ name: "skillcdn" });
    expect(initialized.result.instructions).toContain("Acme/single-skill");

    const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((listed.result.tools as { name: string }[]).map((tool) => tool.name)).toEqual([
      "find",
      "get",
      "read_file",
    ]);

    const called = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get", arguments: { name: "commit-messages" } },
    });
    expect(JSON.stringify(called.result.content)).toContain("Skill: commit-messages");

    const getRequest = await request("/gh/acme/single-skill", {
      headers: { accept: "text/event-stream" },
    });
    expect(getRequest.status).toBe(405);
  });
});
