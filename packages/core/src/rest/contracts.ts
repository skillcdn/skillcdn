// The mini build of zod: these schemas also run in the browser, where the full build would be most
// of what a visitor downloads.
import * as z from "zod/mini";
import { type Address, formatAddress, GIT_HOST_KEYS } from "../address.js";

// Contract: docs/specs/rest.md. The server builds these shapes; clients parse with these schemas.
// Absent values are `null`, never missing keys. Changes within a version are additive.

/** One prefix per operation, so that the address keeps the rest of the path to itself. */
export const REST_ROUTES = {
  mounts: "/api/v1/mounts",
  find: "/api/v1/find",
  skills: "/api/v1/skills",
  files: "/api/v1/files",
  featured: "/api/v1/featured",
} as const;

/** How many skills and how many documents a mount overview lists. The counts are complete. */
export const REST_MOUNT_LIST_LIMIT = 200;
/** How many skill names a featured address shows. */
export const REST_FEATURED_SKILL_NAMES = 5;

/** The REST path of an operation on an address, without a query string. */
export function restPath(
  operation: "mounts" | "find" | "skills" | "files",
  address: Address,
): string {
  return `${REST_ROUTES[operation]}${formatAddress(address)}`;
}

const count = z.int().check(z.nonnegative());

const indexing = z.object({ status: z.literal("indexing") });
const failed = z.object({ status: z.literal("failed"), errorCode: z.string() });

export const restRepositorySchema = z.object({
  host: z.enum(GIT_HOST_KEYS),
  /** As the host spells them, for display. The address has the canonical lowercase form. */
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  /** What the host shows as the repository's description, or `null`. */
  description: z.nullable(z.string()),
});

/** What people see in one language instead of a skill's name and description. */
export const restSkillTranslationSchema = z.object({
  title: z.nullable(z.string()),
  description: z.nullable(z.string()),
});

/** By language tag, such as `ko`. Absent languages are simply not there. */
export const restSkillTranslationsSchema = z.record(z.string(), restSkillTranslationSchema);

/** What people see in one language instead of a repository's name and description. */
export const restRepoTranslationSchema = z.object({
  name: z.nullable(z.string()),
  description: z.nullable(z.string()),
});

export const restRepoTranslationsSchema = z.record(z.string(), restRepoTranslationSchema);

export const restSkillSummarySchema = z.object({
  name: z.string(),
  directory: z.string(),
  description: z.string(),
  warnings: z.array(z.string()),
  translations: restSkillTranslationsSchema,
});

export const restDocumentSummarySchema = z.object({
  path: z.string(),
  title: z.nullable(z.string()),
  summary: z.nullable(z.string()),
});

export const restDiagnosticSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

/** What the repository manifest (SKILLCDN.md) says about the mount. */
export const restManifestSchema = z.object({
  /** The manifest, relative to the mounted root, or `null` when it lies above the mount. */
  path: z.nullable(z.string()),
  /** `null`: the repository goes by the name its git host gives it. */
  name: z.nullable(z.string()),
  description: z.string(),
  /** The tag of the language the repository says it is written in, or `null`. */
  language: z.nullable(z.string()),
  translations: restRepoTranslationsSchema,
});

export const restMountSchema = z.object({
  address: z.string(),
  repository: restRepositorySchema,
  ref: z.nullable(z.string()),
  pinned: z.boolean(),
  commit: z.string(),
  path: z.string(),
  verified: z.boolean(),
  index: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      truncated: z.boolean(),
      /** `null` when the mount has no manifest. */
      manifest: z.nullable(restManifestSchema),
      skillCount: count,
      documentCount: count,
      skills: z.array(restSkillSummarySchema),
      documents: z.array(restDocumentSummarySchema),
      diagnostics: z.array(restDiagnosticSchema),
    }),
    indexing,
    failed,
  ]),
});

export const restFindItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("skill"),
    name: z.string(),
    directory: z.string(),
    description: z.string(),
    translations: restSkillTranslationsSchema,
    /** With a query: the files of the skill that matched as well, best first. */
    files: z.array(restDocumentSummarySchema),
    /** How many more of its files matched than are listed. */
    moreFiles: count,
  }),
  z.object({
    kind: z.literal("document"),
    path: z.string(),
    title: z.nullable(z.string()),
    summary: z.nullable(z.string()),
    /** The directory of the skill the document belongs to, or `null`. */
    skillDirectory: z.nullable(z.string()),
  }),
]);

export const restFindSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    query: z.nullable(z.string()),
    items: z.array(restFindItemSchema),
    /** Without a query: how many skills, and how many documents outside the skills, there are. */
    totals: z.nullable(z.object({ skills: count, documents: count })),
  }),
  indexing,
  failed,
]);

export const restSkillSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    skill: z.object({
      name: z.string(),
      directory: z.string(),
      description: z.string(),
      license: z.nullable(z.string()),
      compatibility: z.nullable(z.string()),
      allowedTools: z.nullable(z.string()),
      metadata: z.record(z.string(), z.string()),
      body: z.string(),
      files: z.array(z.string()),
      filesTruncated: z.boolean(),
      /** The files the skill declares as needed on every run; `get` returns their text. */
      included: z.array(z.string()),
      warnings: z.array(z.string()),
      translations: restSkillTranslationsSchema,
      /** The repository's rules from its manifest, or `null` when there are none. */
      rules: z.nullable(
        z.object({
          /** The manifest, relative to the mounted root, or `null` when it lies above the mount. */
          path: z.nullable(z.string()),
          body: z.string(),
          truncated: z.boolean(),
        }),
      ),
    }),
  }),
  indexing,
  failed,
]);

export const restDirectoryEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  /** Bytes, for a file. */
  size: z.nullable(count),
});

/** A page of a file, or the entries of a directory when the path names one. */
export const restFileSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string(),
    content: z.string(),
    offset: count,
    nextOffset: z.nullable(count),
    totalLength: count,
  }),
  z.object({
    kind: z.literal("directory"),
    /** Empty for the mounted root. */
    path: z.string(),
    entries: z.array(restDirectoryEntrySchema),
    truncated: z.boolean(),
  }),
]);

export const restFeaturedSchema = z.object({
  items: z.array(
    z.object({
      address: z.string(),
      repository: restRepositorySchema,
      /** The name and description the repository gives itself, once indexed, or `null`. */
      manifest: z.nullable(
        z.object({
          name: z.nullable(z.string()),
          description: z.string(),
          translations: restRepoTranslationsSchema,
        }),
      ),
      status: z.enum(["ready", "indexing", "failed"]),
      skillCount: z.nullable(count),
      skills: z.array(z.string()),
    }),
  ),
});

export const restErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** With `skill.ambiguous`: the directories to choose from. */
    directories: z.optional(z.array(z.string())),
  }),
});

export type RestRepository = z.infer<typeof restRepositorySchema>;
export type RestManifest = z.infer<typeof restManifestSchema>;
export type RestSkillTranslation = z.infer<typeof restSkillTranslationSchema>;
export type RestRepoTranslation = z.infer<typeof restRepoTranslationSchema>;
export type RestSkillSummary = z.infer<typeof restSkillSummarySchema>;
export type RestDocumentSummary = z.infer<typeof restDocumentSummarySchema>;
export type RestDiagnostic = z.infer<typeof restDiagnosticSchema>;
export type RestMount = z.infer<typeof restMountSchema>;
export type RestFindItem = z.infer<typeof restFindItemSchema>;
export type RestFind = z.infer<typeof restFindSchema>;
export type RestSkill = z.infer<typeof restSkillSchema>;
export type RestDirectoryEntry = z.infer<typeof restDirectoryEntrySchema>;
export type RestFile = z.infer<typeof restFileSchema>;
export type RestFeatured = z.infer<typeof restFeaturedSchema>;
export type RestError = z.infer<typeof restErrorSchema>;
