import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "./repo-path.js";
import { formatSkillUri, parseSkillUri, skillUriPrefix } from "./skill-uri.js";

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
}

const address = { host: "gh" as const, owner: "acme", repo: "skills" };

describe("skill URIs", () => {
  it("mirror the address without its ref, then the repository-root path", () => {
    expect(skillUriPrefix(address)).toBe("skill://gh/acme/skills");
    expect(formatSkillUri(address, path("skills/ads/SKILL.md"))).toBe(
      "skill://gh/acme/skills/skills/ads/SKILL.md",
    );
    expect(formatSkillUri(address, path("docs/a b#1.md"))).toBe(
      "skill://gh/acme/skills/docs/a%20b%231.md",
    );
  });

  it("read back to the same address and path", () => {
    for (const value of ["skills/ads/SKILL.md", "docs/a b#1.md", "x/@scope/pkg.md"]) {
      expect(parseSkillUri(formatSkillUri(address, path(value)))).toEqual({
        address,
        path: value,
      });
    }
  });

  it.each([
    "skill://gh/acme/skills",
    "skill://gh/acme/skills@main/skills/ads/SKILL.md",
    "skill://gh/acme/skills/../SKILL.md",
    "skill://gh/acme/skills//SKILL.md",
    "skill://gh/acme/skills/%2e%2e/x.md",
    "skill://xx/acme/skills/SKILL.md",
    "file://gh/acme/skills/SKILL.md",
    "skill:gh/acme/skills/SKILL.md",
    "",
  ])("rejects %j", (uri) => {
    expect(parseSkillUri(uri)).toBeUndefined();
  });
});
