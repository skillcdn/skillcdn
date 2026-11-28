import { describe, expect, it } from "vitest";
import { commitOf, imageVersion, PACKAGES_VERSION_FILE, type ReadText } from "./image-version.js";
import { VERSION_PATTERN } from "./version.js";

const COMMIT = "abc1234".padEnd(40, "0");
const OLDER = "fed9876".padEnd(40, "1");

/** A checkout as the files the build reads; every path asked for is kept. */
function checkout(files: Readonly<Record<string, string>>): { read: ReadText; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    read: (path) => {
      asked.push(path);
      return files[path];
    },
  };
}

const packages = (version: unknown): Record<string, string> => ({
  [PACKAGES_VERSION_FILE]: JSON.stringify({ name: "@skillcdn/cli", version }),
});

const versionOf = (named: string | undefined, files: Readonly<Record<string, string>>) =>
  imageVersion(named, checkout(files).read);

describe("the commit a checkout is at", () => {
  it("is the head itself when the head names a commit", () => {
    expect(commitOf(checkout({ ".git/HEAD": `${COMMIT}\n` }).read)).toBe(COMMIT);
    // The longer hash format of git.
    const long = "9".repeat(64);
    expect(commitOf(checkout({ ".git/HEAD": `${long}\n` }).read)).toBe(long);
  });

  it("is what the branch of the head says, in a file of its own", () => {
    const files = { ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": `${COMMIT}\n` };
    expect(commitOf(checkout(files).read)).toBe(COMMIT);
    const nested = {
      ".git/HEAD": "ref: refs/heads/fix/a-thing\n",
      ".git/refs/heads/fix/a-thing": `${COMMIT}\n`,
    };
    expect(commitOf(checkout(nested).read)).toBe(COMMIT);
    // A branch named in another writing than this file's.
    const name = `release-${String.fromCodePoint(0xac00, 0xb098)}_1.2@x`;
    const named = {
      ".git/HEAD": `ref: refs/heads/${name}\n`,
      [`.git/refs/heads/${name}`]: `${COMMIT}\n`,
    };
    expect(commitOf(checkout(named).read)).toBe(COMMIT);
  });

  it("is the line of the branch among the packed refs when the branch has no file", () => {
    const packed = [
      "# pack-refs with: peeled fully-peeled sorted ",
      `${OLDER} refs/heads/main-old`,
      `${COMMIT} refs/heads/main`,
      `${OLDER} refs/remotes/origin/main`,
      `${OLDER} refs/tags/v1`,
      `^${OLDER}`,
      "",
    ].join("\n");
    const files = { ".git/HEAD": "ref: refs/heads/main\n", ".git/packed-refs": packed };
    expect(commitOf(checkout(files).read)).toBe(COMMIT);
    // Lines written on another system end otherwise.
    const windows = packed.replaceAll("\n", String.fromCodePoint(13, 10));
    expect(commitOf(checkout({ ...files, ".git/packed-refs": windows }).read)).toBe(COMMIT);
    // A branch the file does not list is at no commit the build can read.
    const other = { ...files, ".git/HEAD": "ref: refs/heads/other\n" };
    expect(commitOf(checkout(other).read)).toBeUndefined();
  });

  it("is the file of the branch, never the older packed line under it", () => {
    const files = {
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/refs/heads/main": `${COMMIT}\n`,
      ".git/packed-refs": `${OLDER} refs/heads/main\n`,
    };
    expect(commitOf(checkout(files).read)).toBe(COMMIT);
    // A file that holds no commit is not passed over for the line.
    expect(
      commitOf(checkout({ ...files, ".git/refs/heads/main": "not a commit\n" }).read),
    ).toBeUndefined();
  });

  it("is unknown without the files: no checkout, a worktree, refs kept otherwise", () => {
    expect(commitOf(checkout({}).read)).toBeUndefined();
    expect(commitOf(checkout({ ".git/HEAD": "ref: refs/heads/main\n" }).read)).toBeUndefined();
    expect(commitOf(checkout({ ".git/HEAD": "ref: refs/heads/.invalid\n" }).read)).toBeUndefined();
    expect(commitOf(checkout({ ".git/HEAD": "" }).read)).toBeUndefined();
  });

  it("reads nothing outside the branches, whatever the head says", () => {
    const hostile = [
      "ref: refs/heads/../../../etc/passwd",
      "ref: refs/heads/..",
      "ref: refs/heads/a/../../../config",
      "ref: refs/heads//etc/passwd",
      "ref: refs/heads/./main",
      "ref: refs/heads/",
      "ref: /etc/passwd",
      "ref: ../config",
      "ref: refs/remotes/origin/main",
      "ref: refs/tags/v1",
      "ref: refs/heads/a\\..\\..\\config",
      "ref: refs/heads/C:/secrets",
      "ref: refs/heads/main extra",
      `ref: refs/heads/main\n${COMMIT}`,
      `ref: refs/heads/${String.fromCodePoint(0)}main`,
      `ref: refs/heads/${"a".repeat(5000)}`,
      `${COMMIT}0`,
      COMMIT.slice(1),
      COMMIT.toUpperCase(),
      String.fromCodePoint(0xfffd, 0xfffd, 0x1b),
    ];
    for (const head of hostile) {
      // Every file the build may read answers with a commit, so a read that went astray shows.
      const asked: string[] = [];
      const commit = commitOf((path) => {
        asked.push(path);
        return path === ".git/HEAD" ? head : path === ".git/packed-refs" ? "" : COMMIT;
      });
      expect(commit, head).toBeUndefined();
      expect(asked, head).toEqual([".git/HEAD"]);
    }
  });

  it("takes no commit from a packed line that is not one", () => {
    const lines = [
      `${COMMIT}  refs/heads/main`,
      `${COMMIT} refs/heads/main trailing`,
      `${COMMIT.slice(2)} refs/heads/main`,
      `refs/heads/main ${COMMIT}`,
      `^${COMMIT} refs/heads/main`,
      "refs/heads/main",
    ];
    for (const line of lines) {
      const files = { ".git/HEAD": "ref: refs/heads/main\n", ".git/packed-refs": `${line}\n` };
      expect(commitOf(checkout(files).read), line).toBeUndefined();
    }
    // A very long file is read to its end and still answers.
    const long = `${`${OLDER} refs/heads/other\n`.repeat(50_000)}${COMMIT} refs/heads/main\n`;
    const files = { ".git/HEAD": "ref: refs/heads/main\n", ".git/packed-refs": long };
    expect(commitOf(checkout(files).read)).toBe(COMMIT);
  });
});

describe("what the server of an image says of itself (ADR-0134)", () => {
  const atCommit = { ...packages("1.2.3"), ".git/HEAD": `${COMMIT}\n` };

  it("is the version the build names, as it is", () => {
    for (const named of ["1.2.3", "1.2.3-4-gabc1234", "0.0.0-ci", "1.2.3+ours"]) {
      const { read, asked } = checkout(atCommit);
      expect(imageVersion(named, read)).toEqual({ ok: true, version: named });
      // The checkout is not looked at.
      expect(asked).toEqual([]);
    }
  });

  it("fails the build on a name that is not a version", () => {
    const lineBreak = String.fromCodePoint(13, 10);
    for (const named of ["v1.2.3", "1.2", "latest", "1.2.3 (ours)", `1.2.3${lineBreak}x: 1`, " "]) {
      expect(versionOf(named, atCommit), named).toEqual({
        ok: false,
        problem: "VERSION: must be a version such as 1.2.3",
      });
    }
  });

  it("is the version of the packages with the commit, from a build that names none", () => {
    expect(versionOf(undefined, atCommit)).toEqual({ ok: true, version: "1.2.3+abc1234" });
    // A build argument left out arrives empty.
    expect(versionOf("", atCommit)).toEqual({ ok: true, version: "1.2.3+abc1234" });
    const onBranch = {
      ...packages("1.2.3"),
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/refs/heads/main": `${COMMIT}\n`,
    };
    expect(versionOf(undefined, onBranch)).toEqual({ ok: true, version: "1.2.3+abc1234" });
    // The packages of a prerelease keep its name in front of the commit.
    expect(versionOf(undefined, { ...atCommit, ...packages("2.0.0-rc.1") })).toEqual({
      ok: true,
      version: "2.0.0-rc.1+abc1234",
    });
  });

  it("is the version of the packages marked as built from source, when no commit can be read", () => {
    expect(versionOf(undefined, packages("1.2.3"))).toEqual({ ok: true, version: "1.2.3+source" });
    const astray = { ...packages("1.2.3"), ".git/HEAD": "ref: refs/heads/../../config\n" };
    expect(versionOf(undefined, astray)).toEqual({ ok: true, version: "1.2.3+source" });
  });

  it("fails the build when the packages name no version", () => {
    const problem = {
      ok: false,
      problem: `${PACKAGES_VERSION_FILE}: names no version of the packages`,
    };
    expect(versionOf(undefined, { ".git/HEAD": `${COMMIT}\n` })).toEqual(problem);
    const not = ["latest", "1.2", "v1.2.3", "1.2.3+built", "1.2.3 ", 123, null, ["1.2.3"], {}];
    for (const version of not) {
      expect(versionOf(undefined, { ...atCommit, ...packages(version) }), String(version)).toEqual(
        problem,
      );
    }
    for (const text of ["", "{", "[]", "null", '"1.2.3"', `{"version":${"[".repeat(10_000)}`]) {
      expect(versionOf(undefined, { ...atCommit, [PACKAGES_VERSION_FILE]: text }), text).toEqual(
        problem,
      );
    }
  });

  it("says nothing the server would refuse at startup", () => {
    const said = [
      versionOf(undefined, atCommit),
      versionOf(undefined, packages("1.2.3")),
      versionOf(undefined, { ...atCommit, ...packages(`99999.99999.99999-${"a".repeat(40)}`) }),
      versionOf("1.2.3", atCommit),
    ];
    for (const result of said) {
      expect(result.ok && VERSION_PATTERN.test(result.version), JSON.stringify(result)).toBe(true);
    }
  });
});
