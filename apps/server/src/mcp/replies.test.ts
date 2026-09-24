import { MCP_RESULT_MAX_BYTES, type RepoPath, type SkillResult } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { fitsReply, problem, skillReply } from "./replies.js";

const skill = (patch: Partial<SkillResult> = {}): SkillResult => ({
  path: "skills/write/SKILL.md" as RepoPath,
  mount: {
    repository: "acme/skills",
    ref: undefined,
    commit: "abc",
    path: "" as RepoPath,
    verified: true,
    truncated: false,
  },
  name: "write",
  directory: "skills/write" as RepoPath,
  description: "Write a result.",
  license: undefined,
  compatibility: undefined,
  allowedTools: undefined,
  metadata: {},
  body: "Required instructions.",
  files: [],
  filesTruncated: false,
  included: [],
  warnings: [],
  rules: undefined,
  translations: {},
  complete: true,
  ...patch,
});

describe("MCP context projections", () => {
  it("bounds errors after JSON escaping as well as their source text", () => {
    const result = problem(String.fromCodePoint(1).repeat(30_000));
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MCP_RESULT_MAX_BYTES);
    expect(fitsReply(result)).toBe(true);
    expect(result.isError).toBe(true);
  });

  it("keeps missing required context ahead of optional author warnings", () => {
    const warning = "Required file unavailable in this snapshot: skills/write/rules.md.";
    const result = skillReply(
      skill({
        warnings: [
          "Optional field one ignored.",
          "Optional field two ignored.",
          "Optional field three ignored.",
          warning,
        ],
        complete: false,
      }),
    );
    expect(result.content[0]?.text).toContain(warning);
    expect(result.content[0]?.text).toContain("incomplete");
  });

  it("does not repeat optional discovery metadata on continuation pages", () => {
    const result = skillReply(
      skill({
        description: "Long discovery description. ".repeat(80),
        metadata: { audience: "people" },
        files: ["skills/write/guide.md" as RepoPath],
        references: [{ path: "skills/write/guide.md", href: "guide.md", status: "available" }],
      }),
      true,
    );
    expect(result.content[0]?.text).toContain("Required instructions.");
    expect(result.content[0]?.text).not.toContain("Long discovery description");
    expect(result.content[0]?.text).not.toContain("abbreviated");
    expect(result.content[0]?.text).not.toContain("Supporting files");
  });
});
