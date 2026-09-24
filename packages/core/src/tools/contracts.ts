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
    .describe("Exact repository-root path of SKILL.md, as browse or search returns it."),
  cursor,
});

export const findInputSchema = z.object({
  query: z
    .string()
    .max(MAX_QUERY_LENGTH)
    .optional()
    .describe(
      "Keywords, in the language the repository is written in. Omit it to list every skill, " +
        "then the documents outside the skills.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(FIND_MAX_LIMIT)
    .optional()
    .describe(
      `Maximum number of results. Default ${FIND_DEFAULT_LIMIT}. Without a query it bounds the documents only; every skill is listed.`,
    ),
});
export type FindInput = z.infer<typeof findInputSchema>;

export const getInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_REPO_PATH_LENGTH)
    .describe("The skill name as find returns it, or the path of the skill directory."),
});
export type GetInput = z.infer<typeof getInputSchema>;

export const readFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_REPO_PATH_LENGTH)
    .describe(
      "A file path from the repository root, for example skills/ads/references/guide.md. No ./ or ../ segments. Use browse for a folder.",
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

export const findTool: ToolContract<typeof findInputSchema> = {
  name: "find",
  title: "Find skills and documents",
  description:
    "Search the skills and documents of the mounted repository. Matching is by words, not by " +
    "meaning, and in the language the repository is written in: use its terms. Skills match " +
    "on their name and description, documents on their text; the best matches come first, " +
    "and a skill's own files are listed under the skill. Call it without a query to list what " +
    "is available: every skill, then the documents that do not belong to a skill. Then load a " +
    "skill with get, or read a document with read_file.",
  inputSchema: findInputSchema,
};

export const getTool: ToolContract<typeof getInputSchema> = {
  name: "get",
  title: "Get a skill",
  description:
    "Load one skill by name: its instructions, its front-matter, the files it needs on every " +
    "run (their text comes with it) and the list of its other supporting files. Apply the " +
    "instructions to the user's task, and read further files with read_file when the " +
    "instructions point to them.",
  inputSchema: getInputSchema,
};

export const readFileTool: ToolContract<typeof readFileInputSchema> = {
  name: "read_file",
  title: "Read a file",
  description:
    "Read a reference or optional README by repository-root path. Continue long files with nextOffset. Use get_skill for a skill and its required rules.",
  inputSchema: readFileInputSchema,
};

export const browseTool: ToolContract<typeof browseInputSchema> = {
  name: "browse",
  title: "Browse skills and documents",
  description:
    "List a folder's children, skill counts and optional README path. Load exact SKILL.md paths with get_skill. Follow nextCursor for more entries. Paths start at the repository root.",
  inputSchema: browseInputSchema,
};
export const searchTool: ToolContract<typeof searchInputSchema> = {
  name: "search",
  title: "Search skills and documents",
  description:
    "Search words in original content, usually English; display translations are excluded. Optional path scopes results. Matching files appear under their skill. Follow nextCursor for more; load the returned SKILL.md path with get_skill.",
  inputSchema: searchInputSchema,
};
export const getSkillTool: ToolContract<typeof getSkillInputSchema> = {
  name: "get_skill",
  title: "Load a skill",
  description:
    "Load an exact SKILL.md path with inherited rules and required files. Follow nextCursor until complete before applying it. Read optional supporting files with read_file only when needed.",
  inputSchema: getSkillInputSchema,
};
export const TOOL_NAMES = [
  browseTool.name,
  searchTool.name,
  getSkillTool.name,
  readFileTool.name,
] as const;
