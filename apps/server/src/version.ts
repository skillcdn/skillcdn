/** What the server calls itself on the wire: MCP server info and the user agent of its calls. */
export const SERVER_NAME = "skillcdn";

/**
 * The version of a build that was told none: one made from source, outside a release. The image
 * of a release carries the release's own, and the configuration reads it (ADR-0133).
 */
export const UNRELEASED_VERSION = "0.0.0";

/** The user agent of the calls the server makes: to the git host, to the servers of the search by meaning. */
export function userAgentOf(version: string): string {
  return `${SERVER_NAME}/${version}`;
}
