import { parseRepoPath, type RestMount, sourceFileUrl } from "@skillcdn/core";

// Where the things a page shows live at their git host, at the commit the page shows. The pages
// send a reader there for what they do not serve themselves: the tree, a license file, and the
// bytes of a picture.

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** The mounted directory at its host. */
export function hostTreeUrl(mount: RestMount): string {
  const { owner, name } = mount.repository;
  const directory = mount.path === "" ? "" : `/${encodePath(mount.path)}`;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree/${mount.commit}${directory}`;
}

/** A file of the commit at its host, for a reader sent to the source; `undefined` for a path that is not one. */
export function hostFileUrl(mount: RestMount, path: string): string | undefined {
  const parsed = parseRepoPath(path);
  return parsed.ok ? sourceFileUrl(mount.repository, mount.commit, parsed.value) : undefined;
}

/** The bytes of a file of the commit as the host serves them: where a picture in Markdown is loaded from. */
export function hostRawUrl(mount: RestMount, path: string): string {
  const { owner, name } = mount.repository;
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${mount.commit}/${encodePath(path)}`;
}
