#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import process from "node:process";
import { runCli } from "./cli.js";
import { createFileStore, defaultConfigDir } from "./credentials.js";
import { createDirectoryStore } from "./directory.js";
import { guardBrokenPipe } from "./pipe.js";

// The only place that touches the process: everything else takes what it needs as arguments.
guardBrokenPipe(process.stdout, (code) => process.exit(code));

/** All of standard input, once it ends. */
function readStdin(): Promise<string> {
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
});
