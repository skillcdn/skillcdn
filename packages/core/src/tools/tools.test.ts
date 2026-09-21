import { describe, expect, it } from "vitest";
import * as z from "zod";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import {
  findInputSchema,
  findTool,
  getInputSchema,
  getTool,
  READ_FILE_MAX_LIMIT,
  readFileInputSchema,
  readFileTool,
  TOOL_NAMES,
} from "./contracts.js";
import {
  INDEXING_NOTICE,
  PROVENANCE_NOTICE,
  renderFileResult,
  renderFindResult,
  renderSkillResult,
} from "./render.js";
import { type MountSummary, pageOfText } from "./results.js";

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

describe("tool contracts", () => {
  it("keeps the public tool names stable", () => {
    expect(TOOL_NAMES).toEqual(["find", "get", "read_file"]);
  });

  it("exports input schemas that convert to JSON Schema objects", () => {
    for (const tool of [findTool, getTool, readFileTool]) {
      const schema = z.toJSONSchema(tool.inputSchema);
      expect(schema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(40);
    }
    expect(z.toJSONSchema(getInputSchema).required).toEqual(["name"]);
    expect(z.toJSONSchema(readFileInputSchema).required).toEqual(["path"]);
    expect(z.toJSONSchema(findInputSchema).required).toBeUndefined();
  });

  it("accepts the documented inputs", () => {
    expect(findInputSchema.parse({})).toEqual({});
    expect(findInputSchema.parse({ query: "release", limit: 5 })).toEqual({
      query: "release",
      limit: 5,
    });
    expect(getInputSchema.parse({ name: "release-notes" })).toEqual({ name: "release-notes" });
    expect(readFileInputSchema.parse({ path: "docs/a.md", offset: 10 })).toEqual({
      path: "docs/a.md",
      offset: 10,
    });
  });

  it.each([
    ["an oversized query", findInputSchema, { query: "q".repeat(501) }],
    ["a limit of zero", findInputSchema, { limit: 0 }],
    ["a fractional limit", findInputSchema, { limit: 2.5 }],
    ["a query that is not text", findInputSchema, { query: ["a"] }],
    ["an empty skill name", getInputSchema, { name: "" }],
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
  it("lists search results with what to do next", () => {
    const text = renderFindResult({
      mount,
      query: "release",
      items: [
        {
          kind: "skill",
          name: "release-notes",
          directory: path("skills/release-notes"),
          description: "Drafts release notes.",
        },
        {
          kind: "document",
          path: path("docs/getting-started.md"),
          title: "Getting started",
          summary: undefined,
        },
      ],
    });
    expect(text).toBe(
      [
        '2 results for "release" in acme/skills@main (commit 0123456):',
        "",
        "1. skill: release-notes (skills/release-notes)",
        "   Drafts release notes.",
        "2. document: docs/getting-started.md - Getting started",
        "",
        'Next: get {"name": "<skill name>"} loads a skill; read_file {"path": "<path>"} reads a document.',
      ].join("\n"),
    );
  });

  it("explains an empty result and an empty listing", () => {
    expect(renderFindResult({ mount, query: "zebra", items: [] })).toContain(
      'No results for "zebra"',
    );
    expect(renderFindResult({ mount, query: undefined, items: [] })).toContain(
      "Nothing is indexed",
    );
  });

  it("adds the provenance notice for unverified repositories and the truncation notice", () => {
    const unverified = { ...mount, verified: false, truncated: true, path: path("skills") };
    const text = renderFindResult({ mount: unverified, query: undefined, items: [] });
    expect(text).toContain(PROVENANCE_NOTICE);
    expect(text).toContain("larger than the indexing limits");
    expect(text).toContain("under skills)");
    expect(renderFindResult({ mount, query: undefined, items: [] })).not.toContain(
      PROVENANCE_NOTICE,
    );
  });

  it("renders a skill with its supporting files ahead of the instructions", () => {
    const text = renderSkillResult({
      mount: { ...mount, ref: undefined },
      name: "release-notes",
      directory: path("skills/release-notes"),
      description: "Drafts release notes.",
      license: "Apache-2.0",
      compatibility: undefined,
      allowedTools: undefined,
      metadata: {},
      body: "\n# Release notes\n\nCollect the changes.\n",
      files: [path("skills/release-notes/references/style.md")],
      filesTruncated: true,
      warnings: ['"name" should match the directory'],
    });
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
        "- ... (more files not listed)",
        "",
        "Warnings for the skill author:",
        '- "name" should match the directory',
        "",
        "--- instructions ---",
        "# Release notes",
        "",
        "Collect the changes.",
      ].join("\n"),
    );
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
    expect(INDEXING_NOTICE).toContain("few seconds");
  });
});
