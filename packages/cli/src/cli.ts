import { readFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import { ApiError, createClient, type FetchLike } from "@skillcdn/client";
import {
  type Address,
  BROWSE_DEFAULT_LIMIT,
  BROWSE_MAX_LIMIT,
  type Clock,
  COMMAND_OUTPUT_MAX_BYTES,
  FIND_DEFAULT_LIMIT,
  FIND_MAX_LIMIT,
  formatAddress,
  HUB_DEFAULT_LIMIT,
  HUB_MAX_LIMIT,
  hubResultOf,
  type IndexLimits,
  isGitHostAddress,
  parseAddress,
  parseSkillUri,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LIMIT,
  type RestConnectClaimed,
  type RestConnectStarted,
  renderHubResult,
} from "@skillcdn/core";
import {
  checkDirectory,
  openWorkingTreeFile,
  type PackReferenceAsked,
  type PackReferenceVerdict,
  readDirectory,
  readIndexLimits,
} from "@skillcdn/indexer";
import {
  createEmbeddingsApi,
  createRerankApi,
  inferenceFetch,
  withQueryCache,
} from "@skillcdn/inference";
import { ReaderInputError } from "@skillcdn/reader";
import { createLocalApp, listenOn, type ServeLogger, serveOverStdio } from "@skillcdn/serve";
import { catalogTable, writeCatalogRegions } from "./catalog.js";
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
  type LocalMeaning,
  type LocalMount,
  localAddress,
  localReader,
  type MountedDirectory,
  mountDirectory,
  openDirectory,
  watchDirectory,
} from "./local.js";
import { type Pack, PackError } from "./pack.js";
import {
  COMMAND_WORDS,
  FILE_PAGE_CHARS,
  type PackRead,
  ReadMisuse,
  readNumber,
  readPack,
  shellWord,
  wroteLine,
} from "./read.js";
import { asPackError, openDeployment } from "./remote.js";
import { createMemoryVectorCache, type VectorCache } from "./vectors.js";

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
  /**
   * Where the vectors of a directory's sections are kept between runs, for the search by
   * meaning; in memory, for this run only, when left out.
   */
  readonly vectors?: VectorCache | undefined;
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

export { COMMAND_WORDS, FILE_PAGE_CHARS, OUTPUT_CHARS } from "./read.js";

const COMMANDS = [
  "check",
  "catalog",
  "skills",
  "browse",
  "find",
  "search",
  "skill",
  "file",
  "rows",
  "code",
  "mcp",
  "serve",
  "embed",
  "login",
  "logout",
  "logins",
  "use",
  "status",
] as const;
type Command = (typeof COMMANDS)[number];

/**
 * The sentence a checkout's agreement carries (AGENTS.md, or CLAUDE.md where that is the file
 * agents read), so that the agents working in it read the pack it is bound to before they start:
 * what `use` prints, and what the guide says. It has them run `skillcdn status` before the first
 * step, as the console's sentence has them run `console whoami`, and ends on what that answers,
 * which names the read to run next. The console's runs found both of the shape this one had: a
 * condition nobody tested was passed over, and a sentence ending on the help had the help read
 * whole.
 */
export const AGREEMENT_SENTENCE =
  "**Bound to a pack?** Before the first step, run `skillcdn status`: when it names a pack, or `.skillcdn.json` is in this checkout, read that pack's skills and load the one the task calls for (its answer says how).";

/**
 * What `use` says of the file it wrote, before anything commits it: whether it is committed. A
 * file that names a deployment of the organization's own or a private pack tells whoever reads
 * a public repository what the organization keeps to itself, as a console's binding file would
 * tell of its console.
 */
export const COMMIT_LINE =
  "Commit it, so that every clone reads the same pack, unless the repository is public and the file names a deployment of your own or a private pack: then list it in .gitignore, and run skillcdn use in each clone.";

/** What `use` says after binding: how the agents that work here learn of it. */
const HAND_OVER = `Tell the agents that work here, in the checkout's agreement (AGENTS.md, or CLAUDE.md where that is the file agents read), in one sentence:

  ${AGREEMENT_SENTENCE}
`;

const isCommand = (name: string): name is Command => (COMMANDS as readonly string[]).includes(name);

export const USAGE = `usage: skillcdn <command> [arguments]

Reads a pack as SkillCDN serves one: a directory on this machine in the SkillCDN Format (a git
checkout or any folder of skills, documents and rules), or a pack at a deployment, by its
address. Nothing in a directory is executed.

Commands:
  check [<directory>]              Report what an agent would get from the directory, before pushing.
  catalog [<directory>]            The table of the skills for a README: print it, write it into a file, or check one.
  skills [<pack>]                  What a client is told on connect, then every skill and document.
  browse [<pack>] [<folder>]       What a folder holds, as browse_repo lists it.
  find [<pack>] <words...>         What the words find, as search_repo does.
  search <words...>                What the words find across every pack of a deployment, each under its address.
  skill [<pack>] <path>            A skill whole, as load_skill assembles it: rules, instructions, included files.
  file [<pack>] <path>             A page of a file, as read_repo_file reads it, or what a folder holds.
  rows [<pack>] [<path>]           The tables of a document, or of every document under a folder, as CSV or JSON.
  code [<pack>] [<path>]           The fenced code blocks of a document, or of every document under a folder.
  mcp <directory>                  Serve the directory to the MCP client that started the command.
  serve <directory>...             Serve directories over HTTP on this machine: MCP and the REST API.
  embed <directory>                Embed the directory's documents ahead of the first search, saying how far it is.
  login --url <origin> [<address>] Connect to a deployment with a code a person approves; the token is kept, never shown.
  logout --url <origin> [<address>] Forget the tokens kept for a deployment, or the one for a repository.
  logins                           The deployments and repositories a token is kept for.
  use <address>|<directory>        Bind this directory to a pack, at a deployment or on this machine: reads here need no <pack>.
  status                           What this directory reads, and whether a token is kept for it.
  help [<command>]                 This, or one command in full.

A <pack> is a directory, or an address: gh/<owner>/<repo>[@<ref>][/<path>], the URL of a pack
at a deployment, or a skill:// URI. Left out, the pack this directory is bound to (${DIRECTORY_FILE});
there, a directory is a pack only when written as a path, ./<name>, since a bare word is a folder
of the bound pack. An address is read at --url, else SKILLCDN_URL, else the deployment the directory is bound to,
else ${DEFAULT_ORIGIN}, with the token kept for that deployment and the repository read, or
SKILLCDN_TOKEN beside SKILLCDN_URL. Paths start at the pack's root, as marketing/ads/SKILL.md.
Every read answers the words an MCP client's model is given, or the JSON of the REST API with --json.
A read prints no more than ${COMMAND_OUTPUT_MAX_BYTES} bytes for an agent, what the hosts that run its commands show
whole, and one that ends before what was asked for says how to read on.

Exit codes: 0 done; 1 the pack does not have it, or refuses it; 2 the pack cannot be read, the
directory or the deployment; 64 a usage error; 78 a variable that cannot be read; 70 a failure.

Options:
  -h, --help     Print this help.
  -v, --version  Print the version.
`;

const READ_OPTIONS = `  --url <origin>  The deployment an address is read at.
  --as <address>  Address a directory as local/<owner>/<name> instead of its parent's and its own name.
  --json          Print the JSON the REST API answers instead of the words a model is given.`;

/** How a directory is searched by meaning, as the help of the commands that serve one says it. */
const MEANING_NOTE = `With EMBEDDINGS_URL and EMBEDDINGS_MODEL, the sections of the directory's documents are embedded
by that server, as a deployment embeds them (skillcdn embed does it ahead of the first search),
and a search ranks by words and meaning; with
RERANKER_URL and RERANKER_MODEL beside them, the first results are reranked. The variables are
the ones a deployment takes, with the same defaults. The vectors are kept in the cache directory
(~/.cache/skillcdn, or under XDG_CACHE_HOME) by the hash of each file, under the model's name,
so that a directory is embedded once on a machine and a changed file again; a manifest's
search: { meaning: false } keeps its documents to the words. The text of the documents goes to
that server and nowhere else; a server that does not answer leaves the words to answer.`;

const HELP: Readonly<Record<Command, string>> = {
  check: `usage: skillcdn check [<directory>] [--references [--url <origin>]] [--offline]

Reads a directory as SkillCDN would index it and prints what an agent would get: the manifest,
the license, every skill with its files, its warnings and the pages it is read in, the
documents, what is not served, the index diagnostics, and what a client is told on connect.
Nothing in the directory is executed.

The first line names this command's version and the version of the reading rules it applied.
A command run from a cache or installed long ago applies the rules it was built with: when the
npm registry has a later version, a line on standard error says so. That one request is all
the network check uses, it never fails the check, and --offline (or SKILLCDN_OFFLINE=1) leaves
it out. npx @skillcdn/cli@latest check always runs the latest.

A link whose destination is a skill URI, skill://gh/<owner>/<repo>/<path>, names a file of
another pack. The report lists such links. With --references, each is read once at --url, else
SKILLCDN_URL, else ${DEFAULT_ORIGIN}, as skillcdn file reads it: a file that pack does not have
fails the check, and one that could not be asked about is said to be not known.

Exit codes: 0 when there are no index diagnostics, 1 when there are, or when a file --references
asked about is not there, 2 when the directory cannot
be read. The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.
`,
  skills: `usage: skillcdn skills [<pack>] [--cursor <cursor>] [--url <origin>] [--as <address>] [--json]

What a client is told when it connects to the pack, within its 2,000 characters, then every
skill and every document outside the skills, as a search without words lists them: each skill
with its SKILL.md path, which skillcdn skill takes. A listing longer than one read prints,
${COMMAND_OUTPUT_MAX_BYTES} bytes, ends with the command that lists the rest, with its --cursor.

${READ_OPTIONS}
`,
  browse: `usage: skillcdn browse [<pack>] [<folder>] [--cursor <cursor>] [--limit <n>] [--url <origin>] [--as <address>] [--json]

What a folder holds, as browse_repo lists it: its skills, its folders with what each holds and
the README that introduces it, and its files, with the canonical path of each. The pack's root
when no folder is given. A page of ${BROWSE_DEFAULT_LIMIT} entries unless --limit says otherwise (up to
${BROWSE_MAX_LIMIT}), and of fewer where they would not print within ${COMMAND_OUTPUT_MAX_BYTES} bytes; a page that ends
before the folder does names its nextCursor, which --cursor continues.

${READ_OPTIONS}
`,
  find: `usage: skillcdn find [<pack>] <words...> [--path <folder>] [--cursor <cursor>] [--limit <n>] [--url <origin>] [--as <address>] [--json]

What the words find, as search_repo does: words are matched in the language the pack is written
in, usually English, and meaning as well where a deployment offers it, or where EMBEDDINGS_URL
and EMBEDDINGS_MODEL name an embeddings server for a directory (skillcdn help serve says how);
a skill comes with the files of it that matched, in order of relevance, and skills outrank
documents. --path keeps the search to a folder. A page of ${FIND_DEFAULT_LIMIT}
results unless --limit says otherwise (up to ${FIND_MAX_LIMIT}), and of fewer where they would not print
within ${COMMAND_OUTPUT_MAX_BYTES} bytes; a page that ends before the results do names its nextCursor, which
--cursor continues.

${READ_OPTIONS}
`,
  search: `usage: skillcdn search <words...> [--limit <n>] [--url <origin>] [--json]

What the words find across every public pack a deployment serves, as the search_packs tool at
the root of the deployment answers: skills and documents, each under the address of its pack,
matched by words, and by meaning where the deployment searches by it. For finding the pack to
read when none is known; skillcdn find searches inside one. At most ${HUB_DEFAULT_LIMIT} results unless
--limit says otherwise (up to ${HUB_MAX_LIMIT}). What is found is read by its address, which the reads
take first: skillcdn skill <address> <path>, skillcdn file <address> <path>.

The deployment is --url, else SKILLCDN_URL, else the one this directory is bound to, else
${DEFAULT_ORIGIN}. The search covers public packs alone, so no token is sent.

  --url <origin>  The deployment searched.
  --json          Print the JSON the REST API answers instead of the words a model is given.
`,
  skill: `usage: skillcdn skill [<pack>] <path> [--cursor <cursor>] [--url <origin>] [--as <address>] [--json]

One skill whole, as load_skill assembles it: the rules of every SKILLCDN.md from the pack's root
to the skill's own folder, then its instructions, then the files it includes on every run, each
under a line that names its path; then the files it has and what it refers to. <path> is the
path of its SKILL.md from the pack's root, as skills and browse print it, or the skill://
URI the pack names it by, which then names the pack as well. The pages the skill is read in are
joined, up to ${COMMAND_OUTPUT_MAX_BYTES} bytes: a skill longer than that is printed in parts. A part that is
not the last says how many pages of the skill follow it, at its head and at its end, and its
last line is the command that prints the next, with its --cursor; the last part says that the
skill is complete. A part ends after a line, and a part after the first names the skill without
its description, files and references. Read every part before using the skill. --json prints
the skill whole, from --cursor where it is given.

${READ_OPTIONS}
`,
  file: `usage: skillcdn file [<pack>] <path> [--offset <n>] [--limit <n>] [--url <origin>] [--as <address>] [--json]

A page of a file, as read_repo_file reads it: the text as written, from character --offset,
${FILE_PAGE_CHARS} characters unless --limit says otherwise (up to ${READ_FILE_MAX_LIMIT}), and no more than print
within ${COMMAND_OUTPUT_MAX_BYTES} bytes with the header and the links; a page that ends before the file does ends
after a line and says where the next begins. A path that names a folder answers what the folder
holds. A file over the read limit, one that is not text, and one a license keeps at its source
are named with where to read them instead. --json prints the page the REST API answers,
${READ_FILE_DEFAULT_LIMIT} characters unless --limit says otherwise.

${READ_OPTIONS}
`,
  rows: `usage: skillcdn rows [<pack>] [<path>] [--heading <words>] [--format csv|json] [--out <file>] [--url <origin>] [--as <address>] [--json]

The tables of a document, or of every document under a folder, as data: every row in reading
order, with the file and the section it stands in and its cells under the names of its table's
columns. A table that stands in several sections and files under the same header comes out as
one. For a table too long to copy out by hand: take it from here into a file, and read the file
with a program. The pack's root when no path is given.

--heading keeps the tables whose heading path holds every word given, whatever the case.
--format csv (the default) prints one CSV, with a header of path, heading and every column
name; --format json prints an array of rows, each with path, heading and cells by column name.
--out writes to a file instead, and prints how much was written. --json prints the tables as
the REST API answers them, every page joined.

${READ_OPTIONS}
`,
  code: `usage: skillcdn code [<pack>] [<path>] [--heading <words>] [--grep <pattern>] [--out <file>] [--url <origin>] [--as <address>] [--json]

The fenced code blocks of a document, or of every document under a folder, as they are written:
each under a line that names its file, its section and what the block says it is written in.
For definitions and listings a program reads: take them from here instead of copying them out.
The pack's root when no path is given.

--heading keeps the blocks whose heading path holds every word given. --grep keeps the blocks
whose text matches the pattern, a regular expression as JavaScript reads one, run on this
machine. --out writes to a file instead, and prints how much was written. --json prints the
blocks as the REST API answers them, every page joined.

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

${MEANING_NOTE}

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

${MEANING_NOTE}

The INDEX_* and READ_MAX_FILE_BYTES variables set the limits a deployment would apply.
`,
  embed: `usage: skillcdn embed <directory> [--as <address>]

Embeds the sections of the directory's documents with the embeddings server that EMBEDDINGS_URL
and EMBEDDINGS_MODEL name, ahead of the first search, and keeps the vectors in the cache
directory: a find, an mcp or a serve over the directory afterwards ranks by words and meaning
at once, where it would otherwise embed first, or answer by words alone meanwhile. On standard
error it says how many documents there are to embed and, every little while, how many are done
and about how long is left; on standard output, when it is done, what it embedded. A run that
is stopped keeps what it embedded, and the next goes on from there; a document that has not
changed is never embedded twice.

Exit codes: 0 when every document has its vectors, 2 when the server failed before that, 78
when the variables cannot be read or name no server.

${MEANING_NOTE}
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
  catalog: `usage: skillcdn catalog [<directory>] [--folder <path>] [--write <file>]... [--check <file>]...

The skills of a directory as a Markdown table for the people who read its README: each skill's
name, linked to its SKILL.md, and the first sentence of its description, in path order, then how
many there are. Without --write or --check the table is printed, for the whole pack or for the
skills under --folder.

--write <file> writes the table into a file of the directory, between two comments the file
holds, and leaves the rest of the file as it is:

  <!-- skillcdn:catalog -->
  <!-- /skillcdn:catalog -->

The region lists the skills under the folder the file stands in, or under the folder the opening
comment names from the root of the pack: <!-- skillcdn:catalog folder=marketing -->. A file may
hold several regions. --check <file> writes nothing and says whether each region is what
--write would make it. Both may be given more than once.

Exit codes: 0 done, or every region checked is up to date; 1 a region is out of date, or a file
has no region; 2 the directory or a file cannot be read.
`,
  use: `usage: skillcdn use <address> [--url <origin>]
       skillcdn use <directory> [--as local/<owner>/<name>]

Binds the working directory to a pack: writes ${DIRECTORY_FILE} with the pack's address and, with
--url, the deployment it is read at; or, for a directory on this machine, the directory as a
path relative to the file, read with no deployment and no token. A read here or in a directory
below then needs no <pack>. It names no token and nothing secret, and is meant to be committed,
so that everyone who works in the checkout, and every agent they run in it, reads the same pack;
a public repository whose file names a deployment of its own or a private pack lists it in
.gitignore instead, and each clone runs skillcdn use once. Afterwards the command says so, and
prints the sentence to put in the checkout's agreement (AGENTS.md, or CLAUDE.md where
that is the file agents read), so that the agents working here run skillcdn status before their
first step and read the pack.
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

/** A usage error: what was wrong, and the command's help after it, as for a read not asked right. */
class Misuse extends ReadMisuse {}

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
  heading: { type: "string" },
  format: { type: "string" },
  out: { type: "string" },
  grep: { type: "string" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>["values"];

const count = (value: string | undefined, name: string, max: number): number | undefined =>
  readNumber(value, name, max);

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

interface ConfigurationProblem {
  readonly variable: string;
  readonly rule: string;
}

/** A text from the environment, or nothing when the variable is not set or is blank. */
function textOf(env: CliIo["environment"], name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** A whole number from the environment within its bounds, or the default when it is not set. */
function wholeNumberOf(
  env: CliIo["environment"],
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: ConfigurationProblem[],
): number {
  const value = textOf(env, name);
  if (value === undefined) {
    return fallback;
  }
  const number = /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
  if (Number.isNaN(number) || number < min || number > max) {
    problems.push({ variable: name, rule: `must be an integer between ${min} and ${max}` });
    return fallback;
  }
  return number;
}

/** A server's endpoint from the environment, an http or https URL, or nothing when it is not set. */
function serverUrlOf(
  env: CliIo["environment"],
  name: string,
  problems: ConfigurationProblem[],
): string | undefined {
  const value = textOf(env, name);
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return value;
    }
  } catch {
    // Not a URL at all: the one problem below.
  }
  problems.push({ variable: name, rule: "must be an http or https URL" });
  return undefined;
}

/**
 * The search by meaning over a directory (ADR-0064), from the variables a deployment takes, with
 * its defaults: nothing without EMBEDDINGS_URL, and the words answer alone; with it, the
 * embeddings server, the reranking server beside it where RERANKER_URL names one, and where the
 * vectors are kept. What cannot be read is refused, as a deployment would refuse it.
 */
function meaningOf(io: CliIo): LocalMeaning | undefined {
  const env = io.environment;
  const problems: ConfigurationProblem[] = [];
  const url = serverUrlOf(env, "EMBEDDINGS_URL", problems);
  const model = textOf(env, "EMBEDDINGS_MODEL");
  if (url === undefined && problems.length === 0) {
    for (const name of ["EMBEDDINGS_MODEL", "EMBEDDINGS_QUERY_INSTRUCTION", "EMBEDDINGS_KEY"]) {
      if (textOf(env, name) !== undefined) {
        problems.push({ variable: name, rule: "read only with EMBEDDINGS_URL" });
      }
    }
  } else if (url !== undefined && model === undefined) {
    problems.push({ variable: "EMBEDDINGS_MODEL", rule: "required with EMBEDDINGS_URL" });
  } else if (model !== undefined && model.length > 200) {
    problems.push({ variable: "EMBEDDINGS_MODEL", rule: "must be at most 200 characters" });
  }
  const dimensions = wholeNumberOf(env, "EMBEDDINGS_DIMENSIONS", 1024, 32, 4096, problems);
  const timeoutMs = wholeNumberOf(env, "EMBEDDINGS_TIMEOUT_MS", 60_000, 1000, 600_000, problems);
  const queryTimeoutMs = wholeNumberOf(
    env,
    "EMBEDDINGS_QUERY_TIMEOUT_MS",
    5000,
    100,
    60_000,
    problems,
  );
  const concurrency = wholeNumberOf(env, "EMBEDDINGS_CONCURRENCY", 2, 1, 64, problems);
  const maxTexts = wholeNumberOf(env, "EMBEDDINGS_BATCH_TEXTS", 16, 1, 256, problems);
  const maxBatchChars = wholeNumberOf(
    env,
    "EMBEDDINGS_BATCH_CHARS",
    32_000,
    1000,
    1_000_000,
    problems,
  );
  const maxTextChars = wholeNumberOf(env, "EMBEDDINGS_TEXT_CHARS", 8000, 100, 100_000, problems);
  const maxTextTokens = wholeNumberOf(env, "EMBEDDINGS_TEXT_TOKENS", 4096, 64, 100_000, problems);
  const maxQueryTokens = wholeNumberOf(env, "EMBEDDINGS_QUERY_TOKENS", 128, 16, 100_000, problems);
  const rerankerUrl = serverUrlOf(env, "RERANKER_URL", problems);
  const rerankerModel = textOf(env, "RERANKER_MODEL");
  if (textOf(env, "RERANKER_URL") === undefined) {
    for (const name of ["RERANKER_MODEL", "RERANKER_KEY"]) {
      if (textOf(env, name) !== undefined) {
        problems.push({ variable: name, rule: "read only with RERANKER_URL" });
      }
    }
  } else if (rerankerUrl !== undefined && rerankerModel === undefined) {
    problems.push({ variable: "RERANKER_MODEL", rule: "required with RERANKER_URL" });
  }
  const rerankTimeoutMs = wholeNumberOf(env, "RERANKER_TIMEOUT_MS", 5000, 100, 60_000, problems);
  const rerankConcurrency = wholeNumberOf(env, "RERANKER_CONCURRENCY", 2, 1, 64, problems);
  const rerankCandidates = wholeNumberOf(env, "RERANKER_CANDIDATES", 10, 1, 32, problems);
  if (problems.length > 0) {
    throw new ConfigurationError(problems);
  }
  if (url === undefined || model === undefined) {
    return undefined;
  }
  // The package's own transport, where the caller hands in none: the platform's `fetch` ends a
  // call after five minutes whatever `EMBEDDINGS_TIMEOUT_MS` says.
  const fetchLike: FetchLike = io.fetch ?? inferenceFetch;
  const userAgent = io.userAgent ?? "skillcdn";
  const embedder = withQueryCache(
    createEmbeddingsApi({
      url,
      model,
      dimensions,
      queryInstruction: textOf(env, "EMBEDDINGS_QUERY_INSTRUCTION"),
      key: textOf(env, "EMBEDDINGS_KEY"),
      userAgent,
      fetch: fetchLike,
      timeoutMs,
      queryTimeoutMs,
      concurrency,
      maxTexts,
      maxBatchChars,
      maxTextChars,
      maxTextTokens,
      maxQueryTokens,
    }),
  );
  const reranker =
    rerankerUrl === undefined || rerankerModel === undefined
      ? undefined
      : createRerankApi({
          url: rerankerUrl,
          model: rerankerModel,
          key: textOf(env, "RERANKER_KEY"),
          userAgent,
          fetch: fetchLike,
          timeoutMs: rerankTimeoutMs,
          concurrency: rerankConcurrency,
        });
  return {
    embedder,
    reranker,
    rerankCandidates,
    cache: io.vectors ?? createMemoryVectorCache(),
    report: (line) => io.stderr(`${line}\n`),
    now: () => (io.now?.() ?? new Date()).getTime(),
  };
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
 * The deployment a command speaks to: the one the flag names, else the one what was given names
 * itself, else the environment's, else the one the directory is bound to, else the default.
 */
function originFor(
  io: CliIo,
  flagUrl: string | undefined,
  specUrl: string | undefined,
  boundUrl: string | undefined,
): string {
  const written = flagUrl ?? specUrl ?? io.environment.SKILLCDN_URL ?? boundUrl ?? DEFAULT_ORIGIN;
  const url = originOf(written);
  if (url === undefined) {
    throw new Misuse(
      `Not the origin of a deployment: ${written}. An origin is https://<host>, or http://localhost for this machine.`,
    );
  }
  return url;
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
  // A read may send a token, and the environment's goes to the environment's deployment alone:
  // one without the other would be a token for nowhere, or a deployment read as nobody by
  // mistake. A command that sends no token, the search across packs, takes the address alone.
  if ((envUrl === undefined) !== (envToken === undefined)) {
    throw new Misuse(
      "SKILLCDN_URL and SKILLCDN_TOKEN are taken together or not at all: set both, or neither.",
    );
  }
  const url = originFor(io, flagUrl, specUrl, boundUrl);
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
      meaning: meaningOf(io),
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

type ReadCommand = "skills" | "browse" | "find" | "skill" | "file" | "rows" | "code";

/** Prints what a data read made, or writes it to the file `--out` names and says how much. */
async function deliver(
  io: CliIo,
  out: string | undefined,
  text: string,
  written: string,
): Promise<void> {
  if (out === undefined) {
    io.stdout(text.endsWith("\n") || text.length === 0 ? text : `${text}\n`);
    return;
  }
  const file = resolve(io.cwd ?? ".", out);
  await writeFile(file, text).catch((error: unknown) => {
    throw new Unreadable(
      `${out}: cannot be written (${error instanceof Error ? error.message : String(error)})`,
      EXIT_FAILURE,
    );
  });
  io.stdout(`${wroteLine(written, file)}\n`);
}

const counted = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** A word of the command line, quoted for a shell where it needs it. */
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
  // A bare word that is a directory here is a pack, unless this directory is bound to one: a
  // read there names no pack, and in a checkout bound to its own pack every folder of the pack
  // is a directory here, so the word is the folder asked for. A pack on this machine is then
  // written as a path, ./<name>.
  const directoryHere = async (word: string): Promise<boolean> =>
    ((await stat(resolve(io.cwd ?? ".", word)).catch(() => undefined))?.isDirectory() ?? false) &&
    (await io.directory?.load()) === undefined;
  const firstIsPack =
    first !== undefined &&
    (command === "skills" ||
      first.startsWith("skill://") ||
      /^https?:\/\//i.test(first) ||
      looksLikePath(first) ||
      parseAddress(first.startsWith("/") ? first : `/${first}`).ok ||
      (await directoryHere(first)));
  const given = firstIsPack ? positionals.shift() : undefined;
  const { pack, skillPath } = await openPack(given, parsed.values, io);
  const json = parsed.values.json === true;
  const { values } = parsed;
  // A read that goes on is asked for again as it was: the pack, and where it is read (ADR-0108).
  const named = given === undefined ? [] : [given];
  const origin = [
    ...(values.url === undefined ? [] : ["--url", values.url]),
    ...(values.as === undefined ? [] : ["--as", values.as]),
  ];
  /** The read the arguments ask for, checked for what the command takes of them. */
  const asked = ((): {
    read: PackRead;
    nextPart?: (cursor: string) => string;
    browseFolder?: (path: string) => string;
  } => {
    const [argument, ...more] = positionals;
    switch (command) {
      case "skills":
        if (positionals.length > 0) {
          throw new Misuse("skills takes the pack and nothing else.");
        }
        return {
          read: { read: "skills", cursor: values.cursor },
          nextPart: (cursor) =>
            ["skillcdn", "skills", ...named, ...origin, "--cursor", cursor]
              .map(shellWord)
              .join(" "),
        };
      case "browse":
        if (more.length > 0) {
          throw new Misuse("browse takes the pack and at most one folder.");
        }
        return {
          read: { read: "browse", path: argument, cursor: values.cursor, limit: values.limit },
        };
      case "find":
        return {
          read: {
            read: "find",
            words: positionals.join(" "),
            path: values.path,
            cursor: values.cursor,
            limit: values.limit,
          },
        };
      case "skill": {
        if (more.length > 0 || (argument === undefined && skillPath === undefined)) {
          throw new Misuse("Say which skill: the path of its SKILL.md from the pack's root.");
        }
        if (argument !== undefined && skillPath !== undefined) {
          throw new Misuse("The URI names the skill already; say one or the other.");
        }
        // The next part is asked for as this one was: the pack, the path or URI, and where it
        // is read (ADR-0108).
        const asGiven = [...named, ...(argument === undefined ? [] : [argument]), ...origin];
        // The skill's folder is listed in the pack as it was given; a URI that named the skill
        // with its pack names one file, so the pack is said by its address.
        const inPack =
          skillPath === undefined ? named : [formatAddress(pack.address).replace(/^\//, "")];
        return {
          read: {
            read: "skill",
            path: skillPath ?? skillPathOf(pack, argument ?? ""),
            cursor: values.cursor,
          },
          nextPart: (cursor) =>
            ["skillcdn", "skill", ...asGiven, "--cursor", cursor].map(shellWord).join(" "),
          browseFolder: (path) =>
            ["skillcdn", "browse", ...inPack, ...(path.length === 0 ? [] : [path]), ...origin]
              .map(shellWord)
              .join(" "),
        };
      }
      case "file":
        if (argument === undefined || more.length > 0) {
          throw new Misuse("Say which file: its path from the pack's root.");
        }
        return {
          read: { read: "file", path: argument, offset: values.offset, limit: values.limit },
        };
      case "rows":
        if (more.length > 0) {
          throw new Misuse("rows takes the pack and at most one path.");
        }
        return {
          read: { read: "rows", path: argument, heading: values.heading, format: values.format },
        };
      case "code":
        if (more.length > 0) {
          throw new Misuse("code takes the pack and at most one path.");
        }
        return {
          read: { read: "code", path: argument, heading: values.heading, grep: values.grep },
        };
    }
  })();
  const output = await readPack(pack, asked.read, {
    words: COMMAND_WORDS,
    json,
    nextPart: asked.nextPart,
    browseFolder: asked.browseFolder,
  });
  if (output.holds !== undefined) {
    // What a data read made goes to the output, or to the file `--out` names.
    await deliver(io, values.out, output.text, output.holds);
  } else {
    io.stdout(`${output.text}\n`);
  }
  return 0;
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
      `This directory reads ${formatAddress(local.address)} from ${written === "." ? "itself" : written}, on this machine: ${path}.\n${COMMIT_LINE}\n\n${HAND_OVER}`,
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
    `This directory reads ${formatAddress(address.value)}${url === undefined ? "" : ` at ${url}`}: ${path}.\n${COMMIT_LINE}\n\n${HAND_OVER}`,
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

/**
 * The search across every pack of a deployment (ADR-0070), for whoever has a shell and no pack
 * yet: what the root's one tool answers, with the reads named as the commands that take the
 * address of a result. Anyone's request: the search covers public packs, so the token kept for a
 * repository there stays where it is.
 */
async function searchCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.search);
    return 0;
  }
  const query = parsed.positionals.join(" ").trim();
  if (query.length === 0) {
    throw new Misuse("Say the words to search for.");
  }
  const limit = count(parsed.values.limit, "limit", HUB_MAX_LIMIT);
  const bound = await io.directory?.load();
  const url = originFor(io, parsed.values.url, undefined, bound?.url);
  const client = createClient({
    baseUrl: url,
    fetch: io.fetch ?? ((input, init) => fetch(input, init)),
    userAgent: io.userAgent,
  });
  const body = await client.search(query, limit).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      throw new PackError(404, error.code, `${url} has no search across its packs.`);
    }
    return asPackError(error);
  });
  if (parsed.values.json === true) {
    io.stdout(`${JSON.stringify(body, null, 2)}\n`);
    return 0;
  }
  io.stdout(`${renderHubResult(hubResultOf(body), url, COMMAND_WORDS)}\n`);
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
      case "catalog":
        return await catalogCommand(rest, io);
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
      case "embed":
        return await embedCommand(rest, io);
      case "serve":
        return await serveCommand(rest, io);
      case "search":
        return await searchCommand(rest, io);
      default:
        return await readCommand(name, rest, io);
    }
  } catch (error) {
    if (error instanceof ReadMisuse) {
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

/** Where the registry says which version of the command is the latest: one small document. */
const LATEST_VERSION_URL = "https://registry.npmjs.org/-/package/@skillcdn%2Fcli/dist-tags";
/** How long `check` waits for that answer after its report is written. */
const LATEST_VERSION_WAIT_MS = 1_500;
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Whether `candidate` is a later release than `current`; false for anything that is not a release. */
export function isLaterRelease(candidate: string, current: string): boolean {
  const later = RELEASE.exec(candidate);
  const now = RELEASE.exec(current);
  if (later === null || now === null) return false;
  for (const at of [1, 2, 3]) {
    const difference = Number(later[at]) - Number(now[at]);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * The latest version of the command at the registry when it is later than this one, and nothing
 * otherwise: no network, an answer that is not one, a registry that takes too long. A command
 * run from a cache or installed long ago reads a pack by the rules it was built with and has
 * no other way to know that newer ones are out.
 */
async function laterVersion(io: CliIo, current: string): Promise<string | undefined> {
  const fetchLike = io.fetch;
  if (fetchLike === undefined) return undefined;
  const asked = (async (): Promise<string | undefined> => {
    try {
      const response = await fetchLike(LATEST_VERSION_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(LATEST_VERSION_WAIT_MS),
      });
      if (!response.ok) return undefined;
      const tags: unknown = await response.json();
      const latest =
        typeof tags === "object" && tags !== null && "latest" in tags ? tags.latest : undefined;
      return typeof latest === "string" && isLaterRelease(latest, current) ? latest : undefined;
    } catch {
      return undefined;
    }
  })();
  // A fetch that does not heed its signal must not hold the command either.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), LATEST_VERSION_WAIT_MS);
  });
  try {
    return await Promise.race([asked, waited]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks a deployment whether the files of other packs a directory links to are there (ADR-0120):
 * one read of each, as `skillcdn file` reads it, with the token kept for the pack when there is
 * one. A file the pack does not have is not found; anything else that keeps the answer away, a
 * pack that is not indexed in time, a file it will not pass on, a network that is not there, is
 * not known, and said so.
 */
function packReferenceVerifier(
  io: CliIo,
  flagUrl: string | undefined,
): (references: readonly PackReferenceAsked[]) => Promise<readonly PackReferenceVerdict[]> {
  return async (references) => {
    const verdicts: PackReferenceVerdict[] = [];
    for (const reference of references) {
      const address = parseAddress(`/${reference.pack}`);
      if (!address.ok) {
        verdicts.push({ detail: "not an address" });
        continue;
      }
      try {
        const deployment = await deploymentOf(io, flagUrl, undefined, undefined, address.value);
        const pack = openDeployment({
          url: deployment.url,
          address: address.value,
          token: deployment.token,
          fetch: io.fetch ?? ((input, init) => fetch(input, init)),
          userAgent: io.userAgent,
          sleep: io.sleep ?? defaultSleep,
        });
        const answer = await pack.file({ path: reference.path, limit: 1 });
        verdicts.push(
          answer.kind === "file" ? { found: true } : { detail: "a folder, not a file" },
        );
      } catch (error) {
        if (error instanceof Misuse) throw error;
        const code = error instanceof PackError ? error.code : "unreachable";
        verdicts.push(code === "file.not_found" ? { found: false } : { detail: code });
      }
    }
    return verdicts;
  };
}

/**
 * The table of a pack's skills for a README (ADR-0121): printed, written between the comments of
 * a file, or checked against what a file holds. The skills are the ones a search of the pack
 * would list, read as `check` reads the directory.
 */
async function catalogCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: {
      help: { type: "boolean", short: "h" },
      folder: { type: "string" },
      write: { type: "string", multiple: true },
      check: { type: "string", multiple: true },
    },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.catalog);
    return 0;
  }
  const [directory, ...rest] = parsed.positionals;
  if (rest.length > 0) {
    throw new Misuse("catalog takes one directory at most.");
  }
  const files = [
    ...(parsed.values.write ?? []).map((file) => ({ file, write: true })),
    ...(parsed.values.check ?? []).map((file) => ({ file, write: false })),
  ];
  if (files.length > 0 && parsed.values.folder !== undefined) {
    throw new Misuse(
      "--folder is for the printed table; a region names its folder in its comment.",
    );
  }
  const root = resolve(io.cwd ?? ".", directory ?? ".");
  const info = await stat(root).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    io.stderr(`${directory ?? "."}: not a directory that can be read\n`);
    return EXIT_UNREADABLE;
  }
  const { index } = await readDirectory({ directory: root, limits: limitsOf(io) });
  const skills = index.entries
    .filter((entry) => entry.kind === "skill" && entry.visible && entry.searchable)
    .map((entry) => ({
      path: entry.path,
      name: entry.name ?? "",
      description: entry.description ?? "",
    }));
  if (files.length === 0) {
    const folder = (parsed.values.folder ?? "").replace(/^\.\/?|\/+$/g, "");
    io.stdout(`${catalogTable(skills, folder, "")}\n`);
    return 0;
  }
  let code = 0;
  for (const { file, write } of files) {
    const absolute = resolve(io.cwd ?? ".", file);
    const inside = relative(root, absolute);
    if (inside.startsWith("..") || resolve(root, inside) !== absolute) {
      throw new Misuse(`${file} is not a file of ${directory ?? "the directory"}.`);
    }
    const text = await readFile(absolute, "utf8").catch(() => undefined);
    if (text === undefined) {
      io.stderr(`${file}: not a file that can be read\n`);
      return EXIT_UNREADABLE;
    }
    const fileDirectory = dirname(inside).split(sep).join("/");
    const made = writeCatalogRegions(text, fileDirectory === "." ? "" : fileDirectory, skills);
    const regions = `${made.regions} ${made.regions === 1 ? "region" : "regions"}`;
    if (made.regions === 0) {
      io.stderr(
        `${file}: no region to write: put <!-- skillcdn:catalog --> and <!-- /skillcdn:catalog --> where the table goes\n`,
      );
      code = EXIT_MISSING;
    } else if (made.stale === 0) {
      io.stdout(`${file}: up to date (${regions})\n`);
    } else if (write) {
      await writeFile(absolute, made.text);
      io.stdout(`${file}: written (${made.stale} of ${regions} changed)\n`);
    } else {
      io.stdout(
        `${file}: out of date (${made.stale} of ${regions}); skillcdn catalog --write ${shellWord(file)} writes it\n`,
      );
      code = EXIT_MISSING;
    }
  }
  return code;
}

async function checkCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: {
      help: { type: "boolean", short: "h" },
      offline: { type: "boolean" },
      references: { type: "boolean" },
      url: { type: "string" },
    },
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
  const current = version();
  const offline =
    parsed.values.offline === true || textOf(io.environment, "SKILLCDN_OFFLINE") !== undefined;
  if (offline && parsed.values.references === true) {
    throw new Misuse("--references asks a deployment, which --offline does not.");
  }
  if (parsed.values.url !== undefined && parsed.values.references !== true) {
    throw new Misuse("--url names the deployment --references asks.");
  }
  // Asked while the directory is read, so that the answer costs the check no time of its own.
  const later = offline ? undefined : laterVersion(io, current);
  const code = await checkDirectory({
    directory: resolve(io.cwd ?? ".", directory ?? "."),
    limits: limitsOf(io),
    write: io.stdout,
    command: `skillcdn ${current}`,
    ...(parsed.values.references === true
      ? { verifyPackReferences: packReferenceVerifier(io, parsed.values.url) }
      : {}),
  });
  const latest = await later;
  if (latest !== undefined) {
    // Beside the report, not in it: what the directory holds is on standard output alone.
    io.stderr(
      `skillcdn ${latest} is published, and this is ${current}: a later version may read a pack by later rules. Run npx @skillcdn/cli@latest check, or update the command that is installed. --offline asks nothing.\n`,
    );
  }
  return code;
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
  meaning: LocalMeaning | undefined,
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
      meaning,
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
  const meaning = meaningOf(io);
  const [mounted] = await mountAll([directory], parsed.values.as, io, meaning);
  if (mounted === undefined) {
    throw new Error("one directory mounts as one");
  }
  const logger = stderrLogger(io);
  const served = await serveOverStdio(mounted.mount, {
    reader: localReader(limitsOf(io), meaning),
    clock: clockOf(io),
    logger,
    server: identity(),
    stdin: io.streams.stdin,
    stdout: io.streams.stdout,
  });
  io.stderr(
    `Serving ${mounted.mount.root} as ${formatAddress(mounted.mount.address)} over standard input and output.\n`,
  );
  void mounted.embedding();
  const watching = watchAll([mounted], logger);
  await Promise.race([served.closed, io.hold?.() ?? served.closed]);
  watching.close();
  mounted.close();
  await served.close();
  return 0;
}

/**
 * Embeds a directory ahead of the first search (ADR-0064): the vectors are kept by the hash of
 * each body, so whatever reads the directory next finds them made.
 */
async function embedCommand(args: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: [...args],
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    io.stdout(HELP.embed);
    return 0;
  }
  const [directory, ...more] = parsed.positionals;
  if (directory === undefined || more.length > 0) {
    throw new Misuse("Say which directory to embed, and one only.");
  }
  const meaning = meaningOf(io);
  if (meaning === undefined) {
    throw new ConfigurationError([
      {
        variable: "EMBEDDINGS_URL",
        rule: "required to embed: the embeddings server, with EMBEDDINGS_MODEL beside it",
      },
    ]);
  }
  const [mounted] = await mountAll([directory], parsed.values.as, io, meaning);
  if (mounted === undefined) {
    throw new Error("one directory mounts as one");
  }
  const outcome = await mounted.embedding();
  mounted.close();
  if (outcome === undefined) {
    throw new Error("a directory mounted with a server is embedded");
  }
  const { model } = meaning.embedder;
  const where =
    meaning.cache.location === undefined
      ? ""
      : ` The vectors are kept in ${meaning.cache.location}.`;
  if (outcome.failed !== undefined) {
    // What stopped it was said on standard error as it happened; what was embedded is kept.
    io.stdout(
      `Stopped: ${counted(outcome.embedded, "document")} of ${mounted.mount.root} embedded with ${model} in this run, ${outcome.cached} before it; run the command again to go on.${where}\n`,
    );
    return EXIT_UNREADABLE;
  }
  io.stdout(
    outcome.embedded === 0
      ? `Nothing to embed: the ${counted(outcome.cached, "document")} of ${mounted.mount.root} have their vectors under ${model}.${where}\n`
      : `Embedded ${counted(outcome.embedded, "document")} (${counted(outcome.sections, "section")}) of ${mounted.mount.root} with ${model}${outcome.cached === 0 ? "" : `; ${outcome.cached} were embedded before`}.${where}\n`,
  );
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
  const meaning = meaningOf(io);
  const mounted = await mountAll(parsed.positionals, parsed.values.as, io, meaning);
  const logger = stderrLogger(io);
  const mounts: LocalMount[] = mounted.map(({ mount }) => mount);
  const app = createLocalApp({
    mounts,
    reader: localReader(limitsOf(io), meaning),
    clock: clockOf(io),
    logger,
    server: identity(),
    // Over HTTP the bytes of a file are sent from here (ADR-0077): a path on this machine means
    // nothing to a client elsewhere.
    rawFile: (mount, path) => openWorkingTreeFile(mount.root, path),
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
  for (const directory of mounted) {
    void directory.embedding();
  }
  const watching = watchAll(mounted, logger);
  await io.hold?.();
  watching.close();
  for (const directory of mounted) {
    directory.close();
  }
  await listening.close();
  return 0;
}
