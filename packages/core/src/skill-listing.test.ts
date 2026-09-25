import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "./repo-path.js";
import {
  describeListingProblem,
  isHiddenSkill,
  SKILL_LISTING_MAX_BYTES,
  SKILL_LISTING_MAX_FILES,
  skillListingProblem,
} from "./skill-listing.js";

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
}

const file = (size = 10, available = true) => ({ size, available });

describe("what the skills extension lists", () => {
  it("lists a skill whose directory is named after it and whose files can all be served", () => {
    expect(
      skillListingProblem({ directory: path("skills/ads"), name: "ads", files: [file(), file()] }),
    ).toBeUndefined();
    expect(skillListingProblem({ directory: path(""), name: "anything", files: [file()] })).toBe(
      undefined,
    );
  });

  it("names the first reason a skill cannot be listed", () => {
    expect(
      skillListingProblem({ directory: path("skills/ads"), name: "ad-copy", files: [file()] }),
    ).toBe("name_directory_mismatch");
    expect(
      skillListingProblem({
        directory: path("skills/ads"),
        name: "ads",
        files: Array.from({ length: SKILL_LISTING_MAX_FILES + 1 }, () => file()),
      }),
    ).toBe("too_many_files");
    expect(
      skillListingProblem({
        directory: path("skills/ads"),
        name: "ads",
        files: [file(SKILL_LISTING_MAX_BYTES), file(1)],
      }),
    ).toBe("too_large");
    expect(
      skillListingProblem({
        directory: path("skills/ads"),
        name: "ads",
        files: [file(), file(10, false)],
      }),
    ).toBe("file_unavailable");
  });

  it("tells hidden skills from visible ones by their directory", () => {
    expect(isHiddenSkill(path(".claude/skills/ads"))).toBe(true);
    expect(isHiddenSkill(path("skills/.ads"))).toBe(true);
    expect(isHiddenSkill(path("skills/ads"))).toBe(false);
    expect(isHiddenSkill(path(""))).toBe(false);
  });

  it("explains every problem to the author", () => {
    for (const problem of [
      "name_directory_mismatch",
      "too_many_files",
      "too_large",
      "file_unavailable",
      "duplicate",
      "hidden",
      "uri_collision",
    ] as const) {
      expect(describeListingProblem(problem).length).toBeGreaterThan(20);
    }
    expect(describeListingProblem("duplicate", "skills/ads")).toContain("as skills/ads");
  });
});
