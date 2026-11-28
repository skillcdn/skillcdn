/** What the server calls itself on the wire: MCP server info and the user agent of its calls. */
export const SERVER_NAME = "skillcdn";

/**
 * The version of a server that was told none: one run from source. An image says what its build
 * wrote, and a deployment may name one of its own (ADR-0133, ADR-0134).
 */
export const UNRELEASED_VERSION = "0.0.0";

/**
 * A version as releases are numbered: three numbers, and what a build may write after them. It
 * goes into a header and into what the server says of itself, so nothing else is taken.
 */
export const VERSION_PATTERN = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:[-+][0-9A-Za-z.+-]{1,60})?$/;

/** The user agent of the calls the server makes: to the git host, to the servers of the search by meaning. */
export function userAgentOf(version: string): string {
  return `${SERVER_NAME}/${version}`;
}
