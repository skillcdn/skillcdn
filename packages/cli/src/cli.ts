import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  BROWSE_DEFAULT_LIMIT,
  BROWSE_MAX_LIMIT,
  browseBody,
  type CatalogState,
  directoryBody,
  FIND_DEFAULT_LIMIT,
  FIND_MAX_LIMIT,
  type FindItem,
  type FindResult,
  fileBody,
  findBody,
  joinSkillPages,
  type MountFacts,
  mountBody,
  parseSkillUri,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LIMIT,
  REST_MOUNT_LIST_LIMIT,
  renderBrowseResult,
  renderDiagnostics,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderInstructions,
  renderSkillResult,
  type SkillResult,
  skillOutcome,
  type ToolWords,
} from "@skillcdn/core";
import { checkDirectory, readIndexLimits } from "@skillcdn/indexer";
import { ReaderInputError } from "@skillcdn/reader";
import { type LocalPack, openDirectory } from "./local.js";

/** What the command reads and writes, handed in so that a test runs it without a process. */
export interface CliIo {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Where a relative directory is resolved from; the process's directory when left out. */
  readonly cwd?: string | undefined;
}

// Exit codes, as the server's roles use them: 64 for a usage error, 78 for configuration that
// cannot be read, 70 for an internal failure. `check` itself answers 0, 1 or 2; a read answers
// 1 for what the pack does not have and 2 for a directory that cannot be read.
export const EXIT_MISSING = 1;
export const EXIT_UNREADABLE = 2;
export const EXIT_USAGE = 64;
export const EXIT_FAILURE = 70;
export const EXIT_CONFIG = 78;

/** How the results name the reads, so that an agent is told the command and not a tool. */
export const COMMAND_WORDS: ToolWords = {
  browse: "skillcdn browse",
  search: "skillcdn find",
  load: "skillcdn skill",
  read: "skillcdn file",
};

const COMMANDS = ["check", "skills", "browse", "find", "skill", "file"] as const;
type Command = (typeof COMMANDS)[number];

const isCommand = (name: string): name is Command => (COMMANDS as readonly string[]).includes(name);

export const USAGE = `usage: skillcdn <command> [arguments]

Reads a pack as SkillCDN serves one: a directory on this machine in the SkillCDN Format, a git
checkout or any folder of skills, documents and rules. Nothing in the directory is executed.

Commands:
  check [<directory>]              Report what an agent would get from the directory, before pushing.
  skills <directory>               What a client is told on connect, then every skill and document.
  browse <directory> [<folder>]    What a folder holds, as browse_repo lists it.
  find <directory> <words...>      What the words find, as search_repo does.
  skill <directory> <path>         A skill whole, as load_skill assembles it: rules, instructions, included files.
  file <directory> <path>          A page of a file, as read_repo_file reads it, or what a folder holds.
  help [<command>]                 This, or one command in full.

Paths start at the pack's root, as marketing/ads/SKILL.md. Every read answers the words an MCP
client's model is given, or the JSON of the REST API with --json. A directory is addressed as
local/<its parent>/<its name>; --as local/<owner>/<name> names it otherwise. The INDEX_* and
READ_MAX_FILE_BYTES variables set the limits a deployment would apply.

Exit codes: 0 done; 1 the pack does not have it (no such skill, file or folder); 2 the directory
cannot be read; 64 a usage error; 78 a limit variable that cannot be read; 70 a failure.

Options:
  -h, --help     Print this help.
  -v, --version  Print the version.
`;

const READ_OPTIONS = `  --as <address>  Address the directory as local/<owner>/<name> instead of its parent's and its own name.
  --json          Print the JSON the REST API answers instead of the words a model is given.`;

const HELP: Readonly<Record<Command, string>> = {
  check: `usage: skillcdn check [<directory>]

Reads a directory as SkillCDN would index it and prints what an agent would get: the manifest,
the license, every skill with its files and warnings, the documents, what is not served, the
index diagnostics, and what a client is told on connect. Nothing in the directory is executed.

Exit codes: 0 when there are no index diagnostics, 1 when there are, 2 when the directory cannot
be read. The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.
`,
  skills: `usage: skillcdn skills <directory> [--as <address>] [--json]

What a client is told when it connects to the pack, within its 2,000 characters, then every
skill and every document outside the skills, as a search without words lists them: each skill
with its SKILL.md path, which skillcdn skill takes.

${READ_OPTIONS}
`,
  browse: `usage: skillcdn browse <directory> [<folder>] [--cursor <cursor>] [--limit <n>] [--as <address>] [--json]

What a folder holds, as browse_repo lists it: its skills, its folders with what each holds and
the README that introduces it, and its files, with the canonical path of each. The pack's root
when no folder is given. A page of ${BROWSE_DEFAULT_LIMIT} entries unless --limit says otherwise (up to
${BROWSE_MAX_LIMIT}); a page that ends before the folder does names its nextCursor, which --cursor continues.

${READ_OPTIONS}
`,
  find: `usage: skillcdn find <directory> <words...> [--path <folder>] [--cursor <cursor>] [--limit <n>] [--as <address>] [--json]

What the words find, as search_repo does: words are matched, not meaning, in the language the
pack is written in, usually English; a skill comes with the files of it that matched, in order of
relevance, and skills outrank documents. --path keeps the search to a folder. A page of ${FIND_DEFAULT_LIMIT}
results unless --limit says otherwise (up to ${FIND_MAX_LIMIT}); a page that ends before the results do
names its nextCursor, which --cursor continues.

${READ_OPTIONS}
`,
  skill: `usage: skillcdn skill <directory> <path> [--as <address>] [--json]

One skill whole, as load_skill assembles it: the rules of every SKILLCDN.md from the pack's root
to the skill's own folder, then its instructions, then the files it includes on every run, each
under a line that names its path; then the files it has and what it refers to. <path> is the
path of its SKILL.md from the pack's root, as skills and browse print it, or the skill://
URI the pack names it by. The pages the skill is read in are joined: what is printed is complete
unless it says otherwise.

${READ_OPTIONS}
`,
  file: `usage: skillcdn file <directory> <path> [--offset <n>] [--limit <n>] [--as <address>] [--json]

A page of a file, as read_repo_file reads it: the text as written, from character --offset,
${READ_FILE_DEFAULT_LIMIT} characters unless --limit says otherwise (up to ${READ_FILE_MAX_LIMIT}); a page that ends before
the file does says where the next begins. A path that names a folder answers what the folder
holds. A file over the read limit, one that is not text, and one a license keeps at its source
are named with where to read them instead.

${READ_OPTIONS}
`,
};

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

/** A usage error: what was wrong, and the command's help after it. */
class Misuse extends Error {}

/** The pack does not have what was asked for; the words say so as a tool result would. */
class Missing extends Error {}

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  as: { type: "string" },
  json: { type: "boolean" },
  cursor: { type: "string" },
  limit: { type: "string" },
  offset: { type: "string" },
  path: { type: "string" },
} as const;

function count(value: string | undefined, name: string, max: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
  if (Number.isNaN(number) || number < (name === "offset" ? 0 : 1) || number > max) {
    throw new Misuse(
      `--${name} takes an integer ${name === "offset" ? "from 0" : `between 1 and ${max}`}`,
    );
  }
  return number;
}

/** The REST body of the `mounts` route for a directory: what names it, and no picture. */
function factsOf(pack: LocalPack): MountFacts {
  const { address } = pack.mount;
  return {
    address,
    repository: {
      host: address.host,
      owner: address.owner,
      name: address.repo,
      defaultBranch: "",
      description: null,
      avatar: "",
      visibility: "public",
    },
    commit: pack.mount.commit,
    verified: pack.mount.verified,
    image: () => null,
  };
}

/** Every skill and document the pack lists, page after page, as one listing. */
async function listing(pack: LocalPack): Promise<FindResult> {
  const items: FindItem[] = [];
  let first: FindResult | undefined;
  let cursor: string | undefined;
  for (;;) {
    const answer = await pack.reader.find(pack.mount, { cursor, limit: FIND_MAX_LIMIT }, 0);
    if (answer.status !== "ready") {
      throw new Error("the index of a directory is always ready");
    }
    first ??= answer.result;
    items.push(...answer.result.items);
    cursor = answer.result.nextCursor;
    if (cursor === undefined) {
      return { ...first, items, nextCursor: undefined };
    }
  }
}

/** One skill whole: every page of its context, joined. */
async function wholeSkill(pack: LocalPack, path: string): Promise<SkillResult> {
  const pages: SkillResult[] = [];
  let cursor: string | undefined;
  for (;;) {
    const answer = await pack.reader.skill(pack.mount, path, 0, cursor, true);
    if (answer.status !== "ready") {
      throw new Error("the index of a directory is always ready");
    }
    const { lookup } = answer;
    switch (lookup.kind) {
      case "not_found":
        throw new Missing(
          `No skill at ${JSON.stringify(path)}. Use ${COMMAND_WORDS.browse} or ${COMMAND_WORDS.search} for its exact SKILL.md path.${lookup.available.length === 0 ? "" : ` Available: ${lookup.available.join(", ")}.`}${renderDiagnostics(lookup.diagnostics, true, undefined, COMMAND_WORDS) === undefined ? "" : `\n${renderDiagnostics(lookup.diagnostics, true, undefined, COMMAND_WORDS)}`}`,
        );
      case "ambiguous":
        throw new Missing(
          `Use the exact SKILL.md path ${COMMAND_WORDS.browse} or ${COMMAND_WORDS.search} prints.`,
        );
      case "unavailable":
        throw new Missing("The skill's content is unavailable.");
      case "found":
        pages.push(lookup.skill);
        cursor = lookup.skill.nextCursor;
        if (lookup.skill.complete || cursor === undefined) {
          const whole = joinSkillPages(pages);
          if (whole === undefined) {
            throw new Error("a skill has at least one page");
          }
          return whole;
        }
    }
  }
}

/** The path a skill is asked for by: its SKILL.md path, or the URI the pack names it by. */
function skillPathOf(pack: LocalPack, given: string): string {
  const uri = parseSkillUri(given);
  if (uri === undefined) {
    if (given.startsWith("skill://")) {
      throw new Missing(
        `Not a skill URI: ${given}. Say the path of its SKILL.md from the pack's root.`,
      );
    }
    return given;
  }
  const { address } = pack.mount;
  if (
    uri.address.host !== address.host ||
    uri.address.owner !== address.owner ||
    uri.address.repo !== address.repo
  ) {
    throw new Missing(
      `That URI names another pack, ${uri.address.host}/${uri.address.owner}/${uri.address.repo}; this one is ${address.host}/${address.owner}/${address.repo}.`,
    );
  }
  return uri.path;
}

async function readCommand(
  command: Exclude<Command, "check">,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP[command]);
    return 0;
  }
  const [directory, ...rest] = parsed.positionals;
  if (directory === undefined) {
    throw new Misuse("Say which directory.");
  }
  const limits = readIndexLimits(io.environment);
  if (!limits.ok) {
    io.stderr(
      `invalid configuration:\n${limits.error.map((problem) => `  - ${problem.variable}: ${problem.rule}\n`).join("")}`,
    );
    return EXIT_CONFIG;
  }
  const json = parsed.values.json === true;
  const opened = await openDirectory({
    directory: resolve(io.cwd ?? ".", directory),
    as: parsed.values.as,
    limits: limits.value,
  });
  if ("error" in opened) {
    io.stderr(`${opened.error}\n`);
    return opened.exit;
  }
  const pack = opened;
  const print = (text: string): void => {
    io.stdout(`${text}\n`);
  };
  const printJson = (value: unknown): void => {
    io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  };

  switch (command) {
    case "skills": {
      if (rest.length > 0) {
        throw new Misuse("skills takes the directory and nothing else.");
      }
      if (json) {
        printJson(
          mountBody(factsOf(pack), await pack.reader.overview(pack.mount, REST_MOUNT_LIST_LIMIT)),
        );
        return 0;
      }
      const catalog: CatalogState = await pack.reader.catalog(pack.mount);
      print(
        `${renderInstructions(catalog, COMMAND_WORDS)}\n\n${renderFindResult(await listing(pack), COMMAND_WORDS)}`,
      );
      return 0;
    }
    case "browse": {
      const [folder, ...more] = rest;
      if (more.length > 0) {
        throw new Misuse("browse takes the directory and at most one folder.");
      }
      const answer = await pack.reader.browse(
        pack.mount,
        {
          path: folder,
          cursor: parsed.values.cursor,
          limit: count(parsed.values.limit, "limit", BROWSE_MAX_LIMIT),
        },
        0,
      );
      if (answer.status !== "ready") {
        throw new Error("the index of a directory is always ready");
      }
      if (json) {
        printJson(browseBody(answer));
      } else {
        print(renderBrowseResult(answer.result, COMMAND_WORDS));
      }
      return 0;
    }
    case "find": {
      const query = rest.join(" ").trim();
      if (query.length === 0) {
        throw new Misuse("Say the words to find.");
      }
      const answer = await pack.reader.find(
        pack.mount,
        {
          query,
          path: parsed.values.path,
          cursor: parsed.values.cursor,
          limit: count(parsed.values.limit, "limit", FIND_MAX_LIMIT),
        },
        0,
      );
      if (answer.status !== "ready") {
        throw new Error("the index of a directory is always ready");
      }
      if (json) {
        printJson(findBody(answer));
      } else {
        print(renderFindResult(answer.result, COMMAND_WORDS));
      }
      return 0;
    }
    case "skill": {
      const [given, ...more] = rest;
      if (given === undefined || more.length > 0) {
        throw new Misuse("Say which skill: the path of its SKILL.md from the pack's root.");
      }
      const whole = await wholeSkill(pack, skillPathOf(pack, given));
      if (json) {
        const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill: whole } });
        printJson("body" in outcome ? outcome.body : outcome.failure);
      } else {
        print(renderSkillResult(whole, COMMAND_WORDS));
      }
      return 0;
    }
    case "file": {
      const [path, ...more] = rest;
      if (path === undefined || more.length > 0) {
        throw new Misuse("Say which file: its path from the pack's root.");
      }
      const lookup = await pack.reader.file(pack.mount, {
        path,
        offset: count(parsed.values.offset, "offset", Number.MAX_SAFE_INTEGER),
        limit: count(parsed.values.limit, "limit", READ_FILE_MAX_LIMIT),
      });
      switch (lookup.kind) {
        case "not_ready":
          throw new Error("the index of a directory is always ready");
        case "found":
          if (json) printJson(fileBody(lookup.file));
          else print(renderFileResult(lookup.file, COMMAND_WORDS));
          return 0;
        case "directory":
          if (json) printJson(directoryBody(lookup.directory));
          else print(renderDirectoryResult(lookup.directory));
          return 0;
        case "invalid_path":
          throw new Misuse(`Not a path from the pack's root: ${lookup.reason}.`);
        case "not_found":
          throw new Missing(
            `No readable file at ${lookup.path} in this pack. Use ${COMMAND_WORDS.browse}, or ${COMMAND_WORDS.load} for resolved references.${lookup.suggestions?.length ? ` Candidates: ${lookup.suggestions.join(", ")}.` : ""}`,
          );
        case "too_large":
          throw new Missing(
            `${lookup.path} is too large to read here (${lookup.size} bytes; the limit is ${lookup.limit}). Read it at its source: ${lookup.sourceUrl}`,
          );
        case "not_text":
          throw new Missing(
            `${lookup.path} is not a UTF-8 text file, which is all this command carries. Read it at its source: ${lookup.sourceUrl}`,
          );
        case "not_served":
          throw new Missing(
            `${lookup.path} is described, not served: its license allows SkillCDN to say that it exists, not to pass its content on. Read it at its source: ${lookup.sourceUrl}`,
          );
      }
    }
  }
}

/** Runs the command with `args` (without the program name) and returns its exit code. */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  const [name, ...rest] = args;
  if (name === "--version" || name === "-v") {
    io.stdout(`${version()}\n`);
    return 0;
  }
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    const wanted = rest[0];
    if (wanted !== undefined && isCommand(wanted)) {
      io.stdout(HELP[wanted]);
      return 0;
    }
    if (name === undefined || wanted !== undefined) {
      io.stderr(USAGE);
      return EXIT_USAGE;
    }
    io.stdout(USAGE);
    return 0;
  }
  if (!isCommand(name)) {
    io.stderr(`Not a command: ${name}.\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    if (name === "check") {
      return await checkCommand(rest, io);
    }
    return await readCommand(name, rest, io);
  } catch (error) {
    if (error instanceof Misuse) {
      io.stderr(`${error.message}\n\n${HELP[name]}`);
      return EXIT_USAGE;
    }
    if (error instanceof ReaderInputError) {
      io.stderr(`${error.message}\n`);
      return EXIT_USAGE;
    }
    if (error instanceof Missing) {
      io.stderr(`${error.message}\n`);
      return EXIT_MISSING;
    }
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
    ) {
      io.stderr(`${error.message}\n\n${HELP[name]}`);
      return EXIT_USAGE;
    }
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILURE;
  }
}

async function checkCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: { help: { type: "boolean", short: "h" } },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.check);
    return 0;
  }
  const [directory, ...rest] = parsed.positionals;
  if (rest.length > 0) {
    throw new Misuse("check takes one directory at most.");
  }
  const limits = readIndexLimits(io.environment);
  if (!limits.ok) {
    io.stderr(
      `invalid configuration:\n${limits.error.map((problem) => `  - ${problem.variable}: ${problem.rule}\n`).join("")}`,
    );
    return EXIT_CONFIG;
  }
  return await checkDirectory({
    directory: resolve(io.cwd ?? ".", directory ?? "."),
    limits: limits.value,
    write: io.stdout,
  });
}
