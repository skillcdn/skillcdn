import * as z from "zod";
import { MAX_REPO_PATH_LENGTH } from "../repo-path.js";

// The tool set is a public contract: docs/specs/tools.md. Changes here are additive.

export const FIND_DEFAULT_LIMIT = 10;
export const FIND_MAX_LIMIT = 25;
/** A listing names every skill, up to this many; a repository with more is searched instead. */
export const FIND_LIST_SKILLS_MAX = 100;
/** How many of a skill's own files a search result lists under the skill. */
export const FIND_MAX_SKILL_FILES = 5;
export const MAX_QUERY_LENGTH = 500;
export const READ_FILE_DEFAULT_LIMIT = 40_000;
export const READ_FILE_MAX_LIMIT = 100_000;
export const BROWSE_DEFAULT_LIMIT = 50;
export const BROWSE_MAX_LIMIT = 200;
/** Smaller discovery pages for agents; REST retains its existing defaults. */
export const MCP_BROWSE_DEFAULT_LIMIT = 20;
export const MCP_SEARCH_DEFAULT_LIMIT = 5;
export const SKILL_PAGE_BYTES = 16_384;
const cursor = z
  .string()
  .max(4096)
  .optional()
  .describe("Opaque continuation returned by the previous call. Keep the same path and query.");
const scopePath = z
  .string()
  .max(MAX_REPO_PATH_LENGTH)
  .optional()
  .describe("Folder path from the repository root. Omit to use the mounted folder.");
export const browseInputSchema = z.object({
  path: scopePath,
  cursor,
  limit: z.number().int().min(1).max(BROWSE_MAX_LIMIT).optional(),
});
export const searchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .refine((value) => value.trim().length > 0),
  path: scopePath,
  cursor,
  limit: z.number().int().min(1).max(FIND_MAX_LIMIT).optional(),
});
export const getSkillInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_REPO_PATH_LENGTH)
    .describe("Exact repository-root path of SKILL.md, as browse_repo or search_repo returns it."),
  cursor,
});

export const readFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_REPO_PATH_LENGTH)
    .describe(
      "A file path from the repository root, for example skills/ads/references/guide.md. No ./ or ../ segments. Use browse_repo for a folder.",
    ),
  offset: z.number().int().min(0).optional().describe("Character offset to start from. Default 0."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(READ_FILE_MAX_LIMIT)
    .optional()
    .describe(`Maximum number of characters to return. Default ${READ_FILE_DEFAULT_LIMIT}.`),
});
export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface ToolContract<Input extends z.ZodType> {
  readonly name: string;
  readonly title: string;
  /** Written for the model that picks the tool. */
  readonly description: string;
  readonly inputSchema: Input;
}

// The names say what the tools act on, so that they do not collide with a host's own (ADR-0024).

export const readFileTool: ToolContract<typeof readFileInputSchema> = {
  name: "read_repo_file",
  title: "Read a repository file",
  description:
    "Read a reference or optional README by repository-root path. Continue long files with nextOffset. Use load_skill for a skill and its required rules.",
  inputSchema: readFileInputSchema,
};

export const browseTool: ToolContract<typeof browseInputSchema> = {
  name: "browse_repo",
  title: "Browse the repository",
  description:
    "List a folder's children, skill counts and optional README path. Load exact SKILL.md paths with load_skill. Follow nextCursor for more entries. Paths start at the repository root.",
  inputSchema: browseInputSchema,
};
export const searchTool: ToolContract<typeof searchInputSchema> = {
  name: "search_repo",
  title: "Search the repository",
  description:
    "Search words in original content, usually English; display translations are excluded. Optional path scopes results. Matching files appear under their skill. Follow nextCursor for more; load the returned SKILL.md path with load_skill.",
  inputSchema: searchInputSchema,
};
export const getSkillTool: ToolContract<typeof getSkillInputSchema> = {
  name: "load_skill",
  title: "Load a skill",
  description:
    "Load an exact SKILL.md path with inherited rules and required files, assembled as one document. Follow nextCursor until complete before applying it. Read optional supporting files with read_repo_file only when needed.",
  inputSchema: getSkillInputSchema,
};
export const TOOL_NAMES = [
  browseTool.name,
  searchTool.name,
  getSkillTool.name,
  readFileTool.name,
] as const;
