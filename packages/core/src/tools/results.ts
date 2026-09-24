import type { RepoPath } from "../repo-path.js";
import type { SkillTranslation } from "../skill-manifest.js";

export interface FileReference {
  readonly source?: string;
  readonly href: string;
  readonly path: string;
  readonly status: "available" | "outside_mount" | "missing" | "blocked";
}
export interface BrowseEntry {
  readonly browsePath?: RepoPath;
  readonly overviewPath?: RepoPath;
  readonly kind: "directory" | "skill" | "file";
  readonly path: RepoPath;
  readonly name: string | null;
  readonly description: string | null;
  readonly skillCount: number;
  readonly documentCount: number;
  readonly size: number | null;
  readonly manifestPath: string | null;
  readonly language: string | null;
}
/** An optional introduction, read explicitly instead of inherited as skill rules. */
export interface FolderOverview {
  readonly path: RepoPath;
  readonly title: string | undefined;
  readonly description: string | undefined;
}
export interface BrowseResult {
  readonly diagnostics?: readonly IndexDiagnostic[];
  readonly diagnosticsTotal?: number;
  readonly overview?: FolderOverview;
  readonly mount: MountSummary;
  readonly path: RepoPath;
  readonly entries: readonly BrowseEntry[];
  readonly nextCursor: string | undefined;
}

/** What a tool call was answered from. Content paths are repository-root paths. */
export interface MountSummary {
  /** `owner/name` as the host spells it. */
  readonly repository: string;
  /** The ref as written in the address; `undefined` for the default branch. */
  readonly ref: string | undefined;
  readonly commit: string;
  readonly path: RepoPath;
  /** False until the repository owner, or the operator, has vouched for the repository. */
  readonly verified: boolean;
  /** True when the repository was too large to index completely. */
  readonly truncated: boolean;
}

/**
 * A finding of the convention parser for the repository author: a manifest that could not be
 * read, so what it declares is not served, and why.
 */
export interface IndexDiagnostic {
  readonly path: RepoPath;
  readonly code: string;
  readonly message: string;
}

/** A file of a skill that matched a search; it is listed under its skill, never on its own. */
export interface FindFile {
  readonly path: RepoPath;
  readonly title: string | undefined;
  readonly summary: string | undefined;
}

export type FindItem =
  | {
      readonly kind: "skill";
      readonly path?: RepoPath;
      readonly name: string;
      readonly directory: RepoPath;
      readonly description: string;
      /** With a query: the files of the skill that matched as well, best first. */
      readonly files: readonly FindFile[];
      /** How many more of its files matched than are listed. */
      readonly moreFiles: number;
      /** For people: the title and the description in other languages. Not rendered for a model. */
      readonly translations: Readonly<Record<string, SkillTranslation>>;
    }
  | {
      readonly kind: "document";
      readonly path: RepoPath;
      readonly title: string | undefined;
      readonly summary: string | undefined;
      /** The directory of the skill the document belongs to, when it belongs to one in the mount. */
      readonly skillDirectory: RepoPath | undefined;
    };

export interface FindResult {
  readonly diagnosticsTotal?: number;
  readonly path?: RepoPath;
  readonly nextCursor?: string | undefined;
  readonly mount: MountSummary;
  readonly query: string | undefined;
  readonly items: readonly FindItem[];
  /** Without a query: how many skills, and how many documents outside the skills, the mount has. */
  readonly totals: { readonly skills: number; readonly documents: number } | undefined;
  /** Manifests inside the mount that could not be read, so what they declare is not served. */
  readonly diagnostics: readonly IndexDiagnostic[];
}

/** Legacy rendering bound; current get_skill context uses SKILL_PAGE_BYTES. */
export const MAX_SKILL_RULES_LENGTH = 8_000;
/** How much text the files a skill declares as needed on every run may add to it, together. */
export const MAX_SKILL_INCLUDED_LENGTH = 100_000;

/** The rules that hold for every skill of the repository, from its manifest (SKILLCDN.md). */
export interface SkillRules {
  /** The manifest's canonical repository-root path. */
  readonly path: RepoPath | undefined;
  readonly body: string;
  /** True when this page ends before the rule body is complete. */
  readonly truncated: boolean;
}

/** A file the skill declares as needed on every run, returned with the skill. */
export interface IncludedFile {
  /** The canonical repository-root path. */
  readonly path: RepoPath;
  /** The text; `undefined` when it is not at hand (not indexed, or over the limits). */
  readonly content: string | undefined;
  /** True when this page ends before the included file is complete. */
  readonly truncated: boolean;
}

export interface SkillResult {
  readonly referencesTruncated?: boolean;
  /** Optional metadata or author warnings were abbreviated; source content is unchanged. */
  readonly detailsTruncated?: boolean;
  readonly path?: RepoPath;
  readonly ruleChain?: readonly SkillRules[];
  readonly references?: readonly FileReference[];
  readonly complete?: boolean;
  readonly nextCursor?: string | undefined;
  readonly mount: MountSummary;
  readonly name: string;
  readonly directory: RepoPath;
  readonly description: string;
  readonly license: string | undefined;
  readonly compatibility: string | undefined;
  readonly allowedTools: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
  readonly body: string;
  /** Supporting files of the skill, ready to pass to `read_file`. */
  readonly files: readonly RepoPath[];
  readonly filesTruncated: boolean;
  /** The files the skill declares as needed on every run, with their text. */
  readonly included: readonly IncludedFile[];
  readonly warnings: readonly string[];
  /** The repository's rules, when it has a manifest with a body. */
  readonly rules: SkillRules | undefined;
  /** For people: the title and the description in other languages. Not rendered for a model. */
  readonly translations: Readonly<Record<string, SkillTranslation>>;
}

export interface FileResult {
  readonly referencesTruncated?: boolean;
  readonly references?: readonly FileReference[];
  readonly mount: MountSummary;
  readonly path: RepoPath;
  readonly content: string;
  readonly offset: number;
  /** Where the next page starts; `undefined` on the last page. */
  readonly nextOffset: number | undefined;
  readonly totalLength: number;
}

export interface DirectoryEntry {
  /** Relative to the mounted root, like every path in a result. */
  readonly path: RepoPath;
  readonly kind: "file" | "directory";
  /** Bytes, for a file. */
  readonly size: number | undefined;
}

/** What `read_file` answers for a directory: its immediate entries, subdirectories first. */
export interface DirectoryResult {
  readonly mount: MountSummary;
  /** Relative to the mounted root; empty for the root itself. */
  readonly path: RepoPath;
  readonly entries: readonly DirectoryEntry[];
  /** True when the directory has more entries than were listed. */
  readonly truncated: boolean;
}

/** A slice of `content` that never splits a surrogate pair. */
export function pageOfText(
  content: string,
  offset: number,
  limit: number,
): Pick<FileResult, "content" | "offset" | "nextOffset" | "totalLength"> {
  const isLowSurrogate = (index: number): boolean => {
    const unit = content.charCodeAt(index);
    return unit >= 0xdc00 && unit <= 0xdfff;
  };
  let start = Math.min(Math.max(offset, 0), content.length);
  if (start > 0 && start < content.length && isLowSurrogate(start)) {
    start += 1;
  }
  let end = Math.min(start + Math.max(limit, 1), content.length);
  if (end < content.length && isLowSurrogate(end)) {
    end += 1;
  }
  return {
    content: content.slice(start, end),
    offset: start,
    nextOffset: end < content.length ? end : undefined,
    totalLength: content.length,
  };
}
