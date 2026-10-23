import { describe, expect, it } from "vitest";
import { parseRepoPath, type RepoPath } from "../repo-path.js";
import { describeMount } from "./render.js";
import type { MountSummary } from "./results.js";

function path(value: string): RepoPath {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
}
const mount: MountSummary = {
  repository: "acme/skills",
  ref: undefined,
  commit: "a".repeat(40),
  path: path(""),
  verified: true,
  truncated: false,
  skillUri: "skill://gh/acme/skills",
};

describe("the source a result names", () => {
  it("names the repository, the ref, the commit and the mounted path", () => {
    expect(describeMount(mount)).toBe("acme/skills (commit aaaaaaa)");
    expect(describeMount({ ...mount, ref: "main", path: path("docs") })).toBe(
      "acme/skills@main (commit aaaaaaa, under docs)",
    );
  });

  it("adds one clause while another commit's index is served, and nothing else (ADR-0068)", () => {
    const newest = "b".repeat(40);
    expect(describeMount({ ...mount, newest: { commit: newest, status: "indexing" } })).toBe(
      "acme/skills (commit aaaaaaa; newest bbbbbbb indexing)",
    );
    expect(
      describeMount({
        ...mount,
        newest: { commit: newest, status: "failed", errorCode: "indexer.failed" },
      }),
    ).toBe("acme/skills (commit aaaaaaa; newest bbbbbbb failed (indexer.failed))");
    // The same commit: its index is being rebuilt under newer reading rules.
    expect(describeMount({ ...mount, newest: { commit: mount.commit, status: "indexing" } })).toBe(
      "acme/skills (commit aaaaaaa; being reindexed)",
    );
    expect(
      describeMount({
        ...mount,
        path: path("docs"),
        newest: { commit: mount.commit, status: "failed", errorCode: "indexer.failed" },
      }),
    ).toBe("acme/skills (commit aaaaaaa; reindexing failed (indexer.failed), under docs)");
  });
});
