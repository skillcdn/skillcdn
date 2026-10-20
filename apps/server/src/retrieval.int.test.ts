import { allowEverything, type FindResult, parseAddress } from "@skillcdn/core";
import { createBlobStore } from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { INDEX_LIMIT_DEFAULTS } from "@skillcdn/indexer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MountService } from "./mounts/mount-service.js";
import { createMountReader } from "./mounts/reader.js";
import {
  evaluateRetrieval,
  loadRetrievalSet,
  memorySearch,
  RETRIEVAL_PAGE,
} from "./retrieval/evaluate.js";
import { createFixtureHost } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";
import { textOf } from "./testing/tool-text.js";

// A document pack is searched the same way wherever its index is kept (ADR-0063): the index a
// deployment keeps in PostgreSQL answers every question of the retrieval evaluation set with the
// documents and the sections the command's index in memory answers, and what an MCP client is
// told of them is the sections with what reads them, and the outline of a file.

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await database?.drop();
});

const ready = async <T extends { status: string }>(
  answer: () => Promise<T>,
): Promise<Extract<T, { status: "ready" }>> => {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await answer();
    if (value.status === "ready") return value as Extract<T, { status: "ready" }>;
    if (Date.now() > deadline) throw new Error(`not ready: ${value.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** The sections of each document on a page, by path, as the two indexes name them. */
const sectionsByPath = (result: FindResult) =>
  Object.fromEntries(
    result.items.flatMap((item) =>
      item.kind === "document" ? [[item.path, item.sections ?? []] as const] : [],
    ),
  );

describe("the document pack from a deployment's index", () => {
  it("answers the evaluation set as the index in memory does, sections included", async () => {
    const host = createFixtureHost();
    const h = createHarness(database, { host });
    const parsed = parseAddress("/gh/acme/document-pack");
    if (!parsed.ok) throw new Error("invalid fixture address");
    const mounts = new MountService({
      database: database.database,
      gitHost: h.host,
      clock: { now: () => new Date() },
      entitlements: allowEverything,
      repoTtlMs: 60_000,
      refTtlMs: 60_000,
      staleGraceMs: 60_000,
      isVerified: async () => true,
      imageOf: async () => undefined,
    });
    const mount = await mounts.resolve(parsed.value);
    const stored = createMountReader({
      database: database.database,
      gitHost: h.host,
      snapshots: h.snapshots,
      limits: INDEX_LIMIT_DEFAULTS,
      blobStore: createBlobStore(database.database),
    });
    const memory = await memorySearch();
    const set = loadRetrievalSet();

    const fromStore = async (query: string): Promise<FindResult> =>
      (await ready(() => stored.find(mount, { query, limit: RETRIEVAL_PAGE }, 20_000))).result;
    for (const question of set.questions) {
      const [inStore, inMemory] = await Promise.all([
        fromStore(question.query),
        memory(question.query),
      ]);
      const paths = (result: FindResult) => result.items.map((item) => item.path).sort();
      expect(paths(inStore), question.id).toEqual(paths(inMemory));
      expect(sectionsByPath(inStore), question.id).toEqual(sectionsByPath(inMemory));
    }
    // And the numbers are the same numbers.
    const storeScore = await evaluateRetrieval(set, (question) => fromStore(question.query));
    const memoryScore = await evaluateRetrieval(set, (question) => memory(question.query));
    expect(storeScore.fileAt5).toBe(memoryScore.fileAt5);
    expect(storeScore.sectionAt2).toBe(memoryScore.sectionAt2);
  });

  it("tells an MCP client the sections that matched and the outline of a file", async () => {
    const { connect } = createHarness(database, { host: createFixtureHost() });
    const client = await connect("/gh/acme/document-pack");

    const search = textOf(
      await client.callTool({ name: "search_repo", arguments: { query: "waive a late fee" } }),
    );
    expect(search).toContain("1. document: docs/invoicing.md - Invoicing");
    expect(search).toMatch(/ {3}- Invoicing > Late fees \(offset \d+, limit \d+\): .*late fee/);
    expect(search).toContain(
      "A section is read with read_repo_file: the path, its offset and its limit.",
    );

    // The section is read with what the result said, and starts at its heading.
    const match = / {3}- Invoicing > Late fees \(offset (\d+), limit (\d+)\)/.exec(search);
    const page = textOf(
      await client.callTool({
        name: "read_repo_file",
        arguments: {
          path: "docs/invoicing.md",
          offset: Number(match?.[1]),
          limit: Number(match?.[2]),
        },
      }),
    );
    expect(page).toContain("--- content ---\n## Late fees");
    expect(page).toContain("a bookkeeper can waive a fee");

    // A Korean question finds its section through the pairs of its characters.
    const korean = loadRetrievalSet().questions.find((question) => question.id === "ko-13");
    if (korean === undefined) throw new Error("the Korean question is missing");
    const found = textOf(
      await client.callTool({ name: "search_repo", arguments: { query: korean.query } }),
    );
    expect(found).toContain("1. document: ko/docs/expenses.md");
    expect(found).toContain(korean.answers[0]?.heading.join(" > ") ?? "");

    const outline = textOf(
      await client.callTool({ name: "browse_repo", arguments: { path: "docs/invoicing.md" } }),
    );
    expect(outline).toMatch(/^File: docs\/invoicing\.md \(\d+ characters; 8 headings\)/);
    expect(outline).toContain("- # Invoicing (offset ");
    expect(outline).toContain("  - ## Late fees (offset ");
    expect(outline).toContain("Outline; a section is read with read_repo_file");

    const data = textOf(
      await client.callTool({ name: "browse_repo", arguments: { path: "ko/SKILLCDN.md" } }),
    );
    expect(data).toContain("File: ko/SKILLCDN.md");
    expect(data).toContain("- # Rules for reading the office handbook");
    await client.close();
  });
});
