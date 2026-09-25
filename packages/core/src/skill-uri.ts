import { type Address, formatAddress, parseAddress } from "./address.js";
import { type RepoPath, ROOT_PATH } from "./repo-path.js";

/**
 * How the MCP skills extension names the files of a skill: the address without its ref, then
 * the file's repository-root path (ADR-0024). The ref stays with the connection, so the same URI
 * names the same file at whatever commit the address serves.
 */
export const SKILL_URI_SCHEME = "skill";

export type SkillUriAddress = Pick<Address, "host" | "owner" | "repo">;

/** `skill://gh/<owner>/<repo>`: what every URI of the repository starts with. */
export function skillUriPrefix(address: SkillUriAddress): string {
  return `${SKILL_URI_SCHEME}:/${formatAddress({ ...address, ref: undefined, path: ROOT_PATH })}`;
}

/** The URI of one repository-root path; the path is percent-encoded as an address would be. */
export function formatSkillUri(address: SkillUriAddress, path: RepoPath): string {
  return `${SKILL_URI_SCHEME}:/${formatAddress({ ...address, ref: undefined, path })}`;
}

export interface ParsedSkillUri {
  readonly address: SkillUriAddress;
  /** The repository-root path the URI names; never the root itself. */
  readonly path: RepoPath;
}

/**
 * Reads a skill URI back. The part after the scheme is an address without a ref, so the address
 * grammar decides what is valid; a ref, a missing path or anything the grammar rejects is not a
 * skill URI.
 */
export function parseSkillUri(uri: string): ParsedSkillUri | undefined {
  const prefix = `${SKILL_URI_SCHEME}://`;
  if (!uri.startsWith(prefix)) return undefined;
  const parsed = parseAddress(`/${uri.slice(prefix.length)}`);
  if (!parsed.ok || parsed.value.ref !== undefined || parsed.value.path.length === 0) {
    return undefined;
  }
  const { host, owner, repo, path } = parsed.value;
  return { address: { host, owner, repo }, path };
}
