import { describe, expect, it } from "vitest";
import { INDEX_LIMIT_DEFAULTS, INDEX_LIMIT_VARIABLES, readIndexLimits } from "./limits.js";

describe("reading the limits from an environment", () => {
  it("gives the defaults when nothing is set, and ignores empty values", () => {
    expect(readIndexLimits({})).toEqual({ ok: true, value: INDEX_LIMIT_DEFAULTS });
    expect(readIndexLimits({ INDEX_MAX_FILES: "", READ_MAX_FILE_BYTES: "  " })).toEqual({
      ok: true,
      value: INDEX_LIMIT_DEFAULTS,
    });
  });

  it("applies every variable to its limit", () => {
    const environment = Object.fromEntries(
      INDEX_LIMIT_VARIABLES.map((variable) => [variable.name, String(variable.min)]),
    );
    const read = readIndexLimits(environment);
    expect(read.ok).toBe(true);
    if (read.ok) {
      for (const variable of INDEX_LIMIT_VARIABLES) {
        expect(read.value[variable.limit]).toBe(variable.min);
      }
    }
    expect(readIndexLimits({ INDEX_MAX_FILES: " 5 " })).toMatchObject({
      value: { ...INDEX_LIMIT_DEFAULTS, maxIndexedFiles: 5 },
    });
  });

  it("names the variable and the rule for a value it cannot take, never the value", () => {
    const cases = ["many", "-1", "1.5", "1e3", "0", "100001", "0x10"];
    for (const value of cases) {
      const read = readIndexLimits({ INDEX_MAX_FILES: value });
      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.error).toEqual([
          { variable: "INDEX_MAX_FILES", rule: "must be an integer between 1 and 100000" },
        ]);
      }
    }
  });

  it("reports every problem at once and keeps the readable values out of the result", () => {
    const read = readIndexLimits({
      INDEX_MAX_FILES: "x",
      READ_MAX_FILE_BYTES: "1",
      INDEX_MAX_TREE_ENTRIES: "10",
    });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.map((problem) => problem.variable)).toEqual([
        "INDEX_MAX_FILES",
        "READ_MAX_FILE_BYTES",
      ]);
    }
  });
});
