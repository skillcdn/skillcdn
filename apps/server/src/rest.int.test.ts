import {
  restErrorSchema,
  restFeaturedSchema,
  restFileSchema,
  restFindSchema,
  restMountSchema,
  restSkillSchema,
} from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness, type Harness, type HarnessOptions } from "./testing/harness.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});

afterAll(async () => {
  await testDatabase?.drop();
});

const harness = (options: HarnessOptions = {}) => createHarness(testDatabase, options);

/** Asks once so that indexing starts, waits until it is done, and leaves the index ready. */
/**
 * Asks for the address until its index is there. Waiting for the service to go idle is not
 * enough on a slow machine: the request that starts indexing can answer before the job is on
 * the books, and then there is nothing to wait for yet.
 */
async function indexed(h: Harness, address: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let status = "unknown";
  while (Date.now() < deadline) {
    const response = await h.request(`/api/v1/mounts${address}`);
    expect(response.status).toBe(200);
    status = restMountSchema.parse(await response.json()).index.status;
    if (status === "ready") {
      return;
    }
    await h.snapshots.idle();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const events = h.logs
    .filter((line) => String(line.msg).includes("index"))
    .map((line) => JSON.stringify(line));
  throw new Error(`${address} is still ${status} after 20 s:\n${events.join("\n")}`);
}

async function errorOf(response: Response) {
  return restErrorSchema.parse(await response.json()).error;
}

describe("GET /api/v1/mounts/<address>", () => {
  it("says that a new commit is being indexed, then what the address serves", async () => {
    const host = createFixtureHost("rest-overview");
    const release = host.holdTrees();
    const h = harness({ host });
    const address = `/gh/acme/multi-skill@${fixtureCommits("rest-overview").main}`;

    const early = await h.request(`/api/v1/mounts${address}`);
    expect(early.status).toBe(200);
    expect(early.headers.get("cache-control")).toBe("no-store");
    expect(restMountSchema.parse(await early.json()).index).toEqual({ status: "indexing" });

    release();
    await h.snapshots.idle();
    const mount = restMountSchema.parse(await (await h.request(`/api/v1/mounts${address}`)).json());
    expect(mount).toMatchObject({
      address,
      repository: {
        host: "gh",
        owner: "Acme",
        name: "multi-skill",
        defaultBranch: "main",
        description: "Two skills and the documents next to them.",
      },
      ref: fixtureCommits("rest-overview").main,
      pinned: true,
      commit: fixtureCommits("rest-overview").main,
      path: "",
      verified: false,
    });
    if (mount.index.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(mount.index.skills.map((skill) => [skill.name, skill.directory])).toEqual([
      ["incident-review", "skills/incident-review"],
      ["release-notes", "skills/release-notes"],
    ]);
    expect(mount.index.skillCount).toBe(2);
    expect(mount.index.documents.map((document) => document.path)).toContain(
      "docs/getting-started.md",
    );
    expect(mount.index.documentCount).toBe(mount.index.documents.length);
    expect(mount.index.truncated).toBe(false);
  });

  it("answers for the default branch and for a sub-path, with paths relative to the mount", async () => {
    const h = harness();
    await indexed(h, "/gh/acme/multi-skill");
    const whole = restMountSchema.parse(
      await (await h.request("/api/v1/mounts/gh/Acme/Multi-Skill")).json(),
    );
    expect(whole).toMatchObject({ address: "/gh/acme/multi-skill", ref: null, pinned: false });

    const sub = restMountSchema.parse(
      await (
        await h.request("/api/v1/mounts/gh/acme/multi-skill@main/skills/release-notes")
      ).json(),
    );
    expect(sub).toMatchObject({ ref: "main", path: "skills/release-notes" });
    if (sub.index.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(sub.index.skills.map((skill) => skill.directory)).toEqual([""]);
    // The mount is one skill, so its files are the skill's, not documents of the mount.
    expect(sub.index.documents).toEqual([]);
    expect(sub.index.documentCount).toBe(0);
  });

  it("tells the author which manifests were skipped, and why", async () => {
    const h = harness();
    await indexed(h, "/gh/acme/hostile");
    const mount = restMountSchema.parse(
      await (await h.request("/api/v1/mounts/gh/acme/hostile")).json(),
    );
    if (mount.index.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(mount.index.skills.map((skill) => skill.name)).toContain("valid-neighbor");
    const skipped = mount.index.diagnostics.map((diagnostic) => diagnostic.path);
    expect(skipped).toContain("skills/missing-description/SKILL.md");
    expect(skipped).toContain("skills/alias-bomb/SKILL.md");

    // Inside a mounted directory: only what is in it, with paths relative to it.
    const inside = restMountSchema.parse(
      await (await h.request("/api/v1/mounts/gh/acme/hostile/skills/alias-bomb")).json(),
    );
    if (inside.index.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(inside.index.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["SKILL.md"]);
  });

  it("answers like the MCP endpoint when the address is wrong or names nothing", async () => {
    const h = harness();
    const malformed = await h.request("/api/v1/mounts/gh/acme/multi-skill/docs%2Fsecret");
    expect(malformed.status).toBe(400);
    expect((await errorOf(malformed)).code).toMatch(/^address\./);

    for (const path of ["/gh/acme/no-such-repo", "/gh/acme/private-repo"]) {
      const missing = await h.request(`/api/v1/mounts${path}`);
      expect(missing.status).toBe(404);
      expect(await errorOf(missing)).toEqual({
        code: "mount.repo_not_found",
        message: "The repository was not found.",
      });
    }
    const noRef = await h.request("/api/v1/mounts/gh/acme/multi-skill@no-such-ref");
    expect(noRef.status).toBe(404);
    expect((await errorOf(noRef)).code).toBe("mount.ref_not_found");
    const empty = await h.request("/api/v1/mounts");
    expect(empty.status).toBe(400);
    expect((await errorOf(empty)).code).toMatch(/^address\./);
  });
});

describe("GET /api/v1/find/<address>", () => {
  it("lists without a query and searches with one", async () => {
    const h = harness();
    await indexed(h, "/gh/acme/multi-skill");

    const listing = restFindSchema.parse(
      await (await h.request("/api/v1/find/gh/acme/multi-skill?limit=2")).json(),
    );
    // Every skill, then up to `limit` documents outside the skills.
    expect(listing).toEqual({
      status: "ready",
      query: null,
      items: [
        expect.objectContaining({ kind: "skill", name: "incident-review" }),
        expect.objectContaining({ kind: "skill", name: "release-notes" }),
        expect.objectContaining({ kind: "document", path: "README.md", skillDirectory: null }),
        expect.objectContaining({ kind: "document", path: "docs/getting-started.md" }),
      ],
      totals: { skills: 2, documents: 2 },
    });

    const search = restFindSchema.parse(
      await (await h.request("/api/v1/find/gh/acme/multi-skill?query=blameless%20review")).json(),
    );
    if (search.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(search.query).toBe("blameless review");
    expect(search.items[0]).toMatchObject({ kind: "skill", name: "incident-review" });
  });

  it("rejects malformed parameters without repeating them", async () => {
    const h = harness();
    const response = await h.request("/api/v1/find/gh/acme/multi-skill?limit=lots-of-them");
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("request.invalid");
    expect(error.message).toContain("limit");
    expect(error.message).not.toContain("lots-of-them");
  });
});

describe("GET /api/v1/skills/<address>", () => {
  it("returns a skill by name and by directory", async () => {
    const h = harness();
    await indexed(h, "/gh/acme/multi-skill");
    for (const name of ["release-notes", "skills/release-notes"]) {
      const answer = restSkillSchema.parse(
        await (
          await h.request(`/api/v1/skills/gh/acme/multi-skill?name=${encodeURIComponent(name)}`)
        ).json(),
      );
      if (answer.status !== "ready") {
        throw new Error("expected a ready index");
      }
      expect(answer.skill).toMatchObject({
        name: "release-notes",
        directory: "skills/release-notes",
        filesTruncated: false,
      });
      expect(answer.skill.body).toContain("# ");
      expect(answer.skill.body).not.toContain("description:");
      expect(answer.skill.files).toContain("skills/release-notes/references/style.md");
    }
  });

  it("says when there is no such skill, and when the name is missing", async () => {
    const h = harness();
    await indexed(h, "/gh/acme/multi-skill");
    const missing = await h.request("/api/v1/skills/gh/acme/multi-skill?name=no-such-skill");
    expect(missing.status).toBe(404);
    expect((await errorOf(missing)).code).toBe("skill.not_found");
    const unnamed = await h.request("/api/v1/skills/gh/acme/multi-skill");
    expect(unnamed.status).toBe(400);
    expect((await errorOf(unnamed)).code).toBe("request.invalid");
  });
});

describe("GET /api/v1/files/<address>", () => {
  it("pages a text file and explains what it cannot read", async () => {
    const host = createFixtureHost("rest-files");
    host.addFile("docs/long.md", new TextEncoder().encode(`# Long\n\n${"0123456789".repeat(200)}`));
    host.addFile("docs/huge.md", new Uint8Array(5000).fill(0x61));
    host.addFile("assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]));
    const h = harness({ host });
    const address = `/gh/acme/single-skill@${fixtureCommits("rest-files").main}`;
    const fileUrl = (query: string) => `/api/v1/files${address}?${query}`;

    // Without an index yet: reading a file never waits for one.
    const first = restFileSchema.parse(
      await (await h.request(fileUrl("path=docs/long.md&limit=1000"))).json(),
    );
    expect(first).toMatchObject({
      kind: "file",
      path: "docs/long.md",
      offset: 0,
      nextOffset: 1000,
      totalLength: 2008,
    });
    if (first.kind !== "file") {
      throw new Error("expected a file");
    }
    expect(first.content).toHaveLength(1000);
    const second = restFileSchema.parse(
      await (await h.request(fileUrl("path=docs/long.md&offset=1000"))).json(),
    );
    expect(second).toMatchObject({ offset: 1000, nextOffset: null });

    // A directory answers with its entries, from the tree while there is no index.
    const directory = restFileSchema.parse(await (await h.request(fileUrl("path=docs"))).json());
    expect(directory).toEqual({
      kind: "directory",
      path: "docs",
      entries: [
        { path: "docs/huge.md", kind: "file", size: 5000 },
        { path: "docs/long.md", kind: "file", size: 2008 },
      ],
      truncated: false,
    });
    const root = restFileSchema.parse(await (await h.request(fileUrl("path=."))).json());
    expect(root).toMatchObject({ kind: "directory", path: "" });

    for (const [query, status, code] of [
      ["path=docs/missing.md", 404, "file.not_found"],
      ["path=docs/huge.md", 413, "file.too_large"],
      ["path=assets/logo.png", 415, "file.not_text"],
      ["path=../single-skill/SKILL.md", 400, "request.invalid"],
      ["offset=3", 400, "request.invalid"],
      ["path=SKILL.md&limit=0", 400, "request.invalid"],
    ] as const) {
      const response = await h.request(fileUrl(query));
      expect(response.status, query).toBe(status);
      expect((await errorOf(response)).code, query).toBe(code);
    }
    await h.snapshots.idle();
  });
});

describe("GET /api/v1/featured", () => {
  it("shows the configured addresses that resolve, and leaves the others out", async () => {
    const commit = fixtureCommits("rest-featured").main;
    const h = harness({
      host: createFixtureHost("rest-featured"),
      featured: [
        `/gh/acme/multi-skill@${commit}`,
        "/gh/acme/no-such-repo",
        "/gh/acme/private-repo",
      ],
    });
    await indexed(h, `/gh/acme/multi-skill@${commit}`);

    const response = await h.request("/api/v1/featured");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(restFeaturedSchema.parse(await response.json())).toEqual({
      items: [
        {
          address: `/gh/acme/multi-skill@${commit}`,
          repository: {
            host: "gh",
            owner: "Acme",
            name: "multi-skill",
            defaultBranch: "main",
            description: "Two skills and the documents next to them.",
          },
          status: "ready",
          skillCount: 2,
          skills: ["incident-review", "release-notes"],
        },
      ],
    });
  });

  it("is empty when nothing is configured", async () => {
    const response = await harness().request("/api/v1/featured");
    expect(await response.json()).toEqual({ items: [] });
  });
});

describe("from a page on another origin", () => {
  it("answers the preflight and lets any origin read the responses, without credentials", async () => {
    const h = harness();
    const origin = "http://localhost:5173";

    const preflight = await h.request("/api/v1/featured", {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("GET");
    expect(preflight.headers.get("access-control-max-age")).toBe("86400");

    const response = await h.request("/api/v1/featured", { headers: { origin } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toContain("x-request-id");

    // Only the API: nothing else on the server answers other origins.
    const probe = await h.request("/healthz", { headers: { origin } });
    expect(probe.headers.get("access-control-allow-origin")).toBeNull();
  });
});
