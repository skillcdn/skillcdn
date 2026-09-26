import { restShowcaseSchema } from "@skillcdn/core";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureHost, fixtureCommits } from "./testing/fixture-host.js";
import { createHarness } from "./testing/harness.js";

// The admin API (ADR-0026, ADR-0028): the operator's lists, the landing showcase with its
// uploads, and the takedown, behind one token.

let testDatabase: TestDatabase;
beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
});
afterAll(async () => {
  await testDatabase?.drop();
});

const TOKEN = "an-admin-token-that-is-long-enough-to-pass";
const authorized = { authorization: `Bearer ${TOKEN}` };

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
