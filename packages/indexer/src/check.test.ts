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

  it("says in how many pages a skill is read, and what a large one is made of", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-pages-"));
    const lines = (count: number) => "A line of forty characters, with its end.\n".repeat(count);
    const files = {
      "SKILLCDN.md": "---\ndescription: Pages.\n---\n# Rules\n\nAsk first.\n",
      "skills/small/SKILL.md": "---\nname: small\ndescription: A small skill.\n---\n# Small\n",
      "skills/large/SKILL.md":
        "---\nname: large\ndescription: A large skill.\nskillcdn:\n  include:\n    - references/long.md\n    - references/short.md\n---\n# Large\n\nRead both.\n",
      // Forty-two bytes a line: a thousand lines are a little under three pages of 16 KiB.
      "skills/large/references/long.md": lines(1_000),
      "skills/large/references/short.md": lines(10),
    };
    for (const [name, contents] of Object.entries(files)) {
      const parts = name.split("/");
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), contents);
    }
    const { code, report } = await check(root);
    // A large skill is a note, never a failure.
    expect(code).toBe(0);
    expect(report).toContain(
      "  context: 27 bytes, read in 1 page (rules 19, instructions 8, included 0)\n",
    );
    expect(report).toContain(
      "  context: 42459 bytes, read in 3 pages (rules 19, instructions 20, included 42420)\n" +
        "  over the 16384 bytes of instructions and included files a skill aims at; included: skills/large/references/long.md 42000, skills/large/references/short.md 420\n",
    );
    expect(report.split("over the 16384 bytes").length).toBe(2);
    // The same skill is one document of some 42 KB to a host of the extension: a second note.
    expect(report).toContain(
      "Notes: 2\n- skills (skill_large): 1 of 2 hold more than 16384 bytes of instructions and included files",
    );
    expect(report).toContain(
      "- skills (served_large): 1 of 2 listed through the skills extension is served as a document of more than 24576 bytes",
    );
  });

  it("says when the document a skill is served as is more than a tool result holds (ADR-0125)", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-served-"));
    // Forty-two bytes a line.
    const lines = (count: number) => "A line of forty characters, with its end.\n".repeat(count);
    const front = (name: string) => `---\nname: ${name}\ndescription: A skill of ${name}.\n---\n`;
    const files: Record<string, string> = {
      "SKILLCDN.md": "---\ndescription: Served.\n---\n# Rules\n\nAsk first.\n",
      "skills/small/SKILL.md": `${front("small")}# Small\n`,
      // 21 KB: two pages of the tools, and a document a tool result would still hold.
      "skills/paged/SKILL.md": `${front("paged")}# Paged\n\n${lines(500)}`,
      // 29 KB of instructions.
      "skills/long/SKILL.md": `${front("long")}# Long\n\n${lines(700)}`,
      // 26 KB of rules above a skill of a few bytes: the document carries them too.
      "area/SKILLCDN.md": `---\ndescription: An area with long rules.\n---\n# Area rules\n\n${lines(620)}`,
      "area/skills/brief/SKILL.md": `${front("brief")}# Brief\n`,
      // As long as the long one, and not served through the extension at all.
      "skills/misnamed/SKILL.md": `${front("another")}# Misnamed\n\n${lines(700)}`,
    };
    for (const [name, contents] of Object.entries(files)) {
      const parts = name.split("/");
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), contents);
    }
    const { code, report } = await check(root);
    // A long document is a note, never a failure.
    expect(code).toBe(0);
    const over = ", in one piece: over the 24576 bytes a tool result is kept within\n";
    const block = (name: string) => report.split(`- ${name} (`)[1]?.split("\n- ")[0] ?? "";
    expect(block("small")).toMatch(/\n {2}extension: listed, \d+ bytes as served\n/);
    // Over what a skill aims at, read in two pages, and no more than a tool result as a document.
    expect(block("paged")).toMatch(
      /\n {2}extension: listed, \d+ bytes as served\n {2}context: \d+ bytes, read in 2 pages /,
    );
    expect(block("paged")).toContain("  over the 16384 bytes of instructions and included files");
    expect(block("long")).toMatch(
      new RegExp(`\\n {2}extension: listed, \\d+ bytes as served${over} {2}context: `),
    );
    // Rules are no part of what a skill aims at, and are part of the document it is served as.
    expect(block("brief")).toMatch(
      new RegExp(`\\n {2}extension: listed, \\d+ bytes as served${over} {2}context: `),
    );
    expect(block("brief")).not.toContain("over the 16384 bytes");
    expect(block("another")).toContain("  extension: not listed (name_directory_mismatch)\n");
    expect(report.split(over).length).toBe(3);
    expect(report).toContain(
      "- skills (skill_large): 3 of 5 hold more than 16384 bytes of instructions and included files",
    );
    expect(report).toContain(
      "- skills (served_large): 2 of 4 listed through the skills extension are served as a document of more than 24576 bytes, what a tool result is kept within; each says so under its name. A host is handed that document in one piece, and its model gets it cut where that is more than the host gives it of one read, where load_skill gives the same text in pages.",
    );
  });

  it("says where a page of a skill ends inside a code block, a table or a line (ADR-0123)", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-cuts-"));
    const numbered = (count: number, line: (number: string) => string) =>
      Array.from({ length: count }, (_, at) => line(String(at + 1).padStart(4, "0"))).join("");
    const front = (name: string) => `---\nname: ${name}\ndescription: A skill of ${name}.\n---\n`;
    const files: Record<string, string> = {
      // Nineteen bytes of rules come before every skill, so a page has 16,365 left for its body.
      "SKILLCDN.md": "---\ndescription: Cuts.\n---\n# Rules\n\nAsk first.\n",
      // Thirteen bytes above lines of fifteen: 1,090 of them fit, and line 1091 begins page 2.
      "skills/code/SKILL.md": `${front("code")}# Cut\n\n\`\`\`sh\n${numbered(2_000, (n) => `echo line ${n}\n`)}\`\`\`\n`,
      // Twenty-eight bytes above rows of twenty: 816 of them fit, and row 817 begins page 2.
      "skills/table/SKILL.md": `${front("table")}# Wide\n\n| a | b |\n|---|---|\n${numbered(1_500, (n) => `| row ${n} | cell |\n`)}`,
      // A line of 20,000 bytes, which no page holds.
      "skills/line/SKILL.md": `${front("line")}# Long\n\n${"word ".repeat(4_000).trim()}\n`,
      "skills/whole/SKILL.md": `${front("whole")}# Whole\n\n${"A paragraph of a skill that is read whole.\n\n".repeat(600)}`,
    };
    for (const [name, contents] of Object.entries(files)) {
      const parts = name.split("/");
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), contents);
    }
    const { code, report } = await check(root);
    // Where a page ends is a note, never a failure.
    expect(code).toBe(0);
    expect(report).toContain(
      "  page 1 ends inside a code block: page 2 begins at skills/code/SKILL.md line 1098\n",
    );
    expect(files["skills/code/SKILL.md"]?.split("\n")[1097]).toBe("echo line 1091");
    expect(report).toContain(
      "  page 1 ends inside a table: page 2 begins at skills/table/SKILL.md line 825, under the table's head said again\n",
    );
    expect(files["skills/table/SKILL.md"]?.split("\n")[824]).toBe("| row 0817 | cell |");
    expect(report).toContain(
      "  page 1 ends inside a line longer than a page: skills/line/SKILL.md line 7\n",
    );
    // A skill whose pages end between its paragraphs says nothing of them.
    expect(report.split(" ends inside ").length).toBe(4);
    // The table says its head again on the next page, so it is not among what the note counts.
    expect(report).toContain(
      "- skills (page_cut): 2 pages of 2 skills end inside a code block or a line; each says where under its name. A page ends before a code block of no more than 4096 bytes, the line that announces it counted, and before a line of no more than 16384",
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

  it("says what the bound of the instructions cost the folders (ADR-0112)", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillcdn-check-room-"));
    const description = "Releases, incidents and the reviews after them, for whoever is on call. ";
    for (let index = 0; index < 14; index += 1) {
      const area = join(root, `area-${String(index).padStart(2, "0")}`);
      await mkdir(join(area, "act"), { recursive: true });
      await writeFile(join(area, "README.md"), `# Area ${index}\n\n${description.repeat(2)}\n`);
      await writeFile(
        join(area, "act", "SKILL.md"),
        `---\nname: act-${index}\ndescription: Acts for area ${index}.\n---\nAct.\n`,
      );
    }
    const { code, report } = await check(root);
    expect(code).toBe(0);
    expect(report).toMatch(
      /What a client is told on connect \(\d+ of 2000 characters; the folder lines say less, to fit\):/,
    );
    const connection = report.split("What a client is told on connect")[1];
    expect(connection).toContain("area-13/: Area 13. Releases, incidents");
    expect(connection).not.toContain("not listed here");
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
