import { describe, expect, it } from "vitest";
import { MAX_LEXEME_BYTES, queryLexemes, searchLexemes, wordRulesOf } from "./lexemes.js";

// The scripts without word stems are matched by pairs of characters, and a pack's language picks
// the word rules (ADR-0063). Korean words are written as code points, so that no tool rewrites
// them on the way into this file; each is a short common noun or particle.
const word = (...points: number[]): string => String.fromCodePoint(...points);
/** A three-syllable noun, and the same noun with a one-syllable object particle. */
const NOUN = word(0xb9c8, 0xd0b7, 0xd305);
const NOUN_WITH_PARTICLE = `${NOUN}${word(0xc744)}`;
/** The pairs of the noun. */
const PAIRS = [NOUN.slice(0, 2), NOUN.slice(1, 3)];

const lexemesOf = (text: string, language?: string): string[] =>
  searchLexemes(text, language).map((lexeme) => lexeme.lexeme);

describe("scripts without word stems", () => {
  it("matches a word by pairs of characters, so that an inflected word is found by its stem", () => {
    expect(lexemesOf(NOUN)).toEqual(PAIRS);
    expect(lexemesOf(NOUN_WITH_PARTICLE)).toEqual([...PAIRS, NOUN_WITH_PARTICLE.slice(2, 4)]);
    const query = queryLexemes(NOUN);
    expect(query.every((lexeme) => lexemesOf(NOUN_WITH_PARTICLE).includes(lexeme))).toBe(true);
  });

  it("keeps a one-character word as itself", () => {
    expect(lexemesOf(word(0xcc45))).toEqual([word(0xcc45)]);
  });

  it("cuts a particle off a Latin word or a number, which stay findable", () => {
    const particle = word(0xb97c);
    expect(lexemesOf(`MCP${particle}`)).toEqual(["mcp", particle]);
    expect(lexemesOf(`2026${word(0xb144)}`)).toEqual(["2026", word(0xb144)]);
    expect(lexemesOf(`SKILL.md${particle}`)).toEqual(["skill.md", particle]);
  });

  it("gives every pair its own position, counted with the other tokens", () => {
    expect(searchLexemes(`${NOUN} campaign`).map((lexeme) => lexeme.position)).toEqual([1, 2, 3]);
  });

  it("reads Japanese and Chinese text by pairs too, with the marks that extend a word", () => {
    // A katakana word with a prolonged sound mark stays one run.
    const katakana = word(0x30b3, 0x30fc, 0x30d2, 0x30fc);
    expect(lexemesOf(katakana)).toHaveLength(3);
    const han = word(0x4e2d, 0x6587);
    expect(lexemesOf(han)).toEqual([han]);
  });

  it("reads a run of two hundred thousand characters by pairs, however long the run", () => {
    // Pushing the pairs of a run as the arguments of one call overflowed the stack past some
    // hundred thousand of them, and a file with such a run failed the indexing of its pack.
    expect(searchLexemes(word(0xac00).repeat(200_000))).toHaveLength(199_999);
  });
});

describe("wordRulesOf", () => {
  it("names English for English, for no language and for a language without rules of its own", () => {
    expect(wordRulesOf("en").language).toBe("en");
    expect(wordRulesOf("en-GB").language).toBe("en");
    expect(wordRulesOf(undefined).language).toBe("en");
    expect(wordRulesOf("ko").language).toBe("en");
    expect(wordRulesOf("pt-BR").language).toBe("en");
  });

  it("drops a lexeme over the byte limit, whatever its characters", () => {
    const long = word(0xac00).repeat(Math.ceil(MAX_LEXEME_BYTES / 3) + 1);
    // Pairs of a long run are short; a long Latin token is not.
    expect(lexemesOf(`${"a".repeat(MAX_LEXEME_BYTES + 1)} short`)).toEqual(["short"]);
    expect(lexemesOf(long).length).toBeGreaterThan(0);
  });
});
