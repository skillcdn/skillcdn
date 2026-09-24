import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INDEX_LIMIT_DEFAULTS } from "../config/config.js";
import { checkDirectory } from "./check.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/.repositories/", import.meta.url));

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

describe("the check role", () => {
  it("reports what an agent would get from a repository in the format", async () => {
    const { code, report } = await check(join(FIXTURES, "with-manifest"));
    expect(code).toBe(0);
    expect(report).toContain("Repository manifest: SKILLCDN.md");
    expect(report).toContain("  name: Acme playbooks");
    expect(report).toContain("  language: en");
    expect(report).toContain("  translations: ko");
    expect(report).toContain("  documents: docs");
    expect(report).toContain("Skills: 1\n- greeting (skills/greeting)\n");
    expect(report).toContain("  files: 1 (1 returned with the skill)");
    expect(report).toContain(
      "Documents outside the skills: 1\n- docs/guide.md - Using the playbooks",
    );
    expect(report).toContain(
      "Not served: 3 files (README.md, notes/private.md, scripts/check.mjs)",
    );
    expect(report).toContain("Index diagnostics: 0");
    expect(report).toContain("What a client is told on connect (");
    expect(report).toContain("  Skills and documents from with-manifest");
    expect(report).toContain("ok: no index diagnostics");
  });

  it("fails on a manifest that cannot be read, with the same reason the indexer gives", async () => {
    const { code, report } = await check(join(FIXTURES, "hostile"));
    expect(code).toBe(1);
    expect(report).toContain("Repository manifest: none.");
    expect(report).toContain("Skills: 3\n");
    expect(report).toContain(
      '- skills/colon-in-description/SKILL.md (invalid_front_matter): front-matter is not valid YAML (BLOCK_AS_IMPLICIT_KEY): the value of "description" contains ": "',
    );
    expect(report).toContain('- the value of "description" is cut at " #"');
    expect(report).toContain("7 index issue(s) found");
  });

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

  it("says when the directory cannot be read", async () => {
    const { code, report } = await check(join(FIXTURES, "does-not-exist"));
    expect(code).toBe(2);
    expect(report).toContain("not a directory that can be read");
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
    expect(connection).toContain("team/: Editors. Team workflows. 2 skills");
    expect(connection).toContain("docs/: 0 skills");
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
