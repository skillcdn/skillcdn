// What the published package carries beside its own files (ADR-0101), copied in while it is
// packed and taken out again after, so that each has one source in the repository: the
// repository's license, its trademark policy and its third-party notices, at the root of the
// package; and the documentation the pages are made from (ADR-0049), docs/nav.json and every
// file it publishes, with the license of a directory such a file is in, under documentation/ at
// their paths from the repository root. The declarations of what a configuration is written
// with, in types/, are made by `tsc` before this runs, and taken out with the rest.
//
//   node scripts/pack-files.mjs copy | remove
//   node scripts/pack-files.mjs documentation <directory>   (the documentation alone, elsewhere)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..", "..");
const NAV_FILE = "docs/nav.json";
const ROOT_FILES = ["LICENSE.md", "TRADEMARKS.md", "THIRD-PARTY-NOTICES.md"];
const DOCUMENTATION = join(WEB, "documentation");
const TYPES = join(WEB, "types");

/** docs/nav.json and the files it publishes, with the license of each directory they are in. */
function documentationFiles() {
  const nav = JSON.parse(readFileSync(join(ROOT, NAV_FILE), "utf8"));
  const files = new Set([NAV_FILE]);
  for (const section of nav.sections ?? []) {
    for (const page of section.pages ?? []) {
      if (typeof page.file === "string") {
        files.add(page.file);
        const license = `${page.file.split("/").slice(0, -1).join("/")}/LICENSE`;
        if (existsSync(join(ROOT, ...license.split("/")))) {
          files.add(license);
        }
      }
    }
  }
  return [...files].sort();
}

function copyDocumentation(target) {
  rmSync(target, { recursive: true, force: true });
  for (const file of documentationFiles()) {
    const to = join(target, ...file.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(ROOT, ...file.split("/")), to);
  }
}

const [action, target] = process.argv.slice(2);
if (action === "copy") {
  for (const file of ROOT_FILES) {
    copyFileSync(join(ROOT, file), join(WEB, file));
  }
  copyDocumentation(DOCUMENTATION);
} else if (action === "remove") {
  for (const file of ROOT_FILES) {
    rmSync(join(WEB, file), { force: true });
  }
  rmSync(DOCUMENTATION, { recursive: true, force: true });
  rmSync(TYPES, { recursive: true, force: true });
} else if (action === "documentation" && target !== undefined) {
  copyDocumentation(resolve(target));
} else {
  process.stderr.write(
    "usage: node scripts/pack-files.mjs copy | remove | documentation <directory>\n",
  );
  process.exit(64);
}
