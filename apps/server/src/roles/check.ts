import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  type BlobStore,
  BROWSE_DEFAULT_LIMIT,
  browseCatalogFiles,
  type CatalogFile,
  FIND_LIST_SKILLS_MAX,
  folderOverview,
  type GitHost,
  GitHostError,
  INSTRUCTIONS_MAX_LENGTH,
  type IndexDiagnostic,
  type IndexLimits,
  type MountCatalog,
  parseRepoPath,
  type RepoPath,
  ROOT_PATH,
  renderInstructions,
  splitFrontMatter,
  type TreeEntry,
} from "@skillcdn/core";
import type { NewIndexEntry } from "@skillcdn/db";
import { buildSnapshotIndex } from "../indexer/build-index.js";
import { gitBlobHash } from "../indexer/git-hash.js";

// The `check` role: a working tree read by the same indexer that reads a commit, and a report
// of what an agent would get. For repository authors, before they push; it needs no database
// and no git host, and it executes nothing from the directory.

export interface CheckOptions {
  readonly directory: string;
  readonly limits: IndexLimits;
  /** Where the report goes. */
  readonly write: (text: string) => void;
}

interface LocalFile {
  readonly entry: TreeEntry;
  /** Left out for a file too large to be indexed: listed, never read. */
  readonly bytes: Uint8Array | undefined;
}

/** How many not-served paths the report names. */
const NAMED_NOT_SERVED = 12;
/** The commit a working tree stands in for, in results. */
const NO_COMMIT = "0".repeat(40);

/** Entries a working tree has and a git tree does not, or that are never served anyway. */
function isSkipped(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

function pathOf(text: string): RepoPath {
  const parsed = parseRepoPath(text);
  return parsed.ok ? parsed.value : ROOT_PATH;
}

/**
 * The files of a directory as tree entries: `.git`, `node_modules` and ordinary symbolic links
 * are left out. A symlink policy remains an unreadable boundary, without following its target.
 * Hidden skills and explicitly referenced files follow the indexer's rules. A
 * file too large to be indexed gets a stand-in hash: nothing ever asks for its body.
 */
async function readWorkingTree(
  root: string,
  limits: IndexLimits,
): Promise<{ readonly files: LocalFile[]; readonly skipped: number }> {
  const files: LocalFile[] = [];
  let skipped = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (isSkipped(entry.name)) {
        skipped += 1;
        continue;
      }
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        const parsed = entry.name === "SKILLCDN.md" ? parseRepoPath(path) : undefined;
        if (parsed?.ok === true) {
          files.push({
            entry: {
              path: parsed.value,
              type: "symlink",
              size: 0,
              hash: createHash("sha1").update(`unread policy link ${path}`).digest("hex"),
            },
            bytes: undefined,
          });
        } else {
          skipped += 1;
        }
        continue;
      }
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const parsed = parseRepoPath(path);
      if (!parsed.ok) {
        skipped += 1;
        continue;
      }
      const size = (await stat(absolute)).size;
      if (size > limits.maxIndexedFileBytes) {
        const hash = createHash("sha1").update(`unread ${path}`).digest("hex");
        files.push({ entry: { path: parsed.value, type: "file", size, hash }, bytes: undefined });
        continue;
      }
      const bytes = new Uint8Array(await readFile(absolute));
      files.push({
        entry: {
          path: parsed.value,
          type: "file",
          size: bytes.byteLength,
          hash: gitBlobHash(bytes),
        },
        bytes,
      });
    }
  };
  await walk(root, "");
  return { files, skipped };
}

function warningsLine(entry: NewIndexEntry, indent: string): string {
  const warnings = entry.frontMatter?.warnings ?? [];
  return warnings.length === 0
    ? `${indent}warnings: none\n`
    : `${indent}warnings:\n${warnings.map((warning) => `${indent}- ${warning}\n`).join("")}`;
}

function translationsLine(entry: NewIndexEntry, indent: string): string {
  const tags = Object.keys(entry.frontMatter?.translations ?? {});
  return tags.length === 0 ? "" : `${indent}translations: ${tags.join(", ")}\n`;
}

/**
 * Reads `directory` as the indexer would read a commit and reports what an agent would get.
 * Returns the exit code: 0 when there are no index diagnostics, 1 when there are, 2 when the
 * directory cannot be read at all.
 */
export async function checkDirectory(options: CheckOptions): Promise<number> {
  const { limits, write } = options;
  const root = resolve(options.directory);
  const info = await stat(root).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    write(`${options.directory}: not a directory that can be read\n`);
    return 2;
  }
  const { files, skipped } = await readWorkingTree(root, limits);
  const byHash = new Map(files.map((file) => [file.entry.hash, file]));
  const gitHost: Pick<GitHost, "getTree" | "readBlob"> = {
    async getTree() {
      return { entries: files.map((file) => file.entry), truncated: false };
    },
    async readBlob(_coordinates, hash, maxBytes) {
      const file = byHash.get(hash);
      if (file?.bytes === undefined) {
        throw new GitHostError("not_found", "no such file in the directory");
      }
      if (file.bytes.byteLength > maxBytes) {
        throw new GitHostError("invalid", "the file is larger than the limit");
      }
      return file.bytes;
    },
  };
  const texts = new Map<string, string>();
  const blobStore: BlobStore = {
    async read(hash) {
      return texts.get(hash);
    },
    async write(hash, content) {
      texts.set(hash, content);
    },
    async missing(hashes) {
      return new Set(hashes.filter((hash) => !texts.has(hash)));
    },
  };
  const index = await buildSnapshotIndex({
    gitHost,
    blobStore,
    coordinates: { host: "gh", owner: "local", repo: basename(root) },
    commit: NO_COMMIT,
    limits,
    signal: new AbortController().signal,
  });

  const byPath = (a: NewIndexEntry, b: NewIndexEntry): number => (a.path < b.path ? -1 : 1);
  const manifest = index.entries.find(
    (entry) => entry.visible && entry.kind === "manifest" && entry.path === "SKILLCDN.md",
  );
  const skills = index.entries
    .filter((entry) => entry.visible && entry.kind === "skill")
    .sort(byPath);
  const documents = index.entries
    .filter(
      (entry) =>
        entry.visible &&
        entry.searchable &&
        (entry.kind === "markdown" || entry.kind === "json") &&
        entry.skillDir === undefined,
    )
    .sort(byPath);
  const notServed = index.entries.filter((entry) => !entry.visible).sort(byPath);
  const diagnostics: IndexDiagnostic[] = index.diagnostics.map((diagnostic) => ({
    path: pathOf(diagnostic.path),
    code: diagnostic.code,
    message: diagnostic.message,
  }));
  const rulesOf = (entry: NewIndexEntry): string => {
    const text = texts.get(entry.blobSha);
    const split = text === undefined ? undefined : splitFrontMatter(text);
    return split?.kind === "found" ? split.body.trim() : "";
  };
  const catalogFiles: CatalogFile[] = index.entries
    .filter((entry) => entry.visible)
    .map((entry) => ({
      path: pathOf(entry.path),
      kind: entry.kind,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      skillDir: entry.skillDir === undefined ? undefined : pathOf(entry.skillDir),
      searchable: entry.searchable,
      size: entry.size,
      linkedOnly: entry.frontMatter?.linkedOnly,
      overviewOnly: entry.frontMatter?.overviewOnly,
      language: entry.frontMatter?.language,
    }));
  const overview = folderOverview(catalogFiles, ROOT_PATH);

  write(
    `Read ${root} as SkillCDN would index it: ${files.length} files` +
      `${skipped === 0 ? "" : `; ${skipped} .git entries, symbolic links or node_modules skipped`}` +
      `${index.truncated ? "; over the indexing limits, so the index is partial" : ""}.\n\n`,
  );

  if (manifest === undefined) {
    write(
      "Repository manifest: none. Skills, docs/ and optional folder READMEs are served. " +
        "A SKILLCDN.md can declare metadata, document directories, exclusions and shared rules.\n\n",
    );
  } else {
    const rules = rulesOf(manifest);
    write(
      `Repository manifest: ${manifest.path}\n` +
        `  name: ${manifest.name ?? "(the repository's name on the git host)"}\n` +
        `  description: ${manifest.description ?? ""}\n` +
        `  language: ${manifest.frontMatter?.language ?? "(not declared)"}\n` +
        (manifest.frontMatter?.manifestError === undefined
          ? ""
          : `  unavailable: ${manifest.frontMatter.manifestError}\n`) +
        translationsLine(manifest, "  ") +
        `  documents: ${(manifest.frontMatter?.documents ?? []).map((directory) => (directory === "" ? "." : directory)).join(", ") || "(none)"}\n` +
        `  rules: ${rules.length === 0 ? "none" : `${rules.length} characters`}\n` +
        warningsLine(manifest, "  ") +
        "\n",
    );
  }

  write(`Skills: ${skills.length}\n`);
  for (const skill of skills) {
    const directory = skill.skillDir ?? "";
    const owned = index.entries.filter(
      (entry) => entry.visible && entry.skillDir === directory && entry.kind !== "skill",
    );
    const included = skill.frontMatter?.include ?? [];
    write(
      `- ${skill.name ?? "?"} (${directory === "" ? "." : directory})\n` +
        `  ${skill.description ?? ""}\n` +
        `  files: ${owned.length}${included.length === 0 ? "" : ` (${included.length} returned with the skill)`}\n` +
        translationsLine(skill, "  ") +
        warningsLine(skill, "  "),
    );
  }
  write("\n");

  write(`Documents outside the skills: ${documents.length}\n`);
  for (const document of documents) {
    write(`- ${document.path}${document.title === undefined ? "" : ` - ${document.title}`}\n`);
  }
  write("\n");

  if (notServed.length > 0) {
    const named = notServed.slice(0, NAMED_NOT_SERVED).map((entry) => entry.path);
    const rest =
      notServed.length > NAMED_NOT_SERVED
        ? `, and ${notServed.length - NAMED_NOT_SERVED} more`
        : "";
    write(`Not served: ${notServed.length} files (${named.join(", ")}${rest})\n\n`);
  }

  const linked = index.entries.filter(
    (entry) => entry.visible && entry.frontMatter?.linkedOnly === true,
  );
  const overviews = index.entries.filter(
    (entry) => entry.visible && entry.frontMatter?.overviewOnly === true,
  );
  write(
    `Optional overview files: ${overviews.length}${overviews.length === 0 ? "" : ` (${overviews.map((entry) => entry.path).join(", ")})`}\n\n`,
  );
  write(`Linked reference files: ${linked.length}\n\n`);
  write(`Index diagnostics: ${diagnostics.length}\n`);
  for (const diagnostic of diagnostics) {
    write(`- ${diagnostic.path} (${diagnostic.code}): ${diagnostic.message}\n`);
  }
  write("\n");

  const catalog: MountCatalog = {
    overview,
    groups: browseCatalogFiles(catalogFiles, ROOT_PATH).slice(0, BROWSE_DEFAULT_LIMIT),
    mount: {
      repository: basename(root),
      ref: undefined,
      commit: NO_COMMIT,
      path: ROOT_PATH,
      verified: true,
      truncated: index.truncated,
    },
    manifest:
      manifest?.description === undefined
        ? undefined
        : {
            name: manifest.name,
            description: manifest.description ?? "",
            path: pathOf(manifest.path),
            hasRules: rulesOf(manifest).length > 0,
            language: manifest.frontMatter?.language,
          },
    skills: skills.slice(0, FIND_LIST_SKILLS_MAX).map((skill) => ({
      name: skill.name ?? "",
      directory: pathOf(skill.skillDir ?? ""),
      description: skill.description ?? "",
    })),
    skillCount: skills.length,
    documentCount: documents.length,
    diagnostics,
  };
  const instructions = renderInstructions({ status: "ready", catalog });
  write(
    `What a client is told on connect (${instructions.length} of ${INSTRUCTIONS_MAX_LENGTH} characters):\n` +
      `${instructions
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}\n\n`,
  );

  write(
    diagnostics.length === 0
      ? "ok: no index diagnostics\n"
      : `${diagnostics.length} index issue(s) found\n`,
  );
  return diagnostics.length === 0 ? 0 : 1;
}
