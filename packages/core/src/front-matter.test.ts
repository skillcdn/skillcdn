import { describe, expect, it } from "vitest";
import { MAX_FRONT_MATTER_LENGTH, parseFrontMatter, splitFrontMatter } from "./front-matter.js";

describe("splitFrontMatter", () => {
  it("separates front-matter from the body", () => {
    expect(splitFrontMatter("---\nname: a\n---\n# Title\n\nBody\n")).toEqual({
      kind: "found",
      source: "name: a\n",
      body: "# Title\n\nBody\n",
    });
  });

  it("handles CRLF line endings, a byte order mark and trailing spaces on the delimiters", () => {
    const text = `${String.fromCodePoint(0xfeff)}--- \r\nname: a\r\n---\t\r\nBody\r\n`;
    expect(splitFrontMatter(text)).toEqual({
      kind: "found",
      source: "name: a\r\n",
      body: "Body\r\n",
    });
  });

  it('accepts "..." as the closing delimiter and an empty body', () => {
    expect(splitFrontMatter("---\nname: a\n...")).toEqual({
      kind: "found",
      source: "name: a\n",
      body: "",
    });
    expect(splitFrontMatter("---\n---\n")).toEqual({ kind: "found", source: "", body: "" });
  });

  it("only looks for front-matter on the first line", () => {
    expect(splitFrontMatter("# Title\n---\nname: a\n---\n")).toEqual({
      kind: "none",
      body: "# Title\n---\nname: a\n---\n",
    });
    expect(splitFrontMatter("")).toEqual({ kind: "none", body: "" });
    expect(splitFrontMatter("---")).toEqual({ kind: "none", body: "---" });
    expect(splitFrontMatter("----\nname: a\n---\n").kind).toBe("none");
  });

  it("reports front-matter that never closes", () => {
    expect(splitFrontMatter("---\nname: a\n# Title\n")).toEqual({ kind: "unterminated" });
    expect(splitFrontMatter("---\nname: a\n --- \n")).toEqual({ kind: "unterminated" });
  });
});

describe("parseFrontMatter", () => {
  function parsed(source: string): ReadonlyMap<string, unknown> {
    const result = parseFrontMatter(source);
    if (!result.ok) {
      throw new Error(`expected front-matter to parse, got ${result.error.code}`);
    }
    return result.value;
  }

  it("keeps every scalar as the text the author typed", () => {
    const fields = parsed('version: 1.0\nenabled: no\ncount: 012\nempty: ""\nquoted: "yes"\n');
    expect(Object.fromEntries(fields)).toEqual({
      version: "1.0",
      enabled: "no",
      count: "012",
      empty: "",
      quoted: "yes",
    });
  });

  it("returns nested mappings as maps and sequences as arrays", () => {
    const fields = parsed("metadata:\n  author: acme\ntags:\n  - a\n  - b\n");
    expect(fields.get("metadata")).toEqual(new Map([["author", "acme"]]));
    expect(fields.get("tags")).toEqual(["a", "b"]);
  });

  it("treats empty front-matter as an empty mapping", () => {
    expect(parsed("").size).toBe(0);
    expect(parsed("# only a comment\n").size).toBe(0);
  });

  it("does not let a key reach a prototype", () => {
    const fields = parsed("__proto__:\n  polluted: yes\nconstructor: x\n");
    expect(fields.get("__proto__")).toEqual(new Map([["polluted", "yes"]]));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ["a sequence", "- a\n- b\n", "not_a_mapping"],
    ["a scalar", "just text\n", "not_a_mapping"],
    ["a syntax error", 'name: "unclosed\n', "invalid_yaml"],
    ["bad indentation", "a:\n  b: 1\n c: 2\n", "invalid_yaml"],
    ["duplicate keys", "name: a\nname: b\n", "invalid_yaml"],
    ["several documents", "name: a\n---\nname: b\n", "invalid_yaml"],
    ["oversized input", `name: ${"a".repeat(MAX_FRONT_MATTER_LENGTH)}\n`, "too_large"],
  ])("rejects %s", (_name, source, code) => {
    const result = parseFrontMatter(source);
    expect(result.ok ? undefined : result.error.code).toBe(code);
  });
});

describe("parseFrontMatter with hostile input", () => {
  it("rejects aliases instead of expanding them", () => {
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "",
    ].join("\n");
    const result = parseFrontMatter(bomb);
    expect(result.ok ? undefined : result.error.code).toBe("invalid_yaml");
    expect(parseFrontMatter("base: &base text\ncopy: *base\n").ok).toBe(false);
  });

  it("rejects explicit tags instead of resolving them", () => {
    const result = parseFrontMatter(
      "when: !!timestamp 2026-01-01\ncode: !!js/function 'x'\nraw: !!binary aGk=\n",
    );
    expect(result.ok ? undefined : result.error.code).toBe("invalid_yaml");
    for (const tag of ["!!timestamp 2026-01-01", "!!binary aGk=", "!!set {a, b}", "!custom x"]) {
      expect(parseFrontMatter(`value: ${tag}\n`).ok).toBe(false);
    }
  });

  it("survives nesting deep enough to threaten the stack", () => {
    const depth = Math.floor(MAX_FRONT_MATTER_LENGTH / 2) - 8;
    const result = parseFrontMatter(`a: ${"[".repeat(depth)}${"]".repeat(depth)}\n`);
    expect(typeof result.ok).toBe("boolean");
  });

  it("stays fast on the largest input it accepts", () => {
    const source = `${"k: v\n".repeat(10)}long: ${"x ".repeat(MAX_FRONT_MATTER_LENGTH / 2 - 40)}\n`;
    const started = Date.now();
    parseFrontMatter(source);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
