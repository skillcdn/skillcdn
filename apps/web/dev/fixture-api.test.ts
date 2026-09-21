import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  restErrorSchema,
  restFeaturedSchema,
  restFileSchema,
  restFindSchema,
  restMountSchema,
  restSkillSchema,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/i18n/languages.js";
import { handleFixtureRequest, resetFixtureState } from "./fixture-api.js";
import { FIXTURE_FAILURES, FIXTURE_REPOSITORIES } from "./fixtures.js";

const ask = (path: string, now = 0) =>
  handleFixtureRequest(new URL(path, "http://fixtures.invalid"), now) ?? {
    status: 0,
    body: undefined,
  };

// The fixtures stand in for the server while the UI is designed. They are only useful as long
// as they have the shapes the server is tested against.
describe("the fixture API", () => {
  it("answers for every fixture repository with bodies the REST schemas accept", () => {
    for (const [key, repository] of Object.entries(FIXTURE_REPOSITORIES)) {
      const mount = ask(`/api/v1/mounts/gh/${key}`);
      expect(mount.status, key).toBe(200);
      const parsed = restMountSchema.parse(mount.body);
      expect(parsed.repository.name, key).toBe(repository.name);

      expect(
        restFindSchema.safeParse(ask(`/api/v1/find/gh/${key}?query=review`).body).success,
      ).toBe(true);
      for (const skill of repository.skills.slice(0, 5)) {
        const answer = ask(
          `/api/v1/skills/gh/${key}?name=${encodeURIComponent(skill.directory)}`,
          10_000,
        );
        expect(restSkillSchema.safeParse(answer.body).success, skill.directory).toBe(true);
      }
      for (const path of Object.keys(repository.files)) {
        const answer = ask(`/api/v1/files/gh/${key}?path=${encodeURIComponent(path)}`);
        expect(restFileSchema.safeParse(answer.body).success, path).toBe(true);
      }
    }
    expect(restFeaturedSchema.safeParse(ask("/api/v1/featured").body).success).toBe(true);
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

  it("shows paths relative to the mounted directory", () => {
    const mount = restMountSchema.parse(
      ask("/api/v1/mounts/gh/acme/skills@v2/skills/release-notes").body,
    );
    expect(mount).toMatchObject({ ref: "v2", path: "skills/release-notes", pinned: false });
    if (mount.index.status !== "ready") {
      throw new Error("expected a ready index");
    }
    expect(mount.index.skills.map((skill) => skill.directory)).toEqual([""]);
    expect(mount.index.documents.map((document) => document.path)).toContain("references/style.md");
  });

  it("pages a long file and moves from indexing to ready", () => {
    const first = restFileSchema.parse(ask("/api/v1/files/gh/acme/skills?path=docs/long.md").body);
    expect(first.nextOffset).toBe(first.content.length);
    const second = restFileSchema.parse(
      ask(`/api/v1/files/gh/acme/skills?path=docs/long.md&offset=${first.nextOffset}`).body,
    );
    expect(second.nextOffset).toBeNull();
    expect(first.content.length + second.content.length).toBe(first.totalLength);

    resetFixtureState();
    const early = restMountSchema.parse(ask("/api/v1/mounts/gh/demo/slow", 1_000_000).body);
    const later = restMountSchema.parse(ask("/api/v1/mounts/gh/demo/slow", 1_010_000).body);
    expect([early.index.status, later.index.status]).toEqual(["indexing", "ready"]);
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
