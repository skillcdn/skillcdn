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
});

export const restSkillSummarySchema = z.object({
  name: z.string(),
  directory: z.string(),
  description: z.string(),
  warnings: z.array(z.string()),
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
  }),
  z.object({
    kind: z.literal("document"),
    path: z.string(),
    title: z.nullable(z.string()),
    summary: z.nullable(z.string()),
  }),
]);

export const restFindSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    query: z.nullable(z.string()),
    items: z.array(restFindItemSchema),
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
      warnings: z.array(z.string()),
    }),
  }),
  indexing,
  failed,
]);

export const restFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  offset: count,
  nextOffset: z.nullable(count),
  totalLength: count,
});

export const restFeaturedSchema = z.object({
  items: z.array(
    z.object({
      address: z.string(),
      repository: restRepositorySchema,
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
export type RestSkillSummary = z.infer<typeof restSkillSummarySchema>;
export type RestDocumentSummary = z.infer<typeof restDocumentSummarySchema>;
export type RestDiagnostic = z.infer<typeof restDiagnosticSchema>;
export type RestMount = z.infer<typeof restMountSchema>;
export type RestFindItem = z.infer<typeof restFindItemSchema>;
export type RestFind = z.infer<typeof restFindSchema>;
export type RestSkill = z.infer<typeof restSkillSchema>;
export type RestFile = z.infer<typeof restFileSchema>;
export type RestFeatured = z.infer<typeof restFeaturedSchema>;
export type RestError = z.infer<typeof restErrorSchema>;
