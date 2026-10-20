import { describe, expect, it } from "vitest";
import { queryLexemes } from "./lexemes.js";
import {
  MAX_SEARCHED_BODY_LENGTH,
  rankSearchVector,
  searchFieldsOf,
  searchVectorOf,
} from "./vector.js";

describe("searchFieldsOf", () => {
  it("weighs the name and title first, then the description, the words of the path, and the body", () => {
    const fields = searchFieldsOf(
      {
        path: "marketing/ads/SKILL.md",
        name: "ads",
        title: undefined,
        description: "Writes ad copy.",
      },
      "# Ads\n\nThe body.",
    );
    expect(fields).toEqual([
      { weight: "A", text: "ads " },
      { weight: "B", text: "Writes ad copy." },
      { weight: "C", text: "marketing ads SKILL md" },
      { weight: "D", text: "# Ads\n\nThe body." },
    ]);
  });

  it("bounds what is searched of the body", () => {
    const fields = searchFieldsOf({ path: "docs/a.md" }, "x".repeat(MAX_SEARCHED_BODY_LENGTH + 10));
    expect(fields[3]?.text.length).toBe(MAX_SEARCHED_BODY_LENGTH);
    expect(searchFieldsOf({ path: "docs/a.md" }, undefined)[3]?.text).toBe("");
  });
});

describe("searchVectorOf and rankSearchVector", () => {
  it("continues the positions of a later field after the earlier one, as || joins vectors", () => {
    const vector = searchVectorOf([
      { weight: "A", text: "ads copy" },
      { weight: "D", text: "copy of the ads" },
    ]);
    expect(vector.get("ad")).toEqual([
      { position: 1, weight: "A" },
      { position: 6, weight: "D" },
    ]);
    expect(vector.get("copi")).toEqual([
      { position: 2, weight: "A" },
      { position: 3, weight: "D" },
    ]);
  });

  it("ranks a match in the name above the same match in the body, and no match at zero", () => {
    const inName = searchVectorOf([
      { weight: "A", text: "release notes" },
      { weight: "D", text: "how to write them" },
    ]);
    const inBody = searchVectorOf([
      { weight: "A", text: "ads" },
      { weight: "D", text: "release notes are written elsewhere" },
    ]);
    const query = queryLexemes("release");
    expect(rankSearchVector(inName, query)).toBeGreaterThan(rankSearchVector(inBody, query));
    expect(rankSearchVector(inBody, query)).toBeGreaterThan(0);
    expect(rankSearchVector(inBody, queryLexemes("pictures"))).toBe(0);
    expect(rankSearchVector(inBody, [])).toBe(0);
  });

  it("lets any word of the query match, and counts every occurrence a little", () => {
    // Two documents of the same length, so that the length normalization cancels out.
    const once = searchVectorOf([{ weight: "D", text: "ads today" }]);
    const twice = searchVectorOf([{ weight: "D", text: "ads ads" }]);
    const query = queryLexemes("ads pictures");
    expect(rankSearchVector(once, query)).toBeGreaterThan(0);
    expect(rankSearchVector(twice, query)).toBeGreaterThan(rankSearchVector(once, query));
  });

  it("divides by the logarithm of the length, so that a long document ranks under a short one", () => {
    const short = searchVectorOf([{ weight: "D", text: "ads" }]);
    const long = searchVectorOf([{ weight: "D", text: `ads ${"word ".repeat(200)}` }]);
    const query = queryLexemes("ads");
    expect(rankSearchVector(short, query)).toBeGreaterThan(rankSearchVector(long, query));
  });
});
