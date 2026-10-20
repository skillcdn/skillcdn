import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import { renderBrowseResult, renderFindResult } from "./render.js";
import type { FileOutline, MountSummary } from "./results.js";

// What a model is told of the sections a search matched and of the outline of a file
// (ADR-0063): each with the offset and the limit that read it with read_repo_file.

function path(input: string): RepoPath {
  const result = parseRepoPath(input);
  if (!result.ok) {
    throw new Error(`invalid test path ${input}`);
  }
  return result.value;
}

const mount: MountSummary = {
  repository: "acme/handbook",
  ref: undefined,
  commit: "0123456789abcdef0123456789abcdef01234567",
  path: path(""),
  verified: true,
  truncated: false,
  skillUri: "skill://gh/acme/handbook",
};

const outline = (patch: Partial<FileOutline> = {}): FileOutline => ({
  path: path("docs/billing.md"),
  size: 2048,
  totalLength: 1990,
  headings: [
    { level: 1, text: "Billing", offset: 0, length: 120 },
    { level: 2, text: "Plans", offset: 120, length: 400 },
    { level: 3, text: "", offset: 520, length: 100 },
    { level: 2, text: "Discounts", offset: 620, length: 1370 },
  ],
  truncated: false,
  ...patch,
});

describe("search results with sections", () => {
  it("names each matched section with its heading path, what reads it, and an excerpt", () => {
    const text = renderFindResult({
      mount,
      query: "discount",
      items: [
        {
          kind: "document",
          path: path("docs/billing.md"),
          title: "Billing",
          summary: "How a workspace is charged.",
          skillDirectory: undefined,
          sections: [
            {
              heading: ["Billing", "Discounts"],
              offset: 620,
              length: 1370,
              excerpt: "Volume discounts apply from ten seats.",
            },
            { heading: [], offset: 0, length: 40, excerpt: undefined },
          ],
        },
      ],
      totals: undefined,
      diagnostics: [],
    });
    expect(text).toContain(
      [
        "1. document: docs/billing.md - Billing",
        "   How a workspace is charged.",
        "   Sections:",
        "   - Billing > Discounts (offset 620, limit 1370): Volume discounts apply from ten seats.",
        "   - (before the first heading) (offset 0, limit 40)",
        "",
        "A section is read with read_repo_file: the path, its offset and its limit.",
      ].join("\n"),
    );
  });

  it("says nothing of sections when a result has none", () => {
    const text = renderFindResult({
      mount,
      query: "plans",
      items: [
        {
          kind: "document",
          path: path("docs/billing.md"),
          title: "Billing",
          summary: undefined,
          skillDirectory: undefined,
          sections: [],
        },
      ],
      totals: undefined,
      diagnostics: [],
    });
    expect(text).not.toContain("Sections:");
    expect(text).not.toContain("A section is read with");
  });
});

describe("the outline of a file", () => {
  it("lists the headings by level with the offset and limit that read each section", () => {
    const text = renderBrowseResult({
      mount,
      path: path("docs/billing.md"),
      entries: [],
      nextCursor: undefined,
      outline: outline(),
    });
    expect(text).toBe(
      [
        "File: docs/billing.md (1990 characters; 4 headings)",
        "Source: acme/handbook (commit 0123456)",
        "",
        "Outline; a section is read with read_repo_file: the path, its offset and its limit.",
        "- # Billing (offset 0, limit 120)",
        "  - ## Plans (offset 120, limit 400)",
        "    - ### (untitled) (offset 520, limit 100)",
        "  - ## Discounts (offset 620, limit 1370)",
      ].join("\n"),
    );
  });

  it("names the command's reads where a program asks for them, and pages a long outline", () => {
    const text = renderBrowseResult(
      {
        mount,
        path: path("docs/billing.md"),
        entries: [],
        nextCursor: "more",
        outline: outline({ truncated: true }),
      },
      {
        browse: "skillcdn browse",
        search: "skillcdn find",
        load: "skillcdn skill",
        read: "skillcdn file",
      },
    );
    expect(text).toContain("4 headings, the first of more)");
    expect(text).toContain("a section is read with skillcdn file");
    expect(text).toContain('nextCursor: "more"');
  });

  it("says why a file has no outline to list", () => {
    const plain = renderBrowseResult({
      mount,
      path: path("docs/notes.md"),
      entries: [],
      nextCursor: undefined,
      outline: outline({ path: path("docs/notes.md"), headings: [], totalLength: 300 }),
    });
    expect(plain).toContain("File: docs/notes.md (300 characters; no headings)");
    expect(plain).toContain("read_repo_file reads it from the start.");
    const json = renderBrowseResult({
      mount,
      path: path("docs/data.json"),
      entries: [],
      nextCursor: undefined,
      outline: outline({
        path: path("docs/data.json"),
        headings: [],
        totalLength: undefined,
        unavailable: "not_markdown",
      }),
    });
    expect(json).toContain("File: docs/data.json (2048 bytes)");
    expect(json).toContain("Not a Markdown document, so it has no outline.");
    const large = renderBrowseResult({
      mount,
      path: path("docs/big.md"),
      entries: [],
      nextCursor: undefined,
      outline: outline({
        path: path("docs/big.md"),
        headings: [],
        totalLength: undefined,
        unavailable: "too_large",
        sourceUrl: "https://example.test/big.md",
      }),
    });
    expect(large).toContain(
      "Too large to read here. Fetch it from the source: https://example.test/big.md",
    );
    const described = renderBrowseResult({
      mount: { ...mount, verified: false },
      path: path("docs/secret.md"),
      entries: [],
      nextCursor: undefined,
      outline: outline({
        path: path("docs/secret.md"),
        headings: [],
        totalLength: undefined,
        unavailable: "described_only",
        license: { kind: "restrictive", name: "CC-BY-NC-4.0", source: path("LICENSE") },
        sourceUrl: "https://example.test/secret.md",
      }),
    });
    expect(described).toContain("Described only: the license (CC-BY-NC-4.0 (LICENSE))");
    expect(described).toContain("Read it at its source: https://example.test/secret.md");
    expect(described).not.toContain("Outline;");
  });
});
