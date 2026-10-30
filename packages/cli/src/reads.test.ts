import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restFindSchema, restMountSchema, restSkillSchema } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { EXIT_MISSING, EXIT_UNREADABLE, EXIT_USAGE, runCli } from "./cli.js";

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
