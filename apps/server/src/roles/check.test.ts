import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDirectory, INDEX_LIMIT_DEFAULTS } from "@skillcdn/indexer";
import { describe, expect, it } from "vitest";

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

// The role reads a working tree with the indexer package; what a working tree has and a git tree
// does not (hidden entries, links, node_modules) is tested next to that code. The fixture
// repositories are the server's, so what the role makes of them is checked here.
describe("the check role", () => {
  it("reports what an agent would get from a repository in the format", async () => {
    const { code, report } = await check(join(FIXTURES, "with-manifest"));
    expect(code).toBe(0);
    expect(report).toContain("Repository manifest: SKILLCDN.md");
    expect(report).toContain("License: MIT (SKILLCDN.md)\n");
    expect(report).toContain("  license: MIT (SKILLCDN.md)\n");
    expect(report).toContain("  name: Acme playbooks");
    expect(report).toContain("  language: en");
    expect(report).toContain("  image: (none)");
    expect(report).toContain("  translations: ko");
    expect(report).toContain("  documents: docs");
    expect(report).toContain(
      "Skills: 1 (1 listed through the MCP skills extension)\n- greeting (skills/greeting)\n",
    );
    expect(report).toMatch(/ {2}extension: listed, \d+ bytes as served\n/);
    expect(report).toContain("  files: 1 (1 returned with the skill)");
    expect(report).toContain(
      "Documents outside the skills: 1\n- docs/guide.md - Using the playbooks",
    );
    expect(report).toContain("Not served: 2 files (notes/private.md, scripts/check.mjs)");
    expect(report).toContain("Optional overview files: 1 (README.md)");
    expect(report).toContain("Optional overview: read_repo_file README.md");
    expect(report).not.toContain("README.md: Acme playbooks.");
    expect(report).toContain("Index diagnostics: 0");
    expect(report).toContain("What a client is told on connect (");
    expect(report).toContain("  Skills and documents from with-manifest");
    expect(report).toContain("ok: no index diagnostics");
  });

  it("fails on a manifest that cannot be read, with the same reason the indexer gives", async () => {
    const { code, report } = await check(join(FIXTURES, "hostile"));
    expect(code).toBe(1);
    expect(report).toContain("Repository manifest: none.");
    expect(report).toContain(
      "License: none declared (served with its provenance; never featured)\n",
    );
    expect(report).toContain("Skills: 3 (2 listed through the MCP skills extension)\n");
    expect(report).toContain("  extension: not listed (name_directory_mismatch)\n");
    expect(report).toContain(
      '- skills/colon-in-description/SKILL.md (invalid_front_matter): front-matter is not valid YAML (BLOCK_AS_IMPLICIT_KEY): the value of "description" contains ": "',
    );
    expect(report).toContain('- the value of "description" is cut at " #"');
    expect(report).toContain("7 index issue(s) found");
  });

  it("tells the author which skills a deployment describes rather than serves", async () => {
    const { code, report } = await check(join(FIXTURES, "licensed"));
    expect(code).toBe(0);
    expect(report).toContain("License: MIT (LICENSE)\n");
    expect(report).toContain("- open (skills/open)\n");
    expect(report).toContain("  license: MIT (LICENSE)\n");
    expect(report).toContain(
      "  license: All rights reserved (skills/reserved/LICENSE) (described only, unless the repository is verified)\n",
    );
    expect(report).toContain(
      "  license: CC-BY-NC-4.0 (skills/declared/SKILL.md) (described only, unless the repository is verified)\n",
    );
  });

  it("honors exclusion at a fixture root without publishing its own policy metadata", async () => {
    const { code, report } = await check(FIXTURES);
    expect(code).toBe(0);
    expect(report).toContain("Skills: 0");
    expect(report).toContain("Documents outside the skills: 0");
    expect(report).toContain("Index diagnostics: 0");
    expect(report).toContain("Repository manifest: none.");
    expect(report).not.toContain("Internal repository fixtures used by the server test suites.");
    expect(report).not.toContain("missing_front_matter");
    expect(report).not.toContain("invalid_front_matter");
  });
});
