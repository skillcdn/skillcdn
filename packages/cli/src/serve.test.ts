import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { type CliIo, EXIT_UNREADABLE, EXIT_USAGE, runCli } from "./cli.js";

// The command as a server (ADR-0057): a directory served over HTTP and over standard input and
// output, read again as its files change.

async function repository(files: Record<string, string>): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "skillcdn-serve-")), "acme");
  await mkdir(root, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const parts = name.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  return root;
}

const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nDo it.\n`;

const FILES = {
  "SKILLCDN.md": "---\nname: Acme skills\ndescription: The skills of Acme.\n---\nBe brief.\n",
  "marketing/ads/SKILL.md": skill("ads", "Writes ad copy."),
  "docs/guide.md": "# Guide\n",
};

function harness(extra: Partial<CliIo> = {}) {
  let out = "";
  let err = "";
  const io: CliIo = {
    environment: {},
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    ...extra,
  };
  return { io, out: () => out, err: () => err };
}

const addressOf = (root: string): string => `/local/${basename(dirname(root))}/${basename(root)}`;

const skillsOf = (mounted: unknown): string[] => {
  const index = (mounted as { index?: { skills?: { path: string }[] } }).index;
  return index?.skills?.map((entry) => entry.path) ?? [];
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The responses on a stream, one JSON object per line, by id. */
function responsesOf(stream: PassThrough): (id: number) => Promise<Record<string, unknown>> {
  const waiting = new Map<number, (value: Record<string, unknown>) => void>();
  const arrived = new Map<number, Record<string, unknown>>();
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim().length === 0) {
        continue;
      }
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.id !== "number") {
        continue;
      }
      const waiter = waiting.get(message.id);
      if (waiter === undefined) {
        arrived.set(message.id, message);
      } else {
        waiting.delete(message.id);
        waiter(message);
      }
    }
  });
  return (id) => {
    const known = arrived.get(id);
    if (known !== undefined) {
      arrived.delete(id);
      return Promise.resolve(known);
    }
    return new Promise((resolve) => {
      waiting.set(id, resolve);
    });
  };
}

describe("skillcdn serve", () => {
  it("needs a directory", async () => {
    const h = harness();
    expect(await runCli(["serve"], h.io)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("usage: skillcdn serve");
  });

  it("exits with 2 for a directory that cannot be read", async () => {
    const root = await repository({});
    const h = harness();
    const code = await runCli(["serve", join(root, "missing"), "--port", "0"], h.io);
    expect(code).toBe(EXIT_UNREADABLE);
    expect(h.err()).toContain("not a directory that can be read");
  });

  it("refuses two directories at one address, and a port that is not one", async () => {
    const root = await repository(FILES);
    const twice = harness();
    expect(await runCli(["serve", root, root, "--port", "0"], twice.io)).toBe(EXIT_USAGE);
    expect(twice.err()).toContain(`Two directories would be served at ${addressOf(root)}`);
    const port = harness();
    expect(await runCli(["serve", root, "--port", "http"], port.io)).toBe(EXIT_USAGE);
    expect(port.err()).toContain("--port takes a port number");
  });

  it("serves the directory over HTTP until stopped, and reads it again as it changes", async () => {
    const root = await repository(FILES);
    const address = addressOf(root);
    const seen = { url: "", mounted: undefined as unknown, again: undefined as unknown, home: "" };
    const h = harness({
      hold: async () => {
        seen.url = /at (http:\/\/[^\s]+:\d+):/.exec(h.out())?.[1] ?? "";
        const mounts = async (): Promise<unknown> =>
          (await fetch(`${seen.url}/api/v1/mounts${address}`)).json();
        seen.mounted = await mounts();
        // A skill saved while the directory is served is served next.
        await mkdir(join(root, "marketing", "seo"), { recursive: true });
        await writeFile(join(root, "marketing", "seo", "SKILL.md"), skill("seo", "Ranks pages."));
        const deadline = Date.now() + 15_000;
        for (;;) {
          seen.again = await mounts();
          if (skillsOf(seen.again).length === 2 || Date.now() > deadline) {
            break;
          }
          await sleep(100);
        }
        seen.home = await (await fetch(`${seen.url}/`)).text();
      },
    });
    expect(await runCli(["serve", root, "--port", "0"], h.io)).toBe(0);
    expect(h.err()).toBe("");
    expect(h.out()).toContain(`  ${seen.url}${address}  ${root}`);
    expect((seen.mounted as { verified: boolean }).verified).toBe(true);
    expect(skillsOf(seen.mounted)).toEqual(["marketing/ads/SKILL.md"]);
    expect(skillsOf(seen.again)).toEqual(["marketing/ads/SKILL.md", "marketing/seo/SKILL.md"]);
    expect(seen.home).toContain(`${address}  ${basename(dirname(root))}/acme`);
    // Stopped: the port answers no more.
    await expect(fetch(`${seen.url}/`)).rejects.toThrow();
  }, 30_000);
});

describe("skillcdn mcp", () => {
  it("needs one directory", async () => {
    const h = harness({ streams: { stdin: new PassThrough(), stdout: new PassThrough() } });
    expect(await runCli(["mcp"], h.io)).toBe(EXIT_USAGE);
    expect(h.err()).toContain("usage: skillcdn mcp");
  });

  it("serves the directory to the client at the other end of standard input and output", async () => {
    const root = await repository(FILES);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const answer = responsesOf(stdout);
    const h = harness({ streams: { stdin, stdout } });
    const running = runCli(["mcp", root], h.io);
    const ask = (id: number, method: string, params: unknown): Promise<Record<string, unknown>> => {
      const waited = answer(id);
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return waited;
    };
    const initialized = await ask(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "skillcdn-test", version: "0.0.0" },
    });
    const serverInfo = (initialized.result as { serverInfo: { name: string } }).serverInfo;
    expect(serverInfo.name).toBe("skillcdn");
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = await ask(2, "tools/list", {});
    const names = (tools.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names.sort()).toEqual(["browse_repo", "load_skill", "read_repo_file", "search_repo"]);
    const loaded = await ask(3, "tools/call", {
      name: "load_skill",
      arguments: { path: "marketing/ads/SKILL.md" },
    });
    const content = (loaded.result as { content: { text?: string }[] }).content;
    expect(content.map((block) => block.text ?? "").join("")).toContain("Skill: ads");
    // The client closes its end: the command returns.
    stdin.end();
    expect(await running).toBe(0);
    // Standard output carried the protocol alone; the command spoke on standard error.
    expect(h.out()).toBe("");
    expect(h.err()).toContain(`as ${addressOf(root)} over standard input and output`);
  });
});
