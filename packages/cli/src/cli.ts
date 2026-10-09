import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkDirectory, readIndexLimits } from "@skillcdn/indexer";

/** What the command reads and writes, handed in so that a test runs it without a process. */
export interface CliIo {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

// Exit codes, as the server's roles use them: 64 for a usage error, 78 for configuration that
// cannot be read, 70 for an internal failure. `check` itself answers 0, 1 or 2.
export const EXIT_USAGE = 64;
export const EXIT_FAILURE = 70;
export const EXIT_CONFIG = 78;

export const USAGE = `usage: skillcdn check [directory]

Reads a directory as SkillCDN would index it and prints what an agent would get: the manifest,
the license, every skill with its files and warnings, the documents, what is not served, the
index diagnostics, and what a client is told on connect. Nothing in the directory is executed.

Exit codes: 0 when there are no index diagnostics, 1 when there are, 2 when the directory cannot
be read. The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.

Options:
  -h, --help     Print this help.
  -v, --version  Print the version.
`;

/** The version from the package's own manifest, which ships next to `dist/`. */
function version(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const value =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? manifest.version
      : undefined;
  return typeof value === "string" ? value : "unknown";
}

/** Runs the command with `args` (without the program name) and returns its exit code. */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (parsed.values.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  if (parsed.values.version === true) {
    io.stdout(`${version()}\n`);
    return 0;
  }
  const [command, directory, ...rest] = parsed.positionals;
  if (command !== "check" || rest.length > 0) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const limits = readIndexLimits(io.environment);
  if (!limits.ok) {
    io.stderr(
      `invalid configuration:\n${limits.error.map((problem) => `  - ${problem.variable}: ${problem.rule}\n`).join("")}`,
    );
    return EXIT_CONFIG;
  }
  try {
    return await checkDirectory({
      directory: directory ?? ".",
      limits: limits.value,
      write: io.stdout,
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILURE;
  }
}
