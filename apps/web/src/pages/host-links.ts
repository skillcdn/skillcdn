import {
  type GitHostKey,
  isGitHostKey,
  parseRepoPath,
  type RestMount,
  rawFileUrl,
  sourceFileUrl,
} from "@skillcdn/core";

// Where the things a page shows live at their git host, at the commit the page shows. The pages
// send a reader there for what they do not serve themselves: the tree, a license file, and the
// bytes of a picture. A pack served from a machine (ADR-0053) is at no host: there is nowhere
// to send a reader, and the pages say nothing instead.

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** The repository of a mount at its git host, or `undefined` for a pack that is at none. */
function gitRepository(
  mount: RestMount,
): { readonly host: GitHostKey; readonly owner: string; readonly name: string } | undefined {
  const { host, owner, name } = mount.repository;
  return isGitHostKey(host) ? { host, owner, name } : undefined;
}

/** The mounted directory at its host; `undefined` for a pack that is at none. */
export function hostTreeUrl(mount: RestMount): string | undefined {
  const repository = gitRepository(mount);
  if (repository === undefined) {
    return undefined;
  }
  const directory = mount.path === "" ? "" : `/${encodePath(mount.path)}`;
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tree/${mount.commit}${directory}`;
}

/** A file of the commit at its host, for a reader sent to the source; `undefined` for a path that is not one, or a pack at no host. */
export function hostFileUrl(mount: RestMount, path: string): string | undefined {
  const repository = gitRepository(mount);
  const parsed = parseRepoPath(path);
  return repository !== undefined && parsed.ok
    ? sourceFileUrl(repository, mount.commit, parsed.value)
    : undefined;
}

/**
 * The bytes of a file of the commit as the host serves them: where a picture in Markdown is
 * loaded from. A pack at no host has no such place, and the path is left as written.
 */
export function hostRawUrl(mount: RestMount, path: string): string {
  const repository = gitRepository(mount);
  if (repository === undefined) {
    return path;
  }
  const parsed = parseRepoPath(path);
  if (parsed.ok) {
    return rawFileUrl(repository, mount.commit, parsed.value);
  }
  return `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${mount.commit}/${encodePath(path)}`;
}
