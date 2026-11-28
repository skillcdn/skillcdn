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
  describeSource,
  INDEXING_NOTICE,
  MCP_TOOL_WORDS,
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
import { skillShown } from "./shown.js";

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
  skillUri: "skill://gh/acme/skills",
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
    expect(TOOL_NAMES).toEqual(["browse_repo", "search_repo", "load_skill", "read_repo_file"]);
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

  it("ends a page it cuts at the end of a line where it is asked to, and joins back to the text", () => {
    const text = "first line\nsecond line\nthird line\n";
    // Cut in the middle of the second line: the page ends after the first.
    expect(pageOfText(text, 0, 16, { atLineEnd: true })).toMatchObject({
      content: "first line\n",
      nextOffset: 11,
    });
    // Cut exactly at the end of a line, or holding the rest of the text: as it is.
    expect(pageOfText(text, 0, 11, { atLineEnd: true }).content).toBe("first line\n");
    expect(pageOfText(text, 11, 100, { atLineEnd: true })).toMatchObject({
      content: "second line\nthird line\n",
      nextOffset: undefined,
    });
    // A line longer than the page is cut by the count: a page always advances.
    expect(pageOfText(text, 0, 5, { atLineEnd: true })).toMatchObject({
      content: "first",
      nextOffset: 5,
    });
    // Without the option a page is the count asked for.
    expect(pageOfText(text, 0, 16).content).toBe("first line\nsecon");
    // Page by page, whatever the size, the pages are the text.
    for (const size of [1, 4, 7, 12, 20, 100]) {
      let joined = "";
      let at: number | undefined = 0;
      while (at !== undefined) {
        const page = pageOfText(text, at, size, { atLineEnd: true });
        joined += page.content;
        at = page.nextOffset;
      }
      expect(joined).toBe(text);
    }
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
    expect(browse).toContain("read_repo_file README.md");
    expect(browse).toContain("overview: write/README.md");
    expect(browse).not.toContain('browse_repo {"path"');
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
    expect(text).toContain("read_repo_file SKILL.md has the source");
    expect(text).toContain("Reference list abbreviated");
    expect(text).not.toContain("Skill context is incomplete");
  });

  it("says what a first page abbreviated, and names the linked files it did not resolve", () => {
    const text = renderSkillResult(
      skillResult({
        path: path("write/SKILL.md"),
        directory: path("write"),
        complete: true,
        detailsTruncated: true,
        detailsAbbreviated: ["the description", "the warnings (3 of 5)"],
        referencesTruncated: true,
        referencesUnlisted: { paths: ["write/a.md", "docs/b.md"], more: 4 },
      }),
    );
    expect(text).toContain(
      "Abbreviated above: the description, the warnings (3 of 5). The instructions below are whole; read_repo_file write/SKILL.md has the source.",
    );
    expect(text).toContain(
      '6 more linked files, not resolved above: write/a.md, docs/b.md, and 4 more. Each is linked where the text names it; browse_repo {"path":"write"} lists the skill\'s own files.',
    );
    expect(text).not.toContain("abbreviated;");
    const one = renderSkillResult(
      skillResult({
        referencesTruncated: true,
        referencesUnlisted: { paths: ["write/a.md"], more: 0 },
      }),
    );
    expect(one).toContain("1 more linked file, not resolved above: write/a.md. Each is linked");
  });

  it("names a skill's folder by the line that lists it, where the words make one", () => {
    // A reader that runs lines cannot run the call of a tool: the caller makes the line, whole.
    const words = {
      ...MCP_TOOL_WORDS,
      browse: "skillcdn browse",
      browseFolder: (folder: string) =>
        folder.length === 0 ? "skillcdn browse pack" : `skillcdn browse pack ${folder}`,
    };
    const linked = renderSkillResult(
      skillResult({
        directory: path("write"),
        referencesTruncated: true,
        referencesUnlisted: { paths: ["write/a.md"], more: 0 },
      }),
      words,
    );
    expect(linked).toContain(
      "Each is linked where the text names it; skillcdn browse pack write lists the skill's own files.",
    );
    const listed = renderSkillResult(
      skillResult({
        directory: path("write"),
        files: [path("write/references/style.md")],
        filesTruncated: true,
      }),
      words,
    );
    expect(listed).toContain("- ... (skillcdn browse pack write for all supporting files)");
    // A skill at the root of the pack has the pack itself for its folder.
    const root = renderSkillResult(
      skillResult({
        directory: path(""),
        files: [path("references/style.md")],
        filesTruncated: true,
      }),
      words,
    );
    expect(root).toContain("- ... (skillcdn browse pack for all supporting files)");
    for (const text of [linked, listed, root]) {
      expect(text).not.toContain('{"path"');
    }
  });

  it("says the head of a table again above the rows a page begins with (ADR-0118)", () => {
    const head = "| Input | Source |\n|---|---|\n";
    const rows = "| The task | Its number |\n| The work | Its body |\n";
    const text = renderSkillResult(
      skillResult({
        body: "",
        tableHead: head,
        included: [
          { path: path("write/inputs.md"), content: rows, truncated: false },
          { path: path("write/other.md"), content: "Other.", truncated: false },
        ],
      }),
    );
    // Above the first text of the page, the one the page before cut, and nowhere else.
    expect(text).toContain(
      `--- included file: write/inputs.md ---\n(The table goes on from the page before; its first lines again:)\n${head}${rows}`,
    );
    expect(text.split("its first lines again").length).toBe(2);
    expect(text).toContain("--- included file: write/other.md ---\nOther.");
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

  it("ends a page with the sentence a reader of a command runs, and lists the skills alone for one", () => {
    // A reader that runs a line is given the line last, and no cursor to call a tool with.
    const words = {
      ...MCP_TOOL_WORDS,
      browse: "skillcdn browse",
      search: "skillcdn find",
      pageNext: (cursor: string) => `Next page: skillcdn skills pack --cursor ${cursor}`,
    };
    const listing = {
      mount: { ...mount, verified: false, visibility: "public" as const },
      query: undefined,
      items: [skillItem("a"), skillItem("b")],
      totals: { skills: 3, documents: 5 },
      diagnostics: [],
      nextCursor: "next-page",
    };
    const text = renderFindResult({ ...listing, skillsAlone: true }, words);
    expect(text).toContain("3 skills and 5 documents in ");
    expect(text).toContain("1 skills are outside this page; the command below continues.");
    // The documents are counted with what reads them, and not said to be on a later page.
    expect(text).toContain(
      "The 5 documents outside the skills are not listed here: skillcdn browse lists a folder with what it holds, and skillcdn find finds them by what they say.",
    );
    expect(text).not.toContain("documents are outside this page");
    expect(text).not.toContain("nextCursor");
    // The sentence is the last thing said, after what is said of the source.
    expect(text).toContain(PROVENANCE_NOTICE);
    expect(text.endsWith("\n\nNext page: skillcdn skills pack --cursor next-page")).toBe(true);
    // A pack of documents alone is not one where nothing is indexed.
    const documents = renderFindResult(
      {
        ...listing,
        items: [],
        totals: { skills: 0, documents: 1 },
        nextCursor: undefined,
        skillsAlone: true,
      },
      words,
    );
    expect(documents).toContain("0 skills and 1 document in ");
    expect(documents).toContain("The 1 document outside the skills is not listed here:");
    expect(documents).not.toContain("Nothing is indexed");
    // A client that calls a tool is told of the cursor, as before, and of every document.
    const called = renderFindResult(listing);
    expect(called).toContain("1 skills are outside this page; continue with nextCursor.");
    expect(called).toContain("5 documents are outside this page; continue with nextCursor.");
    expect(called).toContain('nextCursor: "next-page"');
    // A page of a folder ends the same way.
    const folder = renderBrowseResult(
      { mount, path: path("docs"), entries: [], nextCursor: "next-page" },
      words,
    );
    expect(folder.endsWith("\n\nNext page: skillcdn skills pack --cursor next-page")).toBe(true);
    expect(folder).not.toContain("nextCursor");
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
    expect(results).toContain("Note: 1 index issue reported; browse_repo provides details.");
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

  it("adds no provenance notice for a private repository, whoever vouched for it (ADR-0061)", () => {
    const privately = { ...mount, verified: false, visibility: "private" as const };
    const empty = { query: undefined, items: [], totals: undefined, diagnostics: [] };
    expect(renderFindResult({ mount: privately, ...empty })).not.toContain(PROVENANCE_NOTICE);
    const publicly = { ...mount, verified: false, visibility: "public" as const };
    expect(renderFindResult({ mount: publicly, ...empty })).toContain(PROVENANCE_NOTICE);
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
        "Supporting files, readable with read_repo_file:",
        "- skills/release-notes/references/style.md",
        '- ... (browse_repo {"path":"skills/release-notes"} for all supporting files)',
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

  it("names the files over the read limit with where to fetch them, after the readable ones", () => {
    const text = renderSkillResult(
      skillResult({
        name: "impeccable",
        directory: path("plugin/skills/impeccable"),
        body: "Design it.",
        files: [path("plugin/skills/impeccable/reference/audit.md")],
        oversized: [
          {
            path: "plugin/skills/impeccable/scripts/data/font-index.json",
            size: 3_000_000,
            sourceUrl:
              "https://raw.githubusercontent.com/acme/skills/0123456789abcdef0123456789abcdef01234567/plugin/skills/impeccable/scripts/data/font-index.json",
          },
        ],
      }),
    );
    expect(text).toContain(
      [
        "Supporting files, readable with read_repo_file:",
        "- plugin/skills/impeccable/reference/audit.md",
        "",
        "Files over this server's size limit, not readable here; fetch them from the source:",
        "- plugin/skills/impeccable/scripts/data/font-index.json (3000000 bytes): https://raw.githubusercontent.com/acme/skills/0123456789abcdef0123456789abcdef01234567/plugin/skills/impeccable/scripts/data/font-index.json",
        "",
        "--- instructions ---",
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
        "Supporting files, readable with read_repo_file:",
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
        "(Continues in the next load_skill page.)",
        "",
        "--- included file: references/other.md ---",
        "(Not at hand here; read_repo_file has it.)",
      ].join("\n"),
    );
  });

  it("says how many pages are left, and ends a page with the call that reads the next (ADR-0123)", () => {
    const text = renderSkillResult(
      skillResult({
        path: path("SKILL.md"),
        complete: false,
        nextCursor: "next-page",
        pagesLeft: 3,
      }),
    );
    const call = 'load_skill with path "SKILL.md" and cursor "next-page"';
    expect(text).toContain(
      `Skill context is incomplete. 3 more pages follow this one. Continue ${call} before using it.`,
    );
    // The end of the page is what a reader has just read: the call is there once more.
    expect(
      text.endsWith(
        `This page ends before the skill does: 3 more pages follow this one, and what follows is part of its instructions. Do not use the skill or answer from it yet: continue ${call}, and go on until a page says the skill is complete.`,
      ),
    ).toBe(true);
    const one = renderSkillResult(
      skillResult({
        path: path("SKILL.md"),
        complete: false,
        nextCursor: "next-page",
        pagesLeft: 1,
      }),
    );
    expect(one).toContain("Skill context is incomplete. 1 more page follows this one. Continue");
    expect(one).toContain("This page ends before the skill does: 1 more page follows this one,");
    // The last page of a skill read in several says that it is the last.
    const last = renderSkillResult(skillResult({ complete: true, pagesLeft: 0 }));
    expect(last.endsWith("Skill context is complete: this was its last page.")).toBe(true);
    // A skill read in one page says nothing of pages, and one that cannot go on says why.
    const whole = renderSkillResult(skillResult({ complete: true }));
    expect(whole).not.toContain("page");
    const stuck = renderSkillResult(skillResult({ complete: false, nextCursor: undefined }));
    expect(stuck).toContain(
      "Skill context is incomplete. Resolve the warnings before using this skill.",
    );
    expect(stuck).not.toContain("This page ends before the skill does");
  });

  it("says the same of a part a command prints, and ends it with the line that prints the next (ADR-0124)", () => {
    const words = {
      ...MCP_TOOL_WORDS,
      load: "skillcdn skill",
      piece: "part",
      loadNext: (skill: string, cursor: string) =>
        `skillcdn skill pack ${skill} --cursor ${cursor}`,
    };
    const line = "skillcdn skill pack SKILL.md --cursor next-page";
    const going = { path: path("SKILL.md"), complete: false, nextCursor: "next-page" };
    // A part is a run of pages: the pages of the skill are what is counted, in the part's word.
    const part = renderSkillResult(skillResult({ ...going, pagesLeft: 3 }), words);
    expect(part).toContain(
      `Skill context is incomplete. 3 more pages follow this part. Read the next part before using it: ${line}`,
    );
    // The last line is the line to run, alone, after what says to run it now.
    expect(
      part.endsWith(
        `This part ends before the skill does: 3 more pages follow this part, and what follows is part of its instructions. Do not use the skill, plan from it or answer from it yet: read the next part now, and each one after it, until a part says the skill is complete:\n${line}`,
      ),
    ).toBe(true);
    // A pack that counts no pages still says that the skill goes on, at the head and at the end.
    const uncounted = renderSkillResult(skillResult(going), words);
    expect(uncounted).toContain(
      `Skill context is incomplete. Read the next part before using it: ${line}`,
    );
    expect(
      uncounted.endsWith(
        `This part ends before the skill does: what follows is part of its instructions. Do not use the skill, plan from it or answer from it yet: read the next part now, and each one after it, until a part says the skill is complete:\n${line}`,
      ),
    ).toBe(true);
    const last = renderSkillResult(skillResult({ complete: true, pagesLeft: 0 }), words);
    expect(last.endsWith("Skill context is complete: this was its last part.")).toBe(true);
    // A skill printed whole says nothing of parts, and words without a line name the read.
    expect(renderSkillResult(skillResult({ complete: true }), words)).not.toContain("part");
    const named = renderSkillResult(skillResult({ ...going, pagesLeft: 1 }), {
      ...MCP_TOOL_WORDS,
      load: "skillcdn skill",
      piece: "part",
    });
    expect(named).toContain(
      'Skill context is incomplete. 1 more page follows this part. Continue skillcdn skill with path "SKILL.md" and cursor "next-page" before using it.',
    );
  });

  it("shows of a skill what one answer takes of it: the lists bounded, the facts once", () => {
    const files = Array.from({ length: 200 }, (_, at) => path(`references/file-${at}-of-many.md`));
    const shown = skillShown(
      skillResult({ description: "word ".repeat(200), files, warnings: ["a", "b", "c", "d"] }),
    );
    expect(shown.description.length).toBe(360);
    expect(shown.files.length).toBeLessThan(files.length);
    expect(shown.filesTruncated).toBe(true);
    expect(shown.detailsAbbreviated).toEqual(["the description", "the warnings (3 of 4)"]);
    // A page after the first names the skill and says none of its facts again.
    const later = skillShown(skillResult({ description: "A skill.", files, license: "MIT" }), true);
    expect(later).toMatchObject({ description: "", files: [], references: [], license: undefined });
    expect(later.filesTruncated).toBe(false);
  });

  it("relays the allowed tools and the metadata of a skill", () => {
    const text = renderSkillResult(
      skillResult({ allowedTools: "Read Bash", metadata: { author: "acme", version: "1.0" } }),
    );
    expect(text).toContain("Allowed tools: Read Bash");
    expect(text).toContain("Metadata: author: acme; version: 1.0");
    expect(text).toContain("Relative paths in the instructions start at the mounted root.");
  });

  it("puts the applicable rules before the instructions, as the served document has them", () => {
    const inside = renderSkillResult(
      skillResult({
        ruleChain: [
          { path: path("SKILLCDN.md"), body: "# Rules\n\n- Ask first.", truncated: true },
        ],
      }),
    );
    expect(inside).toContain(
      [
        "--- applicable rules: SKILLCDN.md ---",
        "# Rules",
        "",
        "- Ask first.",
        "(Continues in the next load_skill page.)",
        "",
        "--- instructions ---",
        "# Commit messages",
      ].join("\n"),
    );
    // The legacy single-rule field is no longer rendered: the chain is complete on its own.
    const above = renderSkillResult(
      skillResult({
        rules: { path: undefined, body: "- Ask first.", truncated: false },
        ruleChain: [{ path: undefined, body: "- Ask first.", truncated: false }],
      }),
    );
    expect(above).toContain(
      "--- applicable rules: the repository manifest above the mounted directory ---\n- Ask first.\n\n--- instructions ---",
    );
    expect(above).not.toContain("rules for every skill in this repository");
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
        "More follows: call read_repo_file with offset 4.",
        "",
        "--- content ---",
        "0123",
      ].join("\n"),
    );
    expect(
      renderFileResult({ mount, path: path("docs/a.md"), ...pageOfText("0123", 0, 10) }),
    ).toContain("File: docs/a.md (4 characters)");
  });

  it("says where a file continues after a page that delivered the length asked for", () => {
    const delivered = renderFileResult({
      mount,
      path: path("docs/a.md"),
      ...pageOfText("0123456789", 0, 4),
      requestedLength: 4,
    });
    expect(delivered).toContain("The file continues at offset 4.");
    expect(delivered).not.toContain("More follows");
    // A page cut short of what was asked for is one to read on from.
    expect(
      renderFileResult({
        mount,
        path: path("docs/a.md"),
        ...pageOfText("0123456789", 0, 4),
        requestedLength: 6,
      }),
    ).toContain("More follows: call read_repo_file with offset 4.");
  });

  it("has a notice for a commit that is still being indexed", () => {
    expect(INDEXING_NOTICE).toContain("Retry shortly");
    expect(INDEXING_NOTICE).toContain("publication rules have been checked");
  });
});

describe("what a result says of originals, pictures, maps and private files (ADR-0076, ADR-0077)", () => {
  it("names the manifest of a browsed folder and the pictures of its folders", () => {
    const text = renderBrowseResult({
      mount,
      path: path("docs"),
      manifestPath: path("docs/SKILLCDN.md"),
      entries: [
        {
          kind: "directory",
          path: path("docs/manual"),
          name: "The manual",
          description: null,
          skillCount: 0,
          documentCount: 4,
          imageCount: 12,
          size: null,
          manifestPath: null,
          language: null,
        },
      ],
      nextCursor: undefined,
      diagnostics: [],
    });
    expect(text).toContain(
      "Manifest: docs/SKILLCDN.md; its front-matter (metadata) and rules are read with read_repo_file.",
    );
    expect(text).toContain(
      "- directory: docs/manual (The manual); 0 skills, 4 documents, 12 images",
    );
  });

  it("outlines a document with what it was made from and the pictures it holds", () => {
    const text = renderBrowseResult({
      mount,
      path: path("docs/manual/ch3.md"),
      entries: [],
      nextCursor: undefined,
      outline: {
        path: path("docs/manual/ch3.md"),
        size: 900,
        totalLength: 880,
        headings: [{ level: 1, text: "Chapter 3", offset: 0, length: 880 }],
        truncated: false,
        sources: [
          {
            text: "sources/manual.pdf",
            path: path("docs/manual/sources/manual.pdf"),
            url: "https://raw.example/manual.pdf",
          },
          { text: "Vendor manual, rev. 3" },
        ],
        images: [
          { path: path("docs/manual/images/a.png"), alt: "Block diagram of the interface" },
          { path: path("docs/manual/images/b.png"), alt: "" },
        ],
      },
    });
    expect(text).toContain(
      "Original: docs/manual/sources/manual.pdf (https://raw.example/manual.pdf); Vendor manual, rev. 3",
    );
    expect(text).toContain(
      [
        "2 images, read as text where the document describes them:",
        "- docs/manual/images/a.png: Block diagram of the interface",
        "- docs/manual/images/b.png (no alternative text)",
      ].join("\n"),
    );
  });

  it("names the original on the first page of a document, and the map among search results", () => {
    const page = renderFileResult({
      mount,
      path: path("docs/manual/ch3.md"),
      sources: [
        { text: "sources/manual.pdf", path: path("docs/manual/sources/manual.pdf"), url: "u" },
      ],
      ...pageOfText("# Chapter 3", 0, 100),
    });
    expect(page).toContain(
      "Source: acme/skills@main (commit 0123456)\nOriginal: docs/manual/sources/manual.pdf (u)",
    );
    const found = renderFindResult({
      mount,
      query: "items",
      items: [
        {
          kind: "document",
          path: path("docs/README.md"),
          title: "The manual",
          summary: "One line per chapter.",
          skillDirectory: undefined,
          overview: true,
        },
      ],
      nextCursor: undefined,
      totals: undefined,
      diagnostics: [],
    });
    expect(found).toContain("1. document: docs/README.md - The manual (overview of its folder)");
  });

  it("tells a reader of a private repository how to fetch what a read does not carry", () => {
    const privately: MountSummary = { ...mount, visibility: "private" };
    const text = renderBrowseResult({
      mount: privately,
      path: path("docs/sources/manual.pdf"),
      entries: [],
      nextCursor: undefined,
      outline: {
        path: path("docs/sources/manual.pdf"),
        size: 5_000_000,
        totalLength: undefined,
        headings: [],
        truncated: false,
        unavailable: "too_large",
        sourceUrl: "https://raw.example/manual.pdf",
      },
    });
    expect(text).toContain(
      "Too large to read here. Fetch it from the source: https://raw.example/manual.pdf The repository acme/skills is private: fetch it with a GitHub credential that may read it",
    );
    const pointer = renderBrowseResult({
      mount,
      path: path("docs/sources/manual.pdf"),
      entries: [],
      nextCursor: undefined,
      outline: {
        path: path("docs/sources/manual.pdf"),
        size: 130,
        totalLength: undefined,
        headings: [],
        truncated: false,
        unavailable: "not_text",
        sourceUrl: "https://github.example/raw/manual.pdf",
        lfs: { size: 7_340_032 },
      },
    });
    expect(pointer).toContain(
      "The repository holds a Git LFS pointer to it; the file itself (7340032 bytes) is served by the host: https://github.example/raw/manual.pdf",
    );
    expect(pointer).not.toContain("is private");
  });

  it("names no credential for a pack served from a directory, which has no host to ask", () => {
    // A directory served from a machine is private too, and its own route sends the file.
    const directory: MountSummary = {
      ...mount,
      host: "local",
      repository: "packs/acme",
      visibility: "private",
      skillUri: "skill://local/packs/acme",
    };
    const text = renderBrowseResult({
      mount: directory,
      path: path("docs/sources/manual.pdf"),
      entries: [],
      nextCursor: undefined,
      outline: {
        path: path("docs/sources/manual.pdf"),
        size: 5_000_000,
        totalLength: undefined,
        headings: [],
        truncated: false,
        unavailable: "not_text",
        sourceUrl: "http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fsources%2Fmanual.pdf",
      },
    });
    expect(text).toContain(
      "Fetch it from the source: http://local.test/api/v1/raw/local/packs/acme?path=docs%2Fsources%2Fmanual.pdf",
    );
    expect(text).not.toContain("credential");
    // A summary from before hosts were named is read as a git host's, as it always was.
    const unnamed = { ...mount, host: undefined, visibility: "private" as const };
    expect(describeSource(unnamed, "https://raw.example/x")).toContain("GitHub credential");
  });
});
