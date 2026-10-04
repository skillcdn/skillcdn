// What a client may be sent back to with an authorization code (docs/specs/permissions.md).
// Pure rules, checked when a client is registered or its document is read, and again when a
// request names where to send the answer.

export const MAX_REDIRECT_URI_LENGTH = 1024;

/** Schemes that run something in the browser, or read from it, instead of leading to a client. */
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "ws:",
  "wss:",
  "ftp:",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for `http://localhost`, `http://127.0.0.1` and `http://[::1]`, on any port. */
export function isLoopbackRedirect(uri: string): boolean {
  const url = URL.parse(uri);
  return url !== null && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Why a URI cannot be a redirect URI, or `undefined` when it can: `https` anywhere, `http` only
 * to this computer, or a scheme of the client's own, as an installed app registers one. Never a
 * fragment, which is where a browser would keep the answer to itself.
 */
export function redirectUriProblem(uri: string): string | undefined {
  if (uri.length > MAX_REDIRECT_URI_LENGTH) {
    return `a redirect URI has at most ${MAX_REDIRECT_URI_LENGTH} characters`;
  }
  const url = URL.parse(uri);
  if (url === null) {
    return "a redirect URI is an absolute URI";
  }
  if (url.hash !== "" || uri.includes("#")) {
    return "a redirect URI has no fragment";
  }
  if (url.username !== "" || url.password !== "") {
    return "a redirect URI carries no credentials";
  }
  if (url.protocol === "https:") {
    return undefined;
  }
  if (url.protocol === "http:") {
    return LOOPBACK_HOSTS.has(url.hostname)
      ? undefined
      : "a redirect URI uses https, unless it leads to this computer";
  }
  return FORBIDDEN_SCHEMES.has(url.protocol)
    ? "a redirect URI leads to a client, not into the browser"
    : undefined;
}

/**
 * Whether the URI a request names is one the client registered: the same string, or, for a
 * client on this computer, the same but for the port, which such a client only learns when it
 * starts listening (RFC 8252, section 7.3).
 */
export function isRegisteredRedirect(registered: readonly string[], presented: string): boolean {
  if (registered.includes(presented)) {
    return true;
  }
  if (!isLoopbackRedirect(presented)) {
    return false;
  }
  const wanted = new URL(presented);
  return registered.some((candidate) => {
    if (!isLoopbackRedirect(candidate)) {
      return false;
    }
    const known = new URL(candidate);
    return (
      known.hostname === wanted.hostname &&
      known.pathname === wanted.pathname &&
      known.search === wanted.search
    );
  });
}

/** Whether a URI is on the web, where its host says who receives what is sent to it. */
function isWebUri(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

/**
 * Whether the answer goes to an app on the person's own computer rather than to a site: an
 * address of the computer itself, or a link scheme an installed app answers to.
 */
export function isLocalRedirect(uri: string): boolean {
  const url = URL.parse(uri);
  return url !== null && (isLoopbackRedirect(uri) || !isWebUri(url));
}

/**
 * Who a person is sent back to, as the consent page names it: the host of a web address, and
 * the scheme of an app's own. Whatever a scheme of an app's own writes after it names no host,
 * however much it looks like one: `com.example.app://github.com/x` leads to the app that
 * answers to `com.example.app:`, and to no site.
 */
export function redirectHostOf(uri: string): string {
  const url = URL.parse(uri);
  if (url === null) {
    return uri;
  }
  return isWebUri(url) ? url.host : url.protocol;
}
