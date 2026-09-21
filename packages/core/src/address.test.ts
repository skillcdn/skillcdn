import { describe, expect, it } from "vitest";
import {
  type AddressErrorCode,
  formatAddress,
  isPinnedAddress,
  MAX_ADDRESS_LENGTH,
  parseAddress,
} from "./address.js";

const HASH = "0123456789abcdef0123456789abcdef01234567";
// Built from code points so that no invisible character hides in this file.
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const LONE_SURROGATE = String.fromCharCode(0xd800);

function parsed(input: string) {
  const result = parseAddress(input);
  if (!result.ok) {
    throw new Error(`expected ${input} to parse, got ${result.error.code}`);
  }
  return result.value;
}

function errorCode(input: string): AddressErrorCode | undefined {
  const result = parseAddress(input);
  return result.ok ? undefined : result.error.code;
}

describe("parseAddress", () => {
  it.each([
    ["/gh/acme/skills", { ref: undefined, path: "" }],
    ["/gh/acme/skills@v1.2.0", { ref: { kind: "name", name: "v1.2.0" }, path: "" }],
    [
      "/gh/acme/skills@main/skills/ads",
      { ref: { kind: "name", name: "main" }, path: "skills/ads" },
    ],
    ["/gh/acme/skills/docs/guides", { ref: undefined, path: "docs/guides" }],
    [`/gh/acme/skills@${HASH}`, { ref: { kind: "commit", hash: HASH }, path: "" }],
    [`/gh/acme/skills@${HASH}/docs`, { ref: { kind: "commit", hash: HASH }, path: "docs" }],
  ])("parses %s", (input, expected) => {
    expect(parsed(input)).toEqual({ host: "gh", owner: "acme", repo: "skills", ...expected });
  });

  it('ends the ref at the first "/" unless a ":" terminates it', () => {
    expect(parsed("/gh/acme/skills@release/1.2")).toMatchObject({
      ref: { kind: "name", name: "release" },
      path: "1.2",
    });
    expect(parsed("/gh/acme/skills@release/1.2:")).toMatchObject({
      ref: { kind: "name", name: "release/1.2" },
      path: "",
    });
    expect(parsed("/gh/acme/skills@release/1.2:marketing/ads")).toMatchObject({
      ref: { kind: "name", name: "release/1.2" },
      path: "marketing/ads",
    });
    expect(parsed("/gh/acme/skills@main:docs")).toMatchObject({
      ref: { kind: "name", name: "main" },
      path: "docs",
    });
  });

  it('keeps later ":" and "@" characters literal', () => {
    expect(parsed("/gh/acme/skills@main:docs/a:b")).toMatchObject({
      ref: { kind: "name", name: "main" },
      path: "docs/a:b",
    });
    expect(parsed("/gh/acme/skills@@scope/pkg@1.0.0:")).toMatchObject({
      ref: { kind: "name", name: "@scope/pkg@1.0.0" },
      path: "",
    });
    expect(parsed("/gh/acme/skills/docs@v2/x:y")).toMatchObject({
      ref: undefined,
      path: "docs@v2/x:y",
    });
  });

  it("treats percent-encoded delimiters like their literal form", () => {
    expect(parsed("/gh/acme/skills%40main%3Adocs")).toEqual(parsed("/gh/acme/skills@main:docs"));
  });

  it("canonicalizes case where the host ignores it, and nowhere else", () => {
    expect(parsed("/gh/AcMe/Skills@Main/Docs")).toMatchObject({
      owner: "acme",
      repo: "skills",
      ref: { kind: "name", name: "Main" },
      path: "Docs",
    });
    expect(parsed(`/gh/acme/skills@${HASH.toUpperCase()}`).ref).toEqual({
      kind: "commit",
      hash: HASH,
    });
  });

  it("accepts the account and repository names the host allows", () => {
    expect(parsed("/gh/octo-cat_corp/my.repo_name-1")).toMatchObject({
      owner: "octo-cat_corp",
      repo: "my.repo_name-1",
    });
    expect(parsed("/gh/a/b")).toMatchObject({ owner: "a", repo: "b" });
  });

  it("accepts non-ASCII refs and paths, encoded or not", () => {
    const expected = { ref: { kind: "name", name: "기능" }, path: "문서/가이드 1" };
    expect(parsed("/gh/acme/skills@기능/문서/가이드 1")).toMatchObject(expected);
    expect(
      parsed(
        "/gh/acme/skills@%EA%B8%B0%EB%8A%A5/%EB%AC%B8%EC%84%9C/%EA%B0%80%EC%9D%B4%EB%93%9C%201",
      ),
    ).toMatchObject(expected);
  });

  it("only treats a full commit hash as pinned", () => {
    expect(isPinnedAddress(parsed(`/gh/acme/skills@${HASH}`))).toBe(true);
    expect(isPinnedAddress(parsed("/gh/acme/skills@0123456"))).toBe(false);
    expect(isPinnedAddress(parsed("/gh/acme/skills@main"))).toBe(false);
    expect(isPinnedAddress(parsed("/gh/acme/skills"))).toBe(false);
  });

  it.each<[string, AddressErrorCode]>([
    ["", "not_absolute"],
    ["gh/acme/skills", "not_absolute"],
    ["https://example.test/gh/acme/skills", "not_absolute"],
    ["/", "empty_segment"],
    ["/gh/acme/skills/", "empty_segment"],
    ["/gh//skills", "empty_segment"],
    ["/gl/acme/skills", "unknown_host"],
    ["/GH/acme/skills", "unknown_host"],
    ["/gh", "missing_repo"],
    ["/gh/acme", "missing_repo"],
    ["/gh/-acme/skills", "invalid_owner"],
    ["/gh/ac@me/skills", "invalid_owner"],
    [`/gh/${"a".repeat(40)}/skills`, "invalid_owner"],
    ["/gh/acme/skills.git", "invalid_repo"],
    ["/gh/acme/@main", "invalid_repo"],
    ["/gh/acme/..@main", "invalid_repo"],
    ["/gh/acme/sk ills", "invalid_repo"],
    [`/gh/acme/${"r".repeat(101)}`, "invalid_repo"],
    ["/gh/acme/skills@", "empty_ref"],
    ["/gh/acme/skills@/docs", "empty_ref"],
    ["/gh/acme/skills@:docs", "empty_ref"],
    ["/gh/acme/skills@ma~in", "invalid_ref"],
    ["/gh/acme/skills@main.lock", "invalid_ref"],
    ["/gh/acme/skills@-rf", "invalid_ref"],
    ["/gh/acme/skills@a..b", "invalid_ref"],
    ["/gh/acme/skills@v1@{0}", "invalid_ref"],
    ["/gh/acme/skills@feature/.hidden:", "invalid_ref"],
    ["/gh/acme/skills@main:/docs", "invalid_path"],
  ])("rejects %j as %s", (input, code) => {
    expect(errorCode(input)).toBe(code);
  });
});

describe("parseAddress with hostile input", () => {
  it.each<[string, string, AddressErrorCode]>([
    ["parent traversal", "/gh/acme/skills/../../etc/passwd", "dot_segment"],
    ["traversal after a ref", "/gh/acme/skills@main/../secrets", "dot_segment"],
    ["encoded traversal", "/gh/acme/skills/%2e%2e/secrets", "dot_segment"],
    ["single dot", "/gh/acme/skills/./docs", "dot_segment"],
    ["encoded slash", "/gh/acme/skills@release%2F1.2", "forbidden_character"],
    ["encoded backslash", "/gh/acme/skills/docs%5C..%5Csecrets", "forbidden_character"],
    ["literal backslash", "/gh/acme/skills/docs\\secrets", "forbidden_character"],
    ["encoded NUL", "/gh/acme/skills/docs%00.md", "forbidden_character"],
    ["encoded newline", "/gh/acme/skills/docs%0Ainjected", "forbidden_character"],
    ["right-to-left override", `/gh/acme/skills/docs${RLO}gpj.md`, "forbidden_character"],
    ["zero-width space", `/gh/acme/skills@ma${ZWSP}in`, "forbidden_character"],
    ["lone surrogate", `/gh/acme/skills/docs${LONE_SURROGATE}`, "forbidden_character"],
    ["truncated escape", "/gh/acme/skills/%E0%A4", "bad_encoding"],
    ["malformed escape", "/gh/acme/skills/%zz", "bad_encoding"],
    ["overlong UTF-8 slash", "/gh/acme/skills/%C0%AF", "bad_encoding"],
    ["oversized input", `/gh/acme/skills/${"a/".repeat(MAX_ADDRESS_LENGTH)}a`, "too_long"],
  ])("rejects %s", (_name, input, code) => {
    expect(errorCode(input)).toBe(code);
  });

  it("decodes exactly once", () => {
    expect(parsed("/gh/acme/skills/%252e%252e").path).toBe("%2e%2e");
    expect(parsed("/gh/acme/skills/%252F").path).toBe("%2F");
  });

  it("stays fast on the largest input it accepts", () => {
    const input = `/gh/acme/skills@main/${"a/".repeat(400)}a`;
    const started = Date.now();
    for (let i = 0; i < 200; i += 1) {
      parseAddress(input);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("formatAddress", () => {
  it.each([
    ["/gh/acme/skills", "/gh/acme/skills"],
    ["/gh/AcMe/Skills@Main/Docs", "/gh/acme/skills@Main/Docs"],
    ["/gh/acme/skills@main:docs", "/gh/acme/skills@main/docs"],
    ["/gh/acme/skills@main:", "/gh/acme/skills@main"],
    ["/gh/acme/skills@release/1.2:", "/gh/acme/skills@release/1.2:"],
    ["/gh/acme/skills@release/1.2:marketing/ads", "/gh/acme/skills@release/1.2:marketing/ads"],
    ["/gh/acme/skills@main:docs/a:b", "/gh/acme/skills@main:docs/a:b"],
    ["/gh/acme/skills%40main%3Adocs", "/gh/acme/skills@main/docs"],
    ["/gh/acme/skills/docs/a:b@c", "/gh/acme/skills/docs/a:b@c"],
    [`/gh/acme/skills@${HASH.toUpperCase()}/docs`, `/gh/acme/skills@${HASH}/docs`],
    ["/gh/acme/skills/my docs/100%25", "/gh/acme/skills/my%20docs/100%25"],
    ["/gh/acme/skills@기능/문서", "/gh/acme/skills@%EA%B8%B0%EB%8A%A5/%EB%AC%B8%EC%84%9C"],
  ])("writes %s as %s", (input, canonical) => {
    expect(formatAddress(parsed(input))).toBe(canonical);
  });

  it("round-trips: the canonical form parses back to the same address", () => {
    const inputs = [
      "/gh/acme/skills",
      "/gh/acme/skills@v1.2.0",
      "/gh/acme/skills@main/skills/ads",
      "/gh/acme/skills@release/1.2:",
      "/gh/acme/skills@release/1.2:marketing/ads",
      "/gh/acme/skills@main:docs/a:b",
      "/gh/acme/skills@@scope/pkg@1.0.0:packages/pkg",
      "/gh/acme/skills/docs@v2/x:y",
      "/gh/acme/skills/my docs/100%25/%252F",
      `/gh/acme/skills@${HASH}/docs`,
      "/gh/acme/skills@기능/문서/가이드 1",
    ];
    for (const input of inputs) {
      const address = parsed(input);
      const canonical = formatAddress(address);
      expect(parsed(canonical)).toEqual(address);
      expect(formatAddress(parsed(canonical))).toBe(canonical);
    }
  });
});
