import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CONFIG, EXIT_USAGE, runCli } from "./cli.js";

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

async function repository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillcdn-cli-"));
  for (const [name, contents] of Object.entries(files)) {
    const parts = name.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  return root;
}

const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

describe("the skillcdn command", () => {
  it("checks a directory and reports what an agent would get", async () => {
    const root = await repository({
      "skills/greeting/SKILL.md": skill("greeting", "Says hello."),
      "docs/guide.md": "# Guide\n",
    });
    const { code, out, err } = await run(["check", root]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("Skills: 1");
    expect(out).toContain("- greeting (skills/greeting)");
    expect(out).toContain("Documents outside the skills: 1\n- docs/guide.md");
    expect(out).toContain("What a client is told on connect");
    expect(out).toContain("ok: no index diagnostics");
  });

  it("exits with 1 when the indexer has something to report", async () => {
    const root = await repository({
      "skills/broken/SKILL.md": skill("broken", "Says: hello."),
    });
    const { code, out } = await run(["check", root]);
    expect(code).toBe(1);
    expect(out).toContain("skills/broken/SKILL.md (invalid_front_matter)");
    expect(out).toContain("1 index issue(s) found");
  });

  it("exits with 2 for a directory that cannot be read", async () => {
    const root = await repository({});
    const { code, out } = await run(["check", join(root, "missing")]);
    expect(code).toBe(2);
    expect(out).toContain("not a directory that can be read");
  });

  it("applies the limits from the environment", async () => {
    const root = await repository({
      "skills/first/SKILL.md": skill("first", "The first."),
      "skills/second/SKILL.md": skill("second", "The second."),
    });
    const whole = await run(["check", root]);
    expect(whole.out).toContain("Skills: 2");
    const partial = await run(["check", root], { INDEX_MAX_FILES: "1" });
    expect(partial.out).toContain("over the indexing limits, so the index is partial");
  });

  it("refuses limits it cannot read, naming the variable and never the value", async () => {
    const root = await repository({});
    const { code, out, err } = await run(["check", root], {
      INDEX_MAX_FILES: "many",
      READ_MAX_FILE_BYTES: "1",
    });
    expect(code).toBe(EXIT_CONFIG);
    expect(out).toBe("");
    expect(err).toBe(
      "invalid configuration:\n" +
        "  - INDEX_MAX_FILES: must be an integer between 1 and 100000\n" +
        "  - READ_MAX_FILE_BYTES: must be an integer between 1024 and 16777216\n",
    );
    expect(err).not.toContain("many");
  });

  it("prints the usage for anything that is not the check command", async () => {
    for (const args of [[], ["--bogus"], ["lint", "."], ["check", "a", "b"]]) {
      const { code, out, err } = await run(args);
      expect(code).toBe(EXIT_USAGE);
      expect(out).toBe("");
      expect(err).toContain("usage: skillcdn check [directory]");
    }
  });

  it("prints its help and its version", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("usage: skillcdn check [directory]");
    expect(help.out).toContain("Exit codes:");
    const version = await run(["-v"]);
    expect(version.code).toBe(0);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+\S*\n$/);
  });
});
