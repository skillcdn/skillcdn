import type { GitHostKey } from "./address.js";
import type { RepoPath } from "./repo-path.js";

// Where a browser fetches what the pages do not serve themselves: the bytes of a file of a
// repository, and the picture of an account, both from the git host (ADR-0030, ADR-0031).

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** The bytes of a file of a commit as the host serves them: where a picture is loaded from. */
export function rawFileUrl(
  repository: { readonly host: GitHostKey; readonly owner: string; readonly name: string },
  commit: string,
  path: RepoPath,
): string {
  switch (repository.host) {
    case "gh":
      return `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${commit}/${encodePath(path)}`;
  }
}

/**
 * The picture of an account as the host serves it, `size` pixels square, by the host's immutable
 * id for the account, which survives a rename.
 */
export function accountAvatarUrl(host: GitHostKey, hostAccountId: string, size: number): string {
  switch (host) {
    case "gh":
      return `https://avatars.githubusercontent.com/u/${encodeURIComponent(hostAccountId)}?s=${size}&v=4`;
  }
}
