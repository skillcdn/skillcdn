import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import type { Plugin } from "vite";

// The licenses of the npm packages the pages bundle, written next to the pages as
// `licenses/npm.txt`, one link away from the footer. They are read from what the build itself
// bundled, so that the list is right wherever the pages are built, in this workspace or by the
// published package in an installation's own directory (ADR-0101), and holds what a page of the
// installation's own brings in as well. Packages of this repository are not listed: their license
// is the repository's.

/** Where the notice is written in the build. */
export const NOTICE_FILE = "licenses/npm.txt";

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[-_.].*)?$/i;
const OWN_SCOPE = "@skillcdn/";

export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly homepage?: string | undefined;
  /** The license file the package ships, whatever it calls it. */
  readonly text?: string | undefined;
}

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly homepage?: string | undefined;
}

function manifestIn(directory: string): Manifest | undefined {
  const file = posix.join(directory, "package.json");
  if (!existsSync(file)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const fields = parsed as Record<string, unknown>;
  // A package.json that only says how the files beside it are read is not a package.
  if (typeof fields.name !== "string" || typeof fields.version !== "string") {
    return undefined;
  }
  const license =
    typeof fields.license === "string"
      ? fields.license
      : typeof fields.license === "object" &&
          fields.license !== null &&
          typeof (fields.license as { type?: unknown }).type === "string"
        ? (fields.license as { type: string }).type
        : "UNKNOWN";
  return {
    name: fields.name,
    version: fields.version,
    license,
    homepage: typeof fields.homepage === "string" ? fields.homepage : undefined,
  };
}

function licenseTextIn(directory: string): string | undefined {
  const names = readdirSync(directory).filter((name) => LICENSE_FILE.test(name));
  names.sort((a, b) => a.length - b.length || a.localeCompare(b));
  const [name] = names;
  return name === undefined ? undefined : readFileSync(posix.join(directory, name), "utf8").trim();
}

/**
 * The packages the modules of a bundle are files of: each module installed under `node_modules`
 * belongs to the nearest directory above it with a `package.json` that names a package, below
 * that `node_modules`. Virtual modules and the files of this repository belong to none.
 */
export function bundledPackages(moduleIds: Iterable<string>): BundledPackage[] {
  const ownerOf = new Map<string, string | undefined>();
  const found = new Map<string, BundledPackage>();
  for (const id of moduleIds) {
    const [path] = id.replace(/^\0/, "").split("?");
    const file = (path ?? "").replaceAll("\\", "/");
    const boundary = file.lastIndexOf("/node_modules/");
    if (boundary < 0) {
      continue;
    }
    const stop = boundary + "/node_modules".length;
    const passed: string[] = [];
    let directory = posix.dirname(file);
    let owner: string | undefined;
    while (directory.length > stop) {
      if (ownerOf.has(directory)) {
        owner = ownerOf.get(directory);
        break;
      }
      passed.push(directory);
      if (manifestIn(directory) !== undefined) {
        owner = directory;
        break;
      }
      directory = posix.dirname(directory);
    }
    for (const step of passed) {
      ownerOf.set(step, owner);
    }
    const manifest = owner === undefined ? undefined : manifestIn(owner);
    if (owner === undefined || manifest === undefined || manifest.name.startsWith(OWN_SCOPE)) {
      continue;
    }
    const key = `${manifest.name}@${manifest.version}`;
    if (!found.has(key)) {
      found.set(key, { ...manifest, text: licenseTextIn(owner) });
    }
  }
  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/** The notice: every package with its license and the text it ships. */
export function noticeOf(packages: readonly BundledPackage[]): string {
  const separator = "=".repeat(72);
  const sections = packages.map((entry) => {
    const heading = [
      `${entry.name} ${entry.version}`,
      `License: ${entry.license}`,
      ...(entry.homepage === undefined ? [] : [entry.homepage]),
    ].join("\n");
    const text =
      entry.text ??
      "(The package ships no license file; its package.json declares the license above.)";
    return `${heading}\n\n${text}`;
  });
  const header = [
    "Third-party notices for the SkillCDN web UI",
    "",
    "The npm packages bundled into these pages, each with the license it is distributed under and the notice it ships. Fonts and icons are listed in THIRD-PARTY-NOTICES.md of the repository and in the files next to this one.",
    "",
    `${packages.length} packages.`,
  ].join("\n");
  return `${header}\n\n${separator}\n\n${sections.join(`\n\n${separator}\n\n`)}\n`;
}

/** Writes the notice of what the pages bundled into the build of the pages. */
export function bundleLicenses(): Plugin {
  let ssr = false;
  return {
    name: "skillcdn-bundle-licenses",
    apply: "build",
    configResolved(config) {
      // The render module the server calls is not sent to anyone; the pages are.
      ssr = Boolean(config.build.ssr);
    },
    generateBundle() {
      if (ssr) {
        return;
      }
      this.emitFile({
        type: "asset",
        fileName: NOTICE_FILE,
        source: noticeOf(bundledPackages(this.getModuleIds())),
      });
    },
  };
}
