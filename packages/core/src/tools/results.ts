import type { Address, AddressHost } from "../address.js";
import type { LicenseFact } from "../license.js";
import type { RepoPath } from "../repo-path.js";
import type { OutlineHeading } from "../search/outline.js";
import type { MatchedSection } from "../search/sections.js";
import type { OmittedFile } from "../skill-document.js";
import type { SkillTranslation } from "../skill-manifest.js";

export interface FileReference {
  readonly source?: string;
  readonly href: string;
  readonly path: string;
  readonly status: "available" | "outside_mount" | "missing" | "blocked";
  /**
   * For an available file whose link names a section by its fragment (ADR-0082): the offset and
   * the length that read the section, with the sections under it.
   */
  readonly section?: { readonly offset: number; readonly length: number };
}
export interface BrowseEntry {
  readonly browsePath?: RepoPath;
  readonly overviewPath?: RepoPath;
  /** A skill's license (ADR-0026). */
  readonly license?: LicenseFact;
  /** True for a skill this mount describes without serving its content: see `license`. */
  readonly describedOnly?: boolean;
  readonly kind: "directory" | "skill" | "file";
  readonly path: RepoPath;
  readonly name: string | null;
  readonly description: string | null;
  readonly skillCount: number;
  readonly documentCount: number;
  /** How many pictures the folder holds, when it holds any. */
  readonly imageCount?: number;
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
/** A picture a document links to, with the words an agent reads it by (ADR-0063). */
export interface DocumentImage {
  readonly path: RepoPath;
  /** The alternative text, trimmed; empty when the document gives none. */
  readonly alt: string;
}
/**
 * What a document says it was made from (ADR-0076): its front-matter `source`, as written; with
 * the repository-root `path` and the `url` of the bytes when it names a file of the repository.
 */
export interface DocumentSource {
  readonly text: string;
  readonly path?: RepoPath;
  readonly url?: string;
  /** True for a file of the repository that the manifest governing it says is kept encrypted (ADR-0084). */
  readonly encrypted?: boolean;
  /** With `encrypted`: the name of the key that opens it, when the manifest names one; never the key. */
  readonly keyName?: string;
}
/** A heading of an outline, with how many rows the tables of its section hold, when they hold any. */
export interface FileOutlineHeading extends OutlineHeading {
  readonly rows?: number;
}

/** Why a file browsed for its outline has no headings to list. */
export type FileOutlineUnavailable = "not_markdown" | "not_text" | "too_large" | "described_only";

/**
 * The outline of a file `browse_repo` was given the path of (ADR-0063): its headings, each with
 * the offset and the length that read its section with `read_repo_file`.
 */
export interface FileOutline {
  readonly path: RepoPath;
  /** Bytes of the file, as the tree has it. */
  readonly size: number;
  /** Characters of the file as it is read; `undefined` when its text is not at hand. */
  readonly totalLength: number | undefined;
  /** The headings on this page, in document order. */
  readonly headings: readonly FileOutlineHeading[];
  /** True when the file has more headings than an outline keeps. */
  readonly truncated: boolean;
  /** Why there are no headings to list, when there are none for a reason other than the file's own. */
  readonly unavailable?: FileOutlineUnavailable;
  /** With `described_only`: the license that keeps the content at its source (ADR-0026). */
  readonly license?: LicenseFact;
  /** With `too_large`, `not_text` and `described_only`: where the file is at its source. */
  readonly sourceUrl?: string;
  /** With `not_text`: the file is a Git LFS pointer, and `sourceUrl` is where the host serves the file of this size (ADR-0077). */
  readonly lfs?: { readonly size: number };
  /** For a Markdown document: the pictures it links to, in document order, bounded. */
  readonly images?: readonly DocumentImage[];
  /** For a Markdown document: what it says it was made from (ADR-0076). */
  readonly sources?: readonly DocumentSource[];
  /** For a Markdown document that has tables: how many, and the rows they hold together (ADR-0080). */
  readonly tables?: { readonly count: number; readonly rows: number };
  /** For a Markdown document that has fenced code blocks: how many. */
  readonly codeBlocks?: number;
  /**
   * Where the tables and the code blocks of the document are had as data, when the mount says
   * where: a URL of the REST API, or the command that prints them.
   */
  readonly data?: { readonly rows?: string; readonly code?: string };
}

/** A table of a document as data (ADR-0080): where it stands, the names of its columns, its rows. */
export interface DataTable {
  readonly path: RepoPath;
  /** The heading path of the section the table stands in; empty before the first heading. */
  readonly heading: readonly string[];
  readonly columns: readonly string[];
  /** Each row as many cells as there are columns, as written. */
  readonly rows: readonly (readonly string[])[];
}

/** The tables under a path, in reading order: what the `rows` route and command answer. */
export interface RowsResult {
  readonly mount: MountSummary;
  /** The file or the folder asked for. */
  readonly path: RepoPath;
  readonly tables: readonly DataTable[];
  /** How many rows the tables of this page hold together. */
  readonly rowCount: number;
  /** Continues with the files after this page's; `undefined` when there are none. */
  readonly nextCursor: string | undefined;
}

/** A fenced code block of a document as data (ADR-0080). */
export interface DataCodeBlock {
  readonly path: RepoPath;
  readonly heading: readonly string[];
  /** What the block says it is written in; empty when it says nothing. */
  readonly language: string;
  readonly text: string;
}

/** The code blocks under a path, in reading order: what the `code` route and command answer. */
export interface CodeResult {
  readonly mount: MountSummary;
  readonly path: RepoPath;
  readonly blocks: readonly DataCodeBlock[];
  readonly nextCursor: string | undefined;
}

export interface BrowseResult {
  readonly diagnostics?: readonly IndexDiagnostic[];
  readonly diagnosticsTotal?: number;
  readonly overview?: FolderOverview;
  /** The repository manifest of the browsed folder, when it has one of its own. */
  readonly manifestPath?: RepoPath;
  /** When `path` names a file: its outline, and `entries` is empty. */
  readonly outline?: FileOutline;
  readonly mount: MountSummary;
  readonly path: RepoPath;
  readonly entries: readonly BrowseEntry[];
  readonly nextCursor: string | undefined;
}

/**
 * The newest commit of a mount's ref while the index served is not its own (ADR-0068): the
 * commit the address resolves to, and why what it serves is another commit's index, or the same
 * commit's under the rules before the current ones. Results name it in one clause and the
 * connection instructions in one sentence; the `mounts` route carries it as a field.
 */
export interface NewestCommit {
  readonly commit: string;
  readonly status: "indexing" | "failed";
  /** Why indexing failed, as the index's own `errorCode`. */
  readonly errorCode?: string | undefined;
}

/** What a tool call was answered from. Content paths are repository-root paths. */
export interface MountSummary {
  /** `owner/name` as the host spells it. */
  readonly repository: string;
  /**
   * The host of the address: a git host, or `local` for a pack served from a directory, which
   * has no host to fetch a file from. A summary that says nothing is taken to be a git host's.
   */
  readonly host?: AddressHost;
  /** The ref as written in the address; `undefined` for the default branch. */
  readonly ref: string | undefined;
  /** The commit the result was read from: the ref's newest, or the one served in its place. */
  readonly commit: string;
  /** The ref's newest commit, when `commit` is not it, or its index is being rebuilt. */
  readonly newest?: NewestCommit | undefined;
  readonly path: RepoPath;
  /** False until the repository owner, or the operator, has vouched for the repository. */
  readonly verified: boolean;
  /**
   * Whether everyone can see the repository or only the people the host lets; `public` when not
   * said. A private repository carries no provenance notice (ADR-0061).
   */
  readonly visibility?: "public" | "private";
  /** True when the repository was too large to index completely. */
  readonly truncated: boolean;
  /** What every skill URI of the repository starts with: `skill://gh/<owner>/<repo>`. */
  readonly skillUri: string;
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

/**
 * A section of a document that a search matched (ADR-0063): its heading path, the offset and
 * the length that read it with `read_repo_file`, and a glimpse of the passage.
 */
export type FindSection = MatchedSection;

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
      /** The skill's license (ADR-0026). */
      readonly license?: LicenseFact;
      /** True when this mount describes the skill without serving its content: see `license`. */
      readonly describedOnly?: boolean;
    }
  | {
      readonly kind: "document";
      readonly path: RepoPath;
      readonly title: string | undefined;
      readonly summary: string | undefined;
      /** The directory of the skill the document belongs to, when it belongs to one in the mount. */
      readonly skillDirectory: RepoPath | undefined;
      /**
       * With a query: the sections of the document that matched, best first. Absent for a
       * document this mount describes without serving, whose text cannot be read here.
       */
      readonly sections?: readonly FindSection[];
      /** True for the README of a folder: the map of the folder, which says a little of everything in it. */
      readonly overview?: boolean;
      /** True for a document that says it was made from other documents of the pack (ADR-0083). */
      readonly derived?: boolean;
    };

/**
 * How a search with a query was ranked where the search by meaning is at hand (ADR-0064): absent
 * where the words alone rank, as on a deployment with no embedder and on the command's index.
 */
export interface FindRanking {
  /**
   * True when the sections nearest in meaning were fused with the words' results; false when the
   * embedder did not answer in time, or at all, and the words answered alone this time.
   */
  readonly meaning: boolean;
  /** True when the first results were reranked by the reranker (ADR-0065). */
  readonly reranked: boolean;
  /**
   * True when the query was identifiers alone, a number or a name, and was ranked by its words
   * for that, the search by meaning left unasked (ADR-0079); `meaning` and `reranked` are then
   * false.
   */
  readonly identifiers?: boolean | undefined;
  /**
   * While the embedding of the index goes on: how many of the documents that are to be embedded
   * have their vectors so far. A document without them is found by its words alone.
   */
  readonly embedding?: { readonly embedded: number; readonly total: number } | undefined;
}

/** One result of a search across the packs a deployment serves (ADR-0070): an item, and the pack it is in. */
/**
 * What the pack of a result is: a pack of skills (a manifest and skills), a pack of documents (a
 * manifest and no skill), or a repository read without a manifest; whether the operator vouches
 * for it; and how many skills it holds.
 */
export interface HubPack {
  readonly kind: "skills" | "documents" | "repository";
  readonly verified: boolean;
  readonly skills: number;
  /** The owner's picture as the git host serves it; empty for a pack at no git host. */
  readonly avatar?: string | undefined;
}

export interface HubItem {
  /** The address of the pack, `/gh/<owner>/<repo>`, which an agent connects to for the rest. */
  readonly address: Address;
  /** `owner/name` as the host spells it. */
  readonly repository: string;
  /** What the pack is, where the deployment says. */
  readonly pack?: HubPack | undefined;
  readonly item: FindItem;
}

/** What a search across the packs of a deployment answers (ADR-0070). */
export interface HubResult {
  readonly query: string;
  /** How many packs were searched: every public pack the deployment serves that did not opt out. */
  readonly packs: number;
  readonly items: readonly HubItem[];
  /** Where the search by meaning is at hand: how the results were ranked. */
  readonly ranking?: FindRanking | undefined;
}

export interface FindResult {
  readonly diagnosticsTotal?: number;
  readonly path?: RepoPath;
  readonly nextCursor?: string | undefined;
  readonly mount: MountSummary;
  readonly query: string | undefined;
  readonly items: readonly FindItem[];
  /** With a query, where the search by meaning is at hand: how the results were ranked. */
  readonly ranking?: FindRanking | undefined;
  /** Without a query: how many skills, and how many documents outside the skills, the mount has. */
  readonly totals: { readonly skills: number; readonly documents: number } | undefined;
  /** Manifests inside the mount that could not be read, so what they declare is not served. */
  readonly diagnostics: readonly IndexDiagnostic[];
}

/** Legacy rendering bound; current load_skill context uses SKILL_PAGE_BYTES. */
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
  /** Supporting files of the skill, ready to pass to `read_repo_file`. */
  readonly files: readonly RepoPath[];
  readonly filesTruncated: boolean;
  /**
   * Files of the skill over the read limit (ADR-0033): not readable here, with where their bytes
   * are at the host.
   */
  readonly oversized?: readonly OmittedFile[];
  /** The files the skill declares as needed on every run, with their text. */
  readonly included: readonly IncludedFile[];
  readonly warnings: readonly string[];
  /** The repository's rules, when it has a manifest with a body. */
  readonly rules: SkillRules | undefined;
  /** For people: the title and the description in other languages. Not rendered for a model. */
  readonly translations: Readonly<Record<string, SkillTranslation>>;
  /** How the skill is served, from the license it carries (ADR-0026). */
  readonly serving?: SkillServing;
}

/** What a mount does with a skill: serves it in full, or describes it and points at the source. */
export interface SkillServing {
  readonly license: LicenseFact;
  /** False when the license allows a description only: body, rules and files are withheld. */
  readonly full: boolean;
  /** Where the skill's manifest can be read at its host, in the commit served. */
  readonly sourceUrl: string;
}

export interface FileResult {
  readonly referencesTruncated?: boolean;
  /** How many links of the page the list of references leaves out, when it leaves any out. */
  readonly referencesMore?: number;
  readonly references?: readonly FileReference[];
  /** On the first page of a Markdown document: what it says it was made from (ADR-0076). */
  readonly sources?: readonly DocumentSource[];
  readonly mount: MountSummary;
  readonly path: RepoPath;
  readonly content: string;
  readonly offset: number;
  /** Where the next page starts; `undefined` on the last page. */
  readonly nextOffset: number | undefined;
  readonly totalLength: number;
  /**
   * The length the call asked for, when it gave one. A page that holds it with more to come ends
   * where it was asked to end, as a section read does; a shorter one was cut by the response budget.
   */
  readonly requestedLength?: number | undefined;
}

export interface DirectoryEntry {
  /** Relative to the mounted root, like every path in a result. */
  readonly path: RepoPath;
  readonly kind: "file" | "directory";
  /** Bytes, for a file. */
  readonly size: number | undefined;
}

/** What `read_repo_file` answers for a directory: its immediate entries, subdirectories first. */
export interface DirectoryResult {
  readonly mount: MountSummary;
  /** Relative to the mounted root; empty for the root itself. */
  readonly path: RepoPath;
  readonly entries: readonly DirectoryEntry[];
  /** True when the directory has more entries than were listed. */
  readonly truncated: boolean;
}

/** A served file of a listed skill, as the skills extension names it: by URI, digest and size. */
export interface SkillResource {
  readonly uri: string;
  /** `sha256:` and 64 hex digits over the bytes a read returns. */
  readonly digest: string;
  readonly size: number;
}

/**
 * One entry of `skills/list`, as the MCP skills extension defines it (ADR-0024): the skill's
 * URI, its served front matter as data, and every served file of its directory.
 */
export interface SkillEntry {
  readonly uri: string;
  readonly frontmatter: Record<string, unknown>;
  readonly resources: readonly SkillResource[];
}

/** A page of `skills/list`, and what the REST `listing` route answers without a URI. */
export interface SkillsPage {
  readonly skills: readonly SkillEntry[];
  readonly nextCursor: string | undefined;
  /** How many skills the mount lists in all. */
  readonly total: number;
  /** Where the page was read from: the commit, with the newest one beside it when that is another (ADR-0068). */
  readonly mount: MountSummary;
}

/** What `resources/read` answers: text or bytes, and the digest the listing declared. */
export interface Resource {
  readonly uri: string;
  readonly mimeType: string;
  readonly text?: string;
  readonly blob?: string;
  readonly digest: string;
}

/** One entry of `resources/directory/read`: a file or a directory under a skill's directory. */
export interface ResourceEntry {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * What one URI of the listing names, as the REST `listing` route answers it (docs/specs/rest.md):
 * a listed skill with its assembled document, a served file, or a directory of a skill.
 */
export type ListedItem =
  | {
      readonly kind: "skill";
      readonly skill: SkillEntry;
      /** The skill's `SKILL.md` as the extension serves it, assembled from its sources (ADR-0025). */
      readonly document: string;
      /** The digest of `document`, as the listing declares it. */
      readonly digest: string;
    }
  | { readonly kind: "file"; readonly resource: Resource }
  | {
      readonly kind: "directory";
      readonly uri: string;
      readonly entries: readonly ResourceEntry[];
    };

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
