import { describe, expect, it } from "vitest";
import { accountAvatarUrl, accountPageUrl, rawFileUrl } from "./host-urls.js";
import { parseRepoPath, type RepoPath } from "./repo-path.js";

const path = (value: string): RepoPath => {
  const parsed = parseRepoPath(value);
  if (!parsed.ok) throw new Error("invalid test path");
  return parsed.value;
};

describe("the URLs at a host", () => {
  it("names the bytes of a file of a commit as the git host serves them", () => {
    expect(
      rawFileUrl(
        { host: "gh", owner: "Acme", name: "skills" },
        "a".repeat(40),
        path("img/a b.png"),
      ),
    ).toBe(`https://raw.githubusercontent.com/Acme/skills/${"a".repeat(40)}/img/a%20b.png`);
    expect(accountPageUrl("gh", "Acme")).toBe("https://github.com/Acme");
    expect(accountAvatarUrl("gh", "12345", 160)).toBe(
      "https://avatars.githubusercontent.com/u/12345?s=160&v=4",
    );
  });

  it("names the page of the file for a pack served from a directory, which has no bytes at any host", () => {
    expect(
      rawFileUrl({ host: "local", owner: "acme", name: "handbook" }, "b".repeat(40), path("a.png")),
    ).toBe("/local/acme/handbook?file=a.png");
  });
});
