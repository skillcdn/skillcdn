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
    expect(report).toContain("Manifests that could not be read: 0");
    expect(report).toContain("What a client is told on connect (");
    expect(report).toContain(
      "  This server serves Acme playbooks, the git repository with-manifest",
    );
    expect(report).toContain("ok: every manifest could be read");
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
    expect(report).toContain("7 manifest(s) could not be read");
  });

  it("reads the working tree as a git tree: hidden entries and node_modules are not there", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-"));
    await mkdir(join(root, "skills", "hello"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(root, "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: Says hello.\n---\n# Hello\n",
    );
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(root, "node_modules", "pkg", "SKILL.md"), "not a skill\n");
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("1 files; 2 hidden entries, symbolic links or node_modules skipped");
    expect(report).toContain("- hello (skills/hello)");
    expect(report).not.toContain("node_modules/pkg");
  });

  it("says when the directory cannot be read", async () => {
    const { code, report } = await check(join(FIXTURES, "does-not-exist"));
    expect(code).toBe(2);
    expect(report).toContain("not a directory that can be read");
  });
});
