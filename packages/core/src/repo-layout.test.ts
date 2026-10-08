import { describe, expect, it } from "vitest";
import {
  baseName,
  classifyRepoFile,
  isExcludedPath,
  isHiddenPath,
  isServedPath,
  isSharedIncludePath,
  nearestDirectoryAtOrAbove,
  owningSkillDirectory,
  parentDirectory,
  repoManifestPath,
  type ServedScope,
  selectReadmePaths,
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

  it("serves the skills and docs where no manifest governs", () => {
    const none: ServedScope = {
      skillDirectories: new Set([path("skills/ads")]),
      manifestDirectories: new Set([path("packages/a")]),
      documentDirectories: new Map([[path("packages/a"), []]]),
    };
    expect(isServedPath(path("docs/guide.md"), none)).toBe(true);
    expect(isServedPath(path("docs/deep/guide.md"), none)).toBe(true);
    expect(isServedPath(path("skills/ads/references/style.md"), none)).toBe(true);
    expect(isServedPath(path("README.md"), none)).toBe(false);
    expect(isServedPath(path("docs.md"), none)).toBe(false);
    expect(isServedPath(path("packages/b/notes.md"), none)).toBe(false);
    expect(isServedPath(path("packages/b/docs/notes.md"), none)).toBe(false);
    // A manifest without document directories serves its skills and itself, nothing else.
    expect(isServedPath(path("packages/a/notes.md"), none)).toBe(false);
    expect(isServedPath(path("packages/a/docs/notes.md"), none)).toBe(false);
    expect(isServedPath(path("packages/a/SKILLCDN.md"), none)).toBe(true);
  });

  it("names the manifest of a directory", () => {
    expect(repoManifestPath(path(""))).toBe("SKILLCDN.md");
    expect(repoManifestPath(path("packages/a"))).toBe("packages/a/SKILLCDN.md");
  });

  it("opens hidden roots only through explicit declarations, not further hidden descendants", () => {
    const declared: ServedScope = {
      skillDirectories: new Set([path(".agents/.curated/write")]),
      manifestDirectories: new Set([path("")]),
      documentDirectories: new Map([[path(""), [path(".guides")]]]),
      includedFiles: new Set([path(".agents/.curated/write/.data/guide.md")]),
    };
    expect(isServedPath(path(".agents/.curated/write/SKILL.md"), declared)).toBe(true);
    expect(isServedPath(path(".agents/.curated/write/references/style.md"), declared)).toBe(true);
    expect(isServedPath(path(".agents/.curated/write/.data/guide.md"), declared)).toBe(true);
    expect(isServedPath(path(".agents/.curated/write/.data/other.md"), declared)).toBe(false);
    expect(isServedPath(path(".guides/guide.md"), declared)).toBe(true);
    expect(isServedPath(path(".guides/.drafts/guide.md"), declared)).toBe(false);
    expect(isServedPath(path(".other/guide.md"), declared)).toBe(false);
  });

  it("gives exact exclusions precedence over declarations and includes", () => {
    const closed: ServedScope = {
      ...scope,
      includedFiles: new Set([path("packages/a/skills/one/keep.md")]),
      excludedPaths: new Set([path("packages/a"), path("docs/private.md")]),
    };
    for (const input of [
      "packages/a/SKILLCDN.md",
      "packages/a/skills/one/SKILL.md",
      "packages/a/skills/one/keep.md",
      "docs/private.md",
    ]) {
      expect(isServedPath(path(input), closed)).toBe(false);
    }
    expect(isServedPath(path("docs/private.md-extra"), closed)).toBe(true);
    expect(isExcludedPath(path("packages/ab/file.md"), closed)).toBe(false);
    expect(
      isServedPath(path("SKILLCDN.md"), { ...closed, excludedPaths: new Set([path("")]) }),
    ).toBe(false);
  });

  it("keeps only the outer broken manifest diagnostic readable", () => {
    const closed: ServedScope = {
      ...scope,
      brokenManifestDirectories: new Set([path("packages"), path("packages/a")]),
      manifestDirectories: new Set([path("packages"), path("packages/a")]),
    };
    expect(isServedPath(path("packages/SKILLCDN.md"), closed)).toBe(true);
    expect(isServedPath(path("packages/a/SKILLCDN.md"), closed)).toBe(false);
    expect(isServedPath(path("packages/a/skills/one/SKILL.md"), closed)).toBe(false);
  });
});

describe("selectReadmePaths", () => {
  it("selects deterministic conventional names only in allowed directories", () => {
    const files = [
      "README.mdx",
      "README.markdown",
      "ReadMe.MD",
      "readme.md",
      "README.md",
      "README.ko.md",
      "docs/README.MARKDOWN",
      "docs/readme.mdx",
      "hidden/README.md",
    ].map(path);
    const directories = new Set([path(""), path("docs")]);
    expect([...selectReadmePaths(files, directories)]).toEqual([
      "README.md",
      "docs/README.MARKDOWN",
    ]);
    expect([...selectReadmePaths([...files].reverse(), directories)].sort()).toEqual([
      "README.md",
      "docs/README.MARKDOWN",
    ]);
    expect([...selectReadmePaths([path("README.ko.md")], directories)]).toEqual([]);
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

describe("isSharedIncludePath", () => {
  // A root manifest declares docs; the marketing and media areas declare their own docs; the
  // product area has no manifest of its own, so the root's declaration governs it.
  const scope: ServedScope = {
    skillDirectories: new Set([
      path("marketing/skills/ad"),
      path("media/skills/drama"),
      path("product/skills/brief"),
    ]),
    manifestDirectories: new Set([path(""), path("marketing"), path("media")]),
    documentDirectories: new Map([
      [path(""), [path("docs")]],
      [path("marketing"), [path("marketing/docs")]],
      [path("media"), [path("media/docs")]],
    ]),
    excludedPaths: new Set([path("docs/private.md")]),
  };
  const ad = path("marketing/skills/ad");

  it.each([
    ["docs/tool/models.md", true],
    ["docs/tool/data.json", true],
    ["marketing/docs/style.md", true],
    // A sibling area's pages: served, but declared by a manifest that is not above the skill.
    ["media/docs/style.md", false],
    // The skill's own files are not shared pages, and neither are another skill's.
    ["marketing/skills/ad/references/style.md", false],
    ["media/skills/drama/references/cast.md", false],
    // Not a document: outside every declared directory, a manifest, hidden, excluded, or
    // the wrong kind of file.
    ["marketing/notes.md", false],
    ["README.md", false],
    ["SKILLCDN.md", false],
    ["docs/.drafts/plan.md", false],
    ["docs/private.md", false],
    ["docs/tool/table.csv", false],
  ])("%s as a shared page of marketing/skills/ad -> %s", (input, shared) => {
    expect(isSharedIncludePath(path(input), ad, scope)).toBe(shared);
  });

  it("reads the root's default docs where no manifest governs", () => {
    const none: ServedScope = {
      skillDirectories: new Set([path("skills/ad")]),
      manifestDirectories: new Set(),
      documentDirectories: new Map(),
    };
    expect(isSharedIncludePath(path("docs/shared.md"), path("skills/ad"), none)).toBe(true);
    expect(isSharedIncludePath(path("notes/shared.md"), path("skills/ad"), none)).toBe(false);
    expect(isSharedIncludePath(path("docs/shared.md"), path("product/skills/brief"), scope)).toBe(
      true,
    );
  });

  it("does not let an include list stand in for a document declaration", () => {
    const declared: ServedScope = {
      ...scope,
      includedFiles: new Set([path("marketing/notes.md")]),
    };
    expect(isSharedIncludePath(path("marketing/notes.md"), ad, declared)).toBe(false);
  });

  it("keeps a page below a broken manifest out", () => {
    const broken: ServedScope = { ...scope, brokenManifestDirectories: new Set([path("docs")]) };
    expect(isSharedIncludePath(path("docs/tool/models.md"), ad, broken)).toBe(false);
  });
});
