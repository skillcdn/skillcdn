import { err, type IndexLimits, ok, type Result } from "@skillcdn/core";

/** The limits on the work one repository may cause, unless the `INDEX_*` variables say otherwise. */
export const INDEX_LIMIT_DEFAULTS: IndexLimits = {
  maxTreeEntries: 20_000,
  maxIndexedFiles: 2000,
  maxIndexedFileBytes: 262_144,
  maxIndexedTotalBytes: 33_554_432,
  maxReadableFileBytes: 2_097_152,
  maxArchiveBytes: 268_435_456,
};

/** One of the variables the limits are read from: which limit it sets, and the range it allows. */
export interface IndexLimitVariable {
  readonly name: string;
  readonly limit: keyof IndexLimits;
  readonly min: number;
  readonly max: number;
}

/** The variables, as the server and the command line read them. Documented in `.env.example`. */
export const INDEX_LIMIT_VARIABLES: readonly IndexLimitVariable[] = [
  { name: "INDEX_MAX_TREE_ENTRIES", limit: "maxTreeEntries", min: 1, max: 1_000_000 },
  { name: "INDEX_MAX_FILES", limit: "maxIndexedFiles", min: 1, max: 100_000 },
  { name: "INDEX_MAX_FILE_BYTES", limit: "maxIndexedFileBytes", min: 1024, max: 16_777_216 },
  { name: "INDEX_MAX_TOTAL_BYTES", limit: "maxIndexedTotalBytes", min: 1024, max: 1_073_741_824 },
  { name: "READ_MAX_FILE_BYTES", limit: "maxReadableFileBytes", min: 1024, max: 16_777_216 },
  {
    name: "INDEX_MAX_ARCHIVE_BYTES",
    limit: "maxArchiveBytes",
    min: 1_048_576,
    max: 17_179_869_184,
  },
];

/** A variable that cannot be read, with the rule it breaks; never its value. */
export interface IndexLimitProblem {
  readonly variable: string;
  readonly rule: string;
}

/**
 * Reads the limits out of an environment. A variable that is unset or empty leaves its default;
 * one that is set must be a whole number within its range. Problems name the variable and the
 * rule, never the value, so that they can be printed anywhere.
 */
export function readIndexLimits(
  environment: Readonly<Record<string, string | undefined>>,
): Result<IndexLimits, readonly IndexLimitProblem[]> {
  const limits: Record<keyof IndexLimits, number> = { ...INDEX_LIMIT_DEFAULTS };
  const problems: IndexLimitProblem[] = [];
  for (const variable of INDEX_LIMIT_VARIABLES) {
    const value = environment[variable.name]?.trim();
    if (value === undefined || value === "") {
      continue;
    }
    const number = /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN;
    if (Number.isNaN(number) || number < variable.min || number > variable.max) {
      problems.push({
        variable: variable.name,
        rule: `must be an integer between ${variable.min} and ${variable.max}`,
      });
      continue;
    }
    limits[variable.limit] = number;
  }
  return problems.length === 0 ? ok(limits) : err(problems);
}
