import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import {
  describeFindTool,
  FIND_DESCRIPTION_MAX_LENGTH,
  INSTRUCTIONS_MAX_LENGTH,
  type MountCatalog,
  renderInstructions,
} from "./catalog.js";
import type { BrowseEntry, MountSummary } from "./results.js";

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
}
const mount: MountSummary = {
  repository: "acme/skills",
  ref: "main",
  commit: "0123456789abcdef0123456789abcdef01234567",
  path: path(""),
  verified: true,
  truncated: false,
};
const base: MountCatalog = {
  mount,
  manifest: undefined,
  skills: [],
  skillCount: 0,
  documentCount: 0,
  diagnostics: [],
};
const folder = (value: string): BrowseEntry => ({
  kind: "directory",
  path: path(value),
  name: "Team skills",
  description: "Use for releases and incidents.",
  skillCount: 128,
  documentCount: 2,
  size: null,
  manifestPath: `${value}/SKILLCDN.md`,
  language: "en",
});
describe("repository instructions", () => {
  it("introduces repositories without a manifest using README metadata and an optional read", () => {
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        description: "Host fallback.",
        overview: {
          path: path("README.md"),
          title: "Cloud skills",
          description: "Automate cloud workloads.",
        },
      },
    });
    expect(text).toContain("Cloud skills: Automate cloud workloads.");
    expect(text).toContain("Optional overview: read_file README.md.");
    expect(text).not.toContain("Host fallback");
    expect(text).not.toContain("applicable rules");
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(
      describeFindTool({ status: "ready", catalog: { ...base, description: "Host fallback." } }),
    ).toContain("Host fallback.");
  });

  it("prefers explicit manifest metadata while keeping README readable", () => {
    const catalog: MountCatalog = {
      ...base,
      description: "Host fallback.",
      overview: { path: path("README.md"), title: "README title", description: "README summary." },
      manifest: {
        name: "Author title",
        description: "Author description.",
        path: path("SKILLCDN.md"),
        language: undefined,
        hasRules: true,
      },
    };
    const text = renderInstructions({ status: "ready", catalog });
    expect(text).toContain("Author title: Author description.");
    expect(text).toContain("read_file README.md");
    expect(text).not.toContain("README summary");
    expect(describeFindTool({ status: "ready", catalog })).toContain("Author description.");
  });

  it("introduces real folders without loading their skills or rules", () => {
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        groups: [folder("engineering")],
        skillCount: 128,
        manifest: {
          name: "Company skills",
          description: "Shared expertise.",
          path: path("SKILLCDN.md"),
          hasRules: true,
          language: "en",
        },
      },
    });
    expect(text).toContain("Company skills: Shared expertise.");
    expect(text).toContain("engineering/");
    expect(text).toContain("128 skills");
    expect(text).toContain("Use for releases and incidents.");
    expect(text).toContain("get_skill");
    expect(text).toContain("until complete");
    expect(text).toContain("repository root");
  });
  it("introduces a skill at the mounted directory itself, with or without folders beside it", () => {
    const root = { name: "release", directory: path(""), description: "Cut a release." };
    const alone = renderInstructions({
      status: "ready",
      catalog: { ...base, groups: [], skills: [root], skillCount: 1 },
    });
    expect(alone).toContain("SKILL.md: Cut a release.");

    const beside = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        groups: [folder("extras")],
        skills: [root, { name: "more", directory: path("extras/more"), description: "More." }],
        skillCount: 2,
      },
    });
    expect(beside).toContain("SKILL.md: Cut a release.");
    expect(beside).toContain("extras/: Team skills.");
    expect(beside).not.toContain("extras/more/SKILL.md");
  });

  it("always preserves discovery instructions within the budget, even for long paths", () => {
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        groups: Array.from({ length: 300 }, (_, index) =>
          folder(`skills/${index}/${"x".repeat(900)}`),
        ),
        skillCount: 30000,
        manifest: {
          name: "x".repeat(100),
          description: "x".repeat(1024),
          path: path("SKILLCDN.md"),
          hasRules: true,
          language: "ko",
        },
        diagnostics: Array.from({ length: 50 }, (_, index) => ({
          path: path(`skills/${index}/${"x".repeat(900)}/SKILL.md`),
          code: "unavailable",
          message: "Missing body",
        })),
      },
    });
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    expect(text).toContain("browse returns the full folder contents");
    expect(text).toContain("until complete");
    expect(text).toContain("Written in ko");
  });
  it("uses exact entrypoint paths to distinguish duplicate names", () => {
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        skills: [
          { name: "review", directory: path("engineering/review"), description: "Review code" },
          { name: "review", directory: path("marketing/review"), description: "Review copy" },
        ],
        skillCount: 2,
      },
    });
    expect(text).toContain("engineering/review/SKILL.md");
    expect(text).toContain("marketing/review/SKILL.md");
  });
  it("reports diagnostics, document-only catalogs and index states", () => {
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        documentCount: 7,
        diagnostics: [
          { path: path("team/SKILLCDN.md"), code: "unavailable", message: "Cannot read" },
        ],
      },
    });
    expect(text).toContain("0 skills, 7 documents");
    expect(text).toContain("team/SKILLCDN.md");
    expect(text).toContain("browse reports diagnostics");
    expect(renderInstructions({ status: "indexing", mount })).toContain("being indexed");
    expect(renderInstructions({ status: "failed", mount })).toContain("could not be indexed");
  });
  it("keeps the search description bounded without enumerating every skill", () => {
    const text = describeFindTool({
      status: "ready",
      catalog: {
        ...base,
        manifest: {
          name: "A",
          description: "x".repeat(1024),
          path: path("SKILLCDN.md"),
          hasRules: false,
          language: "ko",
        },
      },
    });
    expect(text.length).toBeLessThanOrEqual(FIND_DESCRIPTION_MAX_LENGTH);
    expect(text).toContain("Written in ko");
    expect(text).toContain("nextCursor");
  });
});
