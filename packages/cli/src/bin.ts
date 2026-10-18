#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import process from "node:process";
import { runCli } from "./cli.js";
import { createFileStore, defaultConfigDir } from "./credentials.js";
import { createDirectoryStore } from "./directory.js";
import { guardBrokenPipe } from "./pipe.js";

// The only place that touches the process: everything else takes what it needs as arguments.
guardBrokenPipe(process.stdout, (code) => process.exit(code));

/** All of standard input, once it ends: what a job pipes in. */
function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      content += chunk;
    });
    process.stdin.on("end", () => resolve(content));
    process.stdin.on("error", reject);
  });
}

/**
 * One line typed at a terminal without being echoed: what a person pastes a token as. Enter
 * ends it, and so does the end-of-input key; the interrupt key leaves as it always does.
 */
function readSecretLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin } = process;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let line = "";
    const done = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      resolve(line);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\u0003") {
          process.stderr.write("\n");
          process.exit(130);
        }
        if (character === "\r" || character === "\n" || character === "\u0004") {
          done();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          line = line.slice(0, -1);
        } else {
          line += character;
        }
      }
    };
    stdin.on("data", onData);
  });
}

const readStdin = (): Promise<string> =>
  process.stdin.isTTY
    ? readSecretLine("Paste the token and press Enter (it is not shown): ")
    : readAllStdin();

/**
 * What the command calls itself to a person when it asks to connect: the agent it runs under,
 * where the environment says so, and the machine. Claude Code sets `CLAUDECODE` for the
 * commands it runs, Codex its `CODEX_*` variables, and Gemini CLI `GEMINI_CLI=1` (its shell tool
 * documentation: "it sets the GEMINI_CLI=1 environment variable in the subprocess's environment").
 */
function agentName(): string {
  const env = process.env;
  const agent =
    env.CLAUDECODE !== undefined
      ? "Claude Code"
      : Object.keys(env).some((key) => key.startsWith("CODEX_"))
        ? "Codex"
        : env.GEMINI_CLI !== undefined
          ? "Gemini CLI"
          : "An agent";
  const machine = hostname();
  return machine.length === 0 ? agent : `${agent} on ${machine}`;
}

/** The version of the package this file runs from, for what the command calls itself. */
function versionOf(): string | undefined {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const value =
      typeof manifest === "object" && manifest !== null && "version" in manifest
        ? manifest.version
        : undefined;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves when the person stops the command, by a signal from the terminal or the system. */
function hold(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

const version = versionOf();
process.exitCode = await runCli(process.argv.slice(2), {
  environment: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  cwd: process.cwd(),
  fetch: (input, init) => fetch(input, init),
  readStdin,
  store: createFileStore(defaultConfigDir(process.env, homedir()), process.pid),
  directory: createDirectoryStore(process.cwd()),
  userAgent: `skillcdn-cli/${version ?? "0"} (node ${process.versions.node}; ${process.platform})`,
  agentName: agentName(),
  hold,
  streams: { stdin: process.stdin, stdout: process.stdout },
});
