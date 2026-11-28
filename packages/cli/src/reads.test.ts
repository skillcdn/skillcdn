import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMAND_OUTPUT_MAX_BYTES,
  restCodeSchema,
  restFindSchema,
  restMountSchema,
  restRowsSchema,
  restSkillSchema,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { EXIT_MISSING, EXIT_UNREADABLE, EXIT_USAGE, FILE_PAGE_CHARS, runCli } from "./cli.js";

/** What a host counts of an output: its bytes of UTF-8. The command prints a line end after a read. */
const bytesOf = (out: string): number => Buffer.byteLength(out.trimEnd(), "utf8");

async function run(args: string[], environment: Record<string, string | undefined> = {}) {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    environment,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

async function repository(files: Record<string, string>, name = "acme-skills"): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "skillcdn-packs-"));
  const root = join(parent, name);
  for (const [file, contents] of Object.entries(files)) {
    const parts = file.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  return root;
}

const PACK: Record<string, string> = {
  "SKILLCDN.md":
    "---\nname: Acme skills\ndescription: The skills of Acme.\n---\nBe brief, and name the product.\n",
  LICENSE:
    'MIT License\n\nCopyright (c) 2026 Acme\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n',
  "marketing/ads/SKILL.md":
    "---\nname: ads\ndescription: Writes ad copy for a product page.\nskillcdn:\n  include:\n    - references/voice.md\n---\n# Ads\n\nWrite three variants. See [the voice](references/voice.md).\n",
  "marketing/ads/references/voice.md": "# Voice\n\nPlain words, no superlatives.\n",
  "engineering/release-notes/SKILL.md":
    "---\nname: release-notes\ndescription: Writes release notes from merged pull requests.\n---\n# Release notes\n\nGroup the changes by area.\n",
  "docs/guide.md": "# Guide\n\nHow the skills are used, with ad copy as the example.\n",
};

describe("the reads of a directory", () => {
  it("tells an agent what a client is told on connect, then lists every skill and document", async () => {
    const root = await repository(PACK);
    const { code, out, err } = await run(["skills", root]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toMatch(
      /Skills and documents from skillcdn-packs-[^/]+\/acme-skills \(commit 0000000\)/,
    );
    expect(out).toContain("Acme skills: The skills of Acme.");
    expect(out).toContain(
      "skillcdn browse explores folders and outlines a file by its headings; skillcdn find matches original words",
    );
    expect(out).not.toContain("browse_repo");
    expect(out).toContain("2 skills and 1 document in");
    expect(out).toContain("skill: ads (marketing/ads/SKILL.md)");
    expect(out).toContain("skill: release-notes (engineering/release-notes/SKILL.md)");
    expect(out).toContain("document: docs/guide.md");
    // The person chose the directory: it is verified, and no provenance notice follows.
    expect(out).not.toContain("Unverified repository content");
  });

  it("tells an agent where the pack says to start, when its manifest names a page (ADR-0119)", async () => {
    const root = await repository({
      ...PACK,
      "SKILLCDN.md":
        "---\nname: Acme skills\ndescription: The skills of Acme.\nstart: guide/finding-a-skill.md\n---\nBe brief.\n",
      "README.md": "# Acme skills\n\nFor the people who open the repository.\n",
      "guide/finding-a-skill.md": "# Finding a skill\n\nSearch by the task, then load the skill.\n",
    });
    const told = await run(["skills", root]);
    expect(told.code).toBe(0);
    expect(told.out).toContain(
      "Start here, before a task: skillcdn file guide/finding-a-skill.md.\nManifest: skillcdn file SKILLCDN.md",
    );
    expect(told.out).not.toContain("Optional overview");
    // The page is served because the manifest names it, under no directory of documents.
    const page = await run(["file", root, "guide/finding-a-skill.md"]);
    expect(page.code).toBe(0);
    expect(page.out).toContain("Search by the task, then load the skill.");
    const mount = restMountSchema.parse(JSON.parse((await run(["skills", root, "--json"])).out));
    if (mount.index.status !== "ready") throw new Error("not ready");
    expect(mount.index.manifest?.start).toBe("guide/finding-a-skill.md");
    // check prints it with the manifest, and what a client is told with it.
    const checked = await run(["check", root]);
    expect(checked.code).toBe(0);
    expect(checked.out).toContain("  start: guide/finding-a-skill.md\n");
    expect(checked.out).toContain(
      "  Start here, before a task: read_repo_file guide/finding-a-skill.md.",
    );
    // A page that is not there is a finding, and the client is told of the README as before.
    const broken = await repository({
      ...PACK,
      "SKILLCDN.md": "---\ndescription: The skills of Acme.\nstart: guide/nowhere.md\n---\n",
      "README.md": "# Acme skills\n",
    });
    const report = await run(["check", broken]);
    expect(report.code).toBe(1);
    expect(report.out).toContain(
      '- SKILLCDN.md (start_missing): "start" names guide/nowhere.md, which is not a Markdown document of the repository',
    );
    expect(report.out).toContain("  Optional overview: read_repo_file README.md.");
  });

  it("addresses the directory by its parent's name and its own, or as --as says", async () => {
    const root = await repository(PACK);
    const named = await run(["skills", root, "--json"]);
    const mount = restMountSchema.parse(JSON.parse(named.out));
    expect(mount.address).toMatch(/^\/local\/skillcdn-packs-[^/]+\/acme-skills$/);
    expect(mount.repository).toMatchObject({ host: "local", name: "acme-skills" });
    expect(mount.verified).toBe(true);
    if (mount.index.status !== "ready") throw new Error("not ready");
    expect(mount.index.skills.map((skill) => skill.path)).toEqual([
      "engineering/release-notes/SKILL.md",
      "marketing/ads/SKILL.md",
    ]);
    const renamed = await run(["skills", root, "--as", "local/acme/skills"]);
    expect(renamed.out).toContain("Skills and documents from acme/skills");
    const wrong = await run(["skills", root, "--as", "gh/acme/skills"]);
    expect(wrong.code).toBe(EXIT_USAGE);
    expect(wrong.err).toContain("local/<owner>/<name>");
  });

  it("browses a folder with its paths, and pages it", async () => {
    const root = await repository(PACK);
    const top = await run(["browse", root]);
    expect(top.code).toBe(0);
    expect(top.out).toContain("Folder: repository root");
    expect(top.out).toContain("- directory: marketing; 1 skill");
    expect(top.out).toContain("- directory: engineering; 1 skill");
    expect(top.out).toContain("- directory: docs; 0 skills, 1 document");
    const paged = await run(["browse", root, "--limit", "1"]);
    expect(paged.out).toContain("nextCursor:");
    const cursor = /nextCursor: "([^"]+)"/.exec(paged.out)?.[1];
    expect(cursor).toBeDefined();
    const next = await run(["browse", root, "--limit", "1", "--cursor", cursor ?? ""]);
    expect(next.code).toBe(0);
    expect(next.out).not.toBe(paged.out);
    const inner = await run(["browse", root, "marketing/ads"]);
    expect(inner.out).toContain("Folder: marketing/ads");
    expect(inner.out).toContain("- skill: marketing/ads/SKILL.md (ads)");
  });

  it("finds by words, skills first with their matching files, and folds a bad cursor", async () => {
    const root = await repository(PACK);
    const found = await run(["find", root, "ad", "copy"]);
    expect(found.code).toBe(0);
    expect(found.out).toMatch(/1\. skill: ads \(marketing\/ads\/SKILL\.md\)/);
    expect(found.out).toContain("document: docs/guide.md");
    const scoped = await run(["find", root, "copy", "--path", "docs", "--json"]);
    const body = restFindSchema.parse(JSON.parse(scoped.out));
    if (body.status !== "ready") throw new Error("not ready");
    expect(body.items.map((item) => item.path)).toEqual(["docs/guide.md"]);
    const nothing = await run(["find", root, "the", "of"]);
    expect(nothing.code).toBe(0);
    expect(nothing.out).toContain("No results for");
    const stale = await run(["find", root, "ads", "--cursor", "bm90LWEtY3Vyc29y"]);
    expect(stale.code).toBe(EXIT_USAGE);
    expect(stale.err).toContain("Start again without a cursor");
  });

  it("gives a skill whole: the rules first, then the instructions, then the included files", async () => {
    const root = await repository(PACK);
    const { code, out } = await run(["skill", root, "marketing/ads/SKILL.md"]);
    expect(code).toBe(0);
    expect(out).toContain("Skill: ads");
    expect(out).toContain("Supporting files, readable with skillcdn file:");
    const rules = out.indexOf(
      "--- applicable rules: SKILLCDN.md ---\nBe brief, and name the product.",
    );
    const body = out.indexOf("--- instructions ---\n# Ads");
    const included = out.indexOf(
      "--- included file: marketing/ads/references/voice.md ---\n# Voice",
    );
    expect(rules).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(rules);
    expect(included).toBeGreaterThan(body);
    expect(out).not.toContain("Skill context is incomplete");
    const byUri = await run([
      "skill",
      root,
      "skill://local/acme/skills/marketing/ads/SKILL.md",
      "--as",
      "local/acme/skills",
    ]);
    expect(byUri.code).toBe(0);
    expect(byUri.out).toContain("Skill: ads\nSource: acme/skills (commit 0000000)");
    expect(byUri.out).toContain("--- instructions ---\n# Ads");
    const json = await run(["skill", root, "marketing/ads/SKILL.md", "--json"]);
    const parsed = restSkillSchema.parse(JSON.parse(json.out));
    if (parsed.status !== "ready") throw new Error("not ready");
    expect(parsed.skill.complete).toBe(true);
    expect(parsed.skill.included).toEqual(["marketing/ads/references/voice.md"]);
    expect(parsed.commit).toBe("0".repeat(40));
  });

  it("says what the pack does not have, with the way to find it", async () => {
    const root = await repository(PACK);
    const missing = await run(["skill", root, "marketing/SKILL.md"]);
    expect(missing.code).toBe(EXIT_MISSING);
    expect(missing.err).toContain('No skill at "marketing/SKILL.md"');
    expect(missing.err).toContain(
      "Available: engineering/release-notes/SKILL.md, marketing/ads/SKILL.md",
    );
    const elsewhere = await run(["skill", root, "skill://gh/acme/skills/marketing/ads/SKILL.md"]);
    expect(elsewhere.code).toBe(EXIT_MISSING);
    expect(elsewhere.err).toContain("names another pack");
    const file = await run(["file", root, "docs/missing.md"]);
    expect(file.code).toBe(EXIT_MISSING);
    expect(file.err).toContain("file.not_found: No file at that path in this pack.");
  });

  it("reads a file by pages, lists a folder, and refuses a path that leaves the pack", async () => {
    const root = await repository(PACK);
    const whole = await run(["file", root, "docs/guide.md"]);
    expect(whole.code).toBe(0);
    expect(whole.out).toContain("File: docs/guide.md (");
    expect(whole.out).toContain("--- content ---\n# Guide");
    const page = await run(["file", root, "docs/guide.md", "--limit", "10"]);
    expect(page.out).toContain("characters 0 to 10 of");
    expect(page.out).toContain("The file continues at offset 10.");
    const rest = await run(["file", root, "docs/guide.md", "--offset", "10"]);
    expect(rest.out).toContain("characters 10 to");
    const folder = await run(["file", root, "marketing/ads"]);
    expect(folder.out).toContain("Directory: marketing/ads/ (2 entries)");
    expect(folder.out).toContain("- marketing/ads/references/");
    const outside = await run(["file", root, "../secret.md"]);
    expect(outside.code).toBe(EXIT_USAGE);
    expect(outside.err).toContain("request.invalid: Not a valid path");
  });

  it("ends a page it cuts at the end of a line, and gives a length that was asked for as measured", async () => {
    // A table drawn with characters, longer than one read carries: a row cut in the middle
    // would read as a row with empty cells.
    const rows = Array.from(
      { length: 900 },
      (_, at) =>
        `    ${String(at).padStart(4)}   FIELD_${String(at).padStart(4, "0")}   ENUM   m/s   0   ${5000 + at}   4   50`,
    );
    const table = ["# Fields", "", "```", ...rows, "```", ""].join("\n");
    expect(table.length).toBeGreaterThan(40_000);
    const root = await repository({ ...PACK, "docs/fields.md": table });
    const read = async (...flags: string[]) => {
      const answer = await run(["file", root, "docs/fields.md", "--json", ...flags]);
      expect(answer.code).toBe(0);
      return JSON.parse(answer.out) as {
        content: string;
        offset: number;
        nextOffset: number | null;
      };
    };
    const first = await read();
    expect(first.nextOffset).not.toBeNull();
    expect(first.content.endsWith("\n")).toBe(true);
    expect(first.content.length).toBeLessThanOrEqual(40_000);
    // The last line of the page is a row whole, and the next page begins with the row after it.
    expect(rows).toContain(first.content.trimEnd().split("\n").at(-1));
    let joined = first.content;
    let next = first.nextOffset;
    while (next !== null) {
      const page = await read("--offset", String(next));
      expect(page.offset).toBe(next);
      joined += page.content;
      next = page.nextOffset;
    }
    expect(joined).toBe(table);
    // A length that was asked for is given as measured, wherever it ends: a section is read so.
    const measured = await read("--offset", "12", "--limit", "25");
    expect(measured.content).toBe(table.slice(12, 37));
    expect(measured.nextOffset).toBe(37);
  });

  it("names a skill's folder by the command that lists it, in the pack as it was given", async () => {
    // Seven linked files: more than a skill's first page resolves, so the rest are named with
    // what lists the folder they are in.
    const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
    const root = await repository({
      ...PACK,
      "engineering/linked/SKILL.md": `---\nname: linked\ndescription: A skill of many linked files.\n---\n# Linked\n\n${names.map((name) => `- [${name}](references/${name}.md)`).join("\n")}\n`,
      ...Object.fromEntries(
        names.map((name) => [`engineering/linked/references/${name}.md`, `# ${name}\n`]),
      ),
    });
    const { code, out } = await run(["skill", root, "engineering/linked/SKILL.md"]);
    expect(code).toBe(0);
    const line =
      /2 more linked files, not resolved above: [^\n]+\. Each is linked where the text names it; (skillcdn browse (\S+) engineering\/linked) lists the skill's own files\./.exec(
        out,
      );
    expect(line).not.toBeNull();
    // The directory as it was given, quoted for a shell where it needs it: a line to run, and
    // not the call of a tool.
    expect(line?.[2]?.replace(/^'(.*)'$/, "$1")).toBe(root);
    expect(out).not.toContain('{"path"');
    const listed = await run(["browse", root, "engineering/linked"]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("- directory: engineering/linked/references");
    // Where the pack is read under another name, the line says so as the read did.
    const named = await run([
      "skill",
      root,
      "engineering/linked/SKILL.md",
      "--as",
      "local/acme/skills",
    ]);
    expect(named.out).toMatch(
      /; skillcdn browse \S+ engineering\/linked --as local\/acme\/skills lists the skill's own files\./,
    );
  });

  it("prints a skill longer than a host shows whole in parts, each naming the next (ADR-0108)", async () => {
    // Three included files of some twelve thousand characters: more than one read prints.
    const files = ["alpha", "bravo", "charlie"];
    const lines = (name: string) =>
      Array.from(
        { length: 400 },
        (_, at) => `Line ${name}-${String(at).padStart(4, "0")} of the ${name} file.`,
      );
    const include = files.map((name) => `    - references/${name}.md\n`).join("");
    const root = await repository({
      ...PACK,
      "engineering/big/SKILL.md": `---\nname: big\ndescription: A skill of many included files.\nskillcdn:\n  include:\n${include}---\n# Big\n\nRead every file.\n`,
      ...Object.fromEntries(
        files.map((name) => [
          `engineering/big/references/${name}.md`,
          `${lines(name).join("\n")}\n`,
        ]),
      ),
    });
    // The last line of a part that is not the last is the command that prints the next, alone.
    const continuation = /\nskillcdn skill (\S+) engineering\/big\/SKILL\.md --cursor (\S+)\n$/;
    const parts: string[] = [];
    let cursor: string | undefined;
    do {
      const { code, out } = await run([
        "skill",
        root,
        "engineering/big/SKILL.md",
        ...(cursor === undefined ? [] : ["--cursor", cursor]),
      ]);
      expect(code).toBe(0);
      expect(bytesOf(out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
      parts.push(out);
      const next = continuation.exec(out);
      // The directory as it was given, quoted for a shell where it needs it.
      if (next !== null) expect(next[1]?.replace(/^'(.*)'$/, "$1")).toBe(root);
      cursor = next?.[2];
      expect(parts.length).toBeLessThan(20);
    } while (cursor !== undefined);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts.slice(0, -1)) {
      expect(part).toContain("Skill context is incomplete.");
    }
    expect(parts.at(-1)).not.toContain("Skill context is incomplete.");
    // A part that is not the last says how many pages of the skill follow it, at its head and at
    // its end, where it says to read on now; the last says that the skill is complete (ADR-0124).
    const left = parts.slice(0, -1).map((part) => {
      const head =
        /Skill context is incomplete\. (\d+) more pages? follows? this part\. Read the next part before using it: skillcdn skill \S+ engineering\/big\/SKILL\.md --cursor \S+\n/.exec(
          part,
        );
      expect(head).not.toBeNull();
      expect(part).toMatch(
        /This part ends before the skill does: \d+ more pages? follows? this part, and what follows is part of its instructions\. Do not use the skill, plan from it or answer from it yet: read the next part now, and each one after it, until a part says the skill is complete:\nskillcdn skill \S+ engineering\/big\/SKILL\.md --cursor \S+\n$/,
      );
      return Number(head?.[1]);
    });
    expect(left.at(-1)).toBeGreaterThanOrEqual(1);
    expect(left).toEqual([...left].sort((a, b) => b - a));
    expect(new Set(left).size).toBe(left.length);
    expect(parts.at(-1)?.endsWith("Skill context is complete: this was its last part.\n")).toBe(
      true,
    );
    // Each file is named at most once a part (#520), and every line of every file is printed
    // whole, but where a part ends inside it.
    for (const part of parts) {
      for (const name of files) {
        const header = `--- included file: engineering/big/references/${name}.md ---`;
        expect(part.split(header).length - 1).toBeLessThanOrEqual(1);
      }
    }
    // A part ends after a line (ADR-0113): every line of every file is printed whole.
    const printed = parts.join("\n");
    expect(files.flatMap(lines).filter((line) => !printed.includes(line))).toEqual([]);
    // The first part says what the skill is, its license and its files; a later part says none of
    // them again.
    expect(parts[0]).toContain("Description: A skill of many included files.");
    expect(parts[0]).toContain("\nLicense: MIT (LICENSE)\n");
    expect(parts[0]).toContain("Supporting files, readable with skillcdn file:");
    for (const part of parts.slice(1)) {
      expect(part).toMatch(/^Skill: big\nSource: /);
      expect(part).not.toContain("Description:");
      expect(part).not.toContain("License:");
      expect(part).not.toContain("Supporting files");
    }
    for (const part of parts) {
      // A file is under its name only in the parts that have some of it, and a section the part
      // cuts says so in the command's word for what comes next.
      expect(part).not.toMatch(/--- included file: \S+ ---\n(?:\(Continues|\n|$)/);
      expect(part).not.toContain("page.)");
    }
    expect(
      parts.slice(0, -1).some((part) => part.includes("\n(Continues in the next part.)")),
    ).toBe(true);
    // A cursor of another commit, or of nothing, is refused as a misuse.
    const stale = await run([
      "skill",
      root,
      "engineering/big/SKILL.md",
      "--cursor",
      "bm90LWEtY3Vyc29y",
    ]);
    expect(stale.code).toBe(EXIT_USAGE);
    // The JSON is the skill whole, as before.
    const json = await run(["skill", root, "engineering/big/SKILL.md", "--json"]);
    const parsed = restSkillSchema.parse(JSON.parse(json.out));
    if (parsed.status !== "ready") throw new Error("not ready");
    expect(parsed.skill.complete).toBe(true);
  });

  it("ends a part between two blocks, and says the head of a table again where it must cut one (ADR-0118)", async () => {
    const prose = (name: string, count: number) =>
      Array.from({ length: count }, (_, at) => `Sentence ${at} of the ${name} page.\n`).join("");
    const small = `| Input | Source |\n|---|---|\n${Array.from({ length: 50 }, (_, at) => `| input ${at} | where input ${at} is |\n`).join("")}`;
    const long = `| Verdict | When |\n|---|---|\n${Array.from({ length: 700 }, (_, at) => `| verdict ${at} | when verdict ${at} holds |\n`).join("")}`;
    const root = await repository({
      ...PACK,
      "engineering/tables/SKILL.md":
        "---\nname: tables\ndescription: A skill of tables.\nskillcdn:\n  include:\n    - references/inputs.md\n    - references/verdicts.md\n---\n# Tables\n\nRead both.\n",
      // The small table stands where the first page's bytes run out.
      "engineering/tables/references/inputs.md": `# Inputs\n\n${prose("inputs", 420)}\n${small}\n${prose("after", 40)}`,
      "engineering/tables/references/verdicts.md": `# Verdicts\n\nThese hold:\n\n${long}\nDone.\n`,
    });
    const parts: string[] = [];
    let cursor: string | undefined;
    do {
      const { code, out } = await run([
        "skill",
        root,
        "engineering/tables/SKILL.md",
        ...(cursor === undefined ? [] : ["--cursor", cursor]),
      ]);
      expect(code).toBe(0);
      parts.push(out);
      cursor = /--cursor (\S+)\n$/.exec(out)?.[1];
      expect(parts.length).toBeLessThan(20);
    } while (cursor !== undefined);
    expect(parts.length).toBeGreaterThan(2);
    // The table that fits in the reach of a part's end is in one part, whole.
    const holding = parts.filter((part) => part.includes("| input "));
    expect(holding).toHaveLength(1);
    expect(holding[0]).toContain(small);
    // The long one is cut after a row, and every part that has rows of it has its head above
    // them: its own once, and said again in the parts that go on with it.
    const withRows = parts.filter((part) => part.includes("| verdict "));
    expect(withRows.length).toBeGreaterThan(1);
    for (const part of withRows.slice(1)) {
      expect(part).toContain(
        "(The table goes on from the part before; its first lines again:)\n| Verdict | When |\n|---|---|\n| verdict ",
      );
    }
    expect(withRows[0]).not.toContain("its first lines again");
    // No part ends right after a heading or the line that announces the table.
    for (const part of parts.slice(0, -1)) {
      expect(part).not.toMatch(/(?:# Verdicts|These hold:)\n*\(Continues in the next part\.\)/);
    }
    // Every row is printed once, and the skill whole holds each head once.
    const printed = parts.join("\n");
    for (const at of [0, 349, 699]) {
      expect(printed.split(`| verdict ${at} |`).length).toBe(2);
    }
    const json = await run(["skill", root, "engineering/tables/SKILL.md", "--json"]);
    const parsed = restSkillSchema.parse(JSON.parse(json.out));
    if (parsed.status !== "ready") throw new Error("not ready");
    const verdicts = parsed.skill.includedContents?.find((file) =>
      file.path.endsWith("verdicts.md"),
    );
    expect(verdicts?.content?.split("| Verdict | When |").length).toBe(2);
    expect(parsed.skill.tableHead).toBeUndefined();
  });

  it("prints a page of a file within what a host shows whole, ended at a line (ADR-0108)", async () => {
    const rows = Array.from(
      { length: 900 },
      (_, at) => `Row ${String(at).padStart(4, "0")}: a line of the long file.`,
    );
    const root = await repository({ ...PACK, "docs/long.md": `# Long\n\n${rows.join("\n")}\n` });
    const first = await run(["file", root, "docs/long.md"]);
    expect(first.code).toBe(0);
    expect(bytesOf(first.out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
    const next = /More follows: call skillcdn file with offset (\d+)\./.exec(first.out);
    const offset = Number(next?.[1]);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(FILE_PAGE_CHARS);
    const content = first.out.slice(first.out.indexOf("--- content ---\n") + 16);
    expect(content.trimEnd().split("\n").at(-1)).toMatch(/^Row \d{4}: a line of the long file\.$/);
    const rest = await run(["file", root, "docs/long.md", "--offset", String(offset)]);
    expect(rest.out).toMatch(/--- content ---\nRow \d{4}: a line/);
    // The JSON is the page the API answers.
    const json = await run(["file", root, "docs/long.md", "--json"]);
    expect((JSON.parse(json.out) as { content: string }).content.length).toBeGreaterThan(
      FILE_PAGE_CHARS,
    );
  });

  it("counts what one read prints in bytes, whatever the script (ADR-0124)", async () => {
    // Three bytes a character: a bound counted in characters lets a part through at three times
    // what a host shows of one output.
    const lines = (name: string) =>
      Array.from(
        { length: 500 },
        (_, at) =>
          `${name} 문서의 ${String(at).padStart(4, "0")}번째 줄: 독자는 이 줄을 통째로 읽는다.`,
      );
    const files = ["가", "나"];
    const root = await repository({
      ...PACK,
      "engineering/hangul/SKILL.md": `---\nname: hangul\ndescription: 한글로 쓴 긴 스킬.\nskillcdn:\n  include:\n${files.map((name) => `    - references/${name}.md\n`).join("")}---\n# 한글\n\n모든 파일을 읽는다.\n`,
      ...Object.fromEntries(
        files.map((name) => [
          `engineering/hangul/references/${name}.md`,
          `${lines(name).join("\n")}\n`,
        ]),
      ),
      "docs/hangul.md": `# 긴 문서\n\n${lines("긴").join("\n")}\n`,
    });
    const parts: string[] = [];
    let cursor: string | undefined;
    do {
      const { code, out } = await run([
        "skill",
        root,
        "engineering/hangul/SKILL.md",
        ...(cursor === undefined ? [] : ["--cursor", cursor]),
      ]);
      expect(code).toBe(0);
      expect(bytesOf(out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
      parts.push(out);
      cursor = /--cursor (\S+)\n$/.exec(out)?.[1];
      expect(parts.length).toBeLessThan(20);
    } while (cursor !== undefined);
    // Some ninety thousand bytes of included files: more parts than their characters would take.
    expect(parts.length).toBeGreaterThan(3);
    const printed = parts.join("\n");
    expect(files.flatMap(lines).filter((line) => !printed.includes(line))).toEqual([]);
    // A page of a file is what prints within the bound, ended after a line, and the pages are
    // the file.
    const read: string[] = [];
    let offset: string | undefined;
    do {
      const { code, out } = await run([
        "file",
        root,
        "docs/hangul.md",
        ...(offset === undefined ? [] : ["--offset", offset]),
      ]);
      expect(code).toBe(0);
      expect(bytesOf(out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
      const content = out.slice(out.indexOf("--- content ---\n") + 16).trimEnd();
      read.push(...content.split("\n").filter((line) => line.includes("번째 줄")));
      offset = /More follows: call skillcdn file with offset (\d+)\./.exec(out)?.[1];
      expect(read.length).toBeLessThanOrEqual(500);
    } while (offset !== undefined);
    expect(read).toEqual(lines("긴"));
    // A length asked for that does not print within the bound is cut after a line and says to
    // read on; one that does is given as measured, as a section is read.
    const long = await run(["file", root, "docs/hangul.md", "--limit", "100000"]);
    expect(bytesOf(long.out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
    expect(long.out).toMatch(/More follows: call skillcdn file with offset \d+\./);
    expect(long.out.trimEnd().endsWith("통째로 읽는다.")).toBe(true);
    const section = await run(["file", root, "docs/hangul.md", "--offset", "8", "--limit", "40"]);
    expect(section.out).toContain("The file continues at offset 48.");
  }, 30_000);

  it("lists a pack longer than one read prints in pages, and a folder or a search within it (ADR-0124)", async () => {
    const number = (at: number) => String(at).padStart(3, "0");
    // A description of some seven hundred characters of three bytes each, with a word to find.
    const describes = (at: number) =>
      `Does job ${number(at)}. ${"이 스킬은 한 가지 일을 맡아 끝까지 한다. ".repeat(28)}`.trim();
    const count = 90;
    const root = await repository({
      ...PACK,
      ...Object.fromEntries(
        Array.from({ length: count }, (_, at) => [
          `skills/job-${number(at)}/SKILL.md`,
          `---\nname: job-${number(at)}\ndescription: ${describes(at)}\n---\n# Job\n\nDo it.\n`,
        ]),
      ),
    });
    const continuation = /\n\nThe listing goes on: skillcdn skills (\S+) --cursor (\S+)\n$/;
    const pages: string[] = [];
    let cursor: string | undefined;
    do {
      const { code, out } = await run([
        "skills",
        root,
        ...(cursor === undefined ? [] : ["--cursor", cursor]),
      ]);
      expect(code).toBe(0);
      expect(bytesOf(out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
      pages.push(out);
      const next = continuation.exec(out);
      if (next !== null) expect(next[1]?.replace(/^'(.*)'$/, "$1")).toBe(root);
      cursor = next?.[2];
      expect(pages.length).toBeLessThan(40);
    } while (cursor !== undefined);
    expect(pages.length).toBeGreaterThan(2);
    // What a client is told on connect is said once, and a later page says that it goes on.
    expect(pages[0]).toContain("Skills and documents from");
    expect(pages[0]).toContain(`${count + 2} skills and 1 document in`);
    expect(pages[0]).toMatch(/\d+ skills are outside this page; continue with nextCursor\./);
    for (const page of pages.slice(1)) {
      expect(page.startsWith("Continued from the page before. This page lists:\n")).toBe(true);
      expect(page).not.toContain("Skills and documents from");
    }
    expect(pages.at(-1)?.endsWith("The listing is complete: this was its last page.\n")).toBe(true);
    // Every skill is listed once, and so is the document.
    const listed = pages.join("\n");
    for (let at = 0; at < count; at += 1) {
      expect(listed.split(`skill: job-${number(at)} (`).length).toBe(2);
    }
    expect(listed.split("document: docs/guide.md").length).toBe(2);
    // A cursor of nothing is refused as a misuse, as for any read.
    expect((await run(["skills", root, "--cursor", "bm90LWEtY3Vyc29y"])).code).toBe(EXIT_USAGE);
    // A page of a folder holds no more entries than print within the bound, whatever was asked,
    // and names the cursor that goes on.
    const folder: string[] = [];
    cursor = undefined;
    do {
      const { code, out } = await run([
        "browse",
        root,
        "skills",
        "--limit",
        "200",
        ...(cursor === undefined ? [] : ["--cursor", cursor]),
      ]);
      expect(code).toBe(0);
      expect(bytesOf(out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
      folder.push(out);
      cursor = /nextCursor: "([^"]+)"/.exec(out)?.[1];
      expect(folder.length).toBeLessThan(40);
    } while (cursor !== undefined);
    expect(folder.length).toBeGreaterThan(1);
    const entries = folder.join("\n");
    for (let at = 0; at < count; at += 1) {
      expect(entries.split(`skills/job-${number(at)}/SKILL.md`).length).toBe(2);
    }
    // And so does a page of what the words find, at the most results one page takes.
    const found = await run(["find", root, "job", "--limit", "25"]);
    expect(found.code).toBe(0);
    expect(found.out).toMatch(/^\d+ results for "job"/);
    expect(bytesOf(found.out)).toBeLessThanOrEqual(COMMAND_OUTPUT_MAX_BYTES);
    // Each read indexes the directory again: some twenty of them.
  }, 30_000);

  it("refuses what cannot be read or is not asked right", async () => {
    const root = await repository(PACK);
    const nowhere = await run(["skills", join(root, "nowhere")]);
    expect(nowhere.code).toBe(EXIT_UNREADABLE);
    expect(nowhere.err).toContain("not a directory that can be read");
    const noWords = await run(["find", root]);
    expect(noWords.code).toBe(EXIT_USAGE);
    expect(noWords.err).toContain("Say the words to find.");
    const badLimit = await run(["browse", root, "--limit", "0"]);
    expect(badLimit.code).toBe(EXIT_USAGE);
    expect(badLimit.err).toContain("--limit takes an integer between 1 and 200");
    const unknown = await run(["skill", root, "x", "--bogus"]);
    expect(unknown.code).toBe(EXIT_USAGE);
    const help = await run(["help", "skill"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("usage: skillcdn skill [<pack>] <path>");
  });
});

describe("the files a pack carries that are not text (ADR-0077)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

  it("answers a picture or an original with where it is on this machine, whatever its size", async () => {
    const root = await repository({
      ...PACK,
      "docs/ch3.md":
        "---\nsource: sources/manual.pdf\n---\n# Chapter 3\n\n![A figure](images/a.png)\n",
    });
    await mkdir(join(root, "docs", "images"), { recursive: true });
    await mkdir(join(root, "docs", "sources"), { recursive: true });
    await writeFile(join(root, "docs", "images", "a.png"), PNG);
    await writeFile(join(root, "docs", "sources", "manual.pdf"), "%PDF-1.7 not really");
    // A file whose name does not say what it is: its bytes are read from disk to find out.
    await writeFile(join(root, "docs", "sources", "table.dat"), new Uint8Array([0xff, 0xfe, 0, 1]));
    const picture = await run(["file", root, "docs/images/a.png"]);
    expect(picture.code).toBe(EXIT_MISSING);
    expect(picture.err).toContain("The file is not UTF-8 text, which is all this command carries.");
    expect(picture.err).toMatch(/Read it at its source: file:\/\/\/.*docs\/images\/a\.png/);
    const data = await run(["file", root, "docs/sources/table.dat"]);
    expect(data.code).toBe(EXIT_MISSING);
    expect(data.err).toMatch(/Read it at its source: file:\/\/\/.*docs\/sources\/table\.dat/);
    // The chapter names its original, with where it is, and its picture.
    const chapter = await run(["file", root, "docs/ch3.md"]);
    expect(chapter.code).toBe(0);
    expect(chapter.out).toMatch(
      /Original: docs\/sources\/manual\.pdf \(file:\/\/\/.*docs\/sources\/manual\.pdf\)/,
    );
    const outline = await run(["browse", root, "docs/ch3.md"]);
    expect(outline.out).toContain("- docs/images/a.png: A figure");
  });
});

describe("the tables and the code blocks of a directory as data (ADR-0080)", () => {
  // One table in two files under the same header, a table of another shape, and two definitions.
  const DATA: Record<string, string> = {
    ...PACK,
    "docs/codes/010-a-to-b.md":
      '# Codes: A to B\n\n| Code | Meaning |\n|---|---|\n| A | open, or "ajar" |\n| B | closed |\n',
    "docs/codes/020-c-to-d.md":
      "# Codes: C to D\n\n| Code | Meaning |\n|---|---|\n| C | held |\n| D | lost |\n\n## Units\n\n| Unit | Symbol |\n|---|---|\n| second | s |\n",
    "docs/definitions.md":
      "# Definitions\n\n## Code\n\n```tln\nCode ::= ENUMERATED { a, b, c, d }\n```\n\n## Unit\n\n```tln\nUnit ::= ENUMERATED { second }\n```\n",
  };

  it("prints the rows under a path as one CSV, in reading order, with where each stands", async () => {
    const root = await repository(DATA);
    const { code, out, err } = await run(["rows", root, "docs/codes"]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "path,heading,Code,Meaning,Unit,Symbol",
        'docs/codes/010-a-to-b.md,Codes: A to B,A,"open, or ""ajar""",,',
        "docs/codes/010-a-to-b.md,Codes: A to B,B,closed,,",
        "docs/codes/020-c-to-d.md,Codes: C to D,C,held,,",
        "docs/codes/020-c-to-d.md,Codes: C to D,D,lost,,",
        "docs/codes/020-c-to-d.md,Codes: C to D > Units,,,second,s",
        "",
      ].join("\r\n"),
    );
    // A heading keeps the tables under it; one file is read as a folder is.
    const kept = await run(["rows", root, "docs/codes", "--heading", "units"]);
    expect(kept.out).toBe(
      "path,heading,Unit,Symbol\r\ndocs/codes/020-c-to-d.md,Codes: C to D > Units,second,s\r\n",
    );
    const one = await run(["rows", root, "docs/codes/010-a-to-b.md", "--format", "json"]);
    expect(JSON.parse(one.out)).toEqual([
      {
        path: "docs/codes/010-a-to-b.md",
        heading: "Codes: A to B",
        cells: { Code: "A", Meaning: 'open, or "ajar"' },
      },
      {
        path: "docs/codes/010-a-to-b.md",
        heading: "Codes: A to B",
        cells: { Code: "B", Meaning: "closed" },
      },
    ]);
    // With --json, what the REST API answers, every page joined.
    const rest = restRowsSchema.parse(
      JSON.parse((await run(["rows", root, "docs", "--json"])).out),
    );
    if (rest.status !== "ready") throw new Error("not ready");
    expect(rest.rowCount).toBe(5);
    expect(rest.tables.map((table) => table.rows.length)).toEqual([2, 2, 1]);
    expect(rest.nextCursor).toBeNull();
  });

  it("writes to a file when told to, and says how much", async () => {
    const root = await repository(DATA);
    const target = join(root, "..", "codes.csv");
    const { code, out } = await run(["rows", root, "docs/codes", "--out", target]);
    expect(code).toBe(0);
    expect(out).toContain("Wrote 5 rows of 3 tables to ");
    expect(await readFile(target, "utf8")).toContain(
      "docs/codes/020-c-to-d.md,Codes: C to D,D,lost,,",
    );
  });

  it("prints the code blocks under a path as they are written, each under where it stands", async () => {
    const root = await repository(DATA);
    const all = await run(["code", root, "docs"]);
    expect(all.code).toBe(0);
    expect(all.out).toBe(
      "--- docs/definitions.md > Definitions > Code (tln) ---\nCode ::= ENUMERATED { a, b, c, d }\n\n--- docs/definitions.md > Definitions > Unit (tln) ---\nUnit ::= ENUMERATED { second }\n",
    );
    const found = await run(["code", root, "docs", "--grep", "^Unit ::="]);
    expect(found.out).toBe(
      "--- docs/definitions.md > Definitions > Unit (tln) ---\nUnit ::= ENUMERATED { second }\n",
    );
    const under = await run(["code", root, "docs/definitions.md", "--heading", "code", "--json"]);
    const rest = restCodeSchema.parse(JSON.parse(under.out));
    if (rest.status !== "ready") throw new Error("not ready");
    expect(rest.blocks.map((block) => block.heading.at(-1))).toEqual(["Code"]);
  });

  it("refuses what names no document, and what it cannot take", async () => {
    const root = await repository(DATA);
    const missing = await run(["rows", root, "docs/nothing"]);
    expect(missing.code).toBe(EXIT_MISSING);
    expect(missing.err).toContain("No Markdown document at that path");
    expect((await run(["rows", root, "docs", "--format", "xml"])).code).toBe(EXIT_USAGE);
    expect((await run(["code", root, "docs", "--grep", "("])).code).toBe(EXIT_USAGE);
    expect((await run(["rows", root, "docs", "extra"])).code).toBe(EXIT_USAGE);
  });

  it("says in the outline of a document what it holds as data, and the command that prints it", async () => {
    const root = await repository(DATA);
    const outline = await run(["browse", root, "docs/codes/020-c-to-d.md"]);
    expect(outline.out).toMatch(
      /Tables: 2 with 3 rows; as data: skillcdn rows ".*acme-skills" docs\/codes\/020-c-to-d\.md/,
    );
    expect(outline.out).toMatch(/- ## Units \(offset \d+, limit \d+; 1 row\)/);
    const definitions = await run(["browse", root, "docs/definitions.md"]);
    expect(definitions.out).toMatch(
      /Code blocks: 2; as data: skillcdn code ".*acme-skills" docs\/definitions\.md/,
    );
  });
});
