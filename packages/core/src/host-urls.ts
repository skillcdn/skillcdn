import { type AddressHost, type GitHostKey, LOCAL_HOST_KEY } from "./address.js";
import type { RepoPath } from "./repo-path.js";
import { REST_ROUTES } from "./rest/contracts.js";

// Where a reader fetches what the pages and the tools do not carry: the bytes of a file of a
// repository, and the picture of an account, both from the git host (ADR-0030, ADR-0031). A pack
// served from a directory of a deployment (ADR-0071) is at no host: the deployment serves the
// bytes of its files itself, as attachments, from a route of its own (ADR-0077), and its owner
// has no picture.

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/**
 * The bytes of a file of a pack served from a directory, as the deployment that serves the pack
 * sends them: its own route, relative to its origin, which the deployment prefixes with the
 * origin visitors use.
 */
export function localRawFileUrl(
  repository: { readonly owner: string; readonly name: string },
  path: RepoPath,
): string {
  return `${REST_ROUTES.raw}/${LOCAL_HOST_KEY}/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}?path=${encodeURIComponent(path)}`;
}

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
      return localRawFileUrl(repository, path);
  }
}

/**
 * The bytes of a file kept in Git LFS, which the host's raw host does not serve: GitHub's own
 * raw route answers the file itself for one, by a redirect to where it keeps LFS objects, and
 * the raw host's bytes for any other file. A pack served from a directory has the pointer and
 * nothing else, which is what its route serves.
 */
export function lfsFileUrl(
  repository: { readonly host: AddressHost; readonly owner: string; readonly name: string },
  commit: string,
  path: RepoPath,
): string {
  switch (repository.host) {
    case "gh":
      return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/raw/${commit}/${encodePath(path)}`;
    case "local":
      return localRawFileUrl(repository, path);
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
