import { describe, expect, it } from "vitest";
import { queryLexemes, searchLexemes } from "./lexemes.js";

/** `'lexeme':1,2 'other':3`, as PostgreSQL prints a tsvector, from what this parser answers. */
function vectorText(text: string): string {
  const positions = new Map<string, number[]>();
  for (const { lexeme, position } of searchLexemes(text)) {
    positions.set(lexeme, [...(positions.get(lexeme) ?? []), position]);
  }
  return [...positions.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([lexeme, at]) => `'${lexeme}':${at.join(",")}`)
    .join(" ");
}

// Every expectation here is what `to_tsvector('english', ...)` printed on PostgreSQL 18.
describe("searchLexemes", () => {
  it("cuts words, hyphenated words, hosts, versions, paths and addresses as the parser does", () => {
    expect(
      vectorText(
        "Foo_bar skill-cdn top-10 SKILL.md v1.2.0 https://example.com/x/y 2026 abc123 don't marketing/ads e-mail",
      ),
    ).toBe(
      "'-10':7 '/x/y':12 '2026':13 'abc123':14 'bar':2 'cdn':5 'e':19 'e-mail':18 'example.com':11 'example.com/x/y':10 'foo':1 'mail':20 'marketing/ads':17 'skill':4 'skill-cdn':3 'skill.md':8 'top':6 'v1.2.0':9",
    );
  });

  it("reads signs, double hyphens, trailing punctuation and other scripts as the parser does", () => {
    expect(
      vectorText(
        "10-top a1-b2 -foo foo--bar docs/ wait... e.g. /usr/local user@example.com https://example.com x_y-z 3.14 1e10 한국어 테스트 AI-driven self-hosted C++ R&D foo'bar self-hosted-thing top-10-list beta-1 -5 5- a-",
      ),
    ).toBe(
      "'-1':42 '-10':39 '-5':43 '/usr/local':12 '10':1 '1e10':20 '3.14':19 '5':44 'a1':4 'a1-b2':3 'ai':24 'ai-driven':23 'b2':5 'bar':8,33 'beta':41 'c':29 'd':31 'doc':9 'driven':25 'e.g':11 'example.com':14 'foo':6,7,32 'host':28,36 'list':40 'r':30 'self':27,35 'self-host':26 'self-hosted-th':34 'thing':37 'top':2,38 'user@example.com':13 'wait':10 'x':15 'y':17 'y-z':16 'z':18 '테스트':22 '한국어':21",
    );
  });

  it("keeps a path with its dots as one word, and drops stop words while counting them", () => {
    expect(
      vectorText(
        'See docs/guide.md, then (skills/ads/SKILL.md) and "quoted" [bracket] {brace} path/with/dots.v2 ver.1.2 a.b.c-d',
      ),
    ).toBe(
      "'a.b.c-d':11 'brace':8 'bracket':7 'docs/guide.md':2 'path/with/dots.v2':9 'quot':6 'see':1 'skills/ads/skill.md':4 'ver.1.2':10",
    );
    expect(vectorText("Mr. Smith's don't O'Reilly rock'n'roll x's")).toBe(
      "'mr':1 'n':9 'o':6 'reilli':7 'rock':8 'roll':10 'smith':2 'x':11",
    );
  });

  it("stems words and lists every occurrence", () => {
    expect(
      vectorText(
        "Running runners ran easily fairly hopping generalization relational conditional ties cries agreed plastered motoring sized hissing happy sky skies news",
      ),
    ).toBe(
      "'agre':12 'condit':9 'cri':11 'easili':4 'fair':5 'general':7 'happi':17 'hiss':16 'hop':6 'motor':14 'news':20 'plaster':13 'ran':3 'relat':8 'run':1 'runner':2 'size':15 'sky':18,19 'tie':10",
    );
  });

  it("answers nothing for text without a word", () => {
    expect(searchLexemes("")).toEqual([]);
    expect(searchLexemes("... --- /// !!!")).toEqual([]);
    expect(searchLexemes("the and of")).toEqual([]);
  });

  it("ignores a word longer than the parser indexes, position and all", () => {
    expect(searchLexemes(`${"a".repeat(2048)} short`)).toEqual([{ lexeme: "short", position: 1 }]);
  });

  it("reads a sign before digits wherever it stands, and a version up to its hyphen", () => {
    expect(vectorText("-5 -foo --10 foo--10 - -")).toBe("'-10':3,5 '-5':1 'foo':2,4");
    expect(vectorText("Version 2.0.1-beta.3 of the 3D-viewer (x86_64, arm64)")).toBe(
      "'2.0.1':2 '3d':7 '3d-viewer':6 '64':10 'arm64':11 'beta.3':3 'version':1 'viewer':8 'x86':9",
    );
  });
});

describe("queryLexemes", () => {
  it("reads a query as plainto_tsquery does, each lexeme once", () => {
    expect(queryLexemes("the quick brown foxes")).toEqual(["quick", "brown", "fox"]);
    expect(queryLexemes("Skills skill SKILLS")).toEqual(["skill"]);
    expect(queryLexemes("self-hosted")).toEqual(["self-host", "self", "host"]);
  });

  it("is empty for stop words and punctuation alone", () => {
    expect(queryLexemes("the of and")).toEqual([]);
    expect(queryLexemes("!!! ...")).toEqual([]);
  });
});
