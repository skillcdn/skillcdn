import { describe, expect, it } from "vitest";
import {
  isWithinRepoPath,
  joinRepoPath,
  MAX_REPO_PATH_LENGTH,
  parseRepoPath,
  type RepoPath,
  type RepoPathErrorCode,
  ROOT_PATH,
  relativeRepoPath,
} from "./repo-path.js";

function path(input: string): RepoPath {
  const result = parseRepoPath(input);
  if (!result.ok) {
    throw new Error(`expected ${input} to be a valid path, got ${result.error.code}`);
  }
  return result.value;
}

describe("parseRepoPath", () => {
  it.each([
    "",
    "SKILL.md",
    "skills/ads/SKILL.md",
    "docs/my file (1).md",
    "문서/가이드.md",
    "a:b@c",
  ])("accepts %j", (input) => {
    expect(path(input)).toBe(input);
  });

  it.each<[string, RepoPathErrorCode]>([
    ["/etc/passwd", "absolute"],
    ["docs/", "empty_segment"],
    ["docs//guide.md", "empty_segment"],
    ["..", "dot_segment"],
    ["docs/../../etc/passwd", "dot_segment"],
    ["./docs", "dot_segment"],
    ["docs\\..\\secrets", "forbidden_character"],
    [`docs/${String.fromCodePoint(0)}.md`, "forbidden_character"],
    [`docs/${String.fromCodePoint(0x202e)}fdp.md`, "forbidden_character"],
    ["a".repeat(MAX_REPO_PATH_LENGTH + 1), "too_long"],
  ])("rejects %j as %s", (input, code) => {
    const result = parseRepoPath(input);
    expect(result.ok ? undefined : result.error.code).toBe(code);
  });

  it("does not decode anything: percent signs are ordinary characters", () => {
    expect(path("docs/%2e%2e/x")).toBe("docs/%2e%2e/x");
  });
});

describe("repo path helpers", () => {
  it("joins without ever leaving the base", () => {
    expect(joinRepoPath(ROOT_PATH, path("a/b"))).toBe("a/b");
    expect(joinRepoPath(path("skills"), ROOT_PATH)).toBe("skills");
    expect(joinRepoPath(path("skills"), path("ads/SKILL.md"))).toBe("skills/ads/SKILL.md");
  });

  it("tests containment on segment boundaries", () => {
    expect(isWithinRepoPath(ROOT_PATH, path("anything"))).toBe(true);
    expect(isWithinRepoPath(path("skills"), path("skills"))).toBe(true);
    expect(isWithinRepoPath(path("skills"), path("skills/ads"))).toBe(true);
    expect(isWithinRepoPath(path("skills"), path("skills-private/ads"))).toBe(false);
    expect(isWithinRepoPath(path("skills/ads"), path("skills"))).toBe(false);
  });

  it("returns the path below a root", () => {
    expect(relativeRepoPath(ROOT_PATH, path("a/b"))).toBe("a/b");
    expect(relativeRepoPath(path("skills"), path("skills/ads/SKILL.md"))).toBe("ads/SKILL.md");
    expect(relativeRepoPath(path("skills"), path("skills"))).toBe("");
    expect(relativeRepoPath(path("skills"), path("skills-private/x"))).toBeUndefined();
  });
});
