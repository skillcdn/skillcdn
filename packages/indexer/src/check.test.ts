import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDirectory } from "./check.js";
import { INDEX_LIMIT_DEFAULTS } from "./limits.js";

async function check(directory: string, limits = INDEX_LIMIT_DEFAULTS) {
  let report = "";
  const code = await checkDirectory({
    directory,
    limits,
    write: (text) => {
      report += text;
    },
  });
  return { code, report };
}

// The fixture repositories are read in the server's test of its `check` role; what a working
// tree has and a git tree does not is covered here, in directories made for the purpose.
describe("checking a working tree", () => {
  it("reads hidden skill declarations while skipping .git and node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-"));
    await mkdir(join(root, "skills", "hello"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".agents", "skills", "hidden"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(root, "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: Says hello.\n---\n# Hello\n",
    );
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      join(root, ".agents", "skills", "hidden", "SKILL.md"),
      "---\nname: hidden\ndescription: Hidden skill root.\n---\n# Hidden\n",
    );
    await writeFile(join(root, "node_modules", "pkg", "SKILL.md"), "not a skill\n");
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("2 files; 2 .git entries, symbolic links or node_modules skipped");
    expect(report).toContain("- hello (skills/hello)");
    expect(report).toContain("- hidden (.agents/skills/hidden)");
    expect(report).not.toContain("node_modules/pkg");
  });

  it("names the shared pages a skill carries, apart from its own files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-shared-"));
    const files = {
      "SKILLCDN.md": "---\ndescription: Shared pages.\ndocuments: [docs]\n---\n# Rules\n",
      "docs/tool/models.md": "# Models\n\nWhat the tool's models do.\n",
      "marketing/skills/ad/SKILL.md":
        "---\nname: ad\ndescription: Makes an ad.\nskillcdn:\n  include:\n    - /docs/tool/models.md\n    - references/own.md\n    - /media/docs/cast.md\n---\n# Ad\n",
      "marketing/skills/ad/references/own.md": "# Own\n",
      "media/SKILLCDN.md": "---\ndescription: Media.\n---\n",
      "media/docs/cast.md": "# Cast\n",
    };
    for (const [name, contents] of Object.entries(files)) {
      const parts = name.split("/");
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), contents);
    }
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain(
      "- ad (marketing/skills/ad)\n  Makes an ad.\n  files: 1 (1 returned with the skill)\n  shared pages returned with the skill, outside its directory: docs/tool/models.md\n",
    );
    expect(report).toContain(
      '- "skillcdn.include" entry ignored: media/docs/cast.md is outside the skill directory',
    );
    expect(report).toContain("Documents outside the skills: 2\n- docs/tool/models.md - Models\n");
  });

  it("says when the directory cannot be read", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-missing-"));
    const { code, report } = await check(join(root, "does-not-exist"));
    expect(code).toBe(2);
    expect(report).toContain("not a directory that can be read");
  });

  it("keeps a symlink policy closed without reading or walking its target", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-policy-link-"));
    const target = await mkdtemp(join(tmpdir(), "skillcdn-check-policy-target-"));
    await mkdir(join(root, "team", "write"), { recursive: true });
    await writeFile(
      join(root, "team", "write", "SKILL.md"),
      "---\nname: write\ndescription: A skill behind an unreadable policy.\n---\nWrite a draft.\n",
    );
    await writeFile(join(target, "target.md"), "This target must never be read.\n");
    // Junctions need no symlink privilege on Windows; neither kind may become a policy.
    await symlink(target, join(root, "team", "SKILLCDN.md"), "junction");
    const { code, report } = await check(root);
    expect(code).toBe(1);
    expect(report).toContain("Skills: 0");
    expect(report).toContain("Index diagnostics: 1");
    expect(report).toContain("team/SKILLCDN.md (unsupported_type)");
    expect(report).not.toContain("target.md");
    expect(report).not.toContain("This target must never be read.");
  });

  it("uses README introductions without adding searchable documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-overview-"));
    await mkdir(join(root, "team", "write"), { recursive: true });
    await writeFile(
      join(root, "README.md"),
      "# Writing library\n\nFind the right writing skill.\n\nDetailed setup stays optional.\n",
    );
    await writeFile(join(root, "team", "README.md"), "# Editors\n\nTeam writing workflows.\n");
    await writeFile(
      join(root, "team", "write", "SKILL.md"),
      "---\nname: write\ndescription: Write a draft.\n---\nDraft the message.\n",
    );
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("Skills: 1");
    expect(report).toContain("Documents outside the skills: 0");
    expect(report).toContain("Optional overview files: 2");
    const connection = report.split("What a client is told on connect")[1];
    expect(connection).toContain("Writing library: Find the right writing skill.");
    expect(connection).toContain("team/: Editors. Team writing workflows. 1 skill\n");
    expect(connection).toContain("Optional overview: read_repo_file README.md");
    expect(connection).not.toContain("Detailed setup stays optional");
    expect(connection).not.toContain("team/README.md:");
  });

  it("shows folder metadata on connect and distinguishes published support from linked references", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-tree-"));
    const files = {
      "team/SKILLCDN.md": "---\nname: Editors\ndescription: Team workflows.\nlanguage: ko\n---\n",
      "team/review/SKILL.md":
        "---\nname: review\ndescription: Review a draft.\n---\n[Shared](/shared.md)\n",
      "team/review/reference.md": "# Local support\n",
      "team/review/.unpublished.md": "# Not published\n",
      "team/review/child/SKILL.md":
        "---\nname: child\ndescription: Review a specific section.\n---\n",
      "docs/guide.md": "# Repository guide\n",
      "shared.md": "# Shared reference\n",
    };
    for (const [name, contents] of Object.entries(files)) {
      const parts = name.split("/");
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), contents);
    }
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("Skills: 2");
    expect(report).toContain("- review (team/review)\n  Review a draft.\n  files: 1\n");
    expect(report).toContain("Documents outside the skills: 1\n- docs/guide.md");
    expect(report).toContain("Linked reference files: 1");
    const connection = report.split("What a client is told on connect")[1];
    expect(connection).toContain("team/: Editors. Team workflows. 2 skills\n");
    expect(connection).toContain("docs/: 1 document\n");
    expect(connection).not.toContain("shared.md");
    expect(connection).not.toContain("team/review/SKILL.md");
  });

  it("reports reference limits as index issues instead of unreadable manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-references-"));
    await mkdir(join(root, "docs"));
    await writeFile(
      join(root, "docs", "guide.md"),
      Array.from({ length: 201 }, (_, i) => `[Reference](/shared/${i}.md)`).join("\n"),
    );
    const { code, report } = await check(root);
    expect(code).toBe(1);
    expect(report).toContain("Index diagnostics: 1");
    expect(report).toContain("docs/guide.md (reference_limit)");
    expect(report).toContain("1 index issue(s) found");
    expect(report).not.toContain("1 manifest(s) could not be read");
  });
});
