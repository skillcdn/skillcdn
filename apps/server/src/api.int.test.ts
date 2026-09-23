import type { Client } from "@modelcontextprotocol/client";
import { INDEXING_NOTICE, INSTRUCTIONS_MAX_LENGTH, PROVENANCE_NOTICE } from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type HarnessOptions } from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

const harness = (options: HarnessOptions = {}) => createHarness(testDatabase, options);

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

describe("behind a reverse proxy", () => {
  /** What the Node adapter hands to the app: the socket the request arrived on. */
  const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
  const accessLine = (logs: Record<string, unknown>[], path: string) =>
    logs.find((line) => line.msg === "request" && line.path === path);

  it("believes forwarding headers and request ids only from a trusted proxy", async () => {
    const { app, logs } = harness({ trustedProxies: ["10.0.0.0/8"] });
    const headers = { "x-forwarded-for": "198.51.100.7", "x-request-id": "edge-1234" };

    const trusted = await app.request("/via-proxy", { headers }, from("10.1.2.3"));
    expect(trusted.headers.get("x-request-id")).toBe("edge-1234");
    expect(accessLine(logs, "/via-proxy")).toMatchObject({
      requestId: "edge-1234",
      clientAddress: "198.51.100.7",
      method: "GET",
      status: 404,
    });

    const direct = await app.request("/direct", { headers }, from("203.0.113.9"));
    const generated = direct.headers.get("x-request-id");
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(accessLine(logs, "/direct")).toMatchObject({
      requestId: generated,
      clientAddress: "203.0.113.9",
    });
  });

  it("reads the client address from the configured header", async () => {
    const { app, logs } = harness({ trustedProxies: ["127.0.0.1"], clientIpHeader: "x-real-ip" });
    await app.request("/real-ip", { headers: { "x-real-ip": "198.51.100.8" } }, from("127.0.0.1"));
    expect(accessLine(logs, "/real-ip")).toMatchObject({ clientAddress: "198.51.100.8" });
  });

  it("logs the path without its query, and leaves probes out of the log", async () => {
    const { app, logs } = harness();
    await app.request("/somewhere?token=not-for-the-log", {}, from("203.0.113.9"));
    await app.request("/healthz", {}, from("203.0.113.9"));
    await app.request("/readyz", {}, from("203.0.113.9"));
    expect(JSON.stringify(logs)).not.toContain("not-for-the-log");
    expect(accessLine(logs, "/somewhere")).toBeDefined();
    expect(logs.filter((line) => line.msg === "request")).toHaveLength(1);
  });

  it("gives MCP responses a request id too", async () => {
    // A commit of its own: the first test to index the default one counts the host's calls.
    const { request } = harness({ host: createFixtureHost("request-id") });
    const response = await request(`/gh/acme/multi-skill@${fixtureCommits("request-id").main}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
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
    expect(listing.text).toContain("2 skills and 1 document in Acme/multi-skill");
    expect(listing.text).toContain("1. skill: incident-review (skills/incident-review)");
    expect(listing.text).toContain("2. skill: release-notes (skills/release-notes)");
    expect(listing.text).toContain("document: docs/getting-started.md - Getting started");
    // The root README.md is for the git host: outside docs/, it is not served.
    expect(listing.text).not.toContain("README.md");
    // A skill's own files come with the skill, not on their own.
    expect(listing.text).not.toContain("references/style.md");
    expect(listing.text).toContain(PROVENANCE_NOTICE);

    const search = await call(client, "find", { query: "how do I run a blameless review?" });
    expect(search.text).toContain("1. skill: incident-review");

    // A skill's file that matches is listed under the skill, which takes its place in the order.
    const fragment = await call(client, "find", { query: "style guide" });
    expect(fragment.text).toContain("1. skill: release-notes (skills/release-notes)");
    expect(fragment.text).toContain(
      "   Its files that match as well (get loads the skill; read_file reads one):\n   - skills/release-notes/references/style.md - Release notes style guide",
    );
    expect(fragment.text).not.toContain("document: skills/release-notes/references/style.md");

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
    ).toEqual(["find", "find", "find", "get", "get", "read_file", "read_file"]);
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
      ["nowhere", "No file at nowhere"],
      ["../single-skill/SKILL.md", "Not a valid path"],
      ["/etc/passwd", "Not a valid path"],
    ] as const) {
      const result = await call(client, "read_file", { path });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(reason);
    }
    await client.close();
  });

  it("tells a client what the repository holds as it connects", async () => {
    const host = createFixtureHost("connect-catalog");
    // Pinned, so that the ref cache of the earlier tests does not answer with their commit.
    const commit = fixtureCommits("connect-catalog").main;
    const release = host.holdTrees();
    const h = harness({ host });

    // Until the index is there, the instructions say so and the tools still work.
    const early = await h.connect(`/gh/acme/multi-skill@${commit}`);
    expect(early.getInstructions()).toContain("Acme/multi-skill");
    expect(early.getInstructions()).toContain("The commit is being indexed");
    await early.close();
    release();
    await h.snapshots.idle();

    const client = await h.connect(`/gh/acme/multi-skill@${commit}/skills`);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain(
      `Acme/multi-skill@${commit} (commit ${commit.slice(0, 7)}, under skills)`,
    );
    expect(instructions).toContain("It has 2 skills and 0 other documents.");
    expect(instructions).toContain("- incident-review: Guides a blameless incident review");
    expect(instructions).toContain("- release-notes: Drafts release notes");
    expect(instructions).toContain("call get with its name");
    expect(instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(client.getServerVersion()).toMatchObject({
      name: "skillcdn",
      title: `Acme/multi-skill@${commit.slice(0, 7)}/skills`,
      websiteUrl: `http://skillcdn.test/gh/acme/multi-skill@${commit}/skills`,
    });
    const find = (await client.listTools()).tools.find((tool) => tool.name === "find");
    expect(find?.description).toContain("Skills here: incident-review, release-notes.");
    await client.close();
  });

  it("offers every skill as a prompt", async () => {
    const h = harness();
    const first = await h.connect("/gh/acme/multi-skill");
    await call(first, "find");
    await first.close();

    // The list is what the index knows when the client connects.
    const client = await h.connect("/gh/acme/multi-skill");
    const listed = await client.listPrompts();
    expect(listed.prompts.map((prompt) => [prompt.name, prompt.title])).toEqual([
      ["incident-review", "incident-review"],
      ["release-notes", "release-notes"],
    ]);
    expect(listed.prompts[1]?.description).toContain("Drafts release notes");

    const prompt = await client.getPrompt({ name: "release-notes" });
    expect(prompt.description).toContain("Drafts release notes");
    const [message] = prompt.messages;
    expect(message?.role).toBe("user");
    const text = message?.content.type === "text" ? message.content.text : "";
    expect(text).toContain("Skill: release-notes");
    expect(text).toContain("- skills/release-notes/references/style.md");
    expect(text).toContain("Group them into");
    expect(h.usage.filter((event) => event.subject === "prompt")).toHaveLength(1);
    await client.close();
  });

  it("lists a directory through read_file", async () => {
    const client = await harness().connect("/gh/acme/multi-skill");

    const root = await call(client, "read_file", { path: "." });
    expect(root.isError).toBe(false);
    expect(root.text).toContain("Directory: the mounted root (2 entries)");
    expect(root.text).toContain("- docs/");
    expect(root.text).toContain("- skills/");
    expect(root.text).not.toContain("README.md");

    const skill = await call(client, "read_file", { path: "skills/release-notes" });
    expect(skill.text).toContain("Directory: skills/release-notes/ (2 entries)");
    expect(skill.text).toContain("- skills/release-notes/references/");
    expect(skill.text).toContain("- skills/release-notes/SKILL.md (");

    expect((await call(client, "read_file", { path: "skills/nowhere" })).isError).toBe(true);
    await client.close();
  });

  it("never serves hidden entries", async () => {
    const host = createFixtureHost("hidden");
    const encode = (text: string) => new TextEncoder().encode(text);
    host.addFile(".editorconfig", encode("root = true\n"));
    host.addFile(".github/workflows/ci.yml", encode("on: push\n"));
    host.addFile("docs/.draft.md", encode("# Draft\n\nNot for agents.\n"));
    const client = await harness({ host }).connect(
      `/gh/acme/multi-skill@${fixtureCommits("hidden").main}`,
    );

    const listing = await call(client, "find");
    expect(listing.text).toContain("2 skills and 1 document");
    expect(listing.text).not.toContain(".draft.md");
    const search = await call(client, "find", { query: "draft agents" });
    expect(search.text).not.toContain(".draft.md");

    const root = await call(client, "read_file", { path: "." });
    expect(root.text).toContain("(2 entries)");
    expect(root.text).not.toContain(".editorconfig");
    expect(root.text).not.toContain(".github");
    const docs = await call(client, "read_file", { path: "docs" });
    expect(docs.text).toContain("- docs/getting-started.md (");
    expect(docs.text).not.toContain(".draft.md");
    for (const path of [".editorconfig", ".github", ".github/workflows/ci.yml", "docs/.draft.md"]) {
      expect((await call(client, "read_file", { path })).isError, path).toBe(true);
    }
    await client.close();
  });

  it("confines a sub-path mount to its directory", async () => {
    const client = await harness().connect("/gh/acme/multi-skill@main/skills/release-notes");

    const listing = await call(client, "find");
    expect(listing.text).toContain("under skills/release-notes");
    expect(listing.text).toContain("1 skill and 0 documents in");
    expect(listing.text).toContain("1. skill: release-notes (.)");
    // The mount is one skill: its files come with the skill, not as documents of the mount.
    expect(listing.text).not.toContain("document: references/style.md");
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

  it("skips broken manifests, keeps serving the rest, and says what was skipped and why", async () => {
    const h = harness();
    await (await h.connect("/gh/acme/hostile")).close();
    await h.snapshots.idle();
    const client = await h.connect("/gh/acme/hostile");
    // The instructions count what could not be read, so that a model asked for one of those
    // skills by name does not look for it in vain.
    expect(client.getInstructions()).toContain("It has 3 skills and 0 other documents.");
    expect(client.getInstructions()).toMatch(
      /7 manifests could not be read and are not served \(skills\/alias-bomb\/SKILL\.md, skills\/bad-yaml\/SKILL\.md, skills\/colon-in-description\/SKILL\.md and 4 more\); find without a query says why\./,
    );

    const listing = await call(client, "find", { limit: 25 });
    expect(listing.text).toContain("skill: Loud Name (skills/Loud_Name)");
    expect(listing.text).toContain("skill: commented-value (skills/commented-value)");
    expect(listing.text).toContain("skill: valid-neighbor (skills/valid-neighbor)");
    expect(listing.text).not.toContain("skill: alias-bomb");
    expect(listing.text).not.toContain("skill: tagged");
    // A SKILL.md that cannot be read as a skill is no document of the mount, but it stays
    // readable, so that the author can see what was found; the listing says why it is missing.
    expect(listing.text).not.toContain("document: skills/no-front-matter/SKILL.md");
    expect(listing.text).toContain(
      "Manifests that could not be read, so what they declare is not served (fix them and push; the next commit is indexed anew):",
    );
    expect(listing.text).toContain(
      '- skills/colon-in-description/SKILL.md (invalid_front_matter): front-matter is not valid YAML (BLOCK_AS_IMPLICIT_KEY): the value of "description" contains ": "; quote the value or write it as a block scalar (>)',
    );
    expect(listing.text).toContain("- skills/no-front-matter/SKILL.md (missing_front_matter)");
    const unread = await call(client, "read_file", { path: "skills/no-front-matter/SKILL.md" });
    expect(unread.isError).toBe(false);
    expect(unread.text).toContain("No front-matter");

    // Among search results, one line points at the listing.
    const search = await call(client, "find", { query: "neighbor" });
    expect(search.text).toContain("1. skill: valid-neighbor");
    expect(search.text).toContain(
      "Note: 7 manifests could not be read and are not served; find without a query says which.",
    );
    expect(search.text).not.toContain("BLOCK_AS_IMPLICIT_KEY");

    const loud = await call(client, "get", { name: "loud name" });
    expect(loud.isError).toBe(false);
    expect(loud.text).toContain("Warnings for the skill author:");
    // A value cut at a hash is served as YAML read it, and the author is told.
    const commented = await call(client, "get", { name: "commented-value" });
    expect(commented.text).toContain("Description: Greets people\n");
    expect(commented.text).toContain('- the value of "description" is cut at " #"');

    // Asking for a skill that could not be read gets the reason, not only the list of the rest.
    const unknown = await call(client, "get", { name: "colon-in-description" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Available skills: Loud Name, commented-value, valid-neighbor.");
    expect(unknown.text).toContain(
      '- skills/colon-in-description/SKILL.md (invalid_front_matter): front-matter is not valid YAML (BLOCK_AS_IMPLICIT_KEY): the value of "description" contains ": "',
    );
    await client.close();
  });
});

describe("a repository with a manifest", () => {
  /** Connects once so that indexing starts, waits for it, and connects to the ready index. */
  async function connectIndexed(h: ReturnType<typeof harness>, address: string): Promise<Client> {
    await (await h.connect(address)).close();
    await h.snapshots.idle();
    return h.connect(address);
  }

  it("introduces itself, serves only what it declares, and hands its rules over with every skill", async () => {
    const h = harness();
    const client = await connectIndexed(h, "/gh/acme/with-manifest");
    expect(client.getInstructions()).toContain(
      "This server serves Acme playbooks, the git repository Acme/with-manifest",
    );
    expect(client.getInstructions()).toContain("The playbooks every Acme team runs.");
    expect(client.getInstructions()).toContain("Rules that hold for every skill here");
    expect(client.getServerVersion()).toMatchObject({ title: "Acme playbooks" });

    const listing = await call(client, "find");
    expect(listing.text).toContain("1 skill and 1 document in Acme/with-manifest");
    expect(listing.text).toContain("document: docs/guide.md - Using the playbooks");
    expect(listing.text).not.toContain("README.md");
    expect(listing.text).not.toContain("notes/");
    expect((await call(client, "find", { query: "not served" })).text).not.toContain("private.md");

    const root = await call(client, "read_file", { path: "." });
    expect(root.text).toContain("Directory: the mounted root (3 entries)");
    expect(root.text).toContain("- docs/");
    expect(root.text).toContain("- skills/");
    expect(root.text).toContain("- SKILLCDN.md (");
    for (const path of ["README.md", "notes/private.md", "scripts/check.mjs", "notes"]) {
      expect((await call(client, "read_file", { path })).isError, path).toBe(true);
    }
    expect((await call(client, "read_file", { path: "SKILLCDN.md" })).text).toContain(
      "name: Acme playbooks",
    );
    expect((await call(client, "read_file", { path: "docs/guide.md" })).isError).toBe(false);

    const skill = await call(client, "get", { name: "greeting" });
    expect(skill.text).toContain(
      "--- rules for every skill in this repository (from SKILLCDN.md) ---\n# Rules for every skill in this repository\n\n- Ask when a choice changes the result",
    );
    expect(skill.text.indexOf("--- rules")).toBeLessThan(skill.text.indexOf("--- instructions"));
    // The file the skill declares as needed on every run comes with it, after the instructions.
    expect(skill.text).toContain("- skills/greeting/references/tone.md (included below)");
    expect(skill.text).toContain(
      "--- included file: skills/greeting/references/tone.md ---\n# Tone\n\nWarm and brief.",
    );
    expect(skill.text.indexOf("--- instructions")).toBeLessThan(
      skill.text.indexOf("--- included file"),
    );
    // Translations are for people; a model reads the original.
    expect(skill.text).not.toContain("인사말");
    const prompt = await client.getPrompt({ name: "greeting" });
    expect(prompt.messages[0]?.content).toMatchObject({ type: "text" });
    expect(JSON.stringify(prompt.messages[0]?.content)).toContain("rules for every skill");
    expect(JSON.stringify(prompt.messages[0]?.content)).toContain("included file");
    await client.close();
  });

  it("says which language the repository is written in", async () => {
    const client = await connectIndexed(harness(), "/gh/acme/with-manifest");
    expect(client.getInstructions()).toContain(
      "It has 1 skill and 1 other document. Written in en.",
    );
    const find = (await client.listTools()).tools.find((tool) => tool.name === "find");
    expect(find?.description).toContain("Written in en. Skills here: greeting.");
    await client.close();
  });

  it("governs a sub-path mount from above it", async () => {
    const client = await connectIndexed(harness(), "/gh/acme/with-manifest@main/skills");
    expect(client.getInstructions()).toContain("This server serves Acme playbooks");
    const skill = await call(client, "get", { name: "greeting" });
    expect(skill.text).toContain("(from the repository manifest above the mounted directory) ---");
    // The manifest lies outside the mount, so it cannot be read from here.
    expect((await call(client, "read_file", { path: "SKILLCDN.md" })).isError).toBe(true);
    await client.close();
  });

  it("serves only the skills when the manifest cannot be read", async () => {
    const host = createFixtureHost("broken-manifest");
    host.addFile(
      "SKILLCDN.md",
      new TextEncoder().encode("---\nname: Broken\n---\n# No description\n"),
    );
    const client = await connectIndexed(
      harness({ host }),
      `/gh/acme/multi-skill@${fixtureCommits("broken-manifest").main}`,
    );
    expect(client.getInstructions()).toContain("the skills and documents of the git repository");
    expect(client.getInstructions()).not.toContain("Broken");
    const listing = await call(client, "find");
    expect(listing.text).toContain("2 skills and 0 documents");
    expect((await call(client, "read_file", { path: "README.md" })).isError).toBe(true);
    // The file itself stays readable, so the author can see what was found.
    expect((await call(client, "read_file", { path: "SKILLCDN.md" })).isError).toBe(false);
    expect((await call(client, "get", { name: "release-notes" })).text).not.toContain("--- rules");
    await client.close();
  });

  it("keeps its files out of reach while the commit is still being indexed", async () => {
    const host = createFixtureHost("manifest-indexing");
    const indexingStarted = Promise.withResolvers<void>();
    const resumeIndexing = Promise.withResolvers<void>();
    const getTree = host.getTree;
    let heldIndexer = false;
    host.getTree = async (...args) => {
      // Hold only the indexer's first tree request. Fallback reads must finish before
      // indexing resumes, regardless of how the database schedules their requests.
      if (!heldIndexer) {
        heldIndexer = true;
        indexingStarted.resolve();
        await resumeIndexing.promise;
      }
      return getTree(...args);
    };
    const { connect, snapshots } = harness({ host });
    const client = await connect(
      `/gh/acme/with-manifest@${fixtureCommits("manifest-indexing").main}`,
    );
    try {
      await indexingStarted.promise;
      const [root, guide, skill] = await Promise.all([
        call(client, "read_file", { path: "." }),
        call(client, "read_file", { path: "docs/guide.md" }),
        call(client, "read_file", { path: "skills/greeting/SKILL.md" }),
      ]);
      expect(root.text).toContain("- skills/");
      expect(root.text).toContain("- SKILLCDN.md (");
      expect(root.text).not.toContain("README.md");
      expect(root.text).not.toContain("notes/");
      // Nothing has read the manifest yet, so its declared directory is not served: closed, not guessed.
      expect(guide.isError).toBe(true);
      expect(skill.isError).toBe(false);

      resumeIndexing.resolve();
      await snapshots.idle();
      expect((await call(client, "read_file", { path: "docs/guide.md" })).isError).toBe(false);
    } finally {
      resumeIndexing.resolve();
      await snapshots.idle();
      await client.close();
    }
  });
});

describe("a repository the operator vouches for", () => {
  it("carries no provenance notice, while every other repository does", async () => {
    const h = harness({ verified: ["/gh/Acme/single-skill"] });
    const vouched = await h.connect("/gh/acme/single-skill");
    const skill = await call(vouched, "get", { name: "commit-messages" });
    expect(skill.isError).toBe(false);
    expect(skill.text).not.toContain(PROVENANCE_NOTICE);
    expect((await call(vouched, "read_file", { path: "SKILL.md" })).text).not.toContain(
      PROVENANCE_NOTICE,
    );
    await vouched.close();

    const other = await h.connect("/gh/acme/multi-skill");
    expect((await call(other, "find")).text).toContain(PROVENANCE_NOTICE);
    await other.close();
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
      archiveAlters: (path) => path === "docs/notes/note-0.md",
    });
    // Bodies are content-addressed and other tests already stored the fixture files, so the
    // commit needs files of its own for there to be anything to fetch.
    for (let index = 0; index < 6; index += 1) {
      const note = `# Archive note ${index}

Only the archive test has this text: zeppelin ${index}.
`;
      host.addFile(`docs/notes/note-${index}.md`, new TextEncoder().encode(note));
    }
    const { connect } = harness({ host });
    // Pinned: the default branch of this repository is already cached at another test's commit.
    const client = await connect(`/gh/acme/multi-skill@${fixtureCommits("archive").main}`);

    const found = await call(client, "find", { query: "zeppelin" });
    expect(found.text).toContain("6 results");
    expect(host.calls.readArchive).toBe(1);
    // Only the file whose archived copy did not match its hash went the slow way.
    expect(host.calls.readBlob).toBe(1);

    const altered = await call(client, "read_file", { path: "docs/notes/note-0.md" });
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

describe("a client running in a browser, on another origin", () => {
  it("gets its preflight answered and may talk to the endpoint without credentials", async () => {
    const { request } = harness();
    const preflight = await request("/gh/acme/single-skill", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, mcp-protocol-version",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
    expect(preflight.headers.get("access-control-max-age")).toBe("86400");

    const listed = await request("/gh/acme/single-skill", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("access-control-allow-origin")).toBe("*");
    expect(listed.headers.get("access-control-allow-credentials")).toBeNull();
    expect(listed.headers.get("access-control-expose-headers")).toContain("x-request-id");
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
