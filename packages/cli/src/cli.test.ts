import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CONFIG, EXIT_USAGE, isLaterRelease, runCli } from "./cli.js";

// What the help may cost whoever reads it (ADR-0131): the list with what holds for every
// command, and one command's page. A command or a paragraph added past them makes room first.
const HELP_MAX_BYTES = 2_600;
const COMMAND_HELP_MAX_BYTES = 1_900;

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
    // The report says what wrote it: the command's version beside the rules it applied.
    expect(out).toMatch(
      /as SkillCDN would index it \(skillcdn \d+\.\d+\.\d+\S*, reading rules version \d+\): 2 files/,
    );
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

  it("answers a word that is no command with the names, and a misuse with the usage lines alone", async () => {
    // Nothing at all prints the list, as an error: the name was typed alone.
    const bare = await run([]);
    expect(bare.code).toBe(EXIT_USAGE);
    expect(bare.out).toBe("");
    expect(bare.err).toContain("usage: skillcdn <command> [arguments]");
    // A word that is no command is answered with the names, and not with the list and its lines:
    // an agent that mistypes one pays for a sentence.
    for (const args of [["--bogus"], ["lint", "."], ["help", "lint"]]) {
      const { code, out, err } = await run(args);
      expect(code).toBe(EXIT_USAGE);
      expect(out).toBe("");
      expect(err).toMatch(
        /^Not a command: \S+\. The commands are status, skills, find, .+; skillcdn help says what each is for\.\n$/,
      );
      expect(Buffer.byteLength(err)).toBeLessThan(400);
    }
    // A misuse says what was wrong, how the command is written and where the rest is: the usage
    // lines of its page, and not the page.
    const misuse = await run(["check", "a", "b"]);
    expect(misuse.code).toBe(EXIT_USAGE);
    expect(misuse.err).toBe(
      "check takes one directory at most.\n\nusage: skillcdn check [<directory>] [--references [--url <origin>]] [--offline]\n\nskillcdn help check says the rest.\n",
    );
    // An option another command takes is refused, where it was read and dropped: browse does not
    // keep to a folder with --path as find does.
    const stray = await run(["browse", ".", "--path", "docs"]);
    expect(stray.code).toBe(EXIT_USAGE);
    expect(stray.out).toBe("");
    expect(stray.err).toContain("skillcdn browse takes no --path.");
    expect(stray.err).toContain("usage: skillcdn browse [<pack>] [<folder>]");
    // Whatever the parser refuses is a misuse as well: a word where none is taken, an option
    // without its value, an option nobody takes.
    for (const args of [
      ["status", "extra"],
      ["skill", ".", "SKILL.md", "--cursor"],
      ["logins", "--nope"],
    ]) {
      const refused = await run(args);
      expect(refused.code).toBe(EXIT_USAGE);
      expect(refused.err).toContain(`skillcdn help ${args[0]} says the rest.`);
    }
  });

  it("keeps its help short, lists every command once, and names no option a command refuses (ADR-0131)", async () => {
    const help = (await run(["help"])).out;
    expect(Buffer.byteLength(help)).toBeLessThanOrEqual(HELP_MAX_BYTES);
    const names =
      /The commands are (.+); skillcdn help/.exec((await run(["nope"])).err)?.[1]?.split(", ") ??
      [];
    expect(names.length).toBeGreaterThan(10);
    // Each under one of the headings, on a line of its own.
    const listed = [...help.matchAll(/^ {2}([a-z]+)(?: |$)/gm)].map((match) => match[1]);
    expect(listed).toEqual(names);
    expect([...help.matchAll(/^(\S[^\n]*):$/gm)].map((match) => match[1])).toEqual([
      "Read a pack",
      "Write a pack",
      "Serve a directory",
      "Connect",
    ]);
    for (const name of names) {
      const page = (await run(["help", name])).out;
      expect(page.startsWith(`usage: skillcdn ${name}`)).toBe(true);
      expect(Buffer.byteLength(page)).toBeLessThanOrEqual(COMMAND_HELP_MAX_BYTES);
      // Every option its usage lines name is one it takes: asked for with --help beside it, the
      // command prints its page, where an option it refuses would be a misuse.
      const usage = page.split("\n\n", 1)[0] ?? "";
      for (const [, option, value] of usage.matchAll(/--([a-z-]+)(?: ([<a-z]\S*))?/g)) {
        const given = [`--${option}`, ...(value === undefined ? [] : ["x"])];
        const asked = await run([name, ...given, "--help"]);
        expect({ name, option, code: asked.code }).toEqual({ name, option, code: 0 });
      }
    }
  });

  it("says beside the report of check that a later version is published, and asks nothing when told not to", async () => {
    const root = await repository({ "skills/greeting/SKILL.md": skill("greeting", "Says hello.") });
    const asked: string[] = [];
    const checked = async (
      answer: () => Promise<Response>,
      args: string[] = [],
      environment: Record<string, string | undefined> = {},
    ) => {
      let out = "";
      let err = "";
      const code = await runCli(["check", root, ...args], {
        environment,
        stdout: (text) => {
          out += text;
        },
        stderr: (text) => {
          err += text;
        },
        fetch: (input) => {
          asked.push(input);
          return answer();
        },
      });
      return { code, out, err };
    };
    const latest = (version: string) => async () => Response.json({ latest: version });
    const plain = await run(["check", root]);

    const stale = await checked(latest("999.0.0"));
    expect(stale.code).toBe(0);
    // The report is the same with or without the answer: the line stands beside it.
    expect(stale.out).toBe(plain.out);
    expect(stale.err).toMatch(
      /^skillcdn 999\.0\.0 is published, and this is \d+\.\d+\.\d+\S*: a later version may read a pack by later rules\. Run npx @skillcdn\/cli@latest check, or update the command that is installed\. --offline asks nothing\.\n$/,
    );
    expect(asked).toEqual(["https://registry.npmjs.org/-/package/@skillcdn%2Fcli/dist-tags"]);

    // Nothing is said of the same version, an older one, or the placeholder a publish leaves.
    for (const version of ["0.0.1", "0.0.0-stage", "not a version"]) {
      expect((await checked(latest(version))).err).toBe("");
    }
    // No network, or a registry that does not answer as one, is not the check's affair.
    const failures: (() => Promise<Response>)[] = [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("gone", { status: 503 }),
      async () => new Response("<html>", { status: 200 }),
      async () => Response.json(["latest"]),
    ];
    for (const failure of failures) {
      const answered = await checked(failure);
      expect(answered.code).toBe(0);
      expect(answered.err).toBe("");
      expect(answered.out).toBe(plain.out);
    }

    asked.length = 0;
    expect((await checked(latest("999.0.0"), ["--offline"])).err).toBe("");
    expect((await checked(latest("999.0.0"), [], { SKILLCDN_OFFLINE: "1" })).err).toBe("");
    expect(asked).toEqual([]);
  });

  it("tells a later release from one that is not", () => {
    expect(isLaterRelease("0.6.0", "0.5.3")).toBe(true);
    expect(isLaterRelease("0.5.10", "0.5.9")).toBe(true);
    expect(isLaterRelease("1.0.0", "0.99.99")).toBe(true);
    expect(isLaterRelease("0.5.3", "0.5.3")).toBe(false);
    expect(isLaterRelease("0.5.2", "0.5.3")).toBe(false);
    expect(isLaterRelease("0.0.0-stage", "0.5.3")).toBe(false);
    expect(isLaterRelease("0.6.0", "unknown")).toBe(false);
  });

  it("prints its help and its version", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("usage: skillcdn <command> [arguments]");
    expect(help.out).toContain("Exit codes:");
    const one = await run(["check", "--help"]);
    expect(one.out).toContain("usage: skillcdn check [<directory>]");
    const version = await run(["-v"]);
    expect(version.code).toBe(0);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+\S*\n$/);
  });
});
