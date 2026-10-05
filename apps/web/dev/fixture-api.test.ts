import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  restAuthorizationDecisionSchema,
  restAuthorizationSchema,
  restBrowseSchema,
  restErrorSchema,
  restFeaturedSchema,
  restFileSchema,
  restFindSchema,
  restGrantsSchema,
  restLegalDocumentSchema,
  restMeSchema,
  restMountSchema,
  restMyRepositoriesSchema,
  restNewRepoTokenSchema,
  restOwnerSchema,
  restRepoTokensSchema,
  restShowcaseSchema,
  restSkillSchema,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/i18n/languages.js";
import { type FixtureAnswer, handleFixtureRequest, resetFixtureState } from "./fixture-api.js";
import {
  FIXTURE_AUTHORIZATIONS,
  FIXTURE_FAILURES,
  FIXTURE_GRANTS,
  FIXTURE_REPOSITORIES,
  FIXTURE_TOKENS,
  FIXTURE_USER,
} from "./fixtures.js";

const send = (method: string, path: string, now = 0, body?: unknown): FixtureAnswer =>
  handleFixtureRequest(new URL(path, "http://fixtures.invalid"), now, method, body) ?? {
    status: 0,
    body: undefined,
  };

const ask = (path: string, now = 0): FixtureAnswer => send("GET", path, now);

// The fixtures stand in for the server while the UI is designed. They are only useful as long
// as they have the shapes the server is tested against.
describe("the fixture API", () => {
  it("answers for every fixture repository with bodies the REST schemas accept", () => {
    // Signed in, so that the private one answers as well.
    resetFixtureState();
    ask("/auth/gh/login");
    for (const [key, repository] of Object.entries(FIXTURE_REPOSITORIES)) {
      const mount = ask(`/api/v1/mounts/gh/${key}`);
      expect(mount.status, key).toBe(200);
      const parsed = restMountSchema.parse(mount.body);
      expect(parsed.repository.name, key).toBe(repository.name);

      expect(restBrowseSchema.safeParse(ask(`/api/v1/browse/gh/${key}`).body).success).toBe(true);
      expect(
        restFindSchema.safeParse(ask(`/api/v1/find/gh/${key}?query=review`).body).success,
      ).toBe(true);
      for (const skill of repository.skills.slice(0, 5)) {
        const answer = ask(
          `/api/v1/skills/gh/${key}?path=${encodeURIComponent(skill.path ?? `${skill.directory}/SKILL.md`)}`,
          10_000,
        );
        expect(restSkillSchema.safeParse(answer.body).success, skill.directory).toBe(true);
      }
      for (const path of Object.keys(repository.files)) {
        const answer = ask(`/api/v1/files/gh/${key}?path=${encodeURIComponent(path)}`);
        const schema = answer.status === 503 ? restErrorSchema : restFileSchema;
        expect(schema.safeParse(answer.body).success, path).toBe(true);
      }
    }
    expect(restFeaturedSchema.safeParse(ask("/api/v1/featured").body).success).toBe(true);
    expect(restShowcaseSchema.safeParse(ask("/api/v1/showcase").body).success).toBe(true);
    // One page of the deployment's own is written, the other is not.
    expect(restLegalDocumentSchema.safeParse(ask("/api/v1/legal/terms").body).success).toBe(true);
    expect(ask("/api/v1/legal/privacy").status).toBe(404);
    expect(ask("/api/v1/legal/other").status).toBe(404);
    resetFixtureState();
  });

  it("answers failures with the error shape and the status of the spec", () => {
    for (const [key, failure] of Object.entries(FIXTURE_FAILURES)) {
      const answer = ask(`/api/v1/mounts/gh/${key}`);
      expect(answer.status, key).toBe(failure.status);
      expect(restErrorSchema.parse(answer.body).error.code).toBe(failure.code);
    }
    for (const [path, status, code] of [
      ["/api/v1/mounts/gh/demo/missing", 404, "mount.repo_not_found"],
      ["/api/v1/mounts/gh/acme/skills@missing-ref", 404, "mount.ref_not_found"],
      ["/api/v1/mounts/gh/acme/skills.git", 400, "address.invalid_repo"],
      ["/api/v1/skills/gh/acme/skills?name=nothing", 404, "skill.not_found"],
      ["/api/v1/skills/gh/acme/skills?name=review", 409, "skill.ambiguous"],
      ["/api/v1/skills/gh/acme/skills", 400, "request.invalid"],
      ["/api/v1/files/gh/acme/skills?path=docs/huge.md", 413, "file.too_large"],
      ["/api/v1/files/gh/acme/skills?path=assets/logo.png", 415, "file.not_text"],
      ["/api/v1/files/gh/acme/skills?path=nothing.md", 404, "file.not_found"],
      ["/api/v1/nothing", 404, "not_found"],
    ] as const) {
      const answer = ask(path);
      expect(answer.status, path).toBe(status);
      expect(restErrorSchema.parse(answer.body).error.code, path).toBe(code);
    }
  });

  it("keeps repository-root paths when a subdirectory is mounted", () => {
    const mount = restMountSchema.parse(
      ask("/api/v1/mounts/gh/acme/skills@v2/skills/release-notes").body,
    );
    expect(mount).toMatchObject({ ref: "v2", path: "skills/release-notes", pinned: false });
    if (mount.index.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(mount.index.skills.map((skill) => skill.directory)).toEqual(["skills/release-notes"]);
    // The mount is one skill: its files belong to the skill and are not documents of the mount.
    expect(mount.index.documents).toEqual([]);
  });

  it("browses described groups and pages every skill inside a folder", () => {
    const root = restBrowseSchema.parse(ask("/api/v1/browse/gh/acme/skills").body);
    expect(root).toMatchObject({
      status: "ready",
      path: "",
      entries: expect.arrayContaining([
        expect.objectContaining({
          kind: "directory",
          path: "team-a",
          name: "Engineering",
          skillCount: 1,
        }),
      ]),
    });
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const page = restBrowseSchema.parse(
        ask(
          `/api/v1/browse/gh/demo/long?path=skills/generated&limit=40${cursor === null ? "" : `&cursor=${cursor}`}`,
        ).body,
      );
      if (page.status !== "ready") throw new Error("Expected ready browse");
      seen.push(...page.entries.map((entry) => entry.path));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toHaveLength(230);
    expect(new Set(seen).size).toBe(230);
    expect(seen.every((path) => path.endsWith("/SKILL.md"))).toBe(true);
    const skill = restSkillSchema.parse(
      ask("/api/v1/skills/gh/acme/skills/team-a?path=team-a/review/SKILL.md").body,
    );
    expect(skill).toMatchObject({
      status: "ready",
      skill: {
        path: "team-a/review/SKILL.md",
        ruleChain: [
          expect.objectContaining({ path: "SKILLCDN.md" }),
          expect.objectContaining({ path: "team-a/SKILLCDN.md" }),
        ],
      },
    });
  });

  it("scopes search to the selected folder and keeps complete result pages", () => {
    const scoped = restFindSchema.parse(
      ask("/api/v1/find/gh/acme/skills?query=review&path=team-a").body,
    );
    expect(scoped).toMatchObject({
      status: "ready",
      path: "team-a",
      items: [expect.objectContaining({ kind: "skill", directory: "team-a/review" })],
    });
    const first = restFindSchema.parse(
      ask("/api/v1/find/gh/demo/long?query=Generated&path=skills/generated&limit=25").body,
    );
    if (first.status !== "ready") throw new Error("Expected ready search");
    expect(first.items).toHaveLength(25);
    const next = restFindSchema.parse(
      ask(
        `/api/v1/find/gh/demo/long?query=Generated&path=skills/generated&limit=25&cursor=${first.nextCursor}`,
      ).body,
    );
    if (next.status !== "ready") throw new Error("Expected ready search");
    expect(next.items).toHaveLength(25);
    expect(next.items[0]).not.toEqual(first.items[0]);
  });

  it("offers introductions without a manifest and reads them only when requested", () => {
    const root = restBrowseSchema.parse(ask("/api/v1/browse/gh/acme/handbook").body);
    expect(root).toMatchObject({
      status: "ready",
      overview: { path: "README.md", title: "Acme handbook" },
    });
    const folder = restBrowseSchema.parse(ask("/api/v1/browse/gh/acme/handbook?path=docs").body);
    expect(folder).toMatchObject({
      status: "ready",
      entries: expect.arrayContaining([
        expect.objectContaining({
          path: "docs/engineering",
          overviewPath: "docs/engineering/README.md",
        }),
      ]),
    });
    const read = restFileSchema.parse(ask("/api/v1/files/gh/acme/handbook?path=README.md").body);
    expect(read).toMatchObject({
      kind: "file",
      content: expect.stringContaining("# Acme handbook"),
    });
    const found = restFindSchema.parse(ask("/api/v1/find/gh/acme/handbook?query=agreements").body);
    expect(found).toMatchObject({ status: "ready", items: [] });
  });

  it("continues inherited rules, instructions and required contents without losing fragments", () => {
    const first = restSkillSchema.parse(
      ask("/api/v1/skills/gh/demo/context?path=review/SKILL.md").body,
    );
    if (first.status !== "ready") throw new Error("Expected ready skill");
    expect(first.skill.complete).toBe(false);
    expect(first.skill.body).toBe("");
    const next = restSkillSchema.parse(
      ask(`/api/v1/skills/gh/demo/context?path=review/SKILL.md&cursor=${first.skill.nextCursor}`)
        .body,
    );
    if (next.status !== "ready") throw new Error("Expected ready skill");
    expect(next.skill.complete).toBe(true);
    expect(`${first.skill.ruleChain?.[0]?.body}${next.skill.ruleChain?.[0]?.body}`).toBe(
      FIXTURE_REPOSITORIES["demo/context"]?.manifest?.rules,
    );
    expect(next.skill.body).toContain("Instructions after all inherited rules.");
    expect(next.skill.includedContents?.[0]?.content).toContain("Required file received in full.");
  });

  it("pages a long file and moves from indexing to ready", () => {
    const first = restFileSchema.parse(ask("/api/v1/files/gh/acme/skills?path=docs/long.md").body);
    if (first.kind !== "file") {
      throw new Error("expected a file");
    }
    expect(first.nextOffset).toBe(first.content.length);
    const second = restFileSchema.parse(
      ask(`/api/v1/files/gh/acme/skills?path=docs/long.md&offset=${first.nextOffset}`).body,
    );
    if (second.kind !== "file") {
      throw new Error("expected a file");
    }
    expect(second.nextOffset).toBeNull();
    expect(first.content.length + second.content.length).toBe(first.totalLength);

    // A directory is listed, subdirectories first; the mounted root is ".".
    const directory = restFileSchema.parse(ask("/api/v1/files/gh/acme/skills?path=docs").body);
    if (directory.kind !== "directory") {
      throw new Error("expected a directory");
    }
    expect(directory.entries.map((entry) => entry.path)).toContain("docs/long.md");
    const root = restFileSchema.parse(ask("/api/v1/files/gh/acme/skills?path=.").body);
    expect(root).toMatchObject({ kind: "directory", path: "" });

    resetFixtureState();
    const early = restMountSchema.parse(ask("/api/v1/mounts/gh/demo/slow", 1_000_000).body);
    const later = restMountSchema.parse(ask("/api/v1/mounts/gh/demo/slow", 1_010_000).body);
    expect([early.index.status, later.index.status]).toEqual(["indexing", "ready"]);
  });

  it("waits for a publication policy before reading even a known README", () => {
    resetFixtureState();
    const early = ask("/api/v1/files/gh/demo/slow?path=README.md", 1_000_000);
    expect(early.status).toBe(503);
    expect(restErrorSchema.parse(early.body).error.code).toBe("index.indexing");
    const later = ask("/api/v1/files/gh/demo/slow?path=README.md", 1_010_000);
    expect(later.status).toBe(200);
    expect(restFileSchema.parse(later.body)).toMatchObject({ kind: "file", path: "README.md" });
  });

  it("signs the fixture person in and out, and answers what is theirs only in between", () => {
    resetFixtureState();
    expect(restMeSchema.parse(ask("/api/v1/me").body)).toEqual({ user: null });
    for (const path of ["/api/v1/me/repositories", "/api/v1/me/grants", "/api/v1/me/tokens"]) {
      const refused = ask(path);
      expect(refused.status, path).toBe(401);
      expect(restErrorSchema.parse(refused.body).error.code, path).toBe("auth.required");
    }
    // Signed out, a private repository is as missing as one that does not exist.
    expect(ask("/api/v1/mounts/gh/acme/private-skills").status).toBe(404);

    // Signing in is a navigation that comes back to a page of this origin, and to no other.
    expect(ask("/auth/gh/login?return_to=%2Faccount%2Fapps")).toMatchObject({
      status: 302,
      location: "/account/apps",
    });
    expect(ask("/auth/gh/login?return_to=https%3A%2F%2Felsewhere.example").location).toBe("/");
    expect(ask("/auth/gh/login?return_to=%2F%2Felsewhere.example").location).toBe("/");
    expect(restMeSchema.parse(ask("/api/v1/me").body).user).toEqual(FIXTURE_USER);

    const mine = restMyRepositoriesSchema.parse(ask("/api/v1/me/repositories").body);
    expect(
      mine.installations.flatMap((installation) =>
        installation.repositories.map((repository) => repository.visibility),
      ),
    ).toEqual(expect.arrayContaining(["private", "public"]));
    const mount = restMountSchema.parse(ask("/api/v1/mounts/gh/acme/private-skills").body);
    expect(mount.repository.visibility).toBe("private");

    const grants = restGrantsSchema.parse(ask("/api/v1/me/grants").body);
    expect(grants.items).toHaveLength(FIXTURE_GRANTS.length);
    const removal = `/api/v1/me/grants/${grants.items[0]?.id}`;
    expect(send("DELETE", removal).status).toBe(200);
    expect(send("DELETE", removal).status).toBe(404);
    expect(restGrantsSchema.parse(ask("/api/v1/me/grants").body).items).toHaveLength(
      FIXTURE_GRANTS.length - 1,
    );

    expect(send("POST", "/auth/logout").status).toBe(204);
    expect(restMeSchema.parse(ask("/api/v1/me").body)).toEqual({ user: null });
    resetFixtureState();
  });

  it("lists the fixture person's tokens, makes one that shows its secret once, and takes one back", () => {
    resetFixtureState();
    const TOKENS = "/api/v1/me/tokens";
    const request = { address: "/gh/acme/private-skills", label: " Nightly ", expiresInDays: 30 };
    expect(send("POST", TOKENS, 0, request).status).toBe(401);
    ask("/auth/gh/login");
    const listed = restRepoTokensSchema.parse(ask(TOKENS).body);
    expect(listed.items).toEqual(FIXTURE_TOKENS);

    const now = Date.parse("2026-10-04T00:00:00.000Z");
    const made = send("POST", TOKENS, now, request);
    expect(made.status).toBe(201);
    const token = restNewRepoTokenSchema.parse(made.body);
    expect(token.item).toMatchObject({
      address: "/gh/acme/private-skills",
      label: "Nightly",
      createdAt: "2026-10-04T00:00:00.000Z",
      expiresAt: "2026-11-03T00:00:00.000Z",
      lastUsedAt: null,
    });
    // The newest comes first, and the list never holds a secret.
    const after = restRepoTokensSchema.parse(ask(TOKENS).body);
    expect(after.items.map((item) => item.id)).toEqual([
      token.item.id,
      ...FIXTURE_TOKENS.map((item) => item.id),
    ]);
    expect(JSON.stringify(after)).not.toContain(token.token);

    for (const [body, status, code] of [
      [{ ...request, address: "/gh/acme/skills" }, 400, "token.public_repository"],
      [{ ...request, address: "/gh/acme/nothing-here" }, 404, "mount.repo_not_found"],
      [{ ...request, label: "  " }, 400, "token.invalid"],
      [{ ...request, expiresInDays: 0 }, 400, "token.invalid"],
      [undefined, 400, "token.invalid"],
    ] as const) {
      const refused = send("POST", TOKENS, now, body);
      expect(refused.status, JSON.stringify(body)).toBe(status);
      expect(restErrorSchema.parse(refused.body).error.code).toBe(code);
    }

    const removal = `${TOKENS}/${token.item.id}`;
    expect(send("DELETE", removal).status).toBe(200);
    expect(send("DELETE", removal).status).toBe(404);
    expect(restRepoTokensSchema.parse(ask(TOKENS).body).items).toEqual(FIXTURE_TOKENS);
    resetFixtureState();
  });

  it("answers the page of an account with indexed skills first and the rest in pages", () => {
    resetFixtureState();
    const first = restOwnerSchema.parse(ask("/api/v1/owners/gh/acme").body);
    expect(first.owner).toMatchObject({ login: "Acme", kind: "organization" });
    expect(first.indexed.map((card) => card.address)).toEqual(["/gh/acme/skills"]);
    expect(first.nextPage).toBe(2);
    const second = restOwnerSchema.parse(ask("/api/v1/owners/gh/acme?page=2").body);
    expect(second.indexed).toEqual([]);
    expect(second.nextPage).toBeNull();

    // Every public repository once, and the private one nowhere, signed in or not.
    const addresses = [...first.indexed, ...first.repositories, ...second.repositories].map(
      (repository) => repository.address,
    );
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses).toHaveLength(first.owner.publicRepositories);
    ask("/auth/gh/login");
    const signedIn = restOwnerSchema.parse(ask("/api/v1/owners/gh/acme").body);
    expect(
      [...signedIn.indexed, ...signedIn.repositories].map((repository) => repository.address),
    ).not.toContain("/gh/acme/private-skills");
    resetFixtureState();

    // A listed repository opens like any other, and holds nothing to serve.
    const listed = restMountSchema.parse(
      ask(`/api/v1/mounts${second.repositories.at(-1)?.address}`).body,
    );
    expect(listed.index).toMatchObject({ status: "ready", skillCount: 0, documentCount: 0 });

    expect(restOwnerSchema.parse(ask("/api/v1/owners/gh/octo-dev").body)).toMatchObject({
      indexed: [],
      repositories: [],
      nextPage: null,
    });
    for (const [path, status, code] of [
      ["/api/v1/owners/gh/no-such-account", 404, "owner.not_found"],
      ["/api/v1/owners/gh/acme/skills", 400, "owner.invalid"],
      ["/api/v1/owners/gh/acme?page=0", 400, "request.invalid"],
    ] as const) {
      const answer = ask(path);
      expect(answer.status, path).toBe(status);
      expect(restErrorSchema.parse(answer.body).error.code, path).toBe(code);
    }
  });

  it("tells the consent page what a client asks for, as whoever is signed in sees it", () => {
    resetFixtureState();
    for (const name of Object.keys(FIXTURE_AUTHORIZATIONS)) {
      const anonymous = restAuthorizationSchema.parse(
        ask(`/api/v1/oauth/request?request=${name}`).body,
      );
      expect(anonymous, name).toMatchObject({ user: null, visible: null, installUrl: null });
    }
    const expired = ask("/api/v1/oauth/request?request=gone");
    expect(expired.status).toBe(400);
    expect(restErrorSchema.parse(expired.body).error.code).toBe("oauth.invalid_request");
    expect(send("POST", "/api/v1/oauth/decision").status).toBe(401);

    ask("/auth/gh/login");
    const visible = (name: string) =>
      restAuthorizationSchema.parse(ask(`/api/v1/oauth/request?request=${name}`).body).visible;
    expect([visible("web"), visible("local"), visible("not-visible")]).toEqual([true, true, false]);
    // And one the git host could not be asked about: neither yes nor no.
    expect(visible("host-down")).toBeNull();
    expect(
      restAuthorizationDecisionSchema.parse(send("POST", "/api/v1/oauth/decision").body),
    ).toEqual({ redirect: "/dev/states" });
    resetFixtureState();
  });

  it("leaves everything that is not the REST API to the development server", () => {
    expect(handleFixtureRequest(new URL("http://fixtures.invalid/"))).toBeUndefined();
    expect(handleFixtureRequest(new URL("http://fixtures.invalid/gh/acme/skills"))).toBeUndefined();
  });
});

// Things that have to agree with the language list but cannot import it.
describe("what every language needs outside the bundle", () => {
  const publicFile = (path: string) => fileURLToPath(new URL(`../public/${path}`, import.meta.url));

  it("is listed in the script that picks the language before the first paint", () => {
    const boot = readFileSync(publicFile("boot.js"), "utf8");
    const listed = /const SUPPORTED = (\[[^\]]*\]);/.exec(boot)?.[1];
    expect(JSON.parse(listed ?? "[]")).toEqual([...LANGUAGES]);
  });

  it("has a social-preview image", () => {
    for (const language of LANGUAGES) {
      expect(existsSync(publicFile(`og/og-${language}.png`)), language).toBe(true);
    }
  });
});
