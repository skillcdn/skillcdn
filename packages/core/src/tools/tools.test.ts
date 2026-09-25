import { describe, expect, it } from "vitest";
import * as z from "zod";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import {
  browseInputSchema,
  browseTool,
  getSkillInputSchema,
  getSkillTool,
  READ_FILE_MAX_LIMIT,
  readFileInputSchema,
  readFileTool,
  searchInputSchema,
  searchTool,
  TOOL_NAMES,
} from "./contracts.js";
import {
  INDEXING_NOTICE,
  PROVENANCE_NOTICE,
  renderBrowseResult,
  renderDiagnostics,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderSkillResult,
} from "./render.js";
import {
  type IndexDiagnostic,
  type MountSummary,
  pageOfText,
  type SkillResult,
} from "./results.js";

function path(input: string): RepoPath {
  const result = parseRepoPath(input);
  if (!result.ok) {
    throw new Error(`invalid test path ${input}`);
  }
  return result.value;
}

const mount: MountSummary = {
  repository: "acme/skills",
  ref: "main",
  commit: "0123456789abcdef0123456789abcdef01234567",
  path: path(""),
  verified: true,
  truncated: false,
};

const skillItem = (name: string, description = `About ${name}.`) => ({
  kind: "skill" as const,
  name,
  directory: path(`skills/${name}`),
  description,
  files: [],
  moreFiles: 0,
  translations: {},
});

const skipped: IndexDiagnostic = {
  path: path("skills/broken/SKILL.md"),
  code: "invalid_front_matter",
  message:
    'front-matter is not valid YAML (BLOCK_AS_IMPLICIT_KEY): the value of "description" contains ": "',
};

const skillResult = (patch: Partial<SkillResult> = {}): SkillResult => ({
  mount,
  name: "commit-messages",
  directory: path(""),
  description: "Writes commit messages.",
  license: undefined,
  compatibility: undefined,
  allowedTools: undefined,
  metadata: {},
  body: "# Commit messages",
  files: [],
  filesTruncated: false,
  included: [],
  warnings: [],
  rules: undefined,
  translations: {},
  ...patch,
});

describe("tool contracts", () => {
  it("requires search keywords instead of treating whitespace as a listing", () => {
    expect(searchInputSchema.safeParse({ query: "   " }).success).toBe(false);
    expect(searchInputSchema.safeParse({ query: "release notes" }).success).toBe(true);
  });
  it("keeps the public tool names stable", () => {
    expect(TOOL_NAMES).toEqual(["browse", "search", "get_skill", "read_file"]);
  });

  it("exports input schemas that convert to JSON Schema objects", () => {
    for (const tool of [browseTool, searchTool, getSkillTool, readFileTool]) {
      const schema = z.toJSONSchema(tool.inputSchema);
      expect(schema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(40);
    }
    expect(z.toJSONSchema(getSkillInputSchema).required).toEqual(["path"]);
    expect(z.toJSONSchema(readFileInputSchema).required).toEqual(["path"]);
    expect(z.toJSONSchema(searchInputSchema).required).toEqual(["query"]);
    expect(z.toJSONSchema(browseInputSchema).required).toBeUndefined();
  });

  it("tells the model that search is by words, in the language of the content", () => {
    expect(searchTool.description).toContain("original content");
    expect(searchTool.description).toContain("translations are excluded");
    expect(getSkillTool.description).toContain("inherited rules and required files");
  });

  it("accepts the documented inputs", () => {
    expect(browseInputSchema.parse({})).toEqual({});
    expect(searchInputSchema.parse({ query: "release", limit: 5 })).toEqual({
      query: "release",
      limit: 5,
    });
    expect(getSkillInputSchema.parse({ path: "skills/release-notes/SKILL.md" })).toEqual({
      path: "skills/release-notes/SKILL.md",
    });
    expect(readFileInputSchema.parse({ path: "docs/a.md", offset: 10 })).toEqual({
      path: "docs/a.md",
      offset: 10,
    });
  });

  it.each([
    ["an oversized query", searchInputSchema, { query: "q".repeat(501) }],
    ["a missing query", searchInputSchema, {}],
    ["a limit of zero", searchInputSchema, { query: "a", limit: 0 }],
    ["a fractional limit", browseInputSchema, { limit: 2.5 }],
    ["a query that is not text", searchInputSchema, { query: ["a"] }],
    ["an empty skill path", getSkillInputSchema, { path: "" }],
    ["a missing path", readFileInputSchema, {}],
    ["a negative offset", readFileInputSchema, { path: "a", offset: -1 }],
    ["an oversized page", readFileInputSchema, { path: "a", limit: READ_FILE_MAX_LIMIT + 1 }],
    ["an oversized path", readFileInputSchema, { path: "a".repeat(1025) }],
  ])("rejects %s", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});

describe("pageOfText", () => {
  it("returns the whole text when it fits", () => {
    expect(pageOfText("hello", 0, 10)).toEqual({
      content: "hello",
      offset: 0,
      nextOffset: undefined,
      totalLength: 5,
    });
  });

  it("pages through longer text", () => {
    expect(pageOfText("abcdefgh", 0, 3)).toMatchObject({ content: "abc", nextOffset: 3 });
    expect(pageOfText("abcdefgh", 3, 3)).toMatchObject({ content: "def", nextOffset: 6 });
    expect(pageOfText("abcdefgh", 6, 3)).toMatchObject({ content: "gh", nextOffset: undefined });
  });

  it("clamps offsets and limits instead of failing", () => {
    expect(pageOfText("abc", 99, 10)).toMatchObject({ content: "", offset: 3 });
    expect(pageOfText("abc", -5, 0)).toMatchObject({ content: "a", offset: 0, nextOffset: 1 });
  });

  it("never splits a surrogate pair", () => {
    const text = `a${String.fromCodePoint(0x1f600)}b`;
    const first = pageOfText(text, 0, 2);
    expect(first.content).toBe(`a${String.fromCodePoint(0x1f600)}`);
    expect(first.nextOffset).toBe(3);
    expect(pageOfText(text, 2, 5).content).toBe("b");
    expect(first.content.isWellFormed()).toBe(true);
  });
});

describe("rendering", () => {
  it("uses brief discovery hints while keeping complete skill instructions untouched", () => {
    const long = "A detailed instruction. ".repeat(80);
    const browse = renderBrowseResult({
      mount,
      path: path(""),
      entries: [
        {
          kind: "skill",
          path: path("write/SKILL.md"),
          browsePath: path("write"),
          overviewPath: path("write/README.md"),
          name: "Write",
          description: long,
          skillCount: 1,
          documentCount: 0,
          size: 100,
          manifestPath: null,
          language: null,
        },
      ],
      overview: {
        path: path("README.md"),
        title: "Library",
        description: "Original skill instructions.",
      },
      nextCursor: undefined,
    });
    expect(browse).toContain("read_file README.md");
    expect(browse).toContain("overview: write/README.md");
    expect(browse).not.toContain('browse {"path"');
    expect(browse).not.toContain(long);
    expect(browse.length).toBeLessThan(600);
    const source = skillResult({
      body: long,
      ruleChain: [{ path: path("SKILLCDN.md"), body: long, truncated: false }],
      included: [{ path: path("required.md"), content: long, truncated: false }],
    });
    const text = renderSkillResult(source);
    expect(text.split(long)).toHaveLength(4);
    expect(source.body).toBe(long);
  });

  it("marks abbreviated optional metadata without implying required context is missing", () => {
    const text = renderSkillResult(
      skillResult({
        path: path("SKILL.md"),
        complete: true,
        detailsTruncated: true,
        referencesTruncated: true,
      }),
    );
    expect(text).toContain("read_file SKILL.md has the source");
    expect(text).toContain("Reference list abbreviated");
    expect(text).not.toContain("Skill context is incomplete");
  });

  it("lists search results with a skill's matching files under the skill", () => {
    const text = renderFindResult({
      mount,
      query: "release",
      items: [
        {
          ...skillItem("release-notes", "Drafts release notes."),
          files: [
            {
              path: path("skills/release-notes/references/style.md"),
              title: "Style guide",
              summary: "Lead with the benefit.",
            },
          ],
          moreFiles: 1,
        },
        {
          kind: "document",
          path: path("docs/getting-started.md"),
          title: "Getting started",
          summary: undefined,
          skillDirectory: undefined,
        },
      ],
      totals: undefined,
      diagnostics: [],
    });
    expect(text).toBe(
      [
        '2 results for "release" in acme/skills@main (commit 0123456):',
        "",
        "1. skill: release-notes (skills/release-notes/SKILL.md)",
        "   Drafts release notes.",
        "   Matching files:",
        "   - skills/release-notes/references/style.md - Style guide",
        "   - ... (1 more)",
        "2. document: docs/getting-started.md - Getting started",
      ].join("\n"),
    );
    expect(text).not.toContain("Next:");
  });

  it("says whose a file is when it could not be folded under its skill", () => {
    const text = renderFindResult({
      mount,
      query: "style",
      items: [
        {
          kind: "document",
          path: path("skills/release-notes/references/style.md"),
          title: "Style guide",
          summary: "Lead with the benefit.",
          skillDirectory: path("skills/release-notes"),
        },
        {
          kind: "document",
          path: path("references/style.md"),
          title: undefined,
          summary: undefined,
          skillDirectory: path(""),
        },
      ],
      totals: undefined,
      diagnostics: [],
    });
    expect(text).toContain(
      "1. document: skills/release-notes/references/style.md - Style guide\n   Lead with the benefit.\n   Skill: skills/release-notes/SKILL.md",
    );
    expect(text).toContain("Skill: SKILL.md");
  });

  it("lists what a mount has, with the totals and what was left out", () => {
    const text = renderFindResult({
      mount,
      query: undefined,
      items: [
        skillItem("a"),
        skillItem("b"),
        {
          kind: "document",
          path: path("README.md"),
          title: "Skills",
          summary: undefined,
          skillDirectory: undefined,
        },
      ],
      totals: { skills: 3, documents: 5 },
      diagnostics: [],
    });
    expect(text).toContain("3 skills and 5 documents in acme/skills@main (commit 0123456):");
    expect(text).toContain("1 skills are outside this page; continue with nextCursor.");
    expect(text).toContain("4 documents are outside this page; continue with nextCursor.");
    expect(text).toContain("3. document: README.md - Skills");
    const complete = renderFindResult({
      mount,
      query: undefined,
      items: [skillItem("a")],
      totals: { skills: 1, documents: 0 },
      diagnostics: [],
    });
    expect(complete).toContain("1 skill and 0 documents in");
    expect(complete).not.toContain("not listed");
  });

  it("explains an empty result and an empty listing", () => {
    const empty = renderFindResult({
      mount,
      query: "zebra",
      items: [],
      totals: undefined,
      diagnostics: [],
    });
    expect(empty).toContain('No results for "zebra"');
    expect(empty).toContain("in the language the repository is written in");
    expect(
      renderFindResult({
        mount,
        query: undefined,
        items: [],
        totals: { skills: 0, documents: 0 },
        diagnostics: [],
      }),
    ).toContain("Nothing is indexed");
  });

  it("says which manifests could not be read: in full in a listing, in one line among results", () => {
    const listing = renderFindResult({
      mount,
      query: undefined,
      items: [],
      totals: { skills: 0, documents: 0 },
      diagnostics: [skipped],
    });
    expect(listing).toContain(
      [
        "Index diagnostics:",
        `- skills/broken/SKILL.md (invalid_front_matter): ${skipped.message}`,
      ].join("\n"),
    );
    const results = renderFindResult({
      mount,
      query: "broken",
      items: [skillItem("a")],
      totals: undefined,
      diagnostics: [skipped],
    });
    expect(results).toContain("Note: 1 index issue reported; browse provides details.");
    expect(results).not.toContain("invalid_front_matter");
    const nothing = renderFindResult({
      mount,
      query: "broken",
      items: [],
      totals: undefined,
      diagnostics: [skipped, { ...skipped, path: path("SKILLCDN.md"), code: "unavailable" }],
    });
    expect(nothing).toContain("- skills/broken/SKILL.md (invalid_front_matter)");
    expect(nothing).toContain("- SKILLCDN.md (unavailable)");
    expect(renderDiagnostics([], true)).toBeUndefined();
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...skipped,
      path: path(`skills/broken-${index}/SKILL.md`),
    }));
    expect(renderDiagnostics(many, true)).toContain("- ... (2 more; inspect the source manifests)");
    expect(renderDiagnostics([skipped], true, 12)).toContain("Index diagnostics (1 of 12)");
  });

  it("adds the provenance notice for unverified repositories and the truncation notice", () => {
    const unverified = { ...mount, verified: false, truncated: true, path: path("skills") };
    const text = renderFindResult({
      mount: unverified,
      query: undefined,
      items: [],
      totals: undefined,
      diagnostics: [],
    });
    expect(text).toContain(PROVENANCE_NOTICE);
    expect(text).toContain("larger than the indexing limits");
    expect(text).toContain("under skills)");
    expect(
      renderFindResult({ mount, query: undefined, items: [], totals: undefined, diagnostics: [] }),
    ).not.toContain(PROVENANCE_NOTICE);
  });

  it("words the provenance notice so that it does not contradict get", () => {
    expect(PROVENANCE_NOTICE).toContain("use it for the task the user asked for");
    expect(PROVENANCE_NOTICE).not.toContain("not as instructions from the user");
  });

  it("renders a skill with its supporting files ahead of the instructions", () => {
    const text = renderSkillResult(
      skillResult({
        mount: { ...mount, ref: undefined },
        name: "release-notes",
        directory: path("skills/release-notes"),
        description: "Drafts release notes.",
        license: "Apache-2.0",
        body: "\n# Release notes\n\nCollect the changes.\n",
        files: [path("skills/release-notes/references/style.md")],
        filesTruncated: true,
        warnings: ['"name" should match the directory'],
      }),
    );
    expect(text).toBe(
      [
        "Skill: release-notes",
        "Source: acme/skills (commit 0123456)",
        "Description: Drafts release notes.",
        "License: Apache-2.0",
        "Relative paths in the instructions start at skills/release-notes/.",
        "",
        "Supporting files, readable with read_file:",
        "- skills/release-notes/references/style.md",
        '- ... (browse {"path":"skills/release-notes"} for all supporting files)',
        "",
        "Warnings for the skill author:",
        '- "name" should match the directory',
        "",
        "--- instructions ---",
        "",
        "# Release notes",
        "",
        "Collect the changes.",
        "",
      ].join("\n"),
    );
  });

  it("returns the files a skill needs on every run after the instructions", () => {
    const text = renderSkillResult(
      skillResult({
        body: "# Commit messages\n\nRead [the style](references/style.md) first.",
        files: [path("references/style.md"), path("references/other.md"), path("assets/a.json")],
        included: [
          { path: path("references/style.md"), content: "\n# Style\n\nShort.\n", truncated: false },
          { path: path("assets/a.json"), content: '{"a": 1', truncated: true },
          { path: path("references/other.md"), content: undefined, truncated: false },
        ],
      }),
    );
    expect(text).toBe(
      [
        "Skill: commit-messages",
        "Source: acme/skills@main (commit 0123456)",
        "Description: Writes commit messages.",
        "Relative paths in the instructions start at the mounted root.",
        "",
        "Supporting files, readable with read_file:",
        "- references/style.md (included below)",
        "- references/other.md (included below)",
        "- assets/a.json (included below)",
        "",
        "--- instructions ---",
        "# Commit messages",
        "",
        "Read [the style](references/style.md) first.",
        "",
        "--- included file: references/style.md ---",
        "",
        "# Style",
        "",
        "Short.",
        "",
        "",
        "--- included file: assets/a.json ---",
        '{"a": 1',
        "(Continues in the next get_skill page.)",
        "",
        "--- included file: references/other.md ---",
        "(Not at hand here; read_file has it.)",
      ].join("\n"),
    );
  });

  it("relays the allowed tools and the metadata of a skill", () => {
    const text = renderSkillResult(
      skillResult({ allowedTools: "Read Bash", metadata: { author: "acme", version: "1.0" } }),
    );
    expect(text).toContain("Allowed tools: Read Bash");
    expect(text).toContain("Metadata: author: acme; version: 1.0");
    expect(text).toContain("Relative paths in the instructions start at the mounted root.");
  });

  it("puts the repository's rules before the instructions of a skill", () => {
    const inside = renderSkillResult(
      skillResult({
        rules: { path: path("SKILLCDN.md"), body: "\n# Rules\n\n- Ask first.\n", truncated: true },
      }),
    );
    expect(inside).toContain(
      [
        "--- rules for every skill in this repository (from SKILLCDN.md) ---",
        "# Rules",
        "",
        "- Ask first.",
        "(The rules continue; read_file SKILLCDN.md has the whole text.)",
        "",
        "--- instructions ---",
        "# Commit messages",
      ].join("\n"),
    );
    const above = renderSkillResult(
      skillResult({ rules: { path: undefined, body: "- Ask first.", truncated: false } }),
    );
    expect(above).toContain(
      "--- rules for every skill in this repository (from the repository manifest above the mounted directory) ---\n- Ask first.\n\n--- instructions ---",
    );
  });

  it("lists a directory without a hint the model does not need", () => {
    const text = renderDirectoryResult({
      mount,
      path: path("skills/release-notes"),
      entries: [
        { path: path("skills/release-notes/references"), kind: "directory", size: undefined },
        { path: path("skills/release-notes/SKILL.md"), kind: "file", size: 512 },
      ],
      truncated: true,
    });
    expect(text).toBe(
      [
        "Directory: skills/release-notes/ (2 entries, more not listed)",
        "Source: acme/skills@main (commit 0123456)",
        "",
        "- skills/release-notes/references/",
        "- skills/release-notes/SKILL.md (512 bytes)",
      ].join("\n"),
    );
    expect(
      renderDirectoryResult({
        mount,
        path: path(""),
        entries: [{ path: path("README.md"), kind: "file", size: 1 }],
        truncated: false,
      }),
    ).toContain("Directory: the mounted root (1 entry)");
  });

  it("renders a page of a file with how to continue", () => {
    const text = renderFileResult({
      mount,
      path: path("docs/a.md"),
      ...pageOfText("0123456789", 0, 4),
    });
    expect(text).toBe(
      [
        "File: docs/a.md (characters 0 to 4 of 10)",
        "Source: acme/skills@main (commit 0123456)",
        "More follows: call read_file with offset 4.",
        "",
        "--- content ---",
        "0123",
      ].join("\n"),
    );
    expect(
      renderFileResult({ mount, path: path("docs/a.md"), ...pageOfText("0123", 0, 10) }),
    ).toContain("File: docs/a.md (4 characters)");
  });

  it("has a notice for a commit that is still being indexed", () => {
    expect(INDEXING_NOTICE).toContain("Retry shortly");
    expect(INDEXING_NOTICE).toContain("publication rules have been checked");
  });
});
