import type { HostRepository } from "./ports/git-host.js";

/**
 * Whether a repository may be served to a caller who has not authenticated. Fails closed: only a
 * repository the host reports as public qualifies, whatever credentials fetched the answer.
 */
export function isAnonymouslyReadable(repository: HostRepository): boolean {
  return repository.visibility === "public";
}
