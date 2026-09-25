import type { GitHostKey } from "./address.js";
import { parentDirectory } from "./repo-layout.js";
import { isWithinRepoPath, type RepoPath } from "./repo-path.js";

/**
 * What a license lets a deployment do with what a repository publishes (ADR-0026).
 *
 * `permissive` means that copies may be passed on with the license's notice. Copyleft licenses
 * allow that as well: their conditions bind what a reader does next, not the serving. `restrictive`
 * covers all rights reserved, no redistribution, non-commercial or no-derivatives terms, and every
 * text the reader does not recognize, which is the safe mistake. `none` is a repository that says
 * nothing.
 */
export type LicenseKind = "permissive" | "restrictive" | "none";

export interface LicenseFact {
  readonly kind: LicenseKind;
  /** The SPDX identifier when the license is recognized, else the declared text, bounded. */
  readonly name: string | undefined;
  /** The repository-root path of the license file or the manifest that said so. */
  readonly source: RepoPath | undefined;
}

export const NO_LICENSE: LicenseFact = { kind: "none", name: undefined, source: undefined };

/** How much of a license file the reader looks at. Every license it knows is shorter. */
export const MAX_LICENSE_TEXT_LENGTH = 65_536;
/** How much of a declared license text is kept when it is not recognized. */
export const MAX_LICENSE_NAME_LENGTH = 80;

const LICENSE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "",
  "md",
  "txt",
  "rst",
  "markdown",
  "lesser",
]);

/** `LICENSE`, `LICENSE.md`, `LICENSE-MIT`, `LICENCE`, `COPYING`, `UNLICENSE` and the like. */
export function isLicenseFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  const stem = dot < 0 ? name : name.slice(0, dot);
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return (
    /^(?:licen[cs]e|copying|unlicense)(?:[-_][a-z0-9.-]*)?$/i.test(stem) &&
    LICENSE_FILE_EXTENSIONS.has(extension)
  );
}

/** The one license file of a directory when it has several: the plainest name speaks. */
export function preferredLicenseFile(paths: readonly RepoPath[]): RepoPath | undefined {
  const nameOf = (path: RepoPath): string => (path.split("/").at(-1) ?? "").toLowerCase();
  const rank = (path: RepoPath): number => {
    const name = nameOf(path);
    if (name === "license") return 0;
    if (name.startsWith("license.")) return 1;
    if (name.startsWith("license")) return 2;
    if (name.startsWith("licence")) return 3;
    if (name.startsWith("copying")) return 4;
    return 5;
  };
  return [...paths]
    .filter((path) => isLicenseFileName(path.split("/").at(-1) ?? ""))
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

interface Recognized {
  readonly kind: "permissive" | "restrictive";
  readonly name: string | undefined;
}

const permissive = (name: string): Recognized => ({ kind: "permissive", name });
const restrictive = (name: string | undefined): Recognized => ({ kind: "restrictive", name });

/** A Creative Commons license by what its text says it allows. */
function creativeCommons(text: string): Recognized | undefined {
  const version =
    /\battribution\b[^.]{0,80}?(\d\.\d)\b/.exec(text) ??
    /\bcc[- ]by\b[^.]{0,40}?(\d\.\d)\b/.exec(text);
  if (version === null) return undefined;
  const nc = /\bnon-?commercial\b/.test(text);
  const nd = /\bno-?derivative/.test(text);
  const sa = /\bshare-?alike\b/.test(text);
  const name = `CC-BY${nc ? "-NC" : ""}${nd ? "-ND" : ""}${sa ? "-SA" : ""}-${version[1]}`;
  return nc || nd ? restrictive(name) : permissive(name);
}

const has =
  (phrase: string, found: Recognized): ((text: string) => Recognized | undefined) =>
  (text) =>
    text.includes(phrase) ? found : undefined;

/** The licenses the reader knows by their text, tried in this order. */
const KNOWN_TEXTS: readonly ((text: string) => Recognized | undefined)[] = [
  (t) =>
    t.includes("apache license") && t.includes("version 2.0")
      ? permissive("Apache-2.0")
      : undefined,
  has("mit no attribution", permissive("MIT-0")),
  has(
    "permission is hereby granted, free of charge, to any person obtaining a copy",
    permissive("MIT"),
  ),
  (t) =>
    t.includes(
      "permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted",
    )
      ? permissive(t.includes("provided that the above copyright notice") ? "ISC" : "0BSD")
      : undefined,
  (t) =>
    t.includes(
      "redistribution and use in source and binary forms, with or without modification, are permitted",
    )
      ? permissive(
          t.includes("advertising materials")
            ? "BSD-4-Clause"
            : t.includes("neither the name")
              ? "BSD-3-Clause"
              : "BSD-2-Clause",
        )
      : undefined,
  has(
    "this is free and unencumbered software released into the public domain",
    permissive("Unlicense"),
  ),
  (t) =>
    t.includes("cc0 1.0 universal") || t.includes("creative commons zero")
      ? permissive("CC0-1.0")
      : undefined,
  (t) =>
    t.includes("mozilla public license") && (t.includes("version 2.0") || t.includes("v. 2.0"))
      ? permissive("MPL-2.0")
      : undefined,
  (t) =>
    t.includes("eclipse public license")
      ? permissive(t.includes("2.0") ? "EPL-2.0" : "EPL-1.0")
      : undefined,
  has("gnu affero general public license", permissive("AGPL-3.0")),
  (t) =>
    t.includes("gnu lesser general public license")
      ? permissive(t.includes("version 3") ? "LGPL-3.0" : "LGPL-2.1")
      : undefined,
  (t) =>
    t.includes("gnu general public license")
      ? permissive(t.includes("version 3") ? "GPL-3.0" : "GPL-2.0")
      : undefined,
  has("altered source versions must be plainly marked as such", permissive("Zlib")),
  has("boost software license", permissive("BSL-1.0")),
  has("do what the fuck you want to public license", permissive("WTFPL")),
  (t) =>
    t.includes("artistic license") && t.includes("2.0") ? permissive("Artistic-2.0") : undefined,
  has("postgresql license", permissive("PostgreSQL")),
  has("sil open font license", permissive("OFL-1.1")),
  has("blue oak model license", permissive("BlueOak-1.0.0")),
  creativeCommons,
  has("polyform noncommercial", restrictive("PolyForm-Noncommercial-1.0.0")),
  has("business source license", restrictive("BUSL-1.1")),
  has("server side public license", restrictive("SSPL-1.0")),
  has("commons clause", restrictive("Commons-Clause")),
  has("all rights reserved", restrictive("All rights reserved")),
];

function normalizeText(text: string): string {
  return text.slice(0, MAX_LICENSE_TEXT_LENGTH).toLowerCase().replace(/\s+/g, " ");
}

/** What a license text allows: one of the licenses the reader knows, or restrictive. */
export function classifyLicenseText(text: string): Recognized {
  const normalized = normalizeText(text);
  for (const recognize of KNOWN_TEXTS) {
    const found = recognize(normalized);
    if (found !== undefined) return found;
  }
  return restrictive(undefined);
}

/** A license file as found: an unreadable one is one the reader does not recognize. */
export function classifyLicenseFile(path: RepoPath, text: string | undefined): LicenseFact {
  return {
    ...(text === undefined ? restrictive(undefined) : classifyLicenseText(text)),
    source: path,
  };
}

/** Declared identifiers, as authors write them, to what they mean. */
const KNOWN_IDS: Readonly<Record<string, Recognized>> = {
  mit: permissive("MIT"),
  "mit-0": permissive("MIT-0"),
  x11: permissive("X11"),
  isc: permissive("ISC"),
  "0bsd": permissive("0BSD"),
  bsd: permissive("BSD-3-Clause"),
  "bsd-2": permissive("BSD-2-Clause"),
  "bsd-2-clause": permissive("BSD-2-Clause"),
  "bsd-3": permissive("BSD-3-Clause"),
  "bsd-3-clause": permissive("BSD-3-Clause"),
  "bsd-4-clause": permissive("BSD-4-Clause"),
  apache: permissive("Apache-2.0"),
  "apache-2": permissive("Apache-2.0"),
  "apache-2.0": permissive("Apache-2.0"),
  apache2: permissive("Apache-2.0"),
  unlicense: permissive("Unlicense"),
  cc0: permissive("CC0-1.0"),
  "cc0-1.0": permissive("CC0-1.0"),
  "public-domain": permissive("CC0-1.0"),
  "cc-by": permissive("CC-BY-4.0"),
  "cc-by-sa": permissive("CC-BY-SA-4.0"),
  mpl: permissive("MPL-2.0"),
  "mpl-2.0": permissive("MPL-2.0"),
  "epl-1.0": permissive("EPL-1.0"),
  "epl-2.0": permissive("EPL-2.0"),
  gpl: permissive("GPL-3.0"),
  "gpl-2.0": permissive("GPL-2.0"),
  gplv2: permissive("GPL-2.0"),
  "gpl-3.0": permissive("GPL-3.0"),
  gplv3: permissive("GPL-3.0"),
  lgpl: permissive("LGPL-3.0"),
  "lgpl-2.1": permissive("LGPL-2.1"),
  "lgpl-3.0": permissive("LGPL-3.0"),
  agpl: permissive("AGPL-3.0"),
  "agpl-3.0": permissive("AGPL-3.0"),
  zlib: permissive("Zlib"),
  boost: permissive("BSL-1.0"),
  "bsl-1.0": permissive("BSL-1.0"),
  wtfpl: permissive("WTFPL"),
  "artistic-2.0": permissive("Artistic-2.0"),
  postgresql: permissive("PostgreSQL"),
  "ofl-1.1": permissive("OFL-1.1"),
  "blueoak-1.0.0": permissive("BlueOak-1.0.0"),
  proprietary: restrictive("Proprietary"),
  confidential: restrictive("Proprietary"),
  "all-rights-reserved": restrictive("All rights reserved"),
  arr: restrictive("All rights reserved"),
  unlicensed: restrictive("All rights reserved"),
  none: restrictive("All rights reserved"),
  "busl-1.1": restrictive("BUSL-1.1"),
  "sspl-1.0": restrictive("SSPL-1.0"),
  "commons-clause": restrictive("Commons-Clause"),
  "elastic-2.0": restrictive("Elastic-2.0"),
  "polyform-noncommercial-1.0.0": restrictive("PolyForm-Noncommercial-1.0.0"),
};

/** `MIT License`, `Apache License 2.0`, `GPL-3.0-or-later` and `the MIT` all name known ids. */
function normalizeId(part: string): string {
  return part
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/^the-/, "")
    .replace(/-?licen[cs]e(?=-\d|$)/, "")
    .replace(/-?(?:only|or-later)$/, "")
    .replace(/-v(\d)/, "-$1")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function recognizeId(part: string): Recognized | undefined {
  const id = normalizeId(part);
  const known = KNOWN_IDS[id];
  if (known !== undefined) return known;
  if (/^cc-by(?:-(?:nc|nd|sa))*(?:-\d\.\d)?$/.test(id)) {
    const name = /-\d\.\d$/.test(id) ? id.toUpperCase() : `${id.toUpperCase()}-4.0`;
    return id.includes("-nc") || id.includes("-nd") ? restrictive(name) : permissive(name);
  }
  if (id.startsWith("fsl-")) return restrictive("FSL-1.1");
  return undefined;
}

/**
 * What a `license` field declares. `undefined` when it declares nothing and points elsewhere
 * (`See LICENSE`), so that the next source speaks. An expression is as closed as its most closed
 * part; a text the reader does not know is restrictive, kept as written for the author to see.
 */
export function classifyLicenseField(path: RepoPath, value: string): LicenseFact | undefined {
  const declared = value.trim();
  if (declared.length === 0) return undefined;
  const lower = declared.toLowerCase();
  if (
    /^(?:see|refer to|in|as in|per)\b/.test(lower) ||
    /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?(?: file)?$/.test(lower) ||
    /\.(?:md|txt)$/.test(lower)
  ) {
    return undefined;
  }
  if (declared.length > 120) return { ...classifyLicenseText(declared), source: path };
  const parts = declared.split(/\s+(?:or|and|with)\s+|\s*\/\s*/i).filter((part) => part.length > 0);
  const recognized = parts.map(recognizeId);
  if (recognized.every((part) => part !== undefined)) {
    const names = recognized.map((part) => part.name).filter((name) => name !== undefined);
    return {
      kind: recognized.some((part) => part.kind === "restrictive") ? "restrictive" : "permissive",
      name: names.join(" / "),
      source: path,
    };
  }
  return { kind: "restrictive", name: declared.slice(0, MAX_LICENSE_NAME_LENGTH), source: path };
}

export interface LicenseSources {
  /** A license file in the skill's own directory. */
  readonly skillFile?: LicenseFact | undefined;
  /** The skill's `license` field. */
  readonly skillField?: { readonly path: RepoPath; readonly value: string } | undefined;
  /** The `license` fields of the manifests above, nearest first; the repository root's is last. */
  readonly manifestFields: readonly { readonly path: RepoPath; readonly value: string }[];
  /** The repository's license file. */
  readonly rootFile?: LicenseFact | undefined;
}

/**
 * The license that governs a skill, or a file outside the skills when the skill sources are
 * left out: the first of these that says something speaks. A file in the skill's directory, the
 * skill's own field, the manifests between the skill and the repository root, the repository's
 * license file, the root manifest's field; else the repository says nothing.
 */
export function resolveLicense(sources: LicenseSources): LicenseFact {
  if (sources.skillFile !== undefined) return sources.skillFile;
  const declared =
    sources.skillField === undefined
      ? undefined
      : classifyLicenseField(sources.skillField.path, sources.skillField.value);
  if (declared !== undefined) return declared;
  const nested = sources.manifestFields.filter((field) => field.path.includes("/"));
  const root = sources.manifestFields.find((field) => !field.path.includes("/"));
  for (const field of nested) {
    const fact = classifyLicenseField(field.path, field.value);
    if (fact !== undefined) return fact;
  }
  if (sources.rootFile !== undefined) return sources.rootFile;
  const fromRoot = root === undefined ? undefined : classifyLicenseField(root.path, root.value);
  return fromRoot ?? NO_LICENSE;
}

/** What an index entry says about licenses: a manifest's `license` field. */
export interface LicensedEntry {
  readonly path: string;
  readonly kind: string;
  readonly license?: string | undefined;
}

/**
 * The license that governs a path outside the skills: the nearest manifest above it that
 * declares one, else the repository's own (its license file or its root manifest's field, as
 * the index resolved it). A skill's files follow the skill's own fact instead.
 */
export function licenseOfPath(
  entries: readonly LicensedEntry[],
  path: RepoPath,
  repository: LicenseFact,
): LicenseFact {
  const nested = entries
    .filter(
      (entry) =>
        entry.kind === "manifest" &&
        entry.license !== undefined &&
        entry.path.includes("/") &&
        isWithinRepoPath(parentDirectory(entry.path as RepoPath), path),
    )
    .sort((a, b) => b.path.length - a.path.length);
  for (const manifest of nested) {
    const fact = classifyLicenseField(manifest.path as RepoPath, manifest.license ?? "");
    if (fact !== undefined) return fact;
  }
  return repository;
}

/** `MIT (LICENSE)`, `unrecognized (skills/x/LICENSE)`, `none declared`. */
export function describeLicense(fact: LicenseFact): string {
  if (fact.kind === "none") return "none declared";
  const name = fact.name ?? "unrecognized";
  return fact.source === undefined ? name : `${name} (${fact.source})`;
}

/** Whether a mount serves content under this license in full, or describes it only. */
export function servesInFull(fact: LicenseFact, verified: boolean): boolean {
  return fact.kind !== "restrictive" || verified;
}

/** Where a file of a commit can be read at its host, for a reader sent to the source. */
export function sourceFileUrl(
  repository: { readonly host: GitHostKey; readonly owner: string; readonly name: string },
  commit: string,
  path: RepoPath,
): string {
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/blob/${commit}/${encoded}`;
}
