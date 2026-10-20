import { describe, expect, it } from "vitest";
import { queryLexemes } from "./lexemes.js";
import {
  MAX_SEARCHED_BODY_LENGTH,
  MAX_VECTOR_BYTES,
  rankSearchVector,
  searchFieldsOf,
  searchVectorOf,
} from "./vector.js";

/** A text whose every pair of characters is new: two alphabets of Han characters, interleaved. */
function distinctPairs(characters: number): string {
  let text = "";
  for (let index = 0; index < characters / 2; index += 1) {
    text += String.fromCodePoint(0x4e00 + Math.floor(index / 450), 0x5e00 + (index % 450));
  }
  return text;
}

/** Words of five bytes, each new: `a0000` to `l9999`. */
function distinctWords(count: number): string {
  const words: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const letter = String.fromCodePoint(97 + Math.floor(index / 10_000));
    words.push(`${letter}${String(index % 10_000).padStart(4, "0")}`);
  }
  return words.join(" ");
}

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

describe("the bytes of a vector", () => {
  it("stops where a tsvector would be full, laid out as the server lays it out", () => {
    // Each new word costs its bytes rounded up to an even number, two for the count of its
    // positions and two for its one position: ten for a pair of characters or a word of five bytes.
    const full = Math.floor(MAX_VECTOR_BYTES / 10);
    expect(searchVectorOf([{ weight: "D", text: distinctPairs(200_000) }]).size).toBe(full);
    expect(searchVectorOf([{ weight: "D", text: distinctWords(120_000) }]).size).toBe(full);
    // A document that fits is whole.
    expect(searchVectorOf([{ weight: "D", text: distinctPairs(2_000) }]).size).toBe(1_999);
  });

  it("counts every position kept, two bytes each", () => {
    // A word repeated 300 times at the start keeps 256 positions, 520 bytes with its own six; the
    // words after it fit while 520 + 10n stays within the bytes, so 104,805 of them.
    const vector = searchVectorOf([
      { weight: "D", text: `${"banana ".repeat(300)} ${distinctWords(105_000)}` },
    ]);
    expect(vector.get("banana")).toHaveLength(256);
    expect(vector.size).toBe(104_806);
  });
});
