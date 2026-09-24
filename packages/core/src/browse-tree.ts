import { parentDirectory, type RepoFileKind, SKILL_MANIFEST_FILE } from "./repo-layout.js";
import { type RepoPath, ROOT_PATH } from "./repo-path.js";
import type { BrowseEntry } from "./tools/results.js";

/** One already-published file, independent of storage or transport representation. */
export interface CatalogFile {
  readonly path: RepoPath;
  readonly kind: RepoFileKind;
  readonly name?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly skillDir?: RepoPath | undefined;
  readonly searchable: boolean;
  readonly size: number;
  readonly linkedOnly?: boolean | undefined;
  readonly language?: string | undefined;
}

interface Child {
  direct: CatalogFile | undefined;
  skill: CatalogFile | undefined;
  skillCount: number;
  documentCount: number;
}

/** Immediate canonical children, with descendant counts and inherited manifest language. */
export function browseCatalogFiles(files: readonly CatalogFile[], path: RepoPath): BrowseEntry[] {
  const manifests = new Map<RepoPath, CatalogFile>();
  const children = new Map<RepoPath, Child>();
  const prefix = path.length === 0 ? "" : `${path}/`;
  for (const file of files) {
    if (file.linkedOnly === true) continue;
    if (file.kind === "manifest") manifests.set(parentDirectory(file.path), file);
    if (!file.path.startsWith(prefix)) continue;
    const relative = file.path.slice(prefix.length);
    if (relative.length === 0) continue;
    const slash = relative.indexOf("/");
    // This is a whole-segment prefix of an already validated canonical path.
    const childPath = `${prefix}${slash < 0 ? relative : relative.slice(0, slash)}` as RepoPath;
    let child = children.get(childPath);
    if (child === undefined) {
      child = { direct: undefined, skill: undefined, skillCount: 0, documentCount: 0 };
      children.set(childPath, child);
    }
    if (file.path === childPath) child.direct = file;
    if (file.kind === "skill") {
      child.skillCount += 1;
      if (file.path === childPath || file.path === `${childPath}/${SKILL_MANIFEST_FILE}`) {
        child.skill = file;
      }
    }
    if (
      file.searchable &&
      file.skillDir === undefined &&
      (file.kind === "markdown" || file.kind === "json")
    ) {
      child.documentCount += 1;
    }
  }

  const result: BrowseEntry[] = [];
  for (const [childPath, child] of children) {
    const { direct, skill } = child;
    if (direct?.kind === "manifest") continue;
    const ownManifest = manifests.get(childPath);
    let ancestor = childPath;
    let language: string | null = null;
    while (true) {
      const declared = manifests.get(ancestor)?.language;
      if (declared !== undefined) {
        language = declared;
        break;
      }
      if (ancestor === ROOT_PATH) break;
      ancestor = parentDirectory(ancestor);
    }
    result.push({
      ...(skill === undefined ? {} : { browsePath: parentDirectory(skill.path) }),
      kind: skill !== undefined ? "skill" : direct === undefined ? "directory" : "file",
      path: skill?.path ?? childPath,
      name: skill?.name ?? ownManifest?.name ?? direct?.title ?? null,
      description: skill?.description ?? ownManifest?.description ?? direct?.description ?? null,
      skillCount: child.skillCount,
      documentCount: child.documentCount,
      size: (skill ?? direct)?.size ?? null,
      manifestPath: ownManifest?.path ?? null,
      language,
    });
  }
  return result.sort(
    (a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}
