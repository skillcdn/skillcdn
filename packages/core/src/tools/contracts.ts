import * as z from "zod";
import { MAX_REPO_PATH_LENGTH } from "../repo-path.js";

// The tool set is a public contract: docs/specs/tools.md. Changes here are additive.

export const FIND_DEFAULT_LIMIT = 10;
export const FIND_MAX_LIMIT = 25;
/** A listing names every skill, up to this many; a repository with more is searched instead. */
export const FIND_LIST_SKILLS_MAX = 100;
export const MAX_QUERY_LENGTH = 500;
export const READ_FILE_DEFAULT_LIMIT = 40_000;
export const READ_FILE_MAX_LIMIT = 100_000;

export const findInputSchema = z.object({
  query: z
    .string()
    .max(MAX_QUERY_LENGTH)
    .optional()
    .describe(
      "Keywords or a question. Omit it to list every skill, then the documents outside the skills.",
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
      "A file or directory path relative to the mounted root, for example " +
        'skills/ads/references/guide.md. A directory is listed; "." names the mounted root.',
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
    "Search the skills and documents of the mounted repository. Skills match on their name and " +
    "description, documents on their text; the best matches come first. Call it without a query " +
    "to list what is available: every skill, then the documents that do not belong to a skill. " +
    "Then load a skill with get, or read a document with read_file.",
  inputSchema: findInputSchema,
};

export const getTool: ToolContract<typeof getInputSchema> = {
  name: "get",
  title: "Get a skill",
  description:
    "Load one skill by name: its instructions, its front-matter and the supporting files it " +
    "ships. Apply the instructions to the user's task, and read supporting files with read_file " +
    "when the instructions point to them.",
  inputSchema: getInputSchema,
};

export const readFileTool: ToolContract<typeof readFileInputSchema> = {
  name: "read_file",
  title: "Read a file",
  description:
    "Read a text file of the mounted repository by its path relative to the mounted root. Long " +
    "files come in pages: pass the next offset from the previous page to continue. Given a " +
    "directory, it lists what the directory contains.",
  inputSchema: readFileInputSchema,
};

export const TOOL_NAMES = [findTool.name, getTool.name, readFileTool.name] as const;
