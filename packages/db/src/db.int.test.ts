import type { HostRepository } from "@skillcdn/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimSnapshot,
  countEntries,
  createBlobStore,
  type Database,
  deleteRepoAlias,
  ensureSnapshot,
  failSnapshot,
  findCachedRef,
  findRepoByAlias,
  findSkills,
  getEntry,
  getManifest,
  getSchemaStatus,
  getSnapshot,
  getSnapshotDiagnostics,
  listDirectory,
  listEntries,
  listSkillFiles,
  migrateDatabase,
  type NewIndexEntry,
  releaseSnapshot,
  renewSnapshotLease,
  type SnapshotScope,
  saveCachedRef,
  saveRepository,
  searchEntries,
  writeSnapshotIndex,
} from "./index.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

const T0 = new Date("2026-01-01T00:00:00Z");
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

let nextHostId = 1000;
function hostRepository(patch: Partial<HostRepository> = {}): HostRepository {
  nextHostId += 1;
  return {
    hostRepoId: String(nextHostId),
    name: "Skills",
    defaultBranch: "main",
    description: undefined,
    visibility: "public",
    owner: { hostAccountId: `9${nextHostId}`, login: "Acme", kind: "organization" },
    ...patch,
  };
}

async function readySnapshot(entries: NewIndexEntry[], bodies: Record<string, string> = {}) {
  const alias = { host: "gh" as const, owner: `owner${nextHostId}`, repo: "skills" };
  const repo = await saveRepository(database, alias, hostRepository(), T0);
  const snapshot = await ensureSnapshot(
    database,
    { accountId: repo.accountId, repoId: repo.id },
    "a".repeat(40),
  );
  const scope: SnapshotScope = { accountId: repo.accountId, snapshotId: snapshot.id };
  const store = createBlobStore(database);
  for (const [sha, content] of Object.entries(bodies)) {
    await store.write(sha, content);
  }
  expect(await claimSnapshot(database, scope, T0, 60_000)).toBeDefined();
  expect(
    await writeSnapshotIndex(
      database,
      scope,
      { entries, truncated: false, indexedBytes: 0, diagnostics: [] },
      T0,
    ),
  ).toBe(true);
  return scope;
}

function entry(patch: Partial<NewIndexEntry> & Pick<NewIndexEntry, "path">): NewIndexEntry {
  return {
    kind: "markdown",
    size: 10,
    blobSha: `sha-${patch.path}`,
    skillDir: undefined,
    name: undefined,
    title: undefined,
    description: undefined,
    frontMatter: undefined,
    searchable: true,
    visible: true,
    ...patch,
  };
}

describe("migrations", () => {
  it("reports the schema as current after migrating, and migrating again is a no-op", async () => {
    // The newest migration in the journal, whichever that is by now.
    expect(await getSchemaStatus(database)).toEqual({
      current: true,
      expected: expect.stringMatching(/^\d{4}_[a-z0-9-]+$/),
    });
    await migrateDatabase(testDatabase.connectionString);
    expect((await getSchemaStatus(database)).current).toBe(true);
    expect(await database.ping()).toBe(true);
  });
});

describe("repositories", () => {
  it("round-trips what the host reported", async () => {
    const alias = { host: "gh" as const, owner: "acme", repo: "skills" };
    const repository = hostRepository({ description: "Skills for every team." });
    expect(await findRepoByAlias(database, alias)).toBeUndefined();
    const saved = await saveRepository(database, alias, repository, T0);
    expect(await findRepoByAlias(database, alias)).toEqual({
      id: saved.id,
      accountId: saved.accountId,
      host: "gh",
      checkedAt: T0,
      repository,
    });
  });

  it("follows a rename: the same host id keeps its row and gains an alias", async () => {
    const repository = hostRepository();
    const before = await saveRepository(
      database,
      { host: "gh", owner: "acme", repo: "old-name" },
      repository,
      T0,
    );
    const after = await saveRepository(
      database,
      { host: "gh", owner: "acme", repo: "new-name" },
      { ...repository, name: "new-name" },
      minutes(5),
    );
    expect(after.id).toBe(before.id);
    const viaOld = await findRepoByAlias(database, { host: "gh", owner: "acme", repo: "old-name" });
    expect(viaOld?.repository.name).toBe("new-name");
    expect(viaOld?.checkedAt).toEqual(T0);
  });

  it("re-points a recycled name at the repository that owns it now", async () => {
    const alias = { host: "gh" as const, owner: "acme", repo: "recycled" };
    const first = await saveRepository(database, alias, hostRepository(), T0);
    const second = await saveRepository(database, alias, hostRepository(), minutes(1));
    expect(second.id).not.toBe(first.id);
    expect((await findRepoByAlias(database, alias))?.id).toBe(second.id);

    await deleteRepoAlias(database, alias);
    expect(await findRepoByAlias(database, alias)).toBeUndefined();
  });

  it("caches refs per repository and account", async () => {
    const repo = await saveRepository(
      database,
      { host: "gh", owner: "acme", repo: "refs" },
      hostRepository(),
      T0,
    );
    const scope = { accountId: repo.accountId, repoId: repo.id };
    expect(await findCachedRef(database, scope, "")).toBeUndefined();
    await saveCachedRef(database, scope, "", "a".repeat(40), T0);
    await saveCachedRef(database, scope, "", "b".repeat(40), minutes(2));
    await saveCachedRef(database, scope, "release/1.2", "c".repeat(40), minutes(2));
    expect(await findCachedRef(database, scope, "")).toEqual({
      commitSha: "b".repeat(40),
      checkedAt: minutes(2),
    });
    const otherAccount = { ...scope, accountId: "00000000-0000-7000-8000-000000000000" };
    expect(await findCachedRef(database, otherAccount, "")).toBeUndefined();
  });
});

describe("snapshot lifecycle", () => {
  async function pendingSnapshot(): Promise<SnapshotScope> {
    const repo = await saveRepository(
      database,
      { host: "gh", owner: "acme", repo: `life${nextHostId}` },
      hostRepository(),
      T0,
    );
    const scope = { accountId: repo.accountId, repoId: repo.id };
    const first = await ensureSnapshot(database, scope, "d".repeat(40));
    const again = await ensureSnapshot(database, scope, "d".repeat(40));
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ status: "pending", attempts: 0, truncated: false });
    return { accountId: repo.accountId, snapshotId: first.id };
  }

  it("lets exactly one claimant in, until the lease runs out", async () => {
    const scope = await pendingSnapshot();
    const claims = await Promise.all(
      Array.from({ length: 5 }, () => claimSnapshot(database, scope, T0, 60_000)),
    );
    expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);

    expect(await claimSnapshot(database, scope, minutes(0.5), 60_000)).toBeUndefined();
    expect(await renewSnapshotLease(database, scope, minutes(0.5), 60_000)).toBe(true);
    expect(await claimSnapshot(database, scope, minutes(1.2), 60_000)).toBeUndefined();

    const takeover = await claimSnapshot(database, scope, minutes(2), 60_000);
    expect(takeover).toMatchObject({ status: "indexing", attempts: 2 });
  });

  it("hands a released snapshot to the next claimant", async () => {
    const scope = await pendingSnapshot();
    await claimSnapshot(database, scope, T0, 60_000);
    await releaseSnapshot(database, scope, T0);
    expect((await getSnapshot(database, scope))?.status).toBe("pending");
    expect(await claimSnapshot(database, scope, T0, 60_000)).toBeDefined();
  });

  it("retries a failed snapshot only when it is due", async () => {
    const scope = await pendingSnapshot();
    await claimSnapshot(database, scope, T0, 60_000);
    await failSnapshot(database, scope, {
      errorCode: "git_host.rate_limited",
      retryAt: minutes(10),
      now: T0,
    });
    expect(await getSnapshot(database, scope)).toMatchObject({
      status: "failed",
      errorCode: "git_host.rate_limited",
      retryAt: minutes(10),
    });
    expect(await claimSnapshot(database, scope, minutes(9), 60_000)).toBeUndefined();
    expect(await claimSnapshot(database, scope, minutes(10), 60_000)).toMatchObject({
      status: "indexing",
      errorCode: null,
    });
  });

  it("refuses to write an index for a snapshot it no longer holds", async () => {
    const scope = await pendingSnapshot();
    const index = { entries: [], truncated: false, indexedBytes: 0, diagnostics: [] };
    expect(await writeSnapshotIndex(database, scope, index, T0)).toBe(false);
    expect(await renewSnapshotLease(database, scope, T0, 60_000)).toBe(false);

    const stranger = { ...scope, accountId: "00000000-0000-7000-8000-000000000000" };
    expect(await claimSnapshot(database, stranger, T0, 60_000)).toBeUndefined();
    expect(await getSnapshot(database, stranger)).toBeUndefined();
  });

  it("replaces the entries of an earlier attempt and records the outcome", async () => {
    const scope = await pendingSnapshot();
    await claimSnapshot(database, scope, T0, 60_000);
    const diagnostics = [{ path: "skills/x/SKILL.md", code: "invalid_name", message: "bad" }];
    await writeSnapshotIndex(
      database,
      scope,
      { entries: [entry({ path: "a.md" })], truncated: true, indexedBytes: 10, diagnostics },
      T0,
    );
    expect(await getSnapshot(database, scope)).toMatchObject({ status: "ready", truncated: true });
    expect(await getSnapshotDiagnostics(database, scope)).toEqual(diagnostics);
    expect(await getEntry(database, scope, "a.md")).toMatchObject({ path: "a.md" });
    // Once ready, nobody can claim it again.
    expect(await claimSnapshot(database, scope, minutes(60), 60_000)).toBeUndefined();
  });
});

describe("search", () => {
  let scope: SnapshotScope;

  beforeAll(async () => {
    scope = await readySnapshot(
      [
        entry({
          path: "skills/release-notes/SKILL.md",
          kind: "skill",
          blobSha: "body-release",
          skillDir: "skills/release-notes",
          name: "release-notes",
          description: "Drafts release notes from merged changes.",
          frontMatter: { metadata: { author: "acme" }, warnings: [] },
        }),
        entry({
          path: "skills/release-notes/references/style.md",
          blobSha: "body-style",
          skillDir: "skills/release-notes",
          title: "Style guide",
        }),
        entry({
          path: "skills/release-notes/scripts/collect.sh",
          kind: "other",
          skillDir: "skills/release-notes",
          searchable: false,
        }),
        entry({
          path: "skills/incident-review/SKILL.md",
          kind: "skill",
          blobSha: "body-incident",
          skillDir: "skills/incident-review",
          name: "Incident-Review",
          description: "Guides a blameless incident review.",
        }),
        entry({ path: "docs/releasing.md", blobSha: "body-doc", title: "How we release" }),
        entry({ path: "docs_extra/100%_notes.md", blobSha: "body-percent", title: "Percent" }),
      ],
      {
        "body-release": "Collect the merged changes. Group them for the reader.",
        "body-style": "Lead with the benefit. Keep each release entry to one sentence.",
        "body-incident": "Build the timeline first. Ask what made sense at the time.",
        "body-doc": "Releasing happens every week. The release captain drafts the notes.",
        "body-percent": "Unrelated text about percentages.",
      },
    );
  });

  it("matches on any word, ranks skills first and stems words", async () => {
    const results = await searchEntries(database, scope, "", "how do I write release notes", 10);
    expect(results.map((result) => result.path)).toEqual([
      "skills/release-notes/SKILL.md",
      "docs/releasing.md",
      "skills/release-notes/references/style.md",
      // Only its file name matches ("notes"), so it comes last.
      "docs_extra/100%_notes.md",
    ]);
    expect(results[0]).toMatchObject({
      kind: "skill",
      name: "release-notes",
      frontMatter: { metadata: { author: "acme" }, warnings: [] },
    });
  });

  it("searches bodies, not only metadata", async () => {
    const results = await searchEntries(database, scope, "", "timeline", 10);
    expect(results.map((result) => result.path)).toEqual(["skills/incident-review/SKILL.md"]);
  });

  it("finds files by the words in their path", async () => {
    const results = await searchEntries(database, scope, "", "style", 10);
    expect(results[0]?.path).toBe("skills/release-notes/references/style.md");
  });

  it("stays inside the mounted path and takes the path literally", async () => {
    const inSkills = await searchEntries(database, scope, "skills", "release", 10);
    expect(inSkills.every((result) => result.path.startsWith("skills/"))).toBe(true);
    expect(inSkills.length).toBeGreaterThan(0);

    // "docs" must not match "docs_extra", and "%" and "_" are not wildcards.
    const inDocs = await listEntries(database, scope, "docs", 10);
    expect(inDocs.map((result) => result.path)).toEqual(["docs/releasing.md"]);
    expect(await listEntries(database, scope, "doc%", 10)).toEqual([]);
    expect(await listEntries(database, scope, "docs_extr_", 10)).toEqual([]);
  });

  it("returns nothing for queries without usable words, and survives hostile ones", async () => {
    for (const query of ["the and of", "", "   ", "!!! ((( &&& |||", "'; drop table blobs; --"]) {
      expect(await searchEntries(database, scope, "", query, 10)).toEqual([]);
    }
    const noisy = await searchEntries(database, scope, "", "release & | ! ( ) : * <-> '", 10);
    expect(noisy.length).toBeGreaterThan(0);
    expect(await createBlobStore(database).read("body-doc")).toContain("Releasing");
  });

  it("honors the limit", async () => {
    expect(await searchEntries(database, scope, "", "release", 1)).toHaveLength(1);
  });

  it("lists skills before documents and leaves unsearchable files out", async () => {
    const listed = await listEntries(database, scope, "", 10);
    expect(listed.map((result) => result.path)).toEqual([
      "skills/incident-review/SKILL.md",
      "skills/release-notes/SKILL.md",
      "docs/releasing.md",
      "docs_extra/100%_notes.md",
      "skills/release-notes/references/style.md",
    ]);
  });

  it("lists and counts skills and documents separately, inside the mounted path", async () => {
    const skills = await listEntries(database, scope, "", 10, "skills");
    expect(skills.map((result) => result.path)).toEqual([
      "skills/incident-review/SKILL.md",
      "skills/release-notes/SKILL.md",
    ]);
    const documents = await listEntries(database, scope, "", 2, "documents");
    expect(documents.map((result) => result.path)).toEqual([
      "docs/releasing.md",
      "docs_extra/100%_notes.md",
    ]);
    // A skill's own files are not documents of the mount: they come with the skill.
    const standalone = await listEntries(database, scope, "", 10, "documents_outside_skills");
    expect(standalone.map((result) => result.path)).toEqual([
      "docs/releasing.md",
      "docs_extra/100%_notes.md",
    ]);
    expect(await countEntries(database, scope, "")).toEqual({ skills: 2, documents: 2 });
    expect(await countEntries(database, scope, "skills/release-notes")).toEqual({
      skills: 1,
      documents: 0,
    });
    expect(
      await listEntries(database, scope, "skills/release-notes", 10, "documents_outside_skills"),
    ).toEqual([]);
    expect(await countEntries(database, scope, "nowhere")).toEqual({ skills: 0, documents: 0 });
  });

  it("finds a skill by name, by name in another case, and by directory", async () => {
    const byName = await findSkills(
      database,
      scope,
      "",
      { name: "release-notes", directory: undefined },
      5,
    );
    expect(byName.map((skill) => skill.path)).toEqual(["skills/release-notes/SKILL.md"]);

    const byCase = await findSkills(
      database,
      scope,
      "",
      { name: "incident-review", directory: undefined },
      5,
    );
    expect(byCase.map((skill) => skill.name)).toEqual(["Incident-Review"]);

    const byDirectory = await findSkills(
      database,
      scope,
      "",
      { name: "skills/incident-review", directory: "skills/incident-review" },
      5,
    );
    expect(byDirectory.map((skill) => skill.name)).toEqual(["Incident-Review"]);

    expect(
      await findSkills(database, scope, "docs", { name: "release-notes", directory: undefined }, 5),
    ).toEqual([]);
  });

  it("lists a directory: subdirectories first, then files with their sizes", async () => {
    expect(await listDirectory(database, scope, "", 10)).toEqual([
      { path: "docs", kind: "directory", size: null },
      { path: "docs_extra", kind: "directory", size: null },
      { path: "skills", kind: "directory", size: null },
    ]);
    const skill = await listDirectory(database, scope, "skills/release-notes", 10);
    expect(skill.map((entry) => [entry.path, entry.kind])).toEqual([
      ["skills/release-notes/references", "directory"],
      ["skills/release-notes/scripts", "directory"],
      ["skills/release-notes/SKILL.md", "file"],
    ]);
    expect(typeof skill[2]?.size).toBe("number");
    expect(await listDirectory(database, scope, "skills/release-notes", 2)).toHaveLength(2);
    expect(await listDirectory(database, scope, "nowhere", 10)).toEqual([]);
    expect(await listDirectory(database, scope, "docs/releasing.md", 10)).toEqual([]);
  });

  it("lists the supporting files of a skill without its manifest", async () => {
    expect(await listSkillFiles(database, scope, "skills/release-notes", 10)).toEqual([
      "skills/release-notes/references/style.md",
      "skills/release-notes/scripts/collect.sh",
    ]);
    expect(await listSkillFiles(database, scope, "skills/release-notes", 1)).toHaveLength(1);
  });

  it("does not show another account the entries", async () => {
    const stranger = { ...scope, accountId: "00000000-0000-7000-8000-000000000000" };
    expect(await searchEntries(database, stranger, "", "release", 10)).toEqual([]);
    expect(await listEntries(database, stranger, "", 10)).toEqual([]);
    expect(await getEntry(database, stranger, "docs/releasing.md")).toBeUndefined();
  });
});

describe("a repository manifest", () => {
  let scope: SnapshotScope;

  beforeAll(async () => {
    scope = await readySnapshot(
      [
        entry({
          path: "SKILLCDN.md",
          kind: "manifest",
          blobSha: "body-manifest",
          name: "Acme playbooks",
          description: "The playbooks every Acme team runs.",
          frontMatter: { metadata: {}, warnings: [], documents: ["docs"] },
          searchable: false,
        }),
        entry({
          path: "packages/a/SKILLCDN.md",
          kind: "manifest",
          blobSha: "body-manifest-a",
          description: "Package a.",
          frontMatter: { metadata: {}, warnings: [], documents: [] },
          searchable: false,
        }),
        entry({
          path: "skills/release-notes/SKILL.md",
          kind: "skill",
          blobSha: "body-release",
          skillDir: "skills/release-notes",
          name: "release-notes",
          description: "Drafts release notes.",
        }),
        entry({ path: "docs/releasing.md", blobSha: "body-doc", title: "How we release" }),
        entry({ path: "README.md", blobSha: "body-readme", title: "Readme", visible: false }),
        entry({ path: "scripts/check.mjs", kind: "other", searchable: false, visible: false }),
      ],
      {
        "body-release": "Collect the merged changes.",
        "body-doc": "Releasing happens every week.",
        "body-readme": "Releasing is described in the readme too.",
      },
    );
  });

  it("is found from the mounted directory or the nearest one above it", async () => {
    expect((await getManifest(database, scope, ""))?.path).toBe("SKILLCDN.md");
    expect((await getManifest(database, scope, "skills"))?.path).toBe("SKILLCDN.md");
    expect((await getManifest(database, scope, "packages/a"))?.path).toBe("packages/a/SKILLCDN.md");
    expect((await getManifest(database, scope, "packages/a/deep/er"))?.path).toBe(
      "packages/a/SKILLCDN.md",
    );
    expect(await getManifest(database, scope, "packages/b")).toMatchObject({
      path: "SKILLCDN.md",
      name: "Acme playbooks",
      frontMatter: { documents: ["docs"] },
    });
  });

  it("keeps what it leaves out away from every query", async () => {
    // README.md says "releasing" too, and is left out.
    expect((await searchEntries(database, scope, "", "releasing", 10)).map((r) => r.path)).toEqual([
      "skills/release-notes/SKILL.md",
      "docs/releasing.md",
    ]);
    expect((await listEntries(database, scope, "", 10)).map((r) => r.path)).toEqual([
      "skills/release-notes/SKILL.md",
      "docs/releasing.md",
    ]);
    expect(await countEntries(database, scope, "")).toEqual({ skills: 1, documents: 1 });
    expect(await getEntry(database, scope, "README.md")).toBeUndefined();
    expect(await getEntry(database, scope, "scripts/check.mjs")).toBeUndefined();
    // The manifest itself is readable, though never listed by find.
    expect((await getEntry(database, scope, "SKILLCDN.md"))?.kind).toBe("manifest");
    expect((await listDirectory(database, scope, "", 10)).map((child) => child.path)).toEqual([
      "docs",
      "packages",
      "skills",
      "SKILLCDN.md",
    ]);
  });
});

describe("blob store", () => {
  it("stores text by hash, idempotently, and reports what is missing", async () => {
    const store = createBlobStore(database);
    expect(await store.read("missing-hash")).toBeUndefined();
    await store.write("hash-1", "first body with unicode: 한글 ✓");
    await store.write("hash-1", "a second write must not replace the first");
    expect(await store.read("hash-1")).toBe("first body with unicode: 한글 ✓");
    expect(await store.missing(["hash-1", "hash-2", "hash-2", "hash-3"])).toEqual(
      new Set(["hash-2", "hash-3"]),
    );
    expect(await store.missing([])).toEqual(new Set());
  });
});
