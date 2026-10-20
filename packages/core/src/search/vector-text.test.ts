import { describe, expect, it } from "vitest";
import { queryLexemes } from "./lexemes.js";
import {
  parseSearchVector,
  type SearchVector,
  searchVectorOf,
  serializeSearchQuery,
  serializeSearchVector,
} from "./vector.js";

// The text form of a vector is what the deployment stores: it has to be what PostgreSQL reads
// as a tsvector, and read back as the vector it was written from.

describe("positions kept as a tsvector keeps them", () => {
  it("keeps each position once with its highest weight, at most 256, and none after the last", () => {
    const many = searchVectorOf([{ weight: "D", text: "ads ".repeat(300) }]);
    expect(many.get("ad")).toHaveLength(256);
    // Every word past the last position lands on it, and is kept once.
    const far = searchVectorOf([{ weight: "D", text: `${"word ".repeat(16_390)} ads ads` }]);
    expect(far.get("ad")).toEqual([{ position: 16_383, weight: "D" }]);
    expect(far.get("word")?.[255]).toEqual({ position: 256, weight: "D" });
  });

  it("reads the fields with the word rules of the language it is given", () => {
    const vector = searchVectorOf([{ weight: "D", text: "campaigns" }], "ko");
    expect([...vector.keys()]).toEqual(["campaign"]);
  });
});

describe("serializeSearchVector and parseSearchVector", () => {
  it("writes the text form of a tsvector, lexemes in byte order, weight D unmarked", () => {
    const vector = searchVectorOf([
      { weight: "A", text: "Release notes" },
      { weight: "B", text: "Writes the notes of a release." },
      { weight: "D", text: "Notes, release, notes." },
    ]);
    expect(serializeSearchVector(vector)).toBe("'note':2A,5B,9,11 'releas':1A,8B,10 'write':3B");
  });

  it("quotes what the text form needs quoted, and reads it back", () => {
    const backslash = String.fromCharCode(92);
    const vector: SearchVector = new Map([
      ["it's", [{ position: 1, weight: "D" }]],
      [`back${backslash}slash`, [{ position: 2, weight: "C" }]],
      ["a b", [{ position: 3, weight: "A" }]],
    ]);
    const text = serializeSearchVector(vector);
    expect(text).toBe(`'a b':3A 'back${backslash}${backslash}slash':2C 'it''s':1`);
    expect(parseSearchVector(text)).toEqual(vector);
  });

  it("round-trips a built vector, and reads a lexeme without positions as one occurrence", () => {
    const vector = searchVectorOf([
      { weight: "A", text: "release notes" },
      { weight: "D", text: "Group the merged changes by area; link each to its pull request." },
    ]);
    expect(parseSearchVector(serializeSearchVector(vector))).toEqual(vector);
    expect(parseSearchVector("'bare' 'with':4B")).toEqual(
      new Map([
        ["bare", [{ position: 0, weight: "D" }]],
        ["with", [{ position: 4, weight: "B" }]],
      ]),
    );
    expect(parseSearchVector("")).toEqual(new Map());
    expect(parseSearchVector("not a vector 'unterminated")).toEqual(new Map());
  });

  it("writes a query as the text form of a tsquery, any word matching", () => {
    expect(serializeSearchQuery(queryLexemes("release notes"))).toBe("'releas' | 'note'");
    expect(serializeSearchQuery(["it's"])).toBe("'it''s'");
    expect(serializeSearchQuery([])).toBe("");
  });
});
