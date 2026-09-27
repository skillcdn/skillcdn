import { hasForbiddenCodePoint } from "./text-safety.js";

// Where a picture that stands for a repository or an address is loaded from (ADR-0031): an
// `https` URL that the reader's browser fetches from wherever it points. The deployment neither
// fetches nor serves it. Shared by the repository manifest and the operator's images.

/** The longest URL a manifest or the operator may name a picture by. */
export const MAX_IMAGE_URL_LENGTH = 2048;

/**
 * `https://`, a host name (or an IPv4 address), an optional port, then a path, a query or a
 * fragment. No user information, no spaces: what a browser loads a picture from, and nothing
 * that could mean something else to it.
 */
const HTTPS_URL = /^https:\/\/(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/;

/** True for an `https` URL a browser can load a picture from, within the length bound. */
export function isImageUrl(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_IMAGE_URL_LENGTH &&
    !hasForbiddenCodePoint(value) &&
    HTTPS_URL.test(value)
  );
}
