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
// bytes of a picture. A pack served from a directory of the deployment (ADR-0071) is at no
// host: the deployment sends the bytes of its files itself, from a route of its own (ADR-0077),
// and has no tree or file page to send a reader to.

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
 * The bytes of a file of the commit as they are served: by the host for a repository of one,
 * and by the deployment's own route for a pack of its directory. Where a picture in Markdown is
 * loaded from, and where a reader fetches a file the pages do not show.
 */
export function hostRawUrl(mount: RestMount, path: string): string {
  const { host, owner, name } = mount.repository;
  const parsed = parseRepoPath(path);
  if (parsed.ok) {
    return rawFileUrl({ host, owner, name }, mount.commit, parsed.value);
  }
  const repository = gitRepository(mount);
  if (repository === undefined) {
    return path;
  }
  return `https://raw.githubusercontent.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/${mount.commit}/${encodePath(path)}`;
}

/**
 * Where a person opens a file the pages cannot show, a picture or an original: the file's page
 * at its host, which a browser signed in to the host may open for a private repository too, or
 * the deployment's own route for a pack of its directory.
 */
export function hostOpenUrl(mount: RestMount, path: string): string {
  return hostFileUrl(mount, path) ?? hostRawUrl(mount, path);
}
