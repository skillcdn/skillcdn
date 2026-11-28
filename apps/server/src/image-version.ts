import * as z from "zod";
import { VERSION_PATTERN } from "./version.js";

// What the server of an image says of itself, as the build of the image works it out (ADR-0134).
// The build runs `print-image-version.ts` over the checkout it builds from; nothing here runs in
// a deployment.

/** Reads a file of the checkout as text, by its path from the root; `undefined` when it is not there. */
export type ReadText = (path: string) => string | undefined;

export type ImageVersion =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly problem: string };

/** Where the version of the packages is read: the file the release workflow reads it from (ADR-0058). */
export const PACKAGES_VERSION_FILE = "packages/cli/package.json";

/** How much of a commit the version carries: what the git host and `git log --oneline` show. */
const COMMIT_LENGTH = 7;

/** A commit as git names it in its own files, in either of its hash formats. */
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * A branch as the head of a checkout names it: under `refs/heads/`, in letters and digits of any
 * writing and the marks branches are commonly named with. No space, no backslash, no control
 * character: the name becomes a path.
 */
const BRANCH = /^refs\/heads\/[\p{L}\p{N}._/@+=,%#!-]{1,200}$/u;

/** The version of the packages: three numbers, and the name of a prerelease when it is one. */
const packageSchema = z.object({
  version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,40})?$/),
});

/**
 * The commit a checkout is at, read from the files of its `.git` directory, since the build has
 * no git: the head itself when it names a commit, else the branch it names, as a file of its own
 * or as a line of `packed-refs`. `undefined` when the files do not say: a build context without
 * them, a worktree (whose `.git` is a file that points elsewhere), a store of refs kept otherwise.
 */
export function commitOf(read: ReadText): string | undefined {
  const head = read(".git/HEAD")?.trim();
  if (head === undefined) {
    return undefined;
  }
  if (COMMIT.test(head)) {
    return head;
  }
  const branch = /^ref: (.+)$/.exec(head)?.[1];
  // The name becomes a path: nothing that steps out of the directory of the branches is read.
  if (
    branch === undefined ||
    !BRANCH.test(branch) ||
    branch.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return undefined;
  }
  const loose = read(`.git/${branch}`)?.trim();
  if (loose !== undefined) {
    // A branch with a file of its own is what that file says: the packed line under it is older.
    return COMMIT.test(loose) ? loose : undefined;
  }
  for (const line of (read(".git/packed-refs") ?? "").split("\n")) {
    const [commit, name, ...more] = line.trim().split(" ");
    if (name === branch && more.length === 0 && commit !== undefined && COMMIT.test(commit)) {
      return commit;
    }
  }
  return undefined;
}

function packagesVersionOf(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = packageSchema.safeParse(json);
  return parsed.success ? parsed.data.version : undefined;
}

/**
 * What the server of an image says of itself. A version the build names is said as it is: the
 * release workflow names the release. A build that names none says the version of the packages in
 * its tree, marked after a `+` as no release: with the commit it is built from, or with `source`
 * when the checkout does not say which (ADR-0134). A problem fails the build, so that no image
 * carries what its server would refuse at startup.
 */
export function imageVersion(named: string | undefined, read: ReadText): ImageVersion {
  if (named !== undefined && named !== "") {
    return VERSION_PATTERN.test(named)
      ? { ok: true, version: named }
      : { ok: false, problem: "VERSION: must be a version such as 1.2.3" };
  }
  const packages = packagesVersionOf(read(PACKAGES_VERSION_FILE));
  if (packages === undefined) {
    return { ok: false, problem: `${PACKAGES_VERSION_FILE}: names no version of the packages` };
  }
  const commit = commitOf(read);
  return {
    ok: true,
    version: `${packages}+${commit === undefined ? "source" : commit.slice(0, COMMIT_LENGTH)}`,
  };
}
