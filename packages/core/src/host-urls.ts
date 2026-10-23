import type { AddressHost, GitHostKey } from "./address.js";
import { localFileUrl } from "./license.js";
import type { RepoPath } from "./repo-path.js";

// Where a browser fetches what the pages do not serve themselves: the bytes of a file of a
// repository, and the picture of an account, both from the git host (ADR-0030, ADR-0031). A pack
// served from a directory of a deployment (ADR-0071) is at no host: what it has of a source is
// the page of the address at the file, and its owner has no picture.

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** The bytes of a file of a commit as the host serves them: where a picture is loaded from. */
export function rawFileUrl(
  repository: { readonly host: AddressHost; readonly owner: string; readonly name: string },
  commit: string,
  path: RepoPath,
): string {
  switch (repository.host) {
    case "gh":
      return `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${commit}/${encodePath(path)}`;
    case "local":
      // The deployment serves no bytes of a directory pack as they are: the page of the file is
      // all there is to send a reader to.
      return localFileUrl(repository, path);
  }
}

/** The page of an account at its host: where a reader is sent for the account itself. */
export function accountPageUrl(host: GitHostKey, login: string): string {
  switch (host) {
    case "gh":
      return `https://github.com/${encodeURIComponent(login)}`;
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
