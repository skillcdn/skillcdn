import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import { joinSkillPages } from "./pages.js";
import type { MountSummary, SkillResult } from "./results.js";

function path(input: string): RepoPath {
  const parsed = parseRepoPath(input);
  if (!parsed.ok) throw new Error(`invalid test path ${input}`);
  return parsed.value;
}

const mount: MountSummary = {
  repository: "acme/skills",
  ref: undefined,
  commit: "0".repeat(40),
  path: path(""),
  verified: true,
  truncated: false,
  skillUri: "skill://gh/acme/skills",
};

const page = (patch: Partial<SkillResult>): SkillResult => ({
  mount,
  path: path("ads/SKILL.md"),
  ruleChain: [],
  references: [],
  complete: true,
  nextCursor: undefined,
  name: "ads",
  directory: path("ads"),
  description: "Writes ads.",
  license: undefined,
  compatibility: undefined,
  allowedTools: undefined,
  metadata: {},
  body: "",
  files: [],
  filesTruncated: false,
  included: [],
  warnings: [],
  rules: undefined,
  translations: {},
  ...patch,
});

describe("joinSkillPages", () => {
  it("joins the fragments of the rules, the body and the included files across pages", () => {
    const first = page({
      ruleChain: [{ path: path("SKILLCDN.md"), body: "Be br", truncated: true }],
      body: "",
      files: [path("ads/guide.md")],
      warnings: ["one"],
      complete: false,
      nextCursor: "c1",
    });
    const second = page({
      ruleChain: [{ path: path("SKILLCDN.md"), body: "ief.", truncated: false }],
      body: "# Ads\nWrite",
      included: [{ path: path("ads/guide.md"), content: "Gui", truncated: true }],
      warnings: ["one", "two"],
      complete: false,
      nextCursor: "c2",
    });
    const third = page({
      body: " them.",
      included: [{ path: path("ads/guide.md"), content: "de", truncated: false }],
      complete: true,
      nextCursor: undefined,
    });
    const whole = joinSkillPages([first, second, third]);
    expect(whole).toMatchObject({
      ruleChain: [{ path: path("SKILLCDN.md"), body: "Be brief.", truncated: false }],
      rules: { path: path("SKILLCDN.md"), body: "Be brief.", truncated: false },
      body: "# Ads\nWrite them.",
      included: [{ path: path("ads/guide.md"), content: "Guide", truncated: false }],
      files: [path("ads/guide.md")],
      warnings: ["one", "two"],
      complete: true,
      nextCursor: undefined,
    });
  });

  it("keeps two rules apart when the first is complete, and answers nothing for no page", () => {
    const whole = joinSkillPages([
      page({
        ruleChain: [{ path: path("SKILLCDN.md"), body: "Root.", truncated: false }],
        complete: false,
        nextCursor: "c1",
      }),
      page({
        ruleChain: [{ path: path("ads/SKILLCDN.md"), body: "Ads.", truncated: false }],
      }),
    ]);
    expect(whole?.ruleChain).toEqual([
      { path: path("SKILLCDN.md"), body: "Root.", truncated: false },
      { path: path("ads/SKILLCDN.md"), body: "Ads.", truncated: false },
    ]);
    expect(whole?.complete).toBe(true);
    expect(joinSkillPages([])).toBeUndefined();
  });
});
