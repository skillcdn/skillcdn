import { describe, expect, it } from "vitest";
import {
  baseName,
  classifyRepoFile,
  isHiddenPath,
  isServedPath,
  nearestDirectoryAtOrAbove,
  owningSkillDirectory,
  parentDirectory,
  repoManifestPath,
  type ServedScope,
} from "./repo-layout.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";

function path(input: string): RepoPath {
  const result = parseRepoPath(input);
  if (!result.ok) {
    throw new Error(`expected ${input} to be a valid path`);
  }
  return result.value;
}

describe("isHiddenPath", () => {
  it.each([
    [".editorconfig", true],
    [".github/workflows/ci.yml", true],
    [".claude/settings.json", true],
    ["docs/.drafts/plan.md", true],
    ["docs/.plan.md", true],
    ["README.md", false],
    ["skills/ads/SKILL.md", false],
    ["docs/notes.hidden.md", false],
    ["docs/a.b/c.md", false],
  ])("%s -> %s", (input, hidden) => {
    expect(isHiddenPath(path(input))).toBe(hidden);
  });
});

describe("nearestDirectoryAtOrAbove", () => {
  const directories = new Set([path(""), path("packages/a")]);
  it("finds the directory itself, else the nearest ancestor", () => {
    expect(nearestDirectoryAtOrAbove(path("packages/a"), directories)).toBe("packages/a");
    expect(nearestDirectoryAtOrAbove(path("packages/a/docs"), directories)).toBe("packages/a");
    expect(nearestDirectoryAtOrAbove(path("packages/b"), directories)).toBe("");
    expect(nearestDirectoryAtOrAbove(path("packages"), new Set([path("x")]))).toBeUndefined();
  });
});

describe("isServedPath", () => {
  const scope: ServedScope = {
    skillDirectories: new Set([path("skills/ads"), path("packages/a/skills/one")]),
    manifestDirectories: new Set([path(""), path("packages/a")]),
    documentDirectories: new Map([
      [path(""), [path("docs")]],
      [path("packages/a"), [path("packages/a")]],
    ]),
  };

  it.each([
    ["SKILLCDN.md", true],
    ["docs/guide.md", true],
    ["docs/deep/guide.md", true],
    ["skills/ads/SKILL.md", true],
    ["skills/ads/references/style.md", true],
    ["README.md", false],
    ["scripts/check.mjs", false],
    ["documents/guide.md", false],
    ["docs.md", false],
    ["packages/a/SKILLCDN.md", true],
    ["packages/a/anything.md", true],
    ["packages/a/skills/one/SKILL.md", true],
  ])("%s -> %s under the manifests", (input, served) => {
    expect(isServedPath(path(input), scope)).toBe(served);
  });

  it("serves everything where no manifest governs", () => {
    const none: ServedScope = {
      skillDirectories: new Set(),
      manifestDirectories: new Set([path("packages/a")]),
      documentDirectories: new Map([[path("packages/a"), []]]),
    };
    expect(isServedPath(path("README.md"), none)).toBe(true);
    expect(isServedPath(path("packages/b/notes.md"), none)).toBe(true);
    // A manifest without document directories serves its skills and itself, nothing else.
    expect(isServedPath(path("packages/a/notes.md"), none)).toBe(false);
    expect(isServedPath(path("packages/a/SKILLCDN.md"), none)).toBe(true);
  });

  it("names the manifest of a directory", () => {
    expect(repoManifestPath(path(""))).toBe("SKILLCDN.md");
    expect(repoManifestPath(path("packages/a"))).toBe("packages/a/SKILLCDN.md");
  });
});

describe("classifyRepoFile", () => {
  it.each([
    ["SKILL.md", "skill"],
    ["skills/ads/SKILL.md", "skill"],
    ["SKILLCDN.md", "manifest"],
    ["packages/a/SKILLCDN.md", "manifest"],
    ["skillcdn.md", "markdown"],
    ["skills/ads/skill.md", "markdown"],
    ["skills/ads/SKILL.md.bak", "other"],
    ["README.md", "markdown"],
    ["docs/Guide.MD", "markdown"],
    ["docs/page.mdx", "markdown"],
    ["docs/page.markdown", "markdown"],
    ["skills/ads/assets/schema.json", "json"],
    ["skills/ads/scripts/run.py", "other"],
    ["LICENSE", "other"],
    ["md", "other"],
  ])("classifies %s as %s", (input, kind) => {
    expect(classifyRepoFile(path(input))).toBe(kind);
  });
});

describe("path helpers", () => {
  it("splits a path into directory and name", () => {
    expect(baseName(path("skills/ads/SKILL.md"))).toBe("SKILL.md");
    expect(baseName(path("SKILL.md"))).toBe("SKILL.md");
    expect(parentDirectory(path("skills/ads/SKILL.md"))).toBe("skills/ads");
    expect(parentDirectory(path("SKILL.md"))).toBe("");
  });
});

describe("owningSkillDirectory", () => {
  const skills = new Set([path("skills/ads"), path("skills/ads/nested"), path("other")]);

  it("finds the nearest skill directory above a file", () => {
    expect(owningSkillDirectory(path("skills/ads/SKILL.md"), skills)).toBe("skills/ads");
    expect(owningSkillDirectory(path("skills/ads/references/a/b.md"), skills)).toBe("skills/ads");
    expect(owningSkillDirectory(path("skills/ads/nested/notes.md"), skills)).toBe(
      "skills/ads/nested",
    );
  });

  it("returns undefined for files outside every skill", () => {
    expect(owningSkillDirectory(path("README.md"), skills)).toBeUndefined();
    expect(owningSkillDirectory(path("skills/ads-extra/notes.md"), skills)).toBeUndefined();
  });

  it("lets a root-level manifest own the whole tree", () => {
    const rootSkill = new Set([path("")]);
    expect(owningSkillDirectory(path("references/a.md"), rootSkill)).toBe("");
    expect(owningSkillDirectory(path("SKILL.md"), rootSkill)).toBe("");
  });
});
