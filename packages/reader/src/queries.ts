import type { IndexEntry, LicenseKind } from "@skillcdn/core";
import { compareByteOrder, sortedByPath } from "./order.js";

// What the reader asks of the served entries of an index, as questions over the list the store
// answers with (`IndexStore.entries`): the same answers the deployment's database gave to the
// same questions in SQL, so that an index in memory reads as one in PostgreSQL does.

/** Whether `path` is under `mountPath`, which the empty path makes everything. */
const underPath = (path: string, mountPath: string): boolean =>
  mountPath.length === 0 || path.startsWith(`${mountPath}/`);

/** Documents and skills that are searchable: everything `find` can return. */
const findable = (entry: IndexEntry): boolean => entry.visible && entry.searchable;

/** Files that belong to a skill inside the mount: they are listed with the skill, not on their own. */
const ownedBySkillIn = (entry: IndexEntry, mountPath: string): boolean =>
  entry.skillDir !== undefined &&
  (mountPath.length === 0 || entry.skillDir === mountPath || underPath(entry.skillDir, mountPath));

/**
 * What to list: skills, every document, or only the documents that do not belong to a skill
 * inside the mount.
 */
export type EntryListing = "skills" | "documents" | "documents_outside_skills";

/**
 * What a mount offers when nobody asked for anything in particular: skills first, then
 * documents, each in path order. `only` narrows it.
 */
export function listEntries(
  entries: readonly IndexEntry[],
  mountPath: string,
  limit: number,
  only?: EntryListing,
): IndexEntry[] {
  const wanted = (entry: IndexEntry): boolean =>
    only === undefined
      ? true
      : only === "skills"
        ? entry.kind === "skill"
        : only === "documents"
          ? entry.kind !== "skill"
          : entry.kind !== "skill" && !ownedBySkillIn(entry, mountPath);
  return entries
    .filter((entry) => underPath(entry.path, mountPath) && findable(entry) && wanted(entry))
    .sort(
      (a, b) =>
        (a.kind === "skill" ? 0 : 1) - (b.kind === "skill" ? 0 : 1) ||
        compareByteOrder(a.path, b.path),
    )
    .slice(0, limit);
}

/** How many skills, and how many documents outside the skills, `listEntries` would return without a limit. */
export function countEntries(
  entries: readonly IndexEntry[],
  mountPath: string,
): { readonly skills: number; readonly documents: number } {
  let skills = 0;
  let documents = 0;
  for (const entry of entries) {
    if (!underPath(entry.path, mountPath) || !findable(entry)) {
      continue;
    }
    if (entry.kind === "skill") {
      skills += 1;
    } else if (!ownedBySkillIn(entry, mountPath)) {
      documents += 1;
    }
  }
  return { skills, documents };
}

/**
 * Skills inside a mount that answer to `name` or live in `directory`. Exact matches come first;
 * a name that only differs in case still matches, because models are careless with case.
 */
export function findSkills(
  entries: readonly IndexEntry[],
  mountPath: string,
  wanted: { readonly name: string; readonly directory: string | undefined },
  limit: number,
): IndexEntry[] {
  const lower = wanted.name.toLowerCase();
  return entries
    .filter(
      (entry) =>
        entry.kind === "skill" &&
        entry.visible &&
        underPath(entry.path, mountPath) &&
        (entry.name === wanted.name ||
          entry.name?.toLowerCase() === lower ||
          (wanted.directory !== undefined && entry.skillDir === wanted.directory)),
    )
    .sort(
      (a, b) =>
        (a.name === wanted.name ? 0 : 1) - (b.name === wanted.name ? 0 : 1) ||
        compareByteOrder(a.path, b.path),
    )
    .slice(0, limit);
}

/** The skills that live in exactly these directories, in path order. */
export function getSkillsAt(
  entries: readonly IndexEntry[],
  directories: readonly string[],
): IndexEntry[] {
  if (directories.length === 0) {
    return [];
  }
  const wanted = new Set(directories);
  return sortedByPath(
    entries.filter(
      (entry) =>
        entry.kind === "skill" &&
        entry.visible &&
        entry.skillDir !== undefined &&
        wanted.has(entry.skillDir),
    ),
    (entry) => entry.path,
  );
}

/**
 * The skills the MCP skills extension lists inside a mount, in path order: a page of them from
 * `offset`, and how many there are in all.
 */
export function listListedSkills(
  entries: readonly IndexEntry[],
  mountPath: string,
  offset: number,
  limit: number,
  options: { readonly includeRestricted: boolean },
): { readonly skills: IndexEntry[]; readonly total: number } {
  // A restrictive skill is listed only where the repository is verified (ADR-0026).
  const restricted: LicenseKind = "restrictive";
  const listed = sortedByPath(
    entries.filter(
      (entry) =>
        underPath(entry.path, mountPath) &&
        entry.visible &&
        entry.kind === "skill" &&
        entry.listed === true &&
        (options.includeRestricted || entry.licenseKind !== restricted),
    ),
    (entry) => entry.path,
  );
  return { skills: listed.slice(offset, offset + limit), total: listed.length };
}

/**
 * Every served file inside a skill directory whose bytes are stored, its own manifest and the
 * files of nested skills included, in path order: what the extension lists for the skill.
 */
export function listSkillResources(entries: readonly IndexEntry[], skillDir: string): IndexEntry[] {
  return sortedByPath(
    entries.filter(
      (entry) => underPath(entry.path, skillDir) && entry.visible && entry.digest !== undefined,
    ),
    (entry) => entry.path,
  );
}

/** Files that belong to a skill directory, the manifest itself excluded, in path order. */
export function listSkillFiles(
  entries: readonly IndexEntry[],
  skillDir: string,
  limit: number,
): string[] {
  return sortedByPath(
    entries.filter(
      (entry) => entry.skillDir === skillDir && entry.kind !== "skill" && entry.visible,
    ),
    (entry) => entry.path,
  )
    .slice(0, limit)
    .map((entry) => entry.path);
}

export interface DirectoryListing {
  readonly path: string;
  readonly kind: "file" | "directory";
  /** Bytes, for a file. */
  readonly size: number | undefined;
}

/**
 * The immediate entries of one directory: every file the tree had, searchable or not, and the
 * subdirectories, which come first. `directory` is empty for the root. With `servedOnly`, only
 * the files whose bytes are stored count, as the skills extension serves them.
 */
export function listDirectory(
  entries: readonly IndexEntry[],
  directory: string,
  limit: number,
  options: { readonly servedOnly?: boolean } = {},
): DirectoryListing[] {
  const prefix = directory.length === 0 ? "" : `${directory}/`;
  const children = new Map<string, { isFile: boolean; size: number | undefined }>();
  for (const entry of entries) {
    if (!entry.visible || (options.servedOnly === true && entry.digest === undefined)) {
      continue;
    }
    if (prefix.length > 0 && !entry.path.startsWith(prefix)) {
      continue;
    }
    const rest = entry.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const isFile = slash < 0;
    const known = children.get(name);
    if (known === undefined) {
      children.set(name, { isFile, size: isFile ? entry.size : undefined });
    } else if (isFile) {
      // A name that is a file and a directory at once is a file, with the largest size seen.
      known.isFile = true;
      known.size = Math.max(known.size ?? 0, entry.size);
    }
  }
  return [...children.entries()]
    .sort(
      ([nameA, a], [nameB, b]) =>
        (a.isFile ? 1 : 0) - (b.isFile ? 1 : 0) || compareByteOrder(nameA, nameB),
    )
    .slice(0, limit)
    .map(([name, child]) => ({
      path: `${prefix}${name}`,
      kind: child.isFile ? "file" : "directory",
      size: child.isFile ? child.size : undefined,
    }));
}

/** The served entry at `path`, when there is one. */
export function getEntry(entries: readonly IndexEntry[], path: string): IndexEntry | undefined {
  return entries.find((entry) => entry.visible && entry.path === path);
}

/**
 * The repository manifest that governs a mount: the one in the mounted directory, else the
 * nearest one above it, up to the root of the repository. `undefined` when there is none.
 */
export function getManifest(
  entries: readonly IndexEntry[],
  mountPath: string,
): IndexEntry | undefined {
  let directory = mountPath;
  while (true) {
    const candidate = directory.length === 0 ? "SKILLCDN.md" : `${directory}/SKILLCDN.md`;
    const found = entries.find(
      (entry) => entry.kind === "manifest" && entry.visible && entry.path === candidate,
    );
    if (found !== undefined) {
      return found;
    }
    if (directory.length === 0) {
      return undefined;
    }
    const slash = directory.lastIndexOf("/");
    directory = slash < 0 ? "" : directory.slice(0, slash);
  }
}
