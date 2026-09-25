// After the build: the licenses of every npm package that can end up in the web bundle, written
// to dist/licenses/npm.txt so that they ship with the pages and are one link away from the footer.
// Reads what pnpm knows about the installed packages and the license files inside them; no network.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "dist", "licenses", "npm.txt");

function pnpm(args) {
  const execpath = process.env.npm_execpath;
  const options = {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    cwd: root,
  };
  if (execpath !== undefined && /\.(?:c|m)?js$/.test(execpath)) {
    return execFileSync(process.execPath, [execpath, ...args], options);
  }
  const windows = process.platform === "win32";
  return execFileSync(windows ? "pnpm.cmd" : "pnpm", args, { ...options, shell: windows });
}

/** The license file a package ships, whatever it calls it. */
function licenseTextOf(directory) {
  const names = readdirSync(directory).filter((name) =>
    /^(?:licen[cs]e|copying)(?:[-_.].*)?$/i.test(name),
  );
  names.sort((a, b) => a.length - b.length || a.localeCompare(b));
  const [name] = names;
  return name === undefined ? undefined : readFileSync(join(directory, name), "utf8").trim();
}

// The web workspace and everything it depends on, workspace packages included: what the bundler
// may pull in. Development-only packages never reach the bundle.
const output = pnpm(["--filter", "@skillcdn/web...", "licenses", "list", "--json", "--prod"]);
const start = output.indexOf("{");
if (start < 0) {
  process.stderr.write("pnpm licenses list printed no JSON\n");
  process.exit(1);
}
const byLicense = JSON.parse(output.slice(start));
const packages = Object.entries(byLicense)
  .flatMap(([license, found]) => found.map((entry) => ({ ...entry, license })))
  .filter((entry) => !entry.name.startsWith("@skillcdn/"))
  .sort((a, b) => a.name.localeCompare(b.name));

const separator = "=".repeat(72);
const sections = packages.map((entry) => {
  const directory = entry.paths[0];
  const text = directory === undefined ? undefined : licenseTextOf(directory);
  const heading = [
    `${entry.name} ${entry.versions.join(", ")}`,
    `License: ${entry.license}`,
    ...(entry.homepage ? [entry.homepage] : []),
  ].join("\n");
  const notice =
    text ?? "(The package ships no license file; its package.json declares the license above.)";
  return `${heading}\n\n${notice}`;
});
const header = [
  "Third-party notices for the SkillCDN web UI",
  "",
  "The npm packages that may be bundled into these pages, each with the license it is distributed under and the notice it ships. Fonts and icons are listed in THIRD-PARTY-NOTICES.md of the repository and in the files next to this one.",
  "",
  `${packages.length} packages.`,
].join("\n");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${header}\n\n${separator}\n\n${sections.join(`\n\n${separator}\n\n`)}\n`);
if (!existsSync(target)) {
  process.stderr.write("the notices were not written\n");
  process.exit(1);
}
process.stdout.write(`licenses: ${packages.length} packages listed in ${target}\n`);
