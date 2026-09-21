import { describe, expect, it } from "vitest";
import { isFullCommitHash, isValidRefName, MAX_REF_LENGTH } from "./git-ref.js";

describe("isValidRefName", () => {
  it.each([
    "main",
    "v1.2.0",
    "release/1.2",
    "feature/add-skill",
    "refs/tags/v1",
    "@scope/pkg@1.0.0",
    "0123456",
    "기능/검색",
  ])("accepts %j", (name) => {
    expect(isValidRefName(name)).toBe(true);
  });

  it.each([
    "",
    "@",
    "-rf",
    "a..b",
    "a b",
    "a~1",
    "a^",
    "a:b",
    "a?",
    "a*",
    "a[0]",
    "a\\b",
    "v1@{0}",
    "/main",
    "main/",
    "a//b",
    ".hidden",
    "a/.hidden",
    "main.lock",
    "a.lock/b",
    "main.",
    `a${String.fromCodePoint(0x7f)}b`,
    `a${String.fromCodePoint(0x200b)}b`,
    "a".repeat(MAX_REF_LENGTH + 1),
  ])("rejects %j", (name) => {
    expect(isValidRefName(name)).toBe(false);
  });
});

describe("isFullCommitHash", () => {
  it("accepts exactly forty hexadecimal digits", () => {
    expect(isFullCommitHash("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(isFullCommitHash("0123456789ABCDEF0123456789ABCDEF01234567")).toBe(true);
    expect(isFullCommitHash("0123456")).toBe(false);
    expect(isFullCommitHash("0123456789abcdef0123456789abcdef0123456g")).toBe(false);
    expect(isFullCommitHash("0123456789abcdef0123456789abcdef012345678")).toBe(false);
  });
});
