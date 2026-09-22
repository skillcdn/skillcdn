import { describe, expect, it } from "vitest";
import {
  baseName,
  classifyRepoFile,
  isHiddenPath,
  owningSkillDirectory,
  parentDirectory,
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

describe("classifyRepoFile", () => {
  it.each([
    ["SKILL.md", "skill"],
    ["skills/ads/SKILL.md", "skill"],
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
