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

// Every expectation here is what `to_tsvector('english', ...)` printed on PostgreSQL 18 for text
// in the Latin script, which this parser follows, with one addition of our own: a hyphenated code
// with a digit part (`top-10`, `beta-1`) is a word of the vector beside its parts (ADR-0069), which
// the server's parser does not make. The scripts matched by pairs have their own test.
describe("searchLexemes", () => {
  it("cuts words, hyphenated words, hosts, versions, paths and addresses as the parser does", () => {
    expect(
      vectorText(
        "Foo_bar skill-cdn top-10 SKILL.md v1.2.0 https://example.com/x/y 2026 abc123 don't marketing/ads e-mail",
      ),
    ).toBe(
      "'-10':8 '/x/y':13 '2026':14 'abc123':15 'bar':2 'cdn':5 'e':20 'e-mail':19 'example.com':12 'example.com/x/y':11 'foo':1 'mail':21 'marketing/ads':18 'skill':4 'skill-cdn':3 'skill.md':9 'top':7 'top-10':6 'v1.2.0':10",
    );
  });

  it("reads signs, double hyphens, trailing punctuation and other scripts as the parser does", () => {
    expect(
      vectorText(
        "10-top a1-b2 -foo foo--bar docs/ wait... e.g. /usr/local user@example.com https://example.com x_y-z 3.14 1e10 AI-driven self-hosted C++ R&D foo'bar self-hosted-thing top-10-list beta-1 -5 5- a-",
      ),
    ).toBe(
      "'-1':43 '-10':39 '-5':44 '/usr/local':13 '10':2 '10-top':1 '1e10':21 '3.14':20 '5':45 'a1':5 'a1-b2':4 'ai':23 'ai-driven':22 'b2':6 'bar':9,32 'beta':42 'beta-1':41 'c':28 'd':30 'doc':10 'driven':24 'e.g':12 'example.com':15 'foo':7,8,31 'host':27,35 'list':40 'r':29 'self':26,34 'self-host':25 'self-hosted-th':33 'thing':36 'top':3,38 'top-10-list':37 'user@example.com':14 'wait':11 'x':16 'y':18 'y-z':17 'z':19",
    );
  });

  it("keeps a code whole beside its parts, in one script or across scripts (ADR-0069)", () => {
    expect(queryLexemes("Form MMCC-3 and OIW-PV-120")).toEqual([
      "form",
      "mmcc-3",
      "mmcc",
      "-3",
      "oiw-pv-120",
      "oiw",
      "pv",
      "-120",
    ]);
    expect(queryLexemes("stock number 6635-81-302-5518")).toEqual([
      "stock",
      "number",
      "6635-81-302-5518",
      "6635",
      "-81",
      "-302",
      "-5518",
    ]);
    expect(queryLexemes("양식 서돌-4, 様式 蒼陵-2")).toEqual([
      "양식",
      "서돌-4",
      "서돌",
      "-4",
      "様式",
      "蒼陵-2",
      "蒼陵",
      "-2",
    ]);
    // A sign, a doubled hyphen, a version and a particle written onto a word make no code.
    expect(queryLexemes("-5 foo--10 2.0.1-beta.3 MCP를")).toEqual([
      "-5",
      "foo",
      "-10",
      "2.0.1",
      "beta.3",
      "mcp",
      "를",
    ]);
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

  it("ignores a word of 2047 bytes or more, as the parser does, position and all", () => {
    // The parser's notice says "longer than 2047 characters", but its check is at 2047 bytes, as
    // is the limit of the tsvector parser, which rejects a longer lexeme instead of ignoring it.
    expect(searchLexemes(`${"a".repeat(2047)} short`)).toEqual([{ lexeme: "short", position: 1 }]);
    expect(searchLexemes(`${"a".repeat(2046)} short`)).toEqual([
      { lexeme: "a".repeat(2046), position: 1 },
      { lexeme: "short", position: 2 },
    ]);
    // Bytes, not characters: a two-byte letter counts twice.
    const letter = String.fromCodePoint(0xe9);
    expect(searchLexemes(letter.repeat(1024))).toEqual([]);
    expect(searchLexemes(letter.repeat(1023))).toHaveLength(1);
  });

  it("reads a URL without a host as the parser does: no word at all, or its path alone", () => {
    // A placeholder written as `https://...` is common in documentation. The parser emits the
    // scheme and a blank, and the deployment rejected a vector with an empty lexeme.
    expect(searchLexemes("https://...")).toEqual([]);
    expect(searchLexemes("http://.")).toEqual([]);
    expect(vectorText("see https://.../path and http://. too")).toBe("'/path':2 'see':1");
    expect(vectorText('"value":"https://...","is_secret":false')).toBe(
      "'fals':4 'secret':3 'valu':1",
    );
    expect(queryLexemes("https://...")).toEqual([]);
    for (const { lexeme } of searchLexemes('"value":"https://...","is_secret":false')) {
      expect(lexeme.length).toBeGreaterThan(0);
    }
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
