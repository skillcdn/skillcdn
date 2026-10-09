import type { LicenseFact, LicenseKind } from "./license.js";
import type { RepoFileKind } from "./repo-layout.js";

// What the reading rules produce for one commit, and what a store keeps of it: the contract
// between the indexer and whatever persists its result. Pure data, so that the two depend on
// this file and never on each other.

/** Something the reading rules could not read as intended, for the repository author. */
export interface SnapshotDiagnostic {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** What people see in one language instead of a name and a description. */
export interface StoredTranslation {
  /** A skill's translated title. */
  readonly title?: string;
  /** A repository's translated name. */
  readonly name?: string;
  readonly description?: string;
}

/**
 * Front-matter of a skill manifest, as validated by the convention parser. A repository manifest
 * (`SKILLCDN.md`) stores its front-matter here too, with the document directories it declares.
 */
export interface SkillFrontMatter {
  readonly license?: string;
  readonly compatibility?: string;
  readonly allowedTools?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
  /**
   * Skill only: the files it needs on every run, as repository-root paths: files of its own
   * directory, and the shared pages outside it that the index admitted (ADR-0044).
   */
  readonly include?: readonly string[];
  /** By language tag: the title (skill) or name (repository), and the description. */
  readonly translations?: Readonly<Record<string, StoredTranslation>>;
  /** Repository manifest only: the directories it serves, relative to its own directory. */
  readonly documents?: readonly string[];
  /** Repository manifest only: relative files or subtrees never published. Empty means self. */
  readonly exclude?: readonly string[];
  /** Repository manifest only: the tag of the language the repository is written in. */
  readonly language?: string;
  /**
   * Repository manifest only: the picture it declares (ADR-0031), as a repository-root path of a
   * file the tree has, or as an `https` URL.
   */
  readonly image?: string;
  /** Local Markdown destinations, normalized to repository-root paths. */
  readonly references?: readonly { readonly href: string; readonly path: string }[];
  /** Readable through a link, without becoming an independent catalog/search document. */
  readonly linkedOnly?: boolean;
  /** Readable as a directory introduction, without creating a catalog/search document. */
  readonly overviewOnly?: boolean;
  /** A present but unreadable repository manifest still defines a closed boundary. */
  readonly manifestError?: string;
  /** Skill only: why the MCP skills extension does not list it (ADR-0025), when it does not. */
  readonly unlisted?: string;
  /**
   * Skill only: the files of the skill over the read limit when the commit was indexed
   * (ADR-0033): left out of what is served, and named in the served document with where their
   * bytes are at the host. Kept here so that a read assembles the document the index digested.
   */
  readonly omitted?: readonly {
    readonly path: string;
    readonly size: number;
    readonly sourceUrl: string;
  }[];
  /**
   * The license that governs the file (ADR-0026): for a skill, the one resolved for it; for a
   * license file, what the file itself says.
   */
  readonly licenseFact?: LicenseFact;
}

/** One file of a commit, as the reading rules read it. */
export interface IndexEntry {
  readonly path: string;
  readonly kind: RepoFileKind;
  readonly size: number;
  readonly blobSha: string;
  readonly skillDir: string | undefined;
  readonly name: string | undefined;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly frontMatter: SkillFrontMatter | undefined;
  /** Make the entry searchable: canonical metadata plus its search body. */
  readonly searchable: boolean;
  /** Parsed body without presentation-only front-matter; omitted to search the raw blob. */
  readonly searchBody?: string;
  /** False for a file outside the skills and the document directories: known, never served. */
  readonly visible: boolean;
  /** SHA-256 of the served bytes, in hex, when they are stored (ADR-0025). */
  readonly digest?: string;
  /** The size of what is served; for an assembled `SKILL.md` it differs from `size`. */
  readonly servedSize?: number;
  /** True for a skill the MCP skills extension lists. */
  readonly listed?: boolean;
  /** For a skill: what its license allows (ADR-0026). */
  readonly licenseKind?: LicenseKind;
}

/** The index of one commit: what the indexer hands to the store, whole or not at all. */
export interface SnapshotIndex {
  readonly entries: readonly IndexEntry[];
  readonly truncated: boolean;
  readonly indexedBytes: number;
  readonly diagnostics: readonly SnapshotDiagnostic[];
  /** The license that governs the repository outside its skills (ADR-0026). */
  readonly license: LicenseFact;
  /** The version of the reading rules that built it. */
  readonly version: number;
}
