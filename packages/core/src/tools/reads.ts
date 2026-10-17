import type { LicenseFact } from "../license.js";
import type { RepoFileKind } from "../repo-layout.js";
import type { RepoTranslation } from "../repo-manifest.js";
import type { RepoPath } from "../repo-path.js";
import type { SkillTranslation } from "../skill-manifest.js";
import type {
  BrowseEntry,
  DirectoryResult,
  FileResult,
  FindItem,
  FolderOverview,
  IndexDiagnostic,
  MountSummary,
  SkillResult,
} from "./results.js";

// What a read of a mount answers besides a result: that the index is not there to answer from,
// and the outcomes of looking a skill or a file up. The reader produces these, the MCP tools
// and the REST API say them in their own words, and a program that reads the REST API gets
// them back as data (rest/results.ts).

/** The index of the commit is not there to answer from: still being built, or the build failed. */
export type IndexNotReady =
  | { readonly status: "indexing" }
  | { readonly status: "failed"; readonly errorCode: string };

export type SkillLookup =
  | { readonly kind: "found"; readonly skill: SkillResult }
  | {
      readonly kind: "not_found";
      readonly available: readonly string[];
      /** What could not be read: the skill asked for may be among them. */
      readonly diagnostics: readonly IndexDiagnostic[];
    }
  | { readonly kind: "ambiguous"; readonly directories: readonly string[] }
  /** Indexed, but its body is not at hand. */
  | { readonly kind: "unavailable" };

/** What the index says about a file that was read: where it is, what it is, and whose it is. */
export interface IndexedFile {
  /** The repository-root path. */
  readonly path: string;
  readonly kind: RepoFileKind;
  /** The directory of the skill the file belongs to, or null outside every skill. */
  readonly skillDir: string | null;
}

export type FileLookup =
  | { readonly kind: "found"; readonly file: FileResult; readonly indexed: IndexedFile }
  | { readonly kind: "not_ready"; readonly outcome: IndexNotReady }
  /** The path names a directory: its entries are the answer. */
  | { readonly kind: "directory"; readonly directory: DirectoryResult }
  | { readonly kind: "invalid_path"; readonly reason: string }
  | {
      readonly kind: "not_found";
      readonly path: RepoPath;
      readonly suggestions?: readonly string[];
    }
  /** Over the read limit: the bytes are at the source, at `sourceUrl` (ADR-0033). */
  | {
      readonly kind: "too_large";
      readonly path: RepoPath;
      readonly size: number;
      readonly limit: number;
      readonly sourceUrl: string;
    }
  /** Not text, so not what a read carries: the bytes are at the source, at `sourceUrl`. */
  | { readonly kind: "not_text"; readonly path: RepoPath; readonly sourceUrl: string }
  /** The license allows a description of the file's skill or repository, not a copy (ADR-0026). */
  | {
      readonly kind: "not_served";
      readonly path: RepoPath;
      readonly license: LicenseFact;
      readonly sourceUrl: string;
    };

/** One skill as a mount lists it. */
export interface SkillListing {
  readonly name: string;
  readonly directory: RepoPath;
  readonly description: string;
  readonly warnings: readonly string[];
  readonly translations: Readonly<Record<string, SkillTranslation>>;
}

/** The repository manifest that governs a mount, as read from the index. */
export interface MountManifest {
  /** Relative to the mounted root; `undefined` when the manifest lies above the mount. */
  readonly path: RepoPath | undefined;
  readonly name: string | undefined;
  readonly description: string;
  /** The tag of the language the repository says it is written in. */
  readonly language: string | undefined;
  /**
   * The picture the nearest manifest that has one declares (ADR-0031): a repository-root path
   * of a file the tree has, or an `https` URL.
   */
  readonly image: string | undefined;
  readonly translations: Readonly<Record<string, RepoTranslation>>;
  /** The Markdown after the front-matter, trimmed: the rules. Empty when there are none. */
  readonly rules: string;
}

/** Everything a mount offers, as the `mounts` route answers it and the catalog is made from. */
export interface MountOverview {
  readonly overview?: FolderOverview;
  readonly groups?: readonly BrowseEntry[];
  readonly mount: MountSummary;
  readonly manifest: MountManifest | undefined;
  /** The license that governs the mounted directory outside its skills (ADR-0026). */
  readonly license: LicenseFact;
  readonly skillCount: number;
  readonly documentCount: number;
  readonly skills: readonly SkillListing[];
  readonly documents: readonly Extract<FindItem, { kind: "document" }>[];
  readonly diagnostics: readonly IndexDiagnostic[];
}
