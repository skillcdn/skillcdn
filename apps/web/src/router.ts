import {
  ACCOUNT_PAGE_PATH,
  type Address,
  type AddressError,
  CONSENT_PAGE_PATH,
  formatAddress,
  formatOwnerPath,
  LEGAL_PAGE_PATHS,
  type LegalDocumentKind,
  type OwnerPath,
  parseAddress,
  parseOwnerPath,
} from "@skillcdn/core";

// A few kinds of page and no nesting, so the router is a function from a URL to a route.
// Paths are the same in every language; the language travels in the query (i18n/languages.ts).

export type MountView =
  | { readonly kind: "overview"; readonly query: string | undefined; readonly path?: string }
  | { readonly kind: "skill"; readonly path: string }
  | { readonly kind: "file"; readonly path: string };

/**
 * The sections of the pages of whoever is signed in, in the order the side menu lists them. A
 * feature that belongs to a person gets a section here, a path under `/account`, and a page.
 */
export const ACCOUNT_SECTIONS = ["overview", "repositories", "apps"] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export type Route =
  | { readonly name: "landing" }
  | { readonly name: "explore" }
  | { readonly name: "mount"; readonly address: Address; readonly view: MountView }
  /** The page of an account of the git host: one segment short of an address (ADR-0037). */
  | { readonly name: "owner"; readonly owner: OwnerPath }
  /** The pages of whoever is signed in. */
  | { readonly name: "account"; readonly section: AccountSection }
  /** Where a person is asked whether an app may read an address for them. */
  | { readonly name: "consent" }
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
  account: ACCOUNT_PAGE_PATH,
  consent: CONSENT_PAGE_PATH,
  states: "/dev/states",
  ogCard: "/dev/og",
} as const;

const MOUNT_PREFIX = "/gh/";

/** The path of a section of the account pages; the first section is the account page itself. */
export function accountHref(section: AccountSection = "overview"): string {
  return section === "overview" ? PATHS.account : `${PATHS.account}/${section}`;
}

/** The path of the page of an account. */
export function ownerHref(owner: OwnerPath): string {
  return formatOwnerPath(owner);
}

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
  if (pathname === PATHS.consent) {
    return { name: "consent" };
  }
  if (pathname === PATHS.account || pathname.startsWith(`${PATHS.account}/`)) {
    const wanted =
      pathname === PATHS.account ? "overview" : pathname.slice(PATHS.account.length + 1);
    const section = ACCOUNT_SECTIONS.find(
      (candidate) => candidate === wanted && accountHref(candidate) === pathname,
    );
    return section === undefined ? { name: "not-found" } : { name: "account", section };
  }
  if (pathname.startsWith(MOUNT_PREFIX)) {
    const owner = parseOwnerPath(pathname);
    if (owner !== undefined) {
      return { name: "owner", owner };
    }
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

/** The page of an account, when what a person typed is an account's name and nothing more. */
export function ownerFromInput(input: string): OwnerPath | undefined {
  const text = input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+|\/+$/g, "");
  return parseOwnerPath(`/${/^gh\//.test(text) ? text : `gh/${text}`}`);
}
