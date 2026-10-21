import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import { ApiError, createClient, type FetchLike } from "@skillcdn/client";
import {
  type Address,
  BROWSE_DEFAULT_LIMIT,
  BROWSE_MAX_LIMIT,
  browseResultOf,
  type Clock,
  catalogStateOf,
  directoryResultOf,
  FIND_DEFAULT_LIMIT,
  FIND_MAX_LIMIT,
  type FindItem,
  type FindResult,
  fileResultOf,
  findResultOf,
  formatAddress,
  type IndexLimits,
  isGitHostAddress,
  joinSkillPages,
  type MountSummary,
  mountSummaryOf,
  parseAddress,
  parseSkillUri,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LIMIT,
  type RestConnectClaimed,
  type RestConnectStarted,
  renderBrowseResult,
  renderDiagnostics,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderInstructions,
  renderSkillResult,
  type SkillResult,
  skillOutcome,
  skillResultOf,
  type ToolWords,
} from "@skillcdn/core";
import { checkDirectory, readIndexLimits } from "@skillcdn/indexer";
import { ReaderInputError } from "@skillcdn/reader";
import { createLocalApp, listenOn, type ServeLogger, serveOverStdio } from "@skillcdn/serve";
import {
  type CredentialStore,
  createMemoryStore,
  EMPTY_CREDENTIALS,
  loginAt,
  originOf,
  repositoryOf,
  withLogin,
  withoutLogin,
} from "./credentials.js";
import { createMemoryDirectoryStore, DIRECTORY_FILE, type DirectoryStore } from "./directory.js";
import {
  type LocalMount,
  localAddress,
  localReader,
  type MountedDirectory,
  mountDirectory,
  openDirectory,
  watchDirectory,
} from "./local.js";
import { type Pack, PackError } from "./pack.js";
import { openDeployment } from "./remote.js";

/** What the command reads and writes, handed in so that a test runs it without a process. */
export interface CliIo {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Where a relative directory is resolved from; the process's directory when left out. */
  readonly cwd?: string | undefined;
  /** How a deployment is reached; the platform's `fetch` when left out. */
  readonly fetch?: FetchLike | undefined;
  /** All of standard input, for a token given to `login`. */
  readonly readStdin?: (() => Promise<string>) | undefined;
  /** Where the logins are kept; nowhere, for this run only, when left out. */
  readonly store?: CredentialStore | undefined;
  /** What the working directory says of the pack it reads; nothing, when left out. */
  readonly directory?: DirectoryStore | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => Date) | undefined;
  /** What the command calls itself to a deployment. */
  readonly userAgent?: string | undefined;
  /**
   * What the command calls itself to a person, when it asks to connect: the agent it runs
   * under and the machine, as `Claude Code on a laptop`. "An agent" when left out.
   */
  readonly agentName?: string | undefined;
  /**
   * Keeps a server running until the person stops it, and resolves then. Left out, `serve`
   * returns as soon as it is serving, and `mcp` when the client closes its end.
   */
  readonly hold?: (() => Promise<void>) | undefined;
  /** The process's standard input and output, which `mcp` speaks the protocol over. */
  readonly streams?: { readonly stdin: Readable; readonly stdout: Writable } | undefined;
}

// Exit codes, as the server's roles use them: 64 for a usage error, 78 for configuration that
// cannot be read, 70 for an internal failure. `check` itself answers 0, 1 or 2; a read answers
// 1 for what the pack does not have or refuses, and 2 for a pack that cannot be read at all.
export const EXIT_MISSING = 1;
export const EXIT_UNREADABLE = 2;
export const EXIT_USAGE = 64;
export const EXIT_FAILURE = 70;
export const EXIT_CONFIG = 78;

/** Where a pack is read when nothing says otherwise. */
export const DEFAULT_ORIGIN = "https://skillcdn.ai";

/** Where `serve` listens when nothing says otherwise: this machine alone. */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 11189;

/** How the results name the reads, so that an agent is told the command and not a tool. */
export const COMMAND_WORDS: ToolWords = {
  browse: "skillcdn browse",
  search: "skillcdn find",
  load: "skillcdn skill",
  read: "skillcdn file",
};

const COMMANDS = [
  "check",
  "skills",
  "browse",
  "find",
  "skill",
  "file",
  "mcp",
  "serve",
  "login",
  "logout",
  "logins",
  "use",
  "status",
] as const;
type Command = (typeof COMMANDS)[number];

/**
 * The sentence a checkout's agreement carries (CLAUDE.md, AGENTS.md), so that the agents working
 * in it read the pack it is bound to before they start: what `use` prints, and what the guide says.
 */
export const AGREEMENT_SENTENCE =
  "**Bound to a pack?** When .skillcdn.json is in this checkout, or `skillcdn status` names a pack, read its skills with `skillcdn skills` before you start, and load the one a task calls for (`skillcdn help` says how).";

/** What `use` says after binding: how the agents that work here learn of it. */
const HAND_OVER = `Tell the agents that work here, in the checkout's agreement (CLAUDE.md or AGENTS.md), in one sentence:

  ${AGREEMENT_SENTENCE}
`;

const isCommand = (name: string): name is Command => (COMMANDS as readonly string[]).includes(name);

export const USAGE = `usage: skillcdn <command> [arguments]

Reads a pack as SkillCDN serves one: a directory on this machine in the SkillCDN Format (a git
checkout or any folder of skills, documents and rules), or a pack at a deployment, by its
address. Nothing in a directory is executed.

Commands:
  check [<directory>]              Report what an agent would get from the directory, before pushing.
  skills [<pack>]                  What a client is told on connect, then every skill and document.
  browse [<pack>] [<folder>]       What a folder holds, as browse_repo lists it.
  find [<pack>] <words...>         What the words find, as search_repo does.
  skill [<pack>] <path>            A skill whole, as load_skill assembles it: rules, instructions, included files.
  file [<pack>] <path>             A page of a file, as read_repo_file reads it, or what a folder holds.
  mcp <directory>                  Serve the directory to the MCP client that started the command.
  serve <directory>...             Serve directories over HTTP on this machine: MCP and the REST API.
  login --url <origin> [<address>] Connect to a deployment with a code a person approves; the token is kept, never shown.
  logout --url <origin> [<address>] Forget the tokens kept for a deployment, or the one for a repository.
  logins                           The deployments and repositories a token is kept for.
  use <address>|<directory>        Bind this directory to a pack, at a deployment or on this machine: reads here need no <pack>.
  status                           What this directory reads, and whether a token is kept for it.
  help [<command>]                 This, or one command in full.

A <pack> is a directory, or an address: gh/<owner>/<repo>[@<ref>][/<path>], the URL of a pack
at a deployment, or a skill:// URI. Left out, the pack this directory is bound to (${DIRECTORY_FILE}).
An address is read at --url, else SKILLCDN_URL, else the deployment the directory is bound to,
else ${DEFAULT_ORIGIN}, with the token kept for that deployment and the repository read, or
SKILLCDN_TOKEN beside SKILLCDN_URL. Paths start at the pack's root, as marketing/ads/SKILL.md.
Every read answers the words an MCP client's model is given, or the JSON of the REST API with --json.

Exit codes: 0 done; 1 the pack does not have it, or refuses it; 2 the pack cannot be read, the
directory or the deployment; 64 a usage error; 78 a limit variable that cannot be read; 70 a failure.

Options:
  -h, --help     Print this help.
  -v, --version  Print the version.
`;

const READ_OPTIONS = `  --url <origin>  The deployment an address is read at.
  --as <address>  Address a directory as local/<owner>/<name> instead of its parent's and its own name.
  --json          Print the JSON the REST API answers instead of the words a model is given.`;

const HELP: Readonly<Record<Command, string>> = {
  check: `usage: skillcdn check [<directory>]

Reads a directory as SkillCDN would index it and prints what an agent would get: the manifest,
the license, every skill with its files and warnings, the documents, what is not served, the
index diagnostics, and what a client is told on connect. Nothing in the directory is executed.

Exit codes: 0 when there are no index diagnostics, 1 when there are, 2 when the directory cannot
be read. The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.
`,
  skills: `usage: skillcdn skills [<pack>] [--url <origin>] [--as <address>] [--json]

What a client is told when it connects to the pack, within its 2,000 characters, then every
skill and every document outside the skills, as a search without words lists them: each skill
with its SKILL.md path, which skillcdn skill takes.

${READ_OPTIONS}
`,
  browse: `usage: skillcdn browse [<pack>] [<folder>] [--cursor <cursor>] [--limit <n>] [--url <origin>] [--as <address>] [--json]

What a folder holds, as browse_repo lists it: its skills, its folders with what each holds and
the README that introduces it, and its files, with the canonical path of each. The pack's root
when no folder is given. A page of ${BROWSE_DEFAULT_LIMIT} entries unless --limit says otherwise (up to
${BROWSE_MAX_LIMIT}); a page that ends before the folder does names its nextCursor, which --cursor continues.

${READ_OPTIONS}
`,
  find: `usage: skillcdn find [<pack>] <words...> [--path <folder>] [--cursor <cursor>] [--limit <n>] [--url <origin>] [--as <address>] [--json]

What the words find, as search_repo does: words are matched, not meaning, in the language the
pack is written in, usually English; a skill comes with the files of it that matched, in order of
relevance, and skills outrank documents. --path keeps the search to a folder. A page of ${FIND_DEFAULT_LIMIT}
results unless --limit says otherwise (up to ${FIND_MAX_LIMIT}); a page that ends before the results do
names its nextCursor, which --cursor continues.

${READ_OPTIONS}
`,
  skill: `usage: skillcdn skill [<pack>] <path> [--url <origin>] [--as <address>] [--json]

One skill whole, as load_skill assembles it: the rules of every SKILLCDN.md from the pack's root
to the skill's own folder, then its instructions, then the files it includes on every run, each
under a line that names its path; then the files it has and what it refers to. <path> is the
path of its SKILL.md from the pack's root, as skills and browse print it, or the skill://
URI the pack names it by, which then names the pack as well. The pages the skill is read in are
joined: what is printed is complete unless it says otherwise.

${READ_OPTIONS}
`,
  file: `usage: skillcdn file [<pack>] <path> [--offset <n>] [--limit <n>] [--url <origin>] [--as <address>] [--json]

A page of a file, as read_repo_file reads it: the text as written, from character --offset,
${READ_FILE_DEFAULT_LIMIT} characters unless --limit says otherwise (up to ${READ_FILE_MAX_LIMIT}); a page that ends before
the file does says where the next begins. A path that names a folder answers what the folder
holds. A file over the read limit, one that is not text, and one a license keeps at its source
are named with where to read them instead.

${READ_OPTIONS}
`,
  mcp: `usage: skillcdn mcp <directory> [--as <address>]

Serves the directory to the MCP client at the other end of standard input and output: the
client that started the command, configured with a stdio server whose command is
skillcdn mcp <directory>. The client gets what it would get from a deployment that served the
directory as a pack: the four tools, the use_skill prompt and the skills extension, with the
directory addressed as local/<owner>/<name> after its parent's name and its own, or as --as
says. The directory is read again when its files change, so the next read serves what they
hold now. The directory is verified: its content is served in full under its license. Nothing
in it is executed. Standard output carries the protocol alone; what the command has to say
goes to standard error.

The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.
`,
  serve: `usage: skillcdn serve <directory>... [--port <port>] [--host <host>] [--as <address>]

Serves directories over HTTP on this machine, each as a deployment serves a pack: an MCP server
at http://<host>:<port>/local/<owner>/<name>, which any MCP client connects to over HTTP, and
the REST API of the address under /api/v1/. A directory is addressed after its parent's name
and its own, or as --as says when one directory is served. The directories are read again when
their files change. Nothing in them is executed. Listens on ${DEFAULT_HOST} at port ${DEFAULT_PORT} unless
--host and --port say otherwise; --port 0 takes any free port. Whoever reaches the port reads
everything served, since nothing signs anyone in: keep it on this machine, or on a network of
your own. Runs until stopped (Ctrl+C).

The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.
`,
  login: `usage: skillcdn login --url <origin> [<address>] [--agent <name>]
       skillcdn login --url <origin> [<address>] --token-stdin

Connects this command to a deployment for one repository, the address given or the pack this
directory is bound to, with a code a person approves: the command prints the deployment's page
for the code and the code; a person opens the page signed in, checks that it shows the same
code, names the token and says how long it is good for, and approves; the command then receives
a repository token of its own and keeps it, never showing it. An agent running the command
relays the page and the code to its person and waits. The code is good for ten minutes.
--agent says what the command calls itself on that page; left out, the agent it runs under
where its environment says so (Claude Code, Codex, Gemini CLI), else An agent, and the
machine's name.

--token-stdin keeps a token made by hand instead, read from standard input and never from an
argument: a repository token from an account page, for the repository given, or an access token
an app received, for every repository there when none is given. At a terminal the token is
asked for and not echoed; a job pipes it in. For one run, SKILLCDN_URL and SKILLCDN_TOKEN
together do the same.

A token is kept in the person's configuration directory, readable by them alone where the
system can say so, one per deployment and repository; a second login for the same replaces the
first. It goes to the deployment it was kept for and nowhere else.
`,
  logout: `usage: skillcdn logout --url <origin> [<address>]

Forgets the tokens kept for a deployment, or the one kept there for the repository given. The
token itself is ended on the person's account page.
`,
  logins: `usage: skillcdn logins

The deployments and repositories a token is kept for, and since when; never the tokens.
`,
  use: `usage: skillcdn use <address> [--url <origin>]
       skillcdn use <directory> [--as local/<owner>/<name>]

Binds the working directory to a pack: writes ${DIRECTORY_FILE} with the pack's address and, with
--url, the deployment it is read at; or, for a directory on this machine, the directory as a
path relative to the file, read with no deployment and no token. A read here or in a directory
below then needs no <pack>. Meant to be committed: everyone who works in the checkout, and every
agent they run in it, reads the same pack. It names no token and nothing secret. Afterwards the
command prints the sentence to put in the checkout's agreement (CLAUDE.md or AGENTS.md), so
that the agents working here read the pack before they start.
`,
  status: `usage: skillcdn status

What this directory reads, without reading anything: the pack it is bound to and where it is
read, a directory on this machine or a deployment; whether a token is kept for that; and this
command's version. For an agent that meets a checkout: run this first, then skillcdn skills.
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

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  as: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean" },
  cursor: { type: "string" },
  limit: { type: "string" },
  offset: { type: "string" },
  path: { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  "token-stdin": { type: "boolean" },
  agent: { type: "string" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>["values"];

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

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolved) => setTimeout(resolved, ms));

/** The limits a deployment would apply, from the environment. */
function limitsOf(io: CliIo): IndexLimits {
  const limits = readIndexLimits(io.environment);
  if (!limits.ok) {
    throw new ConfigurationError(limits.error);
  }
  return limits.value;
}

/** What the command was given to find the pack by, read into where the pack is. */
interface PackSpec {
  readonly kind: "directory" | "address";
  readonly directory?: string;
  /** The address a bound directory is read as, which the binding wrote. */
  readonly as?: string;
  readonly address?: Address;
  /** A deployment the spec names itself: the origin of a URL. */
  readonly url?: string;
  /** A skill the spec names itself: the path a `skill://` URI carries. */
  readonly skillPath?: string;
}

/**
 * Reads what was given for the pack: a directory that exists, else a `skill://` URI, a URL at a
 * deployment, or an address.
 */
/** Whether what was given is written as a place on this machine rather than an address. */
const looksLikePath = (given: string): boolean =>
  given.startsWith(".") ||
  given.startsWith("~") ||
  given.includes("\\") ||
  /^[a-z]:[\\/]/i.test(given) ||
  (given.startsWith("/") && !parseAddress(given).ok);

async function packSpecOf(given: string, io: CliIo): Promise<PackSpec> {
  const directory = resolve(io.cwd ?? ".", given);
  const info = await stat(directory).catch(() => undefined);
  if (info?.isDirectory()) {
    return { kind: "directory", directory };
  }
  if (looksLikePath(given)) {
    throw new Unreadable(`${given}: not a directory that can be read`, EXIT_UNREADABLE);
  }
  if (given.startsWith("skill://")) {
    const uri = parseSkillUri(given);
    if (uri === undefined) {
      throw new Misuse(`Not a skill URI: ${given}.`);
    }
    return {
      kind: "address",
      address: { ...uri.address, ref: undefined, path: "" as Address["path"] },
      skillPath: uri.path,
    };
  }
  if (/^https?:\/\//i.test(given)) {
    const url = originOf(given);
    let pathname: string;
    try {
      pathname = new URL(given).pathname;
    } catch {
      pathname = "";
    }
    const parsed = parseAddress(pathname);
    if (url === undefined || !parsed.ok) {
      throw new Misuse(
        `Not the URL of a pack at a deployment: ${given}${parsed.ok ? "" : ` (${parsed.error.message})`}.`,
      );
    }
    return { kind: "address", address: parsed.value, url };
  }
  const parsed = parseAddress(given.startsWith("/") ? given : `/${given}`);
  if (!parsed.ok) {
    if (/^[a-z0-9]/i.test(given) && !given.includes("/")) {
      throw new Misuse(
        `${given} is neither a directory here nor an address: an address is written gh/<owner>/<repo>.`,
      );
    }
    throw new Misuse(`Not a directory here, and not an address: ${parsed.error.message}.`);
  }
  return { kind: "address", address: parsed.value };
}

/**
 * Where an address is read, and with what: the origin first, then the token kept for that origin
 * and the repository read, else for that origin alone, never anything kept for another.
 */
async function deploymentOf(
  io: CliIo,
  flagUrl: string | undefined,
  specUrl: string | undefined,
  boundUrl: string | undefined,
  address: Address,
): Promise<{ readonly url: string; readonly token: string | undefined }> {
  const envUrl = io.environment.SKILLCDN_URL;
  const envToken = io.environment.SKILLCDN_TOKEN;
  if ((envUrl === undefined) !== (envToken === undefined)) {
    throw new Misuse(
      "SKILLCDN_URL and SKILLCDN_TOKEN are taken together or not at all: set both, or neither.",
    );
  }
  const written = flagUrl ?? specUrl ?? envUrl ?? boundUrl ?? DEFAULT_ORIGIN;
  const url = originOf(written);
  if (url === undefined) {
    throw new Misuse(
      `Not the origin of a deployment: ${written}. An origin is https://<host>, or http://localhost for this machine.`,
    );
  }
  if (envUrl !== undefined && envToken !== undefined && originOf(envUrl) === url) {
    return { url, token: envToken.trim() };
  }
  const credentials = (await io.store?.load()) ?? EMPTY_CREDENTIALS;
  return {
    url,
    token: loginAt(credentials, url, isGitHostAddress(address) ? repositoryOf(address) : undefined)
      ?.token,
  };
}

/** The pack a read command was given, opened. */
async function openPack(
  given: string | undefined,
  values: Values,
  io: CliIo,
): Promise<{ readonly pack: Pack; readonly skillPath: string | undefined }> {
  const limits = limitsOf(io);
  const bound = given === undefined ? await io.directory?.load() : undefined;
  let spec: PackSpec;
  if (given !== undefined) {
    spec = await packSpecOf(given, io);
  } else if (bound?.directory !== undefined) {
    // Bound to a directory on this machine: read as the binding named it, with no deployment.
    spec = {
      kind: "directory",
      directory: resolve(io.cwd ?? ".", bound.directory),
      as: bound.pack,
    };
  } else if (bound !== undefined) {
    const parsed = parseAddress(bound.pack);
    if (!parsed.ok) {
      throw new Misuse(`${DIRECTORY_FILE} names a pack that is not an address.`);
    }
    spec = { kind: "address", address: parsed.value };
  } else {
    throw new Misuse(
      `Say which pack: a directory, or an address such as gh/<owner>/<repo>; or bind this directory to one with skillcdn use <address>.`,
    );
  }
  if (spec.kind === "directory" && spec.directory !== undefined) {
    const opened = await openDirectory({
      directory: spec.directory,
      as: values.as ?? spec.as,
      limits,
    });
    if ("error" in opened) {
      throw new Unreadable(opened.error, opened.exit);
    }
    return { pack: opened, skillPath: undefined };
  }
  if (spec.address === undefined) {
    throw new Error("an address spec has an address");
  }
  if (values.as !== undefined) {
    throw new Misuse("--as names a directory; a pack at a deployment has its address.");
  }
  const deployment = await deploymentOf(io, values.url, spec.url, bound?.url, spec.address);
  const pack = openDeployment({
    url: deployment.url,
    address: spec.address,
    token: deployment.token,
    fetch: io.fetch ?? ((input, init) => fetch(input, init)),
    userAgent: io.userAgent,
    sleep: io.sleep ?? defaultSleep,
  });
  return { pack, skillPath: spec.skillPath };
}

class ConfigurationError extends Error {
  readonly problems: readonly { readonly variable: string; readonly rule: string }[];
  constructor(problems: readonly { readonly variable: string; readonly rule: string }[]) {
    super("invalid configuration");
    this.problems = problems;
  }
}

class Unreadable extends Error {
  readonly exit: number;
  constructor(message: string, exit: number) {
    super(message);
    this.exit = exit;
  }
}

/** Every skill and document the pack lists, page after page, as one listing. */
async function listing(pack: Pack, summary: MountSummary): Promise<FindResult> {
  const items: FindItem[] = [];
  let first: FindResult | undefined;
  let cursor: string | undefined;
  for (;;) {
    const body = await pack.find({ cursor, limit: FIND_MAX_LIMIT });
    if (body.status !== "ready") {
      throw new PackError(503, `index.${body.status}`, "The pack is not ready to read.");
    }
    const result = findResultOf(body, summary);
    first ??= result;
    items.push(...result.items);
    cursor = result.nextCursor;
    if (cursor === undefined) {
      return { ...first, items, nextCursor: undefined };
    }
  }
}

/**
 * What the tool says when a skill is not at a path: the exact paths that are, and the
 * manifests that could not be read, since the skill asked for may be among them.
 */
async function notFound(pack: Pack, summary: MountSummary, path: string): Promise<PackError> {
  let available: string[] = [];
  let diagnostics = "";
  try {
    const listed = await listing(pack, summary);
    available = listed.items.flatMap((item) =>
      item.kind === "skill" && item.path !== undefined ? [item.path] : [],
    );
    diagnostics = renderDiagnostics(listed.diagnostics, true, undefined, COMMAND_WORDS) ?? "";
  } catch {
    // The list is a courtesy: the refusal stands without it.
  }
  return new PackError(
    404,
    "skill.not_found",
    `No skill at ${JSON.stringify(path)}. Use ${COMMAND_WORDS.browse} or ${COMMAND_WORDS.search} for its exact SKILL.md path.${available.length === 0 ? "" : ` Available: ${available.slice(0, 20).join(", ")}.`}${diagnostics.length === 0 ? "" : `\n${diagnostics}`}`,
  );
}

/** One skill whole: every page of its context, joined. */
async function wholeSkill(pack: Pack, summary: MountSummary, path: string): Promise<SkillResult> {
  const pages: SkillResult[] = [];
  let cursor: string | undefined;
  for (;;) {
    const body = await pack.skill(path, cursor).catch(async (error: unknown) => {
      if (error instanceof PackError && error.code === "skill.not_found") {
        throw await notFound(pack, summary, path);
      }
      throw error;
    });
    if (body.status !== "ready") {
      throw new PackError(503, `index.${body.status}`, "The pack is not ready to read.");
    }
    const page = skillResultOf(body, summary);
    if (page === undefined) {
      throw new PackError(
        0,
        "invalid_response",
        "The pack answered a skill in an unexpected shape.",
      );
    }
    pages.push(page);
    cursor = page.nextCursor;
    if (page.complete || cursor === undefined) {
      const whole = joinSkillPages(pages);
      if (whole === undefined) {
        throw new Error("a skill has at least one page");
      }
      return whole;
    }
  }
}

/** The path a skill is asked for by: its SKILL.md path, or the URI the pack names it by. */
function skillPathOf(pack: Pack, given: string): string {
  const uri = parseSkillUri(given);
  if (uri === undefined) {
    if (given.startsWith("skill://")) {
      throw new Misuse(
        `Not a skill URI: ${given}. Say the path of its SKILL.md from the pack's root.`,
      );
    }
    return given;
  }
  const { address } = pack;
  if (
    uri.address.host !== address.host ||
    uri.address.owner !== address.owner ||
    uri.address.repo !== address.repo
  ) {
    throw new PackError(
      404,
      "skill.not_found",
      `That URI names another pack, ${uri.address.host}/${uri.address.owner}/${uri.address.repo}; this one is ${address.host}/${address.owner}/${address.repo}.`,
    );
  }
  return uri.path;
}

type ReadCommand = "skills" | "browse" | "find" | "skill" | "file";

async function readCommand(
  command: ReadCommand,
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
  const positionals = [...parsed.positionals];
  // The pack comes first when one is given: a directory, a URI, a URL or an address, or
  // anything at all for skills, which takes nothing else. What else is given is the command's
  // own argument; without a pack, the directory's binding is the pack.
  const first = positionals[0];
  const firstIsPack =
    first !== undefined &&
    (command === "skills" ||
      first.startsWith("skill://") ||
      /^https?:\/\//i.test(first) ||
      looksLikePath(first) ||
      parseAddress(first.startsWith("/") ? first : `/${first}`).ok ||
      ((await stat(resolve(io.cwd ?? ".", first)).catch(() => undefined))?.isDirectory() ?? false));
  const given = firstIsPack ? positionals.shift() : undefined;
  const { pack, skillPath } = await openPack(given, parsed.values, io);
  const json = parsed.values.json === true;
  const print = (text: string): void => {
    io.stdout(`${text}\n`);
  };
  const printJson = (value: unknown): void => {
    io.stdout(`${JSON.stringify(value, null, 2)}\n`);
  };
  const mount = await pack.mount();
  const summary = mountSummaryOf(mount);

  switch (command) {
    case "skills": {
      if (positionals.length > 0) {
        throw new Misuse("skills takes the pack and nothing else.");
      }
      if (json) {
        printJson(mount);
        return 0;
      }
      print(
        `${renderInstructions(catalogStateOf(mount), COMMAND_WORDS)}\n\n${renderFindResult(await listing(pack, summary), COMMAND_WORDS)}`,
      );
      return 0;
    }
    case "browse": {
      const [folder, ...more] = positionals;
      if (more.length > 0) {
        throw new Misuse("browse takes the pack and at most one folder.");
      }
      const body = await pack.browse({
        path: folder,
        cursor: parsed.values.cursor,
        limit: count(parsed.values.limit, "limit", BROWSE_MAX_LIMIT),
      });
      if (body.status !== "ready") {
        throw new PackError(503, `index.${body.status}`, "The pack is not ready to read.");
      }
      if (json) {
        printJson(body);
        return 0;
      }
      const result = browseResultOf(body, summary);
      if (result === undefined) {
        throw new PackError(
          0,
          "invalid_response",
          "The pack answered a folder in an unexpected shape.",
        );
      }
      print(renderBrowseResult(result, COMMAND_WORDS));
      return 0;
    }
    case "find": {
      const query = positionals.join(" ").trim();
      if (query.length === 0) {
        throw new Misuse("Say the words to find.");
      }
      const body = await pack.find({
        query,
        path: parsed.values.path,
        cursor: parsed.values.cursor,
        limit: count(parsed.values.limit, "limit", FIND_MAX_LIMIT),
      });
      if (body.status !== "ready") {
        throw new PackError(503, `index.${body.status}`, "The pack is not ready to read.");
      }
      if (json) {
        printJson(body);
        return 0;
      }
      print(renderFindResult(findResultOf(body, summary), COMMAND_WORDS));
      return 0;
    }
    case "skill": {
      const [given, ...more] = positionals;
      if (more.length > 0 || (given === undefined && skillPath === undefined)) {
        throw new Misuse("Say which skill: the path of its SKILL.md from the pack's root.");
      }
      if (given !== undefined && skillPath !== undefined) {
        throw new Misuse("The URI names the skill already; say one or the other.");
      }
      const path = skillPath ?? skillPathOf(pack, given ?? "");
      const whole = await wholeSkill(pack, summary, path);
      if (json) {
        const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill: whole } });
        printJson("body" in outcome ? outcome.body : outcome.failure);
      } else {
        print(renderSkillResult(whole, COMMAND_WORDS));
      }
      return 0;
    }
    case "file": {
      const [path, ...more] = positionals;
      if (path === undefined || more.length > 0) {
        throw new Misuse("Say which file: its path from the pack's root.");
      }
      const limit = count(parsed.values.limit, "limit", READ_FILE_MAX_LIMIT);
      const body = await pack.file({
        path,
        offset: count(parsed.values.offset, "offset", Number.MAX_SAFE_INTEGER),
        limit,
      });
      if (json) {
        printJson(body);
        return 0;
      }
      if (body.kind === "directory") {
        const result = directoryResultOf(body, summary);
        if (result === undefined) {
          throw new PackError(
            0,
            "invalid_response",
            "The pack answered a folder in an unexpected shape.",
          );
        }
        print(renderDirectoryResult(result));
        return 0;
      }
      const result = fileResultOf(body, summary);
      if (result === undefined) {
        throw new PackError(
          0,
          "invalid_response",
          "The pack answered a file in an unexpected shape.",
        );
      }
      // The length asked for travels with the result, so that a range the command got in full
      // says where the file continues, as a tool result does; the body itself does not carry it.
      print(renderFileResult({ ...result, requestedLength: limit }, COMMAND_WORDS));
      return 0;
    }
  }
}

/** How many claims a login makes before it gives up, whatever the clock says: a code's lifetime and some. */
const MAX_CLAIMS = 240;

/**
 * The repository a `login` is about: the address given, else the pack this directory is bound
 * to at a deployment; nothing for a directory bound to a pack on this machine, or to none.
 */
async function repositoryFor(given: string | undefined, io: CliIo): Promise<string | undefined> {
  if (given !== undefined) {
    const address = parseAddress(given.startsWith("/") ? given : `/${given}`);
    if (!address.ok || !isGitHostAddress(address.value)) {
      throw new Misuse(
        `Not the address of a repository at a deployment: ${given}. Say gh/<owner>/<repo>.`,
      );
    }
    return repositoryOf(address.value);
  }
  const bound = await io.directory?.load();
  if (bound === undefined || bound.directory !== undefined) {
    return undefined;
  }
  const address = parseAddress(bound.pack);
  return address.ok && isGitHostAddress(address.value) ? repositoryOf(address.value) : undefined;
}

/** What the deployment refused, in the words the command says such things in. */
const refused = (error: unknown): never => {
  if (error instanceof ApiError) {
    throw new PackError(error.status, error.code, error.message);
  }
  throw error;
};

async function loginCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.login);
    return 0;
  }
  const url = parsed.values.url === undefined ? undefined : originOf(parsed.values.url);
  if (url === undefined) {
    throw new Misuse("Say which deployment: --url https://<host>.");
  }
  const [given, ...more] = parsed.positionals;
  if (more.length > 0) {
    throw new Misuse("login takes one repository at most.");
  }
  const repository = await repositoryFor(given, io);
  const store = io.store ?? createMemoryStore();
  const now = (): Date => io.now?.() ?? new Date();
  const keep = async (token: string): Promise<string> => {
    const credentials = (await store.load()) ?? EMPTY_CREDENTIALS;
    return store.save(
      withLogin(credentials, { url, repository, token, since: now().toISOString() }),
    );
  };

  if (parsed.values["token-stdin"] === true) {
    if (io.readStdin === undefined) {
      throw new Misuse("Standard input is not available here.");
    }
    const token = (await io.readStdin()).trim();
    if (token.length === 0 || token.length > 1024 || /\s/.test(token)) {
      throw new Misuse("A token is one line of up to 1024 characters, with no whitespace.");
    }
    const path = await keep(token);
    io.stdout(
      `A token is kept for ${repository ?? "every repository"} at ${url}, in ${path}. Reads there present it.\n`,
    );
    return 0;
  }

  if (repository === undefined) {
    throw new Misuse(
      "Say which repository to connect to: skillcdn login --url <origin> gh/<owner>/<repo>, or bind this directory to one with skillcdn use first. A token made by hand is read with --token-stdin.",
    );
  }
  const client = createClient({
    baseUrl: url,
    fetch: io.fetch ?? ((input, init) => fetch(input, init)),
    userAgent: io.userAgent,
  });
  let started: RestConnectStarted;
  try {
    started = await client.connect({
      address: repository,
      agent: parsed.values.agent ?? io.agentName ?? "An agent",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new PackError(
        404,
        "connect.unavailable",
        `${url} connects no command: nobody signs in there, so every pack it serves is public and needs no token; or it runs a version without this. A token made on an account page is read with --token-stdin.`,
      );
    }
    return refused(error);
  }
  io.stdout(
    `To connect, open ${started.url} signed in, check that the page shows the code ${started.code}, and approve. An agent running this command relays the page and the code to its person.\nWaiting for the approval, until ${started.expiresAt}.\n`,
  );
  const sleep = io.sleep ?? defaultSleep;
  const notApproved = (): PackError =>
    new PackError(
      404,
      "connect.not_found",
      "The connection was not approved in time, or the person said it was not theirs. Run skillcdn login again for a new code.",
    );
  for (let claims = 0; claims < MAX_CLAIMS; claims += 1) {
    await sleep(started.intervalSeconds * 1000);
    let claimed: RestConnectClaimed;
    try {
      claimed = await client.claimConnection(started.secret);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 0 || error.status >= 500) &&
        now().getTime() < Date.parse(started.expiresAt)
      ) {
        // The deployment, or the git host behind it, will answer later; the approval waits.
        continue;
      }
      if (error instanceof ApiError && error.code === "connect.not_found") {
        throw notApproved();
      }
      return refused(error);
    }
    if (claimed.status === "pending") {
      continue;
    }
    const path = await keep(claimed.token);
    io.stdout(
      `Connected: a token for ${repository} at ${url} is kept in ${path}, listed on the account page as ${JSON.stringify(claimed.item.label)} ${claimed.item.expiresAt === null ? "with no end" : `until ${claimed.item.expiresAt.slice(0, 10)}`}. Reads of ${repository} there present it; the person ends it on their account page.\n`,
    );
    return 0;
  }
  throw notApproved();
}

async function logoutCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.logout);
    return 0;
  }
  const url = parsed.values.url === undefined ? undefined : originOf(parsed.values.url);
  if (url === undefined) {
    throw new Misuse("Say which deployment: --url https://<host>.");
  }
  const [given, ...more] = parsed.positionals;
  if (more.length > 0) {
    throw new Misuse("logout takes one repository at most.");
  }
  const repository = given === undefined ? undefined : await repositoryFor(given, io);
  const store = io.store ?? createMemoryStore();
  const credentials = (await store.load()) ?? EMPTY_CREDENTIALS;
  const where = repository === undefined ? url : `${repository} at ${url}`;
  const kept = credentials.logins.filter(
    (login) => login.url === url && (repository === undefined || login.repository === repository),
  );
  if (kept.length === 0) {
    io.stdout(`No token is kept for ${where}.\n`);
    return 0;
  }
  await store.save(withoutLogin(credentials, url, repository));
  io.stdout(
    `${kept.length === 1 ? "The token" : `The ${kept.length} tokens`} kept for ${where} ${kept.length === 1 ? "is" : "are"} forgotten here; end ${kept.length === 1 ? "it" : "them"} on the account page as well.\n`,
  );
  return 0;
}

async function loginsCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: false,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.logins);
    return 0;
  }
  const credentials = (await (io.store ?? createMemoryStore()).load()) ?? EMPTY_CREDENTIALS;
  if (credentials.logins.length === 0) {
    io.stdout("No token is kept for any deployment.\n");
    return 0;
  }
  for (const login of credentials.logins) {
    io.stdout(
      `${login.url}  ${login.repository ?? "every repository"}${login.since === undefined ? "" : `  since ${login.since}`}\n`,
    );
  }
  return 0;
}

async function useCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.use);
    return 0;
  }
  const [given, ...more] = parsed.positionals;
  if (given === undefined || more.length > 0) {
    throw new Misuse(
      "Say which pack: its address, as gh/<owner>/<repo>, or a directory on this machine.",
    );
  }
  const store = io.directory ?? createMemoryDirectoryStore();
  const cwd = resolve(io.cwd ?? ".");
  const root = resolve(cwd, given);
  const info = await stat(root).catch(() => undefined);
  if (info?.isDirectory() === true || looksLikePath(given)) {
    if (info?.isDirectory() !== true) {
      throw new Unreadable(`${given}: not a directory that can be read`, EXIT_UNREADABLE);
    }
    if (parsed.values.url !== undefined) {
      throw new Misuse(
        "A directory on this machine is read with no deployment; --url names where an address is read.",
      );
    }
    const local = localAddress(root, parsed.values.as);
    if ("error" in local) {
      throw new Misuse(local.error);
    }
    // Relative to the file and with forward slashes, so that the checkout carries it anywhere.
    const written = relative(cwd, root).split("\\").join("/") || ".";
    const path = await store.save({ pack: formatAddress(local.address), directory: written });
    io.stdout(
      `This directory reads ${formatAddress(local.address)} from ${written === "." ? "itself" : written}, on this machine: ${path}.\n\n${HAND_OVER}`,
    );
    return 0;
  }
  if (parsed.values.as !== undefined) {
    throw new Misuse("--as names a directory; a pack at a deployment has its address.");
  }
  const address = parseAddress(given.startsWith("/") ? given : `/${given}`);
  if (!address.ok) {
    throw new Misuse(`Not an address: ${address.error.message}.`);
  }
  if (!isGitHostAddress(address.value)) {
    throw new Misuse(
      "A directory is bound to a pack at a deployment by an address such as gh/<owner>/<repo>, or to a directory on this machine by its path.",
    );
  }
  const url = parsed.values.url === undefined ? undefined : originOf(parsed.values.url);
  if (parsed.values.url !== undefined && url === undefined) {
    throw new Misuse(`Not the origin of a deployment: ${parsed.values.url}.`);
  }
  const path = await store.save({ pack: formatAddress(address.value), url });
  io.stdout(
    `This directory reads ${formatAddress(address.value)}${url === undefined ? "" : ` at ${url}`}: ${path}.\n\n${HAND_OVER}`,
  );
  return 0;
}

async function statusCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: false,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.status);
    return 0;
  }
  const bound = await io.directory?.load();
  const credentials = (await (io.store ?? createMemoryStore()).load()) ?? EMPTY_CREDENTIALS;
  const lines: string[] = [];
  if (bound === undefined) {
    lines.push(
      `This directory is bound to no pack: no ${DIRECTORY_FILE} here or above. skillcdn use gh/<owner>/<repo> binds it to a pack at a deployment, skillcdn use <directory> to a directory on this machine; a read here then needs no pack argument.`,
    );
  } else if (bound.directory !== undefined) {
    lines.push(
      `This directory reads ${bound.pack} from ${bound.directory}, a directory on this machine: no deployment and no token (${DIRECTORY_FILE}).`,
    );
  } else {
    const envUrl = io.environment.SKILLCDN_URL;
    const url = originOf(envUrl ?? bound.url ?? DEFAULT_ORIGIN) ?? DEFAULT_ORIGIN;
    const address = parseAddress(bound.pack);
    const repository =
      address.ok && isGitHostAddress(address.value) ? repositoryOf(address.value) : undefined;
    const fromEnvironment =
      envUrl !== undefined &&
      originOf(envUrl) === url &&
      io.environment.SKILLCDN_TOKEN !== undefined;
    const login = loginAt(credentials, url, repository);
    lines.push(`This directory reads ${bound.pack} at ${url} (${DIRECTORY_FILE}).`);
    lines.push(
      fromEnvironment
        ? "SKILLCDN_TOKEN is set for it, with SKILLCDN_URL."
        : login === undefined
          ? `No token is kept for it. A public pack needs none; for a private one, skillcdn login --url ${url} connects with a code a person approves.`
          : `A token is kept for it${login.repository === undefined ? ", for every repository there" : ""}${login.since === undefined ? "" : `, since ${login.since}`}.`,
    );
  }
  lines.push(
    credentials.logins.length === 0
      ? "No token is kept for any deployment."
      : `Tokens are kept for ${credentials.logins.length === 1 ? "one place" : `${credentials.logins.length} places`}; skillcdn logins names them.`,
  );
  lines.push(
    `This is skillcdn ${version()}. Next: skillcdn skills${bound === undefined ? " <pack>" : ""}.`,
  );
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
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
    switch (name) {
      case "check":
        return await checkCommand(rest, io);
      case "login":
        return await loginCommand(rest, io);
      case "logout":
        return await logoutCommand(rest, io);
      case "logins":
        return await loginsCommand(rest, io);
      case "use":
        return await useCommand(rest, io);
      case "status":
        return await statusCommand(rest, io);
      case "mcp":
        return await mcpCommand(rest, io);
      case "serve":
        return await serveCommand(rest, io);
      default:
        return await readCommand(name, rest, io);
    }
  } catch (error) {
    if (error instanceof Misuse) {
      io.stderr(`${error.message}\n\n${HELP[name]}`);
      return EXIT_USAGE;
    }
    if (error instanceof ConfigurationError) {
      io.stderr(
        `invalid configuration:\n${error.problems.map((problem) => `  - ${problem.variable}: ${problem.rule}\n`).join("")}`,
      );
      return EXIT_CONFIG;
    }
    if (error instanceof Unreadable) {
      io.stderr(`${error.message}\n`);
      return error.exit;
    }
    if (error instanceof ReaderInputError) {
      io.stderr(`${error.message}\n`);
      return EXIT_USAGE;
    }
    if (error instanceof PackError) {
      io.stderr(`${error.code}: ${error.message}\n`);
      return error.status === 400
        ? EXIT_USAGE
        : error.status === 0 || error.status >= 500
          ? EXIT_UNREADABLE
          : EXIT_MISSING;
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
  return await checkDirectory({
    directory: resolve(io.cwd ?? ".", directory ?? "."),
    limits: limitsOf(io),
    write: io.stdout,
  });
}

// Serving a directory (ADR-0057): the same tools and routes a deployment serves, from the index
// in memory, read again when the files change. The server is the serve package's; what is here
// is the arguments, the process and the words.

const clockOf = (io: CliIo): Clock => ({ now: () => io.now?.() ?? new Date() });

const identity = (): { readonly name: string; readonly version: string } => ({
  name: "skillcdn",
  version: version(),
});

/** What the server has to say, on standard error, so that standard output stays the protocol's. */
function stderrLogger(io: CliIo): ServeLogger {
  const shown = (value: unknown): string => {
    if (value instanceof Error) {
      return JSON.stringify(value.message);
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  const line = (level: string, fields: Record<string, unknown>, message: string): void => {
    const rest = Object.entries(fields)
      .map(([key, value]) => ` ${key}=${shown(value)}`)
      .join("");
    io.stderr(`${level}: ${message}${rest}\n`);
  };
  return {
    warn: (fields, message) => line("warn", fields, message),
    error: (fields, message) => line("error", fields, message),
  };
}

/** Mounts the directories to serve, each at its own address. */
async function mountAll(
  directories: readonly string[],
  as: string | undefined,
  io: CliIo,
): Promise<readonly MountedDirectory[]> {
  if (as !== undefined && directories.length > 1) {
    throw new Misuse(
      "--as names one directory; serve the others by their own names, or one at a time.",
    );
  }
  const limits = limitsOf(io);
  const mounted: MountedDirectory[] = [];
  for (const directory of directories) {
    const result = await mountDirectory({
      directory: resolve(io.cwd ?? ".", directory),
      as,
      limits,
    });
    if ("error" in result) {
      throw new Unreadable(result.error, result.exit);
    }
    const address = formatAddress(result.mount.address);
    if (mounted.some((other) => formatAddress(other.mount.address) === address)) {
      throw new Misuse(
        `Two directories would be served at ${address}: a directory is addressed after its parent's name and its own.`,
      );
    }
    mounted.push(result);
  }
  return mounted;
}

/** Reads a directory again whenever its files change, for as long as it is served. */
const watchAll = (mounted: readonly MountedDirectory[], logger: ServeLogger): { close(): void } => {
  const watchers = mounted.map(({ mount, reload }) =>
    watchDirectory(mount.root, reload, {
      failed: (error) =>
        logger.warn(
          { err: error, directory: mount.root },
          "the directory could not be read again; what was read last is served",
        ),
    }),
  );
  return {
    close() {
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
};

async function mcpCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.mcp);
    return 0;
  }
  const [directory, ...more] = parsed.positionals;
  if (directory === undefined || more.length > 0) {
    throw new Misuse("Say which directory to serve, and one only.");
  }
  if (io.streams === undefined) {
    throw new Misuse("Standard input and output are not available here.");
  }
  const [mounted] = await mountAll([directory], parsed.values.as, io);
  if (mounted === undefined) {
    throw new Error("one directory mounts as one");
  }
  const logger = stderrLogger(io);
  const served = await serveOverStdio(mounted.mount, {
    reader: localReader(limitsOf(io)),
    clock: clockOf(io),
    logger,
    server: identity(),
    stdin: io.streams.stdin,
    stdout: io.streams.stdout,
  });
  io.stderr(
    `Serving ${mounted.mount.root} as ${formatAddress(mounted.mount.address)} over standard input and output.\n`,
  );
  const watching = watchAll([mounted], logger);
  await Promise.race([served.closed, io.hold?.() ?? served.closed]);
  watching.close();
  await served.close();
  return 0;
}

function portOf(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN;
  if (Number.isNaN(port) || port > 65_535) {
    throw new Misuse("--port takes a port number from 0 to 65535.");
  }
  return port;
}

function hostOf(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_HOST;
  }
  if (value.length === 0 || /[\s/]/.test(value)) {
    throw new Misuse("--host takes a host name or an address to listen on.");
  }
  return value;
}

async function serveCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.serve);
    return 0;
  }
  if (parsed.positionals.length === 0) {
    throw new Misuse("Say which directories to serve.");
  }
  const port = portOf(parsed.values.port);
  const host = hostOf(parsed.values.host);
  const mounted = await mountAll(parsed.positionals, parsed.values.as, io);
  const logger = stderrLogger(io);
  const mounts: LocalMount[] = mounted.map(({ mount }) => mount);
  const app = createLocalApp({
    mounts,
    reader: localReader(limitsOf(io)),
    clock: clockOf(io),
    logger,
    server: identity(),
  });
  const listening = await listenOn(app, { host, port }).catch((error: unknown) => {
    throw new Error(
      `Cannot listen on ${host} at port ${port}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  io.stdout(
    [
      `Serving ${mounts.length === 1 ? "one pack" : `${mounts.length} packs`} at ${listening.url}: MCP at each address, the REST API under /api/v1/.`,
      ...mounts.map((mount) => `  ${listening.url}${formatAddress(mount.address)}  ${mount.root}`),
      "The directories are read again as their files change. Press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );
  const watching = watchAll(mounted, logger);
  await io.hold?.();
  watching.close();
  await listening.close();
  return 0;
}
