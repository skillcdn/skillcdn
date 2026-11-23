import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { type IndexOutcome, parseAddress, type ReadableIndex, ROOT_PATH } from "@skillcdn/core";
import { INDEX_LIMIT_DEFAULTS, readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, Reader } from "@skillcdn/reader";
import { beforeAll, describe, expect, it } from "vitest";
import * as z from "zod";
import { PINNED_TTL_MS, type ServedMount, SURFACE_TTL_MS } from "./mount.js";
import { createMountServer } from "./tools.js";

// What a client is told to keep of the three answers the SDK builds itself, `server/discover`,
// `tools/list` and `prompts/list` (docs/specs/tools.md), over mounts as a deployment resolves
// them: a moving ref and a pinned commit, a public repository and a private one.

const NOW = Date.parse("2026-10-18T00:00:00Z");
/** What is left of the ref resolution's life in these tests. */
const REF_LEFT_MS = 40_000;
const COMMIT = "a".repeat(40);
const NEWER = "b".repeat(40);

interface TestMount extends ServedMount {
  /** What the reader is handed as the index of the mount's commit. */
  readonly outcome: IndexOutcome;
}

let index: ReadableIndex;
beforeAll(async () => {
  const root = join(await mkdtemp(join(tmpdir(), "skillcdn-serve-")), "pack");
  const files: Record<string, string> = {
    "SKILLCDN.md": "---\nname: Acme skills\ndescription: The skills of Acme.\n---\n",
    "ads/SKILL.md": "---\nname: ads\ndescription: Writes ad copy.\n---\n# Ads\n\nThree variants.\n",
  };
  for (const [file, contents] of Object.entries(files)) {
    const parts = file.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  const read = await readDirectory({
    directory: root,
    limits: INDEX_LIMIT_DEFAULTS,
    repository: { owner: "acme", name: "pack" },
  });
  index = createMemoryIndex({ index: read.index, blobs: read.blobs });
});

function mountOf(options: {
  readonly pinned?: boolean;
  readonly visibility?: "public" | "private";
  readonly trustedUntil?: Date;
  readonly outcome?: IndexOutcome;
}): TestMount {
  const pinned = options.pinned === true;
  const address = parseAddress(`/gh/acme/pack${pinned ? `@${COMMIT}` : ""}`);
  if (!address.ok) throw new Error("invalid test address");
  const url = (path: string): string => `https://git.example/acme/pack/${path}`;
  return {
    address: { ...address.value, path: ROOT_PATH },
    commit: COMMIT,
    verified: true,
    limits: {},
    repository: "acme/pack",
    description: undefined,
    sourceUrl: url,
    rawUrl: url,
    trustedUntil: pinned ? undefined : (options.trustedUntil ?? new Date(NOW + REF_LEFT_MS)),
    visibility: options.visibility ?? "public",
    outcome: options.outcome ?? { status: "ready", index },
  };
}

/** A client of the mount's server, as a deployment that gives `surfaceTtlMs` builds it. */
async function clientOf(
  mount: TestMount,
  options: { readonly surfaceTtlMs?: number; readonly revision?: "earlier" } = {
    surfaceTtlMs: SURFACE_TTL_MS,
  },
): Promise<Client> {
  const reader = new Reader<TestMount>({
    limits: INDEX_LIMIT_DEFAULTS,
    index: async (served) => served.outcome,
  });
  const handler = createMcpHandler(async () =>
    createMountServer(mount, {
      reader,
      clock: { now: () => new Date(NOW) },
      logger: { warn: () => {}, error: () => {} },
      indexWaitMs: 0,
      server: { name: "skillcdn", version: "0.0.0-test" },
      surfaceTtlMs: options.surfaceTtlMs,
    }),
  );
  const client = new Client(
    { name: "skillcdn-test", version: "0.0.0" },
    // The current revision is the one that has cache fields; the SDK's client speaks the
    // revisions before it unless it is pinned.
    options.revision === "earlier" ? {} : { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://deployment.test/gh/acme/pack"), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    }),
  );
  return client;
}

const cacheFields = z.looseObject({
  ttlMs: z.number().optional(),
  cacheScope: z.string().optional(),
});

/** The cache fields of the three answers, as they arrived. */
async function kept(client: Client) {
  const fields = (result: z.infer<typeof cacheFields>) => ({
    ttlMs: result.ttlMs,
    cacheScope: result.cacheScope,
  });
  const answers = {
    discover: fields(cacheFields.parse(await client.discover())),
    tools: fields(await client.request({ method: "tools/list", params: {} }, cacheFields)),
    prompts: fields(await client.request({ method: "prompts/list", params: {} }, cacheFields)),
  };
  await client.close();
  return answers;
}

describe("the cache fields of discovery and the lists", () => {
  it("keeps the lists an hour and discovery as long as the ref is trusted, for everyone at a public address", async () => {
    const lists = { ttlMs: SURFACE_TTL_MS, cacheScope: "public" };
    expect(await kept(await clientOf(mountOf({})))).toEqual({
      discover: { ttlMs: REF_LEFT_MS, cacheScope: "public" },
      tools: lists,
      prompts: lists,
    });
  });

  it("keeps them for one person at an address that is not public", async () => {
    const lists = { ttlMs: SURFACE_TTL_MS, cacheScope: "private" };
    expect(await kept(await clientOf(mountOf({ visibility: "private" })))).toEqual({
      discover: { ttlMs: REF_LEFT_MS, cacheScope: "private" },
      tools: lists,
      prompts: lists,
    });
  });

  it("keeps discovery of a pinned commit no longer than the lists, which the same release wrote", async () => {
    expect(SURFACE_TTL_MS).toBeLessThan(PINNED_TTL_MS);
    const answers = await kept(await clientOf(mountOf({ pinned: true })));
    expect(answers.discover).toEqual({ ttlMs: SURFACE_TTL_MS, cacheScope: "public" });
    expect(answers.tools).toEqual({ ttlMs: SURFACE_TTL_MS, cacheScope: "public" });
  });

  it("keeps discovery five seconds while the commit is not indexed or another index answers for it", async () => {
    const unsettled: IndexOutcome[] = [
      { status: "indexing" },
      { status: "failed", errorCode: "index.too_large" },
      {
        status: "ready",
        index,
        substitute: { commit: COMMIT, newest: { commit: NEWER, status: "indexing" } },
      },
    ];
    for (const outcome of unsettled) {
      for (const pinned of [false, true]) {
        const answers = await kept(await clientOf(mountOf({ outcome, pinned })));
        expect(answers.discover, outcome.status).toEqual({ ttlMs: 5_000, cacheScope: "public" });
        // The lists say nothing of the commit, and are the same whatever becomes of its index.
        expect(answers.tools.ttlMs).toBe(SURFACE_TTL_MS);
        expect(answers.prompts.ttlMs).toBe(SURFACE_TTL_MS);
      }
    }
  });

  it("keeps discovery no longer than the ref is trusted, even while the commit is indexed", async () => {
    const nearly = mountOf({
      outcome: { status: "indexing" },
      trustedUntil: new Date(NOW + 1_200),
    });
    expect((await kept(await clientOf(nearly))).discover.ttlMs).toBe(1_200);
    // A ref served on borrowed time is trusted until now, and no longer.
    const borrowed = await kept(await clientOf(mountOf({ trustedUntil: new Date(NOW) })));
    expect(borrowed.discover.ttlMs).toBe(0);
    expect(borrowed.tools.ttlMs).toBe(SURFACE_TTL_MS);
  });

  it("says to keep nothing where whoever composes the server gives no lifetime", async () => {
    const nothing = { ttlMs: 0, cacheScope: "public" };
    for (const pinned of [false, true]) {
      const client = await clientOf(mountOf({ pinned }), {});
      expect(await kept(client)).toEqual({ discover: nothing, tools: nothing, prompts: nothing });
    }
  });

  it("adds nothing to the answers of the revisions before the current one", async () => {
    const client = await clientOf(mountOf({}), {
      surfaceTtlMs: SURFACE_TTL_MS,
      revision: "earlier",
    });
    expect(client.getNegotiatedProtocolVersion()).not.toBe("2026-07-28");
    const tools = await client.request({ method: "tools/list", params: {} }, cacheFields);
    const prompts = await client.request({ method: "prompts/list", params: {} }, cacheFields);
    await client.close();
    for (const answer of [tools, prompts]) {
      expect(answer).not.toHaveProperty("ttlMs");
      expect(answer).not.toHaveProperty("cacheScope");
    }
  });
});
