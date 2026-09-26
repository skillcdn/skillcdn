import {
  type Address,
  type AddressError,
  formatAddress,
  LEGAL_PAGE_PATHS,
  type LegalDocumentKind,
  parseAddress,
} from "@skillcdn/core";

// A few kinds of page and no nesting, so the router is a function from a URL to a route.
// Paths are the same in every language; the language travels in the query (i18n/languages.ts).

export type MountView =
  | { readonly kind: "overview"; readonly query: string | undefined; readonly path?: string }
  | { readonly kind: "skill"; readonly path: string }
  | { readonly kind: "file"; readonly path: string };

export type Route =
  | { readonly name: "landing" }
  | { readonly name: "explore" }
  | { readonly name: "mount"; readonly address: Address; readonly view: MountView }
  /** A page of the deployment's own: its terms or its privacy policy (ADR-0029). */
  | { readonly name: "legal"; readonly kind: LegalDocumentKind }
  | { readonly name: "bad-address"; readonly error: AddressError }
  /** Every state of every page, for whoever works on the design. Only in development. */
  | { readonly name: "states" }
  /** The picture behind the social-preview images. Only in development. */
  | { readonly name: "og-card" }
  | { readonly name: "not-found" };

export const PATHS = {
  landing: "/",
  explore: "/explore",
  terms: LEGAL_PAGE_PATHS.terms,
  privacy: LEGAL_PAGE_PATHS.privacy,
  states: "/dev/states",
  ogCard: "/dev/og",
} as const;

const MOUNT_PREFIX = "/gh/";

export function matchRoute(pathname: string, search: string, development = false): Route {
  if (pathname === PATHS.landing) {
    return { name: "landing" };
  }
  if (pathname === PATHS.explore) {
    return { name: "explore" };
  }
  if (pathname === PATHS.terms) {
    return { name: "legal", kind: "terms" };
  }
  if (pathname === PATHS.privacy) {
    return { name: "legal", kind: "privacy" };
  }
  if (pathname.startsWith(MOUNT_PREFIX)) {
    const parsed = parseAddress(pathname);
    if (!parsed.ok) {
      return { name: "bad-address", error: parsed.error };
    }
    const params = new URLSearchParams(search);
    const skill = params.get("skill");
    const file = params.get("file");
    const query = params.get("q")?.trim();
    const view: MountView =
      skill !== null && skill.length > 0
        ? { kind: "skill", path: skill }
        : file !== null && file.length > 0
          ? { kind: "file", path: file }
          : {
              kind: "overview",
              query: query === undefined || query === "" ? undefined : query,
              ...(params.has("path") ? { path: params.get("path") ?? "" } : {}),
            };
    return { name: "mount", address: parsed.value, view };
  }
  if (development && pathname === PATHS.states) {
    return { name: "states" };
  }
  if (development && pathname === PATHS.ogCard) {
    return { name: "og-card" };
  }
  return { name: "not-found" };
}

/** The URL of a view of a mount, without a language. */
export function mountHref(address: Address, view?: MountView): string {
  const path = formatAddress(address);
  const params = new URLSearchParams();
  if (view?.kind === "skill") {
    params.set("skill", view.path);
  } else if (view?.kind === "file") {
    params.set("file", view.path);
  } else if (view?.kind === "overview") {
    if (view.path !== undefined && view.path !== address.path) params.set("path", view.path);
    if (view.query !== undefined) params.set("q", view.query);
  }
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

/** A repository page on GitHub, optionally at a ref and a directory: what people tend to paste. */
const GITHUB_PAGE =
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?(?:\/tree\/([^/\s?#]+)(?:\/([^\s?#]*?))?)?\/?(?:[?#].*)?$/i;

/**
 * Turns what a person types into an address: `owner/repo@ref/path`, with or without `/gh/` or
 * this service's origin in front, or the URL of a repository page on GitHub.
 */
export function addressFromInput(input: string): ReturnType<typeof parseAddress> {
  const text = input.trim();
  const page = GITHUB_PAGE.exec(text);
  if (page !== null) {
    const [, owner, repo, ref, path] = page;
    const refPart = ref === undefined ? "" : `@${ref}`;
    const pathPart = path === undefined || path === "" ? "" : `/${path}`;
    return parseAddress(`/gh/${owner}/${repo}${refPart}${pathPart}`);
  }
  const bare = text.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
  if (bare === "") {
    // Nothing typed yet: "a repository is missing" says more than "an empty segment".
    return parseAddress("/gh");
  }
  return parseAddress(`/${/^gh\//.test(bare) ? bare : `gh/${bare}`}`);
}
