import type { RepoPath } from "../repo-path.js";

/** What a tool call was answered from. Every path in a result is relative to `path`. */
export interface MountSummary {
  /** `owner/name` as the host spells it. */
  readonly repository: string;
  /** The ref as written in the address; `undefined` for the default branch. */
  readonly ref: string | undefined;
  readonly commit: string;
  readonly path: RepoPath;
  /** False until the repository owner has verified the repository with the service. */
  readonly verified: boolean;
  /** True when the repository was too large to index completely. */
  readonly truncated: boolean;
}

export type FindItem =
  | {
      readonly kind: "skill";
      readonly name: string;
      readonly directory: RepoPath;
      readonly description: string;
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
  readonly mount: MountSummary;
  readonly query: string | undefined;
  readonly items: readonly FindItem[];
  /** Without a query: how many skills, and how many documents outside the skills, the mount has. */
  readonly totals: { readonly skills: number; readonly documents: number } | undefined;
}

export interface SkillResult {
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
  readonly warnings: readonly string[];
}

export interface FileResult {
  readonly mount: MountSummary;
  readonly path: RepoPath;
  readonly content: string;
  readonly offset: number;
  /** Where the next page starts; `undefined` on the last page. */
  readonly nextOffset: number | undefined;
  readonly totalLength: number;
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
