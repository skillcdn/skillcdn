import {
  allowEverything,
  discardUsage,
  type Embedder,
  restLegalDocumentSchema,
  restShowcaseSchema,
} from "@skillcdn/core";
import {
  addUsage,
  createBlobStore,
  createJobQueue,
  ensureSnapshot,
  findRepoByAlias,
  saveRepository,
  servedEntries,
  usageDayOf,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { INDEX_VERSION } from "@skillcdn/indexer";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vectorKeyOf } from "./adapters/meaning.js";
import { embedSnapshotSlice } from "./jobs/embed-snapshot.js";
import { EMBED_QUEUE, ensureJobQueues, INDEX_QUEUE, SWEEP_QUEUE } from "./jobs/queues.js";
import { UsageRecorder } from "./stats/usage-recorder.js";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";

// The admin API (ADR-0026, ADR-0028): the operator's lists, the landing showcase with its
// uploads, the takedown, and the usage statistics, behind one token.

let testDatabase: TestDatabase;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await testDatabase?.drop();
});

const TOKEN = "an-admin-token-that-is-long-enough-to-pass";
const authorized = { authorization: `Bearer ${TOKEN}` };

describe("the usage statistics over the admin API", () => {
  it("answer the deployment's totals, the rankings and one repository, naming public repositories only", async () => {
    const DAY = "2026-08-20";
    const clock = { now: () => new Date(`${DAY}T12:00:00Z`) };
    const stats = new UsageRecorder({
      database: testDatabase.database,
      clock,
      logger: pino({ level: "silent" }),
    });
    const h = createHarness(testDatabase, {
      adminToken: TOKEN,
      host: createFixtureHost("admin-usage"),
      stats,
      clock,
    });
    const commit = fixtureCommits("admin-usage").main;
    const client = await h.connect(`/gh/acme/multi-skill@${commit}`, { peer: "203.0.113.20" });
    await client.callTool({
      name: "load_skill",
      arguments: { path: "skills/release-notes/SKILL.md" },
    });
    await client.callTool({
      name: "read_repo_file",
      arguments: { path: "docs/getting-started.md" },
    });
    await client.close();
    await h.snapshots.idle();
    // A repository that is not public, counted under the same account: never named.
    const counted = await findRepoByAlias(testDatabase.database, {
      host: "gh",
      owner: "acme",
      repo: "multi-skill",
    });
    if (counted === undefined) {
      throw new Error("the repository was not saved");
    }
    const secret = await saveRepository(
      testDatabase.database,
      { host: "gh", owner: "acme", repo: "secret-usage" },
      {
        ...counted.repository,
        hostRepoId: "990001",
        name: "secret-usage",
        visibility: "private",
      },
      clock.now(),
    );
    await addUsage(
      testDatabase.database,
      [
        {
          scope: { accountId: secret.accountId, repoId: secret.id },
          day: DAY,
          metric: "skill_load",
          subject: "skills/hidden",
          count: 1000,
        },
      ],
      clock.now(),
    );
    await stats.flush();

    const get = (path: string) => h.request(path, { headers: authorized });
    const range = `from=${DAY}&to=${DAY}`;
    expect(await (await get(`/admin/v1/usage?${range}`)).json()).toEqual({
      from: DAY,
      to: DAY,
      items: [
        { day: DAY, metric: "connection", subject: "", count: 1 },
        { day: DAY, metric: "file_read", subject: "", count: 1 },
        { day: DAY, metric: "skill_load", subject: "", count: 1 },
        { day: DAY, metric: "tool_call", subject: "load_skill", count: 1 },
        { day: DAY, metric: "tool_call", subject: "read_repo_file", count: 1 },
      ],
    });
    const repository = {
      address: "/gh/acme/multi-skill",
      host: "gh",
      owner: "Acme",
      name: "multi-skill",
    };
    expect(
      await (await get(`/admin/v1/usage/repositories?metric=tool_call&${range}`)).json(),
    ).toEqual({ from: DAY, to: DAY, metric: "tool_call", items: [{ ...repository, count: 2 }] });
    expect(
      await (await get(`/admin/v1/usage/subjects?metric=skill_load&${range}&limit=5`)).json(),
    ).toEqual({
      from: DAY,
      to: DAY,
      metric: "skill_load",
      items: [{ ...repository, subject: "skills/release-notes", count: 1 }],
    });
    expect(await (await get(`/admin/v1/usage/gh/Acme/Multi-Skill?${range}`)).json()).toEqual({
      address: "/gh/acme/multi-skill",
      from: DAY,
      to: DAY,
      items: [
        { metric: "connection", subject: "", count: 1 },
        { metric: "file_read", subject: "docs/getting-started.md", count: 1 },
        { metric: "skill_load", subject: "skills/release-notes", count: 1 },
        { metric: "tool_call", subject: "load_skill", count: 1 },
        { metric: "tool_call", subject: "read_repo_file", count: 1 },
      ],
    });
    // Without days, the last thirty.
    expect(await (await get("/admin/v1/usage/repositories?metric=client")).json()).toEqual({
      from: "2026-07-22",
      to: DAY,
      metric: "client",
      items: [],
    });

    // What is wrong with a request is said; what is not public, or nothing, is not there.
    const refused = async (path: string, code: string, status = 400) => {
      const response = await get(path);
      expect([path, response.status]).toEqual([path, status]);
      expect(await response.json()).toMatchObject({ error: { code } });
    };
    await refused("/admin/v1/usage?from=2026-08-20&to=2026-08-19", "usage.invalid_range");
    await refused("/admin/v1/usage?from=2026-02-30", "usage.invalid_range");
    await refused("/admin/v1/usage?from=20-1-1", "usage.invalid_range");
    await refused("/admin/v1/usage?from=2020-01-01&to=2026-08-20", "usage.invalid_range");
    await refused("/admin/v1/usage/repositories", "usage.invalid_metric");
    await refused("/admin/v1/usage/repositories?metric=nothing", "usage.invalid_metric");
    await refused("/admin/v1/usage/subjects?metric=client", "usage.invalid_metric");
    await refused("/admin/v1/usage/subjects?metric=skill_load&limit=0", "usage.invalid_limit");
    await refused("/admin/v1/usage/subjects?metric=skill_load&limit=x", "usage.invalid_limit");
    await refused(`/admin/v1/usage/gh/acme/secret-usage?${range}`, "usage.unknown_repository", 404);
    await refused(`/admin/v1/usage/gh/acme/nothing?${range}`, "usage.unknown_repository", 404);
    await refused("/admin/v1/usage/not-an-address", "operator.invalid_address");
    await refused("/admin/v1/usage/gh/acme/multi-skill@main", "operator.invalid_address");
  });
});

describe("the admin API", () => {
  it("does not exist without a token, and refuses every other token with one", async () => {
    const without = createHarness(testDatabase);
    expect((await without.request("/admin/v1/repositories")).status).toBe(404);
    expect((await without.request("/admin/v1/repositories", { headers: authorized })).status).toBe(
      404,
    );

    const h = createHarness(testDatabase, { adminToken: TOKEN });
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: TOKEN }]) {
      const refused = await h.request("/admin/v1/repositories", { headers });
      expect(refused.status).toBe(401);
      expect(refused.headers.get("www-authenticate")).toContain("Bearer");
      expect(await refused.json()).toMatchObject({ error: { code: "admin.unauthorized" } });
    }
    const allowed = await h.request("/admin/v1/repositories", { headers: authorized });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
  });

  it("adds, lists and removes entries, and writes them as addresses", async () => {
    const h = createHarness(testDatabase, { adminToken: TOKEN });
    const put = (kind: string, address: string) =>
      h.request(`/admin/v1/repositories/${kind}${address}`, { method: "PUT", headers: authorized });
    expect(await (await put("verified", "/gh/Acme/Single-Skill")).json()).toEqual({
      kind: "verified",
      address: "/gh/acme/single-skill",
    });
    expect(await (await put("featured", "/gh/acme/multi-skill@main/skills")).json()).toEqual({
      kind: "featured",
      address: "/gh/acme/multi-skill@main/skills",
    });
    expect((await put("verified", "/gh/Acme/Single-Skill")).status).toBe(200);
    // A vouched-for or blocked repository is a repository, not a ref or a path.
    const refused = await put("blocked", "/gh/acme/multi-skill@main");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "operator.invalid_address" } });
    expect((await put("blocked", "/not an address")).status).toBe(400);
    expect((await put("banned", "/gh/acme/multi-skill")).status).toBe(404);

    const listed = await (
      await h.request("/admin/v1/repositories", { headers: authorized })
    ).json();
    expect(listed).toMatchObject({
      items: [
        { kind: "verified", address: "/gh/acme/single-skill" },
        { kind: "featured", address: "/gh/acme/multi-skill@main/skills" },
      ],
    });
    const featured = await (
      await h.request("/admin/v1/repositories?kind=featured", { headers: authorized })
    ).json();
    expect(featured).toMatchObject({ items: [{ kind: "featured" }] });
    expect(
      (await h.request("/admin/v1/repositories?kind=other", { headers: authorized })).status,
    ).toBe(400);

    const removed = await h.request("/admin/v1/repositories/verified/gh/acme/single-skill", {
      method: "DELETE",
      headers: authorized,
    });
    expect(await removed.json()).toEqual({
      kind: "verified",
      address: "/gh/acme/single-skill",
      removed: true,
    });
    expect(
      (
        await h.request("/admin/v1/repositories/verified/gh/acme/single-skill", {
          method: "DELETE",
          headers: authorized,
        })
      ).status,
    ).toBe(404);
    expect(await h.lists.all("verified")).toEqual([]);
  });

  it("purges what was indexed for a repository, and the bodies nothing references", async () => {
    const host = createFixtureHost("admin-purge");
    const h = createHarness(testDatabase, { adminToken: TOKEN, host });
    const commit = fixtureCommits("admin-purge").main;
    const client = await h.connect(`/gh/acme/single-skill@${commit}`);
    await client.close();
    await h.snapshots.idle();
    expect((await h.request(`/api/v1/mounts/gh/acme/single-skill@${commit}`)).status).toBe(200);

    const unknown = await h.request("/admin/v1/purge/gh/acme/never-seen", {
      method: "POST",
      headers: authorized,
    });
    expect(unknown.status).toBe(404);
    const purged = await h.request("/admin/v1/purge/gh/acme/single-skill", {
      method: "POST",
      headers: authorized,
    });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toMatchObject({ snapshots: 1 });
    // The next request indexes the repository again, unless it is blocked as well.
    await h.lists.add("blocked", "/gh/acme/single-skill");
    expect((await h.request(`/api/v1/mounts/gh/acme/single-skill@${commit}`)).status).toBe(404);
    expect(host.calls.getTree).toBe(1);
  });
});

interface Uploaded {
  readonly sha: string;
  readonly contentType: string;
  readonly size: number;
  readonly url: string;
}

describe("the landing showcase in the admin API (ADR-0028)", () => {
  const upload = (
    h: ReturnType<typeof createHarness>,
    body: Uint8Array | string,
    contentType: string,
  ) =>
    h.request("/admin/v1/media", {
      method: "POST",
      headers: { ...authorized, "content-type": contentType },
      body,
    });
  const asJson = { ...authorized, "content-type": "application/json" };

  it("stores an upload by the hash of its bytes, and serves it to everyone, immutably, in ranges", async () => {
    const h = createHarness(testDatabase, { adminToken: TOKEN });
    expect((await upload(h, "hello", "text/plain")).status).toBe(415);
    expect((await upload(h, new Uint8Array(), "image/png")).status).toBe(400);
    const bytes = new TextEncoder().encode("not really a picture, but served like one");
    const first = await upload(h, bytes, "image/png; charset=binary");
    expect(first.status).toBe(200);
    const uploaded = (await first.json()) as Uploaded;
    expect(uploaded.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(uploaded).toMatchObject({
      contentType: "image/png",
      size: bytes.byteLength,
      url: `/media/${uploaded.sha}`,
    });
    // The same bytes again are the same upload, whatever type they are sent as.
    expect(await (await upload(h, bytes, "image/webp")).json()).toMatchObject({
      sha: uploaded.sha,
      contentType: "image/png",
    });

    const served = await h.request(uploaded.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(served.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
    const part = await h.request(uploaded.url, { headers: { range: "bytes=4-9" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 4-9/${bytes.byteLength}`);
    expect(await part.text()).toBe("really");
    const etag = served.headers.get("etag") ?? "";
    expect((await h.request(uploaded.url, { headers: { "if-none-match": etag } })).status).toBe(
      304,
    );
    const head = await h.request(uploaded.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect((await h.request(`/media/${"0".repeat(64)}`)).status).toBe(404);
    expect((await h.request("/media/not-a-hash")).status).toBe(404);

    // Anyone may read an upload; only the operator may list or remove one.
    expect((await h.request("/admin/v1/media")).status).toBe(401);
    const listed = await (await h.request("/admin/v1/media", { headers: authorized })).json();
    expect(listed).toMatchObject({ items: [{ sha: uploaded.sha, usedBy: [] }] });
    expect(
      (
        await h.request(`/admin/v1/media/${uploaded.sha}`, {
          method: "DELETE",
          headers: authorized,
        })
      ).status,
    ).toBe(200);
    expect((await h.request(uploaded.url)).status).toBe(404);
  });

  it("writes an entry from uploads, shows it to everyone, and keeps an upload an entry uses", async () => {
    const h = createHarness(testDatabase, { adminToken: TOKEN });
    const poster = (await (
      await upload(h, new TextEncoder().encode("poster"), "image/webp")
    ).json()) as Uploaded;
    const clip = (await (
      await upload(h, new TextEncoder().encode("clip"), "video/mp4")
    ).json()) as Uploaded;
    const entry = {
      address: "/gh/Acme/Multi-Skill@main/skills",
      position: 1,
      width: 640,
      height: 480,
      durationMs: 8000,
      published: "2026-10-01",
      media: { poster: poster.sha, clip: clip.sha },
      texts: {
        en: {
          title: "A spring ad",
          body: "One picture in, an ad out.",
          tags: ["Ready to post"],
          action: "Make one",
        },
      },
    };
    const put = (id: string, body: unknown) =>
      h.request(`/admin/v1/showcase/${id}`, {
        method: "PUT",
        headers: asJson,
        body: JSON.stringify(body),
      });

    // What is wrong is said, and nothing is written.
    expect(await (await put("Spring Ad", entry)).json()).toMatchObject({
      error: { code: "showcase.invalid_id" },
    });
    const missing = await put("spring", { ...entry, media: { poster: "e".repeat(64) } });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: { code: "showcase.media_missing", problems: ["e".repeat(64)] },
    });
    expect(
      await (await put("spring", { ...entry, media: { poster: clip.sha } })).json(),
    ).toMatchObject({
      error: { code: "showcase.media_wrong_kind", problems: ["poster: video/mp4"] },
    });
    const noDuration = await put("spring", { ...entry, durationMs: undefined });
    expect(await noDuration.json()).toMatchObject({
      error: { code: "showcase.invalid", problems: [expect.stringContaining("media.clip")] },
    });
    expect(await (await put("spring", { ...entry, texts: {} })).json()).toMatchObject({
      error: { code: "showcase.invalid" },
    });
    expect(
      await (await put("spring", { ...entry, address: "/not an address" })).json(),
    ).toMatchObject({ error: { code: "operator.invalid_address" } });
    const notJson = await h.request("/admin/v1/showcase/spring", {
      method: "PUT",
      headers: asJson,
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect(await (await h.request("/api/v1/showcase")).json()).toEqual({ items: [] });

    const written = await put("spring", entry);
    expect(written.status).toBe(200);
    expect(await written.json()).toMatchObject({
      id: "spring",
      address: "/gh/acme/multi-skill@main/skills",
      position: 1,
      durationMs: 8000,
      published: "2026-10-01",
      media: {
        poster: { url: poster.url, type: "image/webp" },
        clip: { url: clip.url, type: "video/mp4" },
        animation: null,
        social: null,
      },
      texts: {
        en: { title: "A spring ad", tags: ["Ready to post"], requirement: null, demo: null },
      },
    });
    const shown = await h.request("/api/v1/showcase");
    expect(shown.headers.get("cache-control")).toBe("no-store");
    const body = restShowcaseSchema.parse(await shown.json());
    expect(body.items.map((item) => item.id)).toEqual(["spring"]);
    expect(await (await h.request("/admin/v1/showcase", { headers: authorized })).json()).toEqual(
      body,
    );
    const uploads = (await (
      await h.request("/admin/v1/media", { headers: authorized })
    ).json()) as {
      items: { sha: string; usedBy: string[] }[];
    };
    expect(
      uploads.items
        .filter((upload) => upload.sha === poster.sha || upload.sha === clip.sha)
        .map((upload) => upload.usedBy),
    ).toEqual([["spring"], ["spring"]]);

    // Replacing an entry replaces its slots; an upload in use stays; removing the entry frees it.
    await put("spring", {
      ...entry,
      media: { poster: poster.sha },
      durationMs: null,
      published: null,
    });
    const replaced = restShowcaseSchema.parse(await (await h.request("/api/v1/showcase")).json());
    expect(replaced.items[0]?.media.clip).toBeNull();
    const remove = (path: string) => h.request(path, { method: "DELETE", headers: authorized });
    const inUse = await remove(`/admin/v1/media/${poster.sha}`);
    expect(inUse.status).toBe(409);
    expect(await inUse.json()).toMatchObject({ error: { code: "media.in_use" } });
    expect((await remove(`/admin/v1/media/${clip.sha}`)).status).toBe(200);
    expect((await remove(`/admin/v1/media/${clip.sha}`)).status).toBe(404);
    expect((await h.request(clip.url)).status).toBe(404);
    expect((await remove("/admin/v1/showcase/spring")).status).toBe(200);
    expect((await remove("/admin/v1/showcase/spring")).status).toBe(404);
    expect((await remove(`/admin/v1/media/${poster.sha}`)).status).toBe(200);
    expect(await (await h.request("/api/v1/showcase")).json()).toEqual({ items: [] });
  });
});

describe("the deployment's own pages in the admin API (ADR-0029)", () => {
  it("writes the terms and the privacy policy as Markdown per language, and serves them to everyone", async () => {
    const h = createHarness(testDatabase, { adminToken: TOKEN });
    const asJson = { ...authorized, "content-type": "application/json" };
    const put = (kind: string, body: unknown) =>
      h.request(`/admin/v1/legal/${kind}`, {
        method: "PUT",
        headers: asJson,
        body: JSON.stringify(body),
      });
    expect((await h.request("/api/v1/legal/terms")).status).toBe(404);
    expect((await h.request("/api/v1/legal/imprint")).status).toBe(404);
    expect((await put("imprint", { texts: { en: { title: "Imprint", body: "x" } } })).status).toBe(
      404,
    );
    const empty = await put("terms", { texts: {} });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: { code: "legal.invalid" } });
    expect(
      (await put("terms", { revised: "yesterday", texts: { en: { title: "Terms", body: "x" } } }))
        .status,
    ).toBe(400);

    const texts = {
      en: { title: "Terms of service", body: "Be **kind**." },
      ko: { title: "이용약관", body: "친절하세요." },
    };
    const written = await put("terms", { revised: "2026-10-01", texts });
    expect(written.status).toBe(200);
    expect(await written.json()).toEqual({ kind: "terms", revised: "2026-10-01", texts });
    const shown = await h.request("/api/v1/legal/terms");
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toBe("no-store");
    expect(restLegalDocumentSchema.parse(await shown.json()).texts.ko?.title).toBe("이용약관");
    expect(await (await h.request("/admin/v1/legal", { headers: authorized })).json()).toEqual({
      items: [{ kind: "terms", revised: "2026-10-01", texts }],
    });
    // Replaced as a whole: a language left out is gone.
    await put("terms", { texts: { en: texts.en } });
    expect(
      restLegalDocumentSchema.parse(await (await h.request("/api/v1/legal/terms")).json()),
    ).toEqual({ kind: "terms", revised: null, texts: { en: texts.en } });

    const remove = () =>
      h.request("/admin/v1/legal/terms", { method: "DELETE", headers: authorized });
    expect((await remove()).status).toBe(200);
    expect((await remove()).status).toBe(404);
    expect((await h.request("/api/v1/legal/terms")).status).toBe(404);
  });
});

describe("the pictures of addresses in the admin API (ADR-0031)", () => {
  const asJson = { ...authorized, "content-type": "application/json" };

  it("keeps one picture per address, an upload or a URL, and frees an upload only when nothing shows it", async () => {
    const h = createHarness(testDatabase, { adminToken: TOKEN });
    const put = (address: string, body: unknown) =>
      h.request(`/admin/v1/images${address}`, {
        method: "PUT",
        headers: asJson,
        body: JSON.stringify(body),
      });
    const upload = async (contentType: string, body: Uint8Array) =>
      (await (
        await h.request("/admin/v1/media", {
          method: "POST",
          headers: { ...authorized, "content-type": contentType },
          body,
        })
      ).json()) as Uploaded;
    const remove = (path: string) => h.request(path, { method: "DELETE", headers: authorized });

    // One source, and only one: an upload by hash or an https URL.
    for (const body of [
      {},
      { url: "http://example.com/a.png" },
      { url: "https://example.com/a b.png" },
      { media: "not-a-hash" },
      { url: "https://example.com/a.png", media: "a".repeat(64) },
      { url: "https://example.com/a.png", extra: true },
    ]) {
      const refused = await put("/gh/acme/single-skill", body);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "image.invalid" } });
    }
    expect((await put("/not an address", { url: "https://example.com/a.png" })).status).toBe(400);
    expect(
      await (await put("/gh/acme/single-skill", { media: "b".repeat(64) })).json(),
    ).toMatchObject({ error: { code: "image.media_missing" } });
    const clip = await upload("video/mp4", new Uint8Array([1, 2, 3]));
    expect(await (await put("/gh/acme/single-skill", { media: clip.sha })).json()).toMatchObject({
      error: { code: "image.media_wrong_kind" },
    });

    const picture = await upload("image/png", new TextEncoder().encode("a picture of an address"));
    const written = await put("/gh/Acme/Single-Skill", { media: picture.sha });
    expect(written.status).toBe(200);
    expect(await written.json()).toMatchObject({
      address: "/gh/acme/single-skill",
      media: picture.sha,
      url: picture.url,
    });
    expect(
      await (
        await put("/gh/acme/multi-skill@main/skills", { url: "https://example.com/skills.png" })
      ).json(),
    ).toMatchObject({
      address: "/gh/acme/multi-skill@main/skills",
      media: null,
      url: "https://example.com/skills.png",
    });
    const listed = (await (
      await h.request("/admin/v1/images", { headers: authorized })
    ).json()) as {
      items: { address: string; url: string }[];
    };
    expect(listed.items.map((item) => [item.address, item.url])).toEqual([
      ["/gh/acme/single-skill", picture.url],
      ["/gh/acme/multi-skill@main/skills", "https://example.com/skills.png"],
    ]);

    // The upload is in use until the picture is replaced or removed.
    expect((await remove(`/admin/v1/media/${picture.sha}`)).status).toBe(409);
    const uploads = (await (
      await h.request("/admin/v1/media", { headers: authorized })
    ).json()) as {
      items: { sha: string; usedBy: string[] }[];
    };
    expect(uploads.items.find((item) => item.sha === picture.sha)?.usedBy).toEqual([
      "/gh/acme/single-skill",
    ]);
    expect(
      await (await put("/gh/acme/single-skill", { url: "https://example.com/single.png" })).json(),
    ).toMatchObject({ media: null, url: "https://example.com/single.png" });
    expect((await remove(`/admin/v1/media/${picture.sha}`)).status).toBe(200);
    expect(await (await remove("/admin/v1/images/gh/acme/single-skill")).json()).toEqual({
      address: "/gh/acme/single-skill",
      removed: true,
    });
    expect((await remove("/admin/v1/images/gh/acme/single-skill")).status).toBe(404);
    expect((await remove("/admin/v1/images/gh/acme/multi-skill@main/skills")).status).toBe(200);
    expect((await remove(`/admin/v1/media/${clip.sha}`)).status).toBe(200);
  });
});

describe("the search by meaning in the admin API (ADR-0064)", () => {
  const DIMENSIONS = 8;
  /** An embedder in the process: every text points one way, by its length. */
  const embedder: Embedder = {
    model: "admin-fake",
    dimensions: DIMENSIONS,
    maxTexts: 16,
    maxTextChars: 8000,
    maxBatchChars: 32_000,
    async embed(texts) {
      return {
        vectors: texts.map((text) => {
          const vector = new Float32Array(DIMENSIONS);
          vector[text.length % DIMENSIONS] = 1;
          return vector;
        }),
        tokens: texts.length * 10,
      };
    },
  };
  const KEY = vectorKeyOf(embedder);
  const json = { ...authorized, "content-type": "application/json" };
  interface State {
    readonly configured: unknown;
    readonly vectors: boolean;
    readonly pending: number | null;
    readonly queues: { readonly name: string; readonly queued: number }[] | null;
    readonly failures: unknown[] | null;
  }
  interface Repositories {
    readonly items: {
      readonly address: string;
      readonly visibility: string;
      readonly snapshots: number;
      readonly completed: number;
      readonly sections: number;
      readonly bytes: number;
    }[];
  }
  interface Usage {
    readonly items: { readonly day: string; readonly tokens: number }[];
  }

  it("says it is not configured, and has no queue to ask, where the search by meaning is off", async () => {
    const h = createHarness(testDatabase, {
      adminToken: TOKEN,
      host: createFixtureHost("admin-meaning-off"),
    });
    const state = (await (
      await h.request("/admin/v1/embeddings", { headers: authorized })
    ).json()) as State;
    expect(state).toMatchObject({ configured: null, pending: null, queues: null, failures: null });
    expect(typeof state.vectors).toBe("boolean");
    expect(
      (
        await h.request("/admin/v1/embeddings/index/gh/acme/single-skill", {
          method: "POST",
          headers: authorized,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await h.request("/admin/v1/embeddings/import", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ ...KEY, items: [] }),
        })
      ).status,
    ).toBe(503);
    expect(
      await (await h.request("/admin/v1/embeddings/repositories", { headers: authorized })).json(),
    ).toEqual({ items: [] });
  });

  it("reads the queues, designates a repository, shows where the embedding went and what it took, and imports vectors", async () => {
    const jobs = await createJobQueue(testDatabase.database, { role: "api", onError: () => {} });
    await ensureJobQueues(jobs);
    try {
      const host = createFixtureHost("admin-meaning");
      const commit = fixtureCommits("admin-meaning").main;
      const h = createHarness(testDatabase, {
        adminToken: TOKEN,
        host,
        embedding: { jobs, key: KEY, scope: "public", vectors: true },
        meaning: { embedder, reranker: undefined, rerankCandidates: undefined, key: KEY },
      });
      // Indexing queues the embedding; no worker runs here, so the job waits.
      const client = await h.connect(`/gh/acme/document-pack@${commit}`);
      await client.callTool({ name: "browse_repo", arguments: {} });
      await client.close();
      await h.snapshots.idle();

      const state = (await (
        await h.request("/admin/v1/embeddings", { headers: authorized })
      ).json()) as State;
      expect(state).toMatchObject({
        configured: { model: KEY.model, dimensions: DIMENSIONS, scope: "public", reranker: null },
        vectors: true,
        failures: [],
      });
      // Every served public snapshot of this database is still to embed under this key.
      const pending = state.pending ?? 0;
      expect(pending).toBeGreaterThanOrEqual(1);
      const queues = state.queues ?? [];
      expect(queues.map((queue) => queue.name).sort()).toEqual(
        [EMBED_QUEUE, INDEX_QUEUE, SWEEP_QUEUE].sort(),
      );
      expect(queues.find((queue) => queue.name === EMBED_QUEUE)?.queued).toBe(1);

      // Designated: queued once, and not again while it waits.
      const designated = await h.request("/admin/v1/embeddings/index/gh/acme/single-skill", {
        method: "POST",
        headers: authorized,
      });
      expect(designated.status).toBe(202);
      expect(await designated.json()).toEqual({ address: "/gh/acme/single-skill", queued: true });
      expect(
        await (
          await h.request("/admin/v1/embeddings/index/gh/acme/single-skill", {
            method: "POST",
            headers: authorized,
          })
        ).json(),
      ).toMatchObject({ queued: false });
      expect(
        (
          await h.request("/admin/v1/embeddings/index/gh/acme/single-skill/skills", {
            method: "POST",
            headers: authorized,
          })
        ).status,
      ).toBe(400);

      // Embedded as the worker would embed it: where it went, and what it took.
      const known = await findRepoByAlias(testDatabase.database, {
        host: "gh",
        owner: "acme",
        repo: "document-pack",
      });
      if (known === undefined) throw new Error("the pack was not resolved");
      const repo = { accountId: known.accountId, repoId: known.id };
      const snapshot = await ensureSnapshot(
        testDatabase.database,
        repo,
        commit,
        INDEX_VERSION,
        new Date(),
      );
      const scope = { accountId: repo.accountId, snapshotId: snapshot.id };
      const embedded = await embedSnapshotSlice(
        {
          database: testDatabase.database,
          blobs: createBlobStore(testDatabase.database),
          embedder,
          policy: { scope: "public", entitlements: allowEverything },
          lists: h.lists,
          usage: discardUsage,
          clock: { now: () => new Date() },
          logger: pino({ level: "silent" }),
        },
        { ...scope, repoId: repo.repoId, commitSha: commit, key: KEY, reason: "indexed" },
      );
      expect(embedded).toMatchObject({ status: "embedded", next: undefined });

      const repositories = (await (
        await h.request("/admin/v1/embeddings/repositories", { headers: authorized })
      ).json()) as Repositories;
      expect(repositories.items).toHaveLength(1);
      expect(repositories.items[0]).toMatchObject({
        address: "/gh/acme/document-pack",
        visibility: "public",
        snapshots: 1,
        completed: 1,
      });
      expect(repositories.items[0]?.sections).toBeGreaterThan(0);
      expect(repositories.items[0]?.bytes).toBeGreaterThan(0);
      const usage = (await (
        await h.request("/admin/v1/embeddings/usage", { headers: authorized })
      ).json()) as Usage;
      expect(usage.items).toHaveLength(1);
      expect(usage.items[0]).toMatchObject({ day: usageDayOf(new Date()) });
      expect(usage.items[0]?.tokens).toBeGreaterThan(0);
      const after = (await (
        await h.request("/admin/v1/embeddings", { headers: authorized })
      ).json()) as State;
      expect(after.pending).toBe(pending - 1);

      // Imports: vectors of a stored body under the deployment's key; anything else is refused.
      const body = (await servedEntries(testDatabase.database, scope)).find(
        (entry) => entry.kind === "markdown",
      );
      if (body === undefined) throw new Error("a document");
      const post = (payload: unknown) =>
        h.request("/admin/v1/embeddings/import", {
          method: "POST",
          headers: json,
          body: JSON.stringify(payload),
        });
      const item = {
        blobSha: body.blobSha,
        section: 99,
        heading: ["Imported"],
        offset: 0,
        length: 10,
        vector: Array.from({ length: DIMENSIONS }, (_, at) => (at === 0 ? 1 : 0)),
      };
      expect(await (await post({ ...KEY, items: [item] })).json()).toEqual({
        written: 1,
        skipped: 0,
      });
      expect(await (await post({ ...KEY, items: [item] })).json()).toEqual({
        written: 0,
        skipped: 1,
      });
      expect((await post({ ...KEY, model: "another-model", items: [item] })).status).toBe(409);
      expect((await post({ ...KEY, items: [{ ...item, vector: [1, 0] }] })).status).toBe(400);
      const unknown = await post({ ...KEY, items: [{ ...item, blobSha: "f".repeat(40) }] });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toMatchObject({
        error: { code: "embeddings.unknown_bodies", blobShas: ["f".repeat(40)] },
      });
      expect((await post({ nonsense: true })).status).toBe(400);
    } finally {
      await jobs.stop({ timeoutMs: 1000 });
    }
  });
});
