#!/usr/bin/env node
// The command of the published web UI (ADR-0101): builds the pages of a SkillCDN deployment,
// with the pages of an installation's own among them where a configuration names them
// (ADR-0099), into a directory the server serves from WEB_ROOT; or serves them for development,
// against fixtures or against a running deployment. The pages of this workspace, and of the
// image, are built by the same steps.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_CONFIG = join(WEB, "vite.config.ts");
const { version } = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8"));

const USAGE = `skillcdn-web ${version}: the pages of a SkillCDN deployment

Usage:
  skillcdn-web build [--config <file>] [--out <dir>]
      Builds the pages into <dir> (default: dist), for the server's WEB_ROOT, with the pages of
      the installation's own that <file> names. The directory is emptied first, so it must be
      new, empty, or a build from before.
  skillcdn-web dev [--config <file>] [--api <url>] [--port <port>]
      Serves the pages for development, against fixtures, or against the deployment at <url>.

The configuration defaults to SKILLCDN_WEB_CONFIG; without one the pages are the product's own.
A build is of one release: take the version of this package that the deployment's image is.
`;

function fail(message, code = 64) {
  process.stderr.write(`skillcdn-web: ${message}\n`);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      api: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
} catch (error) {
  fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
}
const { values, positionals } = parsed;
if (values.version === true) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}
const [command, ...rest] = positionals;
if (values.help === true || command === undefined) {
  process.stdout.write(USAGE);
  process.exit(command === undefined && values.help !== true ? 64 : 0);
}
if (rest.length > 0) {
  fail(`unexpected argument: ${rest[0]}\n\n${USAGE}`);
}

/** The configuration file, as given or from the environment, checked to be there. */
function configFile() {
  const named = values.config ?? process.env.SKILLCDN_WEB_CONFIG;
  if (named === undefined || named.trim() === "") {
    return undefined;
  }
  const file = resolve(named);
  if (!existsSync(file) || !statSync(file).isFile()) {
    fail(`the configuration is not a file: ${file}`, 66);
  }
  return file;
}

/** Whether `child` is `parent` or inside it. */
function within(child, parent) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/**
 * The directory a build is written to, which is emptied first: never the directory the command
 * runs in or one above it, never one that holds the configuration or this package, and never a
 * directory that holds anything but a build.
 */
function outputDirectory(config) {
  const out = resolve(values.out ?? "dist");
  if (within(process.cwd(), out)) {
    fail(`--out must not be the directory the command runs in, or one above it: ${out}`);
  }
  if (config !== undefined && within(config, out)) {
    fail(`--out must not hold the configuration: ${out}`);
  }
  if (within(WEB, out) || (within(out, WEB) && out !== join(WEB, "dist"))) {
    fail(`--out must be outside the package: ${out}`);
  }
  if (existsSync(out)) {
    if (!statSync(out).isDirectory()) {
      fail(`--out is a file: ${out}`);
    }
    const entries = readdirSync(out);
    const aBuild =
      entries.length === 0 || entries.includes("routes.json") || entries.includes("assets");
    if (!aBuild) {
      fail(`--out holds something other than a build, and would be emptied: ${out}`);
    }
  }
  return out;
}

async function build() {
  const config = configFile();
  const out = outputDirectory(config);
  if (config !== undefined) {
    process.env.SKILLCDN_WEB_CONFIG = config;
  }
  const vite = await import("vite");
  const common = { root: WEB, configFile: VITE_CONFIG, mode: "production" };
  // The pages the browser loads, then the module the server renders pages with, then every
  // static page once per language with the manifest of routes (scripts/prerender.mjs).
  await vite.build({ ...common, build: { outDir: out } });
  await vite.build({
    ...common,
    build: { ssr: "src/entry-server.tsx", outDir: join(out, "render") },
  });
  const prerendered = spawnSync(process.execPath, [join(WEB, "scripts", "prerender.mjs"), out], {
    stdio: "inherit",
  });
  if (prerendered.status !== 0) {
    process.exit(prerendered.status ?? 1);
  }
  process.stdout.write(`the pages are in ${out}\n`);
}

async function dev() {
  const config = configFile();
  if (config !== undefined) {
    process.env.SKILLCDN_WEB_CONFIG = config;
  }
  let mode = "development";
  if (values.api !== undefined) {
    let url;
    try {
      url = new URL(values.api);
    } catch {
      fail(`--api is not a URL: ${values.api}`);
    }
    process.env.SKILLCDN_API_URL = url.origin;
    mode = "api";
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    fail(`--port is not a port: ${values.port}`);
  }
  const vite = await import("vite");
  const server = await vite.createServer({
    root: WEB,
    configFile: VITE_CONFIG,
    mode,
    ...(port === undefined ? {} : { server: { port } }),
  });
  await server.listen();
  server.printUrls();
}

if (command === "build") {
  await build();
} else if (command === "dev") {
  await dev();
} else {
  fail(`unknown command: ${command}\n\n${USAGE}`);
}
