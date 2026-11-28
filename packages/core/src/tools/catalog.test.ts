import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import {
  catalogGroups,
  describeFindTool,
  FIND_DESCRIPTION_MAX_LENGTH,
  fitInstructions,
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
  skillUri: "skill://gh/acme/skills",
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
    expect(text).toContain("Optional overview: read_repo_file README.md.");
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
    expect(text).toContain("read_repo_file README.md");
    // The manifest is in no folder listing: the model is told where the pack's metadata is.
    expect(text).toContain(
      "Manifest: read_repo_file SKILLCDN.md for the pack's metadata and rules.",
    );
    expect(text).not.toContain("README summary");
    expect(describeFindTool({ status: "ready", catalog })).toContain("Author description.");
  });

  it("tells a client of the page the pack starts at, in the place of the README (ADR-0119)", () => {
    const catalog: MountCatalog = {
      ...base,
      overview: { path: path("README.md"), title: "README title", description: "README summary." },
      manifest: {
        name: "Author title",
        description: "Author description.",
        path: path("SKILLCDN.md"),
        language: undefined,
        hasRules: true,
        start: path("docs/pack/finding-a-skill.md"),
      },
    };
    const text = renderInstructions({ status: "ready", catalog });
    expect(text).toContain(
      "Start here, before a task: read_repo_file docs/pack/finding-a-skill.md.\nManifest: read_repo_file SKILLCDN.md",
    );
    // The README is for the people who open the repository: one line names where to begin.
    expect(text).not.toContain("Optional overview");
    // Without the field, the instructions are what they were.
    const plain: MountCatalog = {
      ...catalog,
      manifest: {
        name: "Author title",
        description: "Author description.",
        path: path("SKILLCDN.md"),
        language: undefined,
      },
    };
    expect(renderInstructions({ status: "ready", catalog: plain })).toContain(
      "Optional overview: read_repo_file README.md.\nManifest: read_repo_file SKILLCDN.md",
    );
    // A client is told of the cursor a long skill goes on with; a reader of a command, who is
    // given no cursor to call with, of its parts and the command each ends with.
    expect(renderInstructions({ status: "ready", catalog: plain })).toContain(
      "load_skill loads an exact SKILL.md path; follow nextCursor until complete before applying it.",
    );
    const command = renderInstructions(
      { status: "ready", catalog: plain },
      {
        browse: "skillcdn browse",
        search: "skillcdn find",
        load: "skillcdn skill",
        read: "skillcdn file",
        piece: "part",
      },
    );
    expect(command).toContain(
      "skillcdn skill loads an exact SKILL.md path; a long skill comes in parts, each ending with the command that prints the next: read every part before applying it.",
    );
    expect(command).not.toContain("nextCursor");
  });

  it("says once, on connect, that another commit's index is served and why (ADR-0068)", () => {
    const newest = "fedcba9876543210fedcba9876543210fedcba98";
    const indexing = renderInstructions({
      status: "ready",
      catalog: { ...base, mount: { ...mount, newest: { commit: newest, status: "indexing" } } },
    });
    expect(indexing).toContain("(commit 0123456; newest fedcba9 indexing)");
    expect(indexing).toContain(
      "The newest commit of this ref, fedcba9, is being indexed; until it is ready, what is served is the last indexed commit, 0123456.",
    );
    const failed = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        mount: {
          ...mount,
          newest: { commit: newest, status: "failed", errorCode: "indexer.failed" },
        },
      },
    });
    expect(failed).toContain("(commit 0123456; newest fedcba9 failed (indexer.failed))");
    expect(failed).toContain("could not be indexed (indexer.failed) and is retried");
    const rebuilt = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        mount: { ...mount, newest: { commit: mount.commit, status: "indexing" } },
      },
    });
    expect(rebuilt).toContain("(commit 0123456; being reindexed)");
    expect(rebuilt).toContain("is being rebuilt under newer reading rules");
    expect(renderInstructions({ status: "ready", catalog: base })).not.toContain("newest");
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
    expect(text).toContain("Use for releases and incidents. 128 skills, 2 documents");
    expect(text).toContain("load_skill");
    expect(text).toContain("until complete");
    expect(text).toContain("repository root");
  });

  it("introduces only the folders with something discoverable, and says what that is", () => {
    const text = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        groups: [
          { ...folder(".claude"), name: null, description: null, skillCount: 0, documentCount: 0 },
          { ...folder("docs"), name: null, description: null, skillCount: 0, documentCount: 20 },
          { ...folder("plugin"), name: null, description: null, skillCount: 1, documentCount: 0 },
        ],
        skillCount: 1,
        documentCount: 20,
      },
    });
    expect(text).not.toContain(".claude/");
    expect(text).toContain("docs/: 20 documents\n");
    expect(text).toContain("plugin/: 1 skill\n");
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
    expect(text).toContain("browse_repo returns the full folder contents");
    expect(text).toContain("until complete");
    expect(text).toContain("Written in ko");
    // Not one path fits: the text says so instead of reading as a pack without folders.
    expect(text).toContain("\n300 folders are not listed here.\n");
  });

  describe("folders that do not fit whole (ADR-0112)", () => {
    const areas = (count: number, description: string | null): BrowseEntry[] =>
      Array.from({ length: count }, (_, index) => ({
        ...folder(`area-${String(index).padStart(3, "0")}`),
        description,
      }));
    const told = (groups: BrowseEntry[]) =>
      fitInstructions({ status: "ready", catalog: { ...base, groups, skillCount: 128 } });
    const long = `${"Releases, incidents and the reviews after them. ".repeat(3)}End.`;

    it("says them whole while there is room, and says so", () => {
      const fit = told(areas(6, long));
      expect(fit).toMatchObject({ rows: 6, listed: 6, shortened: false });
      expect(fit.text).toContain(`area-005/: Team skills. ${long.slice(0, 99)}… 128 skills`);
    });

    it("cuts the descriptions alike, so that every folder keeps its line", () => {
      const groups = [...areas(12, long), { ...folder("brief"), description: "Short and whole." }];
      const fit = told(groups);
      expect(fit).toMatchObject({ rows: 13, listed: 13, shortened: true });
      expect(fit.text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
      const lines = fit.text.split("\n").filter((line) => line.startsWith("area-"));
      expect(lines).toHaveLength(12);
      // One length for all of them, shorter than a description is with room, and the counts stay.
      expect(new Set(lines.map((line) => line.length)).size).toBe(1);
      expect(lines[0]).toMatch(/^area-000\/: Team skills\. Releases, .+… 128 skills, 2 documents$/);
      expect(lines[0]?.length).toBeLessThan(`area-000/: Team skills. ${long}`.length);
      expect(fit.text).toContain("brief/: Team skills. Short and whole. 128 skills, 2 documents\n");
      expect(fit.text).not.toContain("not listed here");
    });

    it("leaves the descriptions out, then the names, before it leaves a folder out", () => {
      const named = told(areas(24, long));
      expect(named).toMatchObject({ rows: 24, listed: 24, shortened: true });
      expect(named.text).toContain("area-023/: Team skills. 128 skills, 2 documents\n");
      expect(named.text).not.toContain("Releases");

      const bare = told(areas(36, long));
      expect(bare).toMatchObject({ rows: 36, listed: 36, shortened: true });
      expect(bare.text).toContain("area-035/: 128 skills, 2 documents\n");
      expect(bare.text).not.toContain("Team skills");
      expect(bare.text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    });

    it("says how many folders it could not name, when not even their paths fit", () => {
      const fit = told(areas(120, long));
      expect(fit.rows).toBe(120);
      expect(fit.listed).toBeGreaterThan(20);
      expect(fit.listed).toBeLessThan(120);
      expect(fit.text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
      expect(fit.text.split("\n").filter((line) => line.startsWith("area-"))).toHaveLength(
        fit.listed,
      );
      expect(fit.text).toContain(
        `\n${120 - fit.listed} more folders are not listed here.\nbrowse_repo returns the full folder contents`,
      );
    });

    it("counts skills where skills are the rows", () => {
      const skills = Array.from({ length: 200 }, (_, index) => ({
        name: `skill-${index}`,
        directory: path(`skills/skill-${index}`),
        description: "Does one thing.",
      }));
      const fit = fitInstructions({
        status: "ready",
        catalog: { ...base, skills, skillCount: 200 },
      });
      expect(fit.listed).toBeLessThan(200);
      expect(fit.text).toContain(`\n${200 - fit.listed} more skills are not listed here.\n`);
      expect(fit.text).toContain("skills/skill-0/SKILL.md\n");
      expect(fit.text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    });

    it("counts the folders the catalog was not given, where it was given the first of them", () => {
      const fit = fitInstructions({
        status: "ready",
        catalog: {
          ...base,
          ...catalogGroups(
            [
              { ...folder(".hidden"), skillCount: 0, documentCount: 0 },
              ...areas(70, null).map((area) => ({
                ...area,
                name: null,
                skillCount: 1,
                documentCount: 0,
              })),
            ],
            50,
          ),
          skillCount: 70,
        },
      });
      // Fifty paths with their counts fit; the twenty the catalog only counts are said.
      expect(fit).toMatchObject({ rows: 70, listed: 50 });
      expect(fit.text).toContain("area-049/: 1 skill\n20 more folders are not listed here.\n");
      expect(fit.text).not.toContain(".hidden");
      expect(fit.text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);

      // A catalog made from an older answer has no count: what it was given is all it knows of.
      const uncounted = told(areas(6, null));
      expect(uncounted).toMatchObject({ rows: 6, listed: 6 });
      expect(uncounted.text).not.toContain("not listed here");
    });

    it("has nothing to say of rows before the commit is read", () => {
      expect(fitInstructions({ status: "indexing", mount })).toMatchObject({
        rows: 0,
        listed: 0,
        shortened: false,
      });
    });
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
    expect(text).toContain("browse_repo reports diagnostics");
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
  it("says in one line what the search matches: words, or words and meaning", () => {
    const words = renderInstructions({ status: "ready", catalog: base });
    expect(words).toContain(
      "search_repo matches original words (usually English) and names the sections that matched.",
    );
    expect(words).not.toContain("meaning");
    const notYet = renderInstructions({
      status: "ready",
      catalog: {
        ...base,
        search: { meaning: false, embedding: { status: "in_progress", embedded: 0, total: 12 } },
      },
    });
    expect(notYet).toContain("matches original words");
    const meaning = renderInstructions({
      status: "ready",
      catalog: { ...base, search: { meaning: true, embedding: { status: "complete" } } },
    });
    expect(meaning).toContain(
      "search_repo matches words and meaning, so ask in your own words; it names the sections that matched.",
    );
    expect(meaning).not.toContain("original words");
    expect(meaning.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_LENGTH);
    // While the commit is not ready there are no vectors to speak of.
    expect(renderInstructions({ status: "indexing", mount })).toContain("matches original words");
  });
});
