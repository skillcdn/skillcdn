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
// in the Latin script, which this parser follows, with two additions of our own: a hyphenated code
// with a digit part (`top-10`, `beta-1`) is a word of the vector beside its parts (ADR-0069), and a
// token joined by slashes or dots (`marketing/ads`, `SKILL.md`) is a word beside the words it
// joins (ADR-0078), neither of which the server's parser makes. The scripts matched by pairs have
// their own test.
describe("searchLexemes", () => {
  it("cuts words, hyphenated words, hosts, versions, paths and addresses as the parser does", () => {
    expect(
      vectorText(
        "Foo_bar skill-cdn top-10 SKILL.md v1.2.0 https://example.com/x/y 2026 abc123 don't marketing/ads e-mail",
      ),
    ).toBe(
      "'-10':8 '/x/y':16 '2026':17 'abc123':18 'ad':23 'bar':2 'cdn':5 'e':25 'e-mail':24 'example.com':15 'example.com/x/y':14 'foo':1 'mail':26 'market':22 'marketing/ads':21 'md':11 'skill':4,10 'skill-cdn':3 'skill.md':9 'top':7 'top-10':6 'v1':13 'v1.2.0':12",
    );
  });

  it("reads signs, double hyphens, trailing punctuation and other scripts as the parser does", () => {
    expect(
      vectorText(
        "10-top a1-b2 -foo foo--bar docs/ wait... e.g. /usr/local user@example.com https://example.com x_y-z 3.14 1e10 AI-driven self-hosted C++ R&D foo'bar self-hosted-thing top-10-list beta-1 -5 5- a-",
      ),
    ).toBe(
      "'-1':47 '-10':43 '-5':48 '/usr/local':15 '10':2 '10-top':1 '1e10':25 '3.14':24 '5':49 'a1':5 'a1-b2':4 'ai':27 'ai-driven':26 'b2':6 'bar':9,36 'beta':46 'beta-1':45 'c':32 'd':34 'doc':10 'driven':28 'e':13 'e.g':12 'example.com':19 'foo':7,8,35 'g':14 'host':31,39 'list':44 'local':17 'r':33 'self':30,38 'self-host':29 'self-hosted-th':37 'thing':40 'top':3,42 'top-10-list':41 'user@example.com':18 'usr':16 'wait':11 'x':20 'y':22 'y-z':21 'z':23",
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
      "beta",
      "mcp",
      "를",
    ]);
  });

  it("keeps a path with its dots as one word beside its parts, and drops stop words while counting them", () => {
    expect(
      vectorText(
        'See docs/guide.md, then (skills/ads/SKILL.md) and "quoted" [bracket] {brace} path/with/dots.v2 ver.1.2 a.b.c-d',
      ),
    ).toBe(
      "'a.b.c-d':26 'ad':10 'b':28 'brace':17 'bracket':16 'c':30 'c-d':29 'd':31 'doc':3 'docs/guide.md':2 'dot':22 'dots.v2':21 'guid':5 'guide.md':4 'md':6,13 'path':19 'path/with/dots.v2':18 'quot':15 'see':1 'skill':9,12 'skill.md':11 'skills/ads/skill.md':8 'v2':23 'ver':25 'ver.1.2':24",
    );
    expect(vectorText("Mr. Smith's don't O'Reilly rock'n'roll x's")).toBe(
      "'mr':1 'n':9 'o':6 'reilli':7 'rock':8 'roll':10 'smith':2 'x':11",
    );
  });

  it("finds a word joined by slashes or dots by the words it joins (ADR-0078)", () => {
    // Alternatives and codes written with slashes: the whole as written, then each part.
    expect(queryLexemes("HOLD/RELEASE/ABORT")).toEqual([
      "hold/release/abort",
      "hold",
      "releas",
      "abort",
    ]);
    // A dotted name: the whole, then each part that is not digits alone.
    expect(queryLexemes("ops.intake.queue v2.1")).toEqual([
      "ops.intake.queue",
      "op",
      "intak",
      "queue",
      "v2.1",
      "v2",
    ]);
    // A section number or a version names one thing: its digits are no words of their own, and a
    // number between slashes is still the number it is.
    expect(queryLexemes("4.2.6")).toEqual(["4.2.6"]);
    expect(queryLexemes("see 4.2.6/4.2.7")).toEqual(["see", "4.2.6/4.2.7", "4.2.6", "4.2.7"]);
    expect(queryLexemes("2026/11/10")).toEqual(["2026/11/10", "2026", "11", "10"]);
    // The parts are words like any other: a stop word among them is dropped, a hyphenated part
    // is read as a hyphenated word, and a path keeps its leading slash on the whole alone.
    expect(queryLexemes("and/or")).toEqual(["and/or"]);
    expect(queryLexemes("relay/fail-safe")).toEqual([
      "relay/fail-safe",
      "relay",
      "fail-saf",
      "fail",
      "safe",
    ]);
    expect(queryLexemes("/var/log/app.log")).toEqual([
      "/var/log/app.log",
      "var",
      "log",
      "app.log",
      "app",
    ]);
    // A URL and an address stay what the parser makes of them.
    expect(queryLexemes("https://example.com/a/b ops@example.com")).toEqual([
      "example.com/a/b",
      "example.com",
      "/a/b",
      "ops@example.com",
    ]);
    // The document that writes the joined word is found by one of its parts, and by the whole.
    const held = new Set(
      searchLexemes("Set the valve to HOLD/RELEASE/ABORT.").map((l) => l.lexeme),
    );
    for (const lexeme of queryLexemes("release")) {
      expect(held.has(lexeme)).toBe(true);
    }
    expect(held.has("hold/release/abort")).toBe(true);
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

  it("reads a long line of anything in time that grows with its length", () => {
    // Each of these was read again from every character of it, or by a call for every part: a
    // file of one such line took minutes to index, or overflowed the stack and failed its pack.
    const length = 200_000;
    expect(searchLexemes("_".repeat(length))).toEqual([]);
    expect(searchLexemes(".".repeat(length))).toEqual([]);
    expect(searchLexemes("-".repeat(length))).toEqual([]);
    expect(searchLexemes("b+".repeat(length))).toHaveLength(length);
    expect(searchLexemes("1.-".repeat(length))).toHaveLength(length);
    expect(searchLexemes(`b${"-".repeat(length)}c`)).toHaveLength(2);
    // One word longer than a lexeme may be, which is no word; the words its dots join are.
    expect(searchLexemes(`${"b.".repeat(length)}@`)).toHaveLength(length);
    expect(searchLexemes("b/".repeat(length))).toHaveLength(length);
    // What the bounds leave as it was: an address and a URL of any ordinary length.
    expect(queryLexemes("first.last_name-2@example.com")).toEqual([
      "first.last_name-2@example.com",
    ]);
    expect(queryLexemes("git+ssh://example.com/repo")).toEqual([
      "example.com/repo",
      "example.com",
      "/repo",
    ]);
  });

  it("reads a sign before digits wherever it stands, and a version up to its hyphen", () => {
    expect(vectorText("-5 -foo --10 foo--10 - -")).toBe("'-10':3,5 '-5':1 'foo':2,4");
    expect(vectorText("Version 2.0.1-beta.3 of the 3D-viewer (x86_64, arm64)")).toBe(
      "'2.0.1':2 '3d':8 '3d-viewer':7 '64':11 'arm64':12 'beta':4 'beta.3':3 'version':1 'viewer':9 'x86':10",
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
