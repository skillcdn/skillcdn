// Every production dependency ships in the image or the web build, so its license must allow
// that: permissive only, no copyleft and nothing source-available (CLAUDE.md, Dependencies).
// Part of `pnpm check`. Reads what pnpm knows about the installed packages; no network.
import { execFileSync } from "node:child_process";
import process from "node:process";

/** SPDX identifiers that permit bundling and redistribution without conditions we cannot meet. */
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "CC-BY-4.0",
  "Zlib",
]);

/** `(MIT OR Apache-2.0)` is fine when one side is; `MIT AND X` only when both are. */
function allowed(expression) {
  const trimmed = expression.trim().replace(/^\(|\)$/g, "");
  if (/\bOR\b/i.test(trimmed)) return trimmed.split(/\s+OR\s+/i).some(allowed);
  if (/\bAND\b/i.test(trimmed)) return trimmed.split(/\s+AND\s+/i).every(allowed);
  return ALLOWED.has(trimmed);
}

function pnpm(args) {
  const execpath = process.env.npm_execpath;
  const options = {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  };
  if (execpath !== undefined && /\.(?:c|m)?js$/.test(execpath)) {
    return execFileSync(process.execPath, [execpath, ...args], options);
  }
  const windows = process.platform === "win32";
  return execFileSync(windows ? "pnpm.cmd" : "pnpm", args, { ...options, shell: windows });
}

const output = pnpm(["licenses", "list", "--json", "--prod"]);
const start = output.indexOf("{");
if (start < 0) {
  process.stderr.write("pnpm licenses list printed no JSON\n");
  process.exit(1);
}
const byLicense = JSON.parse(output.slice(start));
const offenders = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const found of packages) {
    count += 1;
    if (!allowed(license)) {
      offenders.push(`${found.name}@${found.versions.join(", ")}: ${license}`);
    }
  }
}
if (offenders.length > 0) {
  process.stderr.write("production dependencies under a license that is not allowed to ship:\n");
  for (const line of offenders) process.stderr.write(`- ${line}\n`);
  process.exit(1);
}
process.stdout.write(`licenses: ${count} production packages, all under allowed licenses\n`);
