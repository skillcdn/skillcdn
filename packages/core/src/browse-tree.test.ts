import { describe, expect, it } from "vitest";
import { browseCatalogFiles, type CatalogFile, folderOverview } from "./browse-tree.js";
import { parentDirectory } from "./repo-layout.js";
import { parseRepoPath, type RepoPath, ROOT_PATH } from "./repo-path.js";

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
}

function file(value: string, fields: Partial<Omit<CatalogFile, "path">> = {}): CatalogFile {
  return { path: path(value), kind: "markdown", searchable: true, size: 20, ...fields };
}

function skill(value: string): CatalogFile {
  return file(value, {
    kind: "skill",
    name: "shared-name",
    skillDir: parentDirectory(path(value)),
  });
}

describe("browsing a published repository tree", () => {
  it("adds folder introductions without turning overview-only files into listed documents", () => {
    const files = [
      skill("team/write/SKILL.md"),
      file("team/README.md", {
        overviewOnly: true,
        searchable: false,
        title: "Team",
        description: "Write useful copy.",
      }),
      file("README.md", { overviewOnly: true, searchable: false, title: "Library" }),
      file("unused/README.md", { overviewOnly: true, searchable: false }),
    ];
    expect(browseCatalogFiles(files, ROOT_PATH)).toMatchObject([
      {
        path: "team",
        name: "Team",
        description: "Write useful copy.",
        overviewPath: "team/README.md",
        skillCount: 1,
        documentCount: 0,
      },
    ]);
    expect(browseCatalogFiles(files, ROOT_PATH)).toHaveLength(1);
    expect(browseCatalogFiles(files, path("team"))).toHaveLength(1);
    expect(folderOverview(files, ROOT_PATH)).toEqual({
      path: "README.md",
      title: "Library",
      description: undefined,
    });
  });

  it("keeps independently published READMEs discoverable and prefers explicit folder metadata", () => {
    const files = [
      skill("team/write/SKILL.md"),
      file("team/SKILLCDN.md", {
        kind: "manifest",
        name: "Explicit title",
        description: "Explicit summary.",
      }),
      file("team/README.md", { title: "README title", description: "README summary." }),
    ];
    expect(browseCatalogFiles(files, ROOT_PATH)).toMatchObject([
      {
        path: "team",
        name: "Explicit title",
        description: "Explicit summary.",
        overviewPath: "team/README.md",
        documentCount: 1,
      },
    ]);
    expect(browseCatalogFiles(files, path("team")).map((entry) => entry.path)).toContain(
      "team/README.md",
    );
  });

  it("selects a deterministic original README without choosing a display translation", () => {
    const files = [
      file("README.ko.md", { title: "Translation" }),
      file("readme.mdx", { title: "MDX" }),
      file("ReadMe.markdown", { title: "Markdown" }),
      file("readme.md", { title: "Lowercase" }),
      file("README.md", { title: "Original" }),
    ];
    expect(folderOverview(files, ROOT_PATH)?.title).toBe("Original");
    expect(folderOverview([...files].reverse(), ROOT_PATH)).toEqual(
      folderOverview(files, ROOT_PATH),
    );
    expect(folderOverview([files[0] as CatalogFile], ROOT_PATH)).toBeUndefined();
  });

  it("preserves real folders and counts descendant skills without flattening or duplicate identities", () => {
    const files = [
      skill("marketing/skills/write/SKILL.md"),
      skill("engineering/skills/review/SKILL.md"),
      skill("engineering/skills/review/inner/SKILL.md"),
      file("docs/guide.md"),
      file("docs/unindexed.md", { searchable: false }),
      file("engineering/skills/review/reference.md", {
        skillDir: path("engineering/skills/review"),
      }),
    ];
    expect(
      browseCatalogFiles(files, ROOT_PATH).map((entry) => [
        entry.path,
        entry.kind,
        entry.skillCount,
        entry.documentCount,
      ]),
    ).toEqual([
      ["docs", "directory", 0, 1],
      ["engineering", "directory", 2, 0],
      ["marketing", "directory", 1, 0],
    ]);
    expect(browseCatalogFiles(files, path("engineering/skills"))).toMatchObject([
      {
        path: "engineering/skills/review/SKILL.md",
        browsePath: "engineering/skills/review",
        kind: "skill",
        skillCount: 2,
      },
    ]);
    expect(
      browseCatalogFiles(files, path("engineering/skills/review")).map((entry) => entry.path),
    ).toEqual([
      "engineering/skills/review/SKILL.md",
      "engineering/skills/review/inner/SKILL.md",
      "engineering/skills/review/reference.md",
    ]);
    expect(browseCatalogFiles(files, path("engineering/skills/review/SKILL.md"))).toEqual([]);
    expect(browseCatalogFiles(files, ROOT_PATH)).toEqual(
      browseCatalogFiles([...files].reverse(), ROOT_PATH),
    );
  });

  it("keeps a root skill and a nested skill separately reachable", () => {
    const files = [
      skill("SKILL.md"),
      skill("nested/SKILL.md"),
      file("guide.md", { skillDir: ROOT_PATH }),
    ];
    expect(browseCatalogFiles(files, ROOT_PATH)).toMatchObject([
      { path: "SKILL.md", browsePath: "", kind: "skill", skillCount: 1 },
      { path: "nested/SKILL.md", browsePath: "nested", kind: "skill", skillCount: 1 },
      { path: "guide.md", kind: "file", documentCount: 0 },
    ]);
  });

  it("uses local manifest labels and inherits only language from the nearest declaration", () => {
    const files = [
      file("SKILLCDN.md", {
        kind: "manifest",
        name: "Root",
        description: "All teams",
        language: "en",
      }),
      file("team/SKILLCDN.md", {
        kind: "manifest",
        name: "Team",
        description: "Team tasks",
        language: "ko",
      }),
      file("team/sub/SKILLCDN.md", {
        kind: "manifest",
        name: "Subteam",
        description: "Narrow tasks",
      }),
      skill("team/sub/write/SKILL.md"),
      skill("team-other/write/SKILL.md"),
    ];
    expect(browseCatalogFiles(files, ROOT_PATH)).toMatchObject([
      {
        path: "team",
        name: "Team",
        description: "Team tasks",
        manifestPath: "team/SKILLCDN.md",
        language: "ko",
      },
      { path: "team-other", name: null, description: null, manifestPath: null, language: "en" },
    ]);
    expect(browseCatalogFiles(files, path("team"))).toMatchObject([
      { path: "team/sub", name: "Subteam", language: "ko" },
    ]);
    expect(browseCatalogFiles(files, path("team/sub"))).toMatchObject([
      { path: "team/sub/write/SKILL.md", name: "shared-name", description: null, language: "ko" },
    ]);
  });

  it("hides linked-only targets while keeping explicitly published hidden skill roots navigable", () => {
    const files = [
      skill(".agents/skills/write/SKILL.md"),
      file("shared/reference.md", { linkedOnly: true, searchable: false }),
      file(".agents/skills/write/.context/linked.md", { linkedOnly: true, searchable: false }),
      file(".agents/skills/write/reference.md", { skillDir: path(".agents/skills/write") }),
      file(".manual/guide.md"),
    ];
    expect(browseCatalogFiles(files, ROOT_PATH).map((entry) => entry.path)).toEqual([
      ".agents",
      ".manual",
    ]);
    expect(browseCatalogFiles(files, path("shared"))).toEqual([]);
    expect(browseCatalogFiles(files, path(".agents/skills"))).toMatchObject([
      { path: ".agents/skills/write/SKILL.md", browsePath: ".agents/skills/write" },
    ]);
    expect(
      browseCatalogFiles(files, path(".agents/skills/write")).map((entry) => entry.path),
    ).toEqual([".agents/skills/write/SKILL.md", ".agents/skills/write/reference.md"]);
  });
});
