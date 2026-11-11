import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INDEX_VERSION } from "./build-index.js";
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
    expect(report).toContain(
      `as SkillCDN would index it (reading rules version ${INDEX_VERSION}): 2 files; 2 .git entries, symbolic links or node_modules skipped`,
    );
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
    expect(report).toContain(
      "Documents outside the skills: 2\n- docs/tool/models.md - Models (1 section)\n",
    );
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
    // The dead links are one issue, however many: the limit is the other.
    expect(report).toContain("Index diagnostics: 2");
    expect(report).toContain("docs/guide.md (reference_limit)");
    expect(report).toContain(
      "docs/guide.md (link_missing): 200 links name no file of the repository (/shared/0.md, /shared/1.md, /shared/2.md, ...)",
    );
    expect(report).toContain("2 index issue(s) found");
    expect(report).not.toContain("1 manifest(s) could not be read");
  });

  it("notes a section longer than one read carries, and fails nothing for it (ADR-0081)", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-sections-"));
    await mkdir(join(root, "docs"));
    // A table of 1,400 rows under one heading: one section, read whole for one row.
    const table = [
      "## TABLE C-2 Modifier codes",
      "",
      "| Code | Meaning |",
      "|---|---|",
      ...Array.from({ length: 1400 }, () => "| AA | a code and what it means |"),
    ];
    await writeFile(
      join(root, "docs", "codes.md"),
      ["# Codes", "", "A short introduction.", "", ...table, "", "## Notes", "", "Short.", ""].join(
        "\n",
      ),
    );
    await writeFile(
      join(root, "docs", "guide.md"),
      ["# Guide", "", "Short throughout.", ""].join("\n"),
    );
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("Notes: 1");
    expect(report).toContain(
      '- docs/codes.md (section_large): the section "TABLE C-2 Modifier codes" is ',
    );
    expect(report).toContain(" characters, more than one read carries (40000)");
    expect(report).toContain("ok: no index diagnostics");
    // A pack whose sections are all read at once has no notes to show.
    await writeFile(join(root, "docs", "codes.md"), ["# Codes", "", "Short.", ""].join("\n"));
    expect((await check(root)).report).not.toContain("Notes:");
  });
});

describe("the originals a manifest says are kept encrypted (ADR-0084)", () => {
  /** A PDF as far as the check looks: a header, a body, and a trailer that names an encryption dictionary or not. */
  const pdf = (encrypted: boolean): string =>
    [
      "%PDF-1.6",
      "1 0 obj",
      "<< /Type /Catalog /Pages 2 0 R >>",
      "endobj",
      "trailer",
      `<< /Size 6 /Root 1 0 R${encrypted ? " /Encrypt 5 0 R" : ""} >>`,
      "startxref",
      "9",
      "%%EOF",
      "",
    ].join("\n");
  const SET = [
    "---",
    "description: The manuals of the workshop.",
    "documents: [.]",
    "originals:",
    "  encrypted: true",
    "  key-name: workshop-2026",
    "---",
    "",
  ].join("\n");
  const chapter = (source: string): string =>
    [
      "---",
      "title: Chapter",
      "description: A chapter of a manual.",
      `source: ${source}`,
      "---",
      "# Chapter",
      "",
      "Text.",
      "",
    ].join("\n");
  async function workshop(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-originals-"));
    for (const [name, contents] of Object.entries(files)) {
      const parts = name.split("/");
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), contents);
    }
    return root;
  }

  it("passes a set whose originals are encrypted as it says", async () => {
    const root = await workshop({
      "docs/manuals/SKILLCDN.md": SET,
      "docs/manuals/chapter.md": chapter("sources/manual.pdf"),
      "docs/manuals/sources/manual.pdf": pdf(true),
    });
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("Originals kept encrypted: 1 PDF as their manifest says\n");
    expect(report).toContain("ok: no index diagnostics");
    expect(report).not.toContain("Notes:");
  });

  it("fails on a copy without its protection, and names it", async () => {
    const root = await workshop({
      "docs/manuals/SKILLCDN.md": SET,
      "docs/manuals/chapter.md": chapter("sources/manual.pdf"),
      "docs/manuals/sources/manual.pdf": pdf(true),
      "docs/manuals/sources/decrypted-copy.pdf": pdf(false),
    });
    const { code, report } = await check(root);
    expect(code).toBe(1);
    expect(report).toContain("Originals kept encrypted: 1 PDF as their manifest says; 1 not\n");
    expect(report).toContain(
      "- docs/manuals/sources/decrypted-copy.pdf (original_not_encrypted): the manifest above it says the originals here are kept encrypted, and this PDF is not",
    );
    expect(report).toContain("1 original(s) not encrypted as their manifest says");
    expect(report).not.toContain("ok: no index diagnostics");
  });

  it("notes an encrypted original that no manifest speaks of, and a file it cannot read as a PDF", async () => {
    const root = await workshop({
      "docs/open/chapter.md": chapter("sources/manual.pdf"),
      "docs/open/sources/manual.pdf": pdf(true),
      "docs/open/sources/plain.pdf": pdf(false),
      "docs/manuals/SKILLCDN.md": SET,
      "docs/manuals/sources/not-a-pdf.pdf": "PK is how another kind of file begins",
    });
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toContain("Notes: 2");
    expect(report).toContain("- docs/open/sources/manual.pdf (original_encrypted_undeclared)");
    expect(report).toContain("- docs/manuals/sources/not-a-pdf.pdf (original_not_read)");
    expect(report).not.toContain("plain.pdf (");
    expect(report).not.toContain("Originals kept encrypted");
  });

  it("reports a password written into a front-matter, by the name of its key and never its value", async () => {
    const root = await workshop({
      "docs/manuals/SKILLCDN.md": SET.replace(
        "  key-name: workshop-2026",
        "  key-name: workshop-2026\n  password: opensesame-1",
      ),
      "docs/manuals/chapter.md": chapter("sources/manual.pdf").replace(
        "source:",
        "pdf-password: opensesame-2\nsource:",
      ),
      "docs/manuals/sources/manual.pdf": pdf(true),
    });
    const { code, report } = await check(root);
    expect(code).toBe(1);
    expect(report).toContain(
      'docs/manuals/SKILLCDN.md (password_in_front_matter): the front-matter carries "originals.password"',
    );
    expect(report).toContain(
      'docs/manuals/chapter.md (password_in_front_matter): the front-matter carries "pdf-password"',
    );
    expect(report).not.toContain("opensesame");
  });
});
