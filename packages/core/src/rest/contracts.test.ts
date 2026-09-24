import { describe, expect, it } from "vitest";
import { restBrowseSchema } from "./contracts.js";

describe("folder overview REST metadata", () => {
  const browse = {
    status: "ready",
    commit: "a".repeat(40),
    path: "",
    entries: [],
    nextCursor: null,
  };

  it("keeps existing results valid and preserves an optional overview without its body", () => {
    expect(restBrowseSchema.parse(browse)).toEqual(browse);
    const overview = { path: "README.md", title: "Library", description: null };
    expect(restBrowseSchema.parse({ ...browse, overview })).toEqual({ ...browse, overview });
    expect(
      restBrowseSchema.safeParse({ ...browse, overview: { path: "README.md", title: 12 } }).success,
    ).toBe(false);
  });
});
