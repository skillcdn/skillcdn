import {
  type Address,
  formatAddress,
  formatOwnerPath,
  type OwnerPath,
  type RestMount,
} from "@skillcdn/core";
import { useEffect, useRef } from "react";
import type { ApiError } from "./api/client.js";
import type { Language } from "./i18n/languages.js";
import { accountHref, docsHref, type MountView, PATHS, type Route } from "./router.js";

// What the pages tell analytics, once a visitor has allowed them (README.md, "Analytics"): page
// views and a few events, all written here, so that nothing leaves the page that is not
// public. An address is sent once the server has answered that it is a public repository; a
// page about anything else is sent as what it is, under a name that stands for it; what a
// visitor typed, a search, a path that was not found, a title, a sealed request, is never sent.

/**
 * What the server's bootstrap leaves on the page when analytics are configured
 * (`deploy/README.md`): whether the visitor is to be asked, whether they agreed, and where the
 * answer goes. Without analytics there is nothing here.
 */
export interface AnalyticsState {
  /** The visitor is to be asked: nothing is stored yet, and no privacy signal said no. */
  readonly ask: boolean;
  /** The visitor agreed, and the script is loading or loaded. */
  readonly active: boolean;
  decide(granted: boolean): void;
}

declare global {
  interface Window {
    skillcdnAnalytics?: AnalyticsState;
    gtag?: (...args: unknown[]) => void;
  }
}

/** Dispatched on `window` by the bootstrap once analytics are active. */
export const ANALYTICS_ACTIVATED_EVENT = "skillcdn:analytics";

export type AnalyticsParams = Readonly<Record<string, string | number | boolean>>;

/** A page as analytics are told of it. */
export interface AnalyticsPage {
  /** Sent as the page's location: a public address, or a name for what is not one. */
  readonly path: string;
  /** What the page is, sent in place of its title, which may name what is not public. */
  readonly title: string;
  readonly params?: AnalyticsParams;
}

/** Where a page about a repository that is not public, or that is nothing, is said to be. */
export const WITHHELD_REPOSITORY_PATH = "/gh/-/-";
/** The same for the page of an account that is nothing. */
export const WITHHELD_OWNER_PATH = "/gh/-";

function gtagOf(): ((...args: unknown[]) => void) | undefined {
  if (typeof window === "undefined" || window.skillcdnAnalytics?.active !== true) {
    return undefined;
  }
  return typeof window.gtag === "function" ? window.gtag : undefined;
}

/**
 * Sends an event while analytics run; otherwise nothing, and nothing is kept for later. The
 * parameters are words from a short list of the caller's own: never an address that is not
 * public, never text a visitor typed.
 */
export function track(name: string, params: AnalyticsParams = {}): void {
  gtagOf()?.("event", name, params);
}

let lastView: { readonly location: string; readonly key: string } | undefined;

/** Forgets the last page view, between tests. */
export function resetAnalyticsForTests(): void {
  lastView = undefined;
}

/** The page the visitor came from, when it is another site's: a page of this site may be private. */
function outsideReferrer(): string | undefined {
  if (typeof document === "undefined" || document.referrer === "") {
    return undefined;
  }
  const own = window.location.origin;
  return document.referrer === own || document.referrer.startsWith(`${own}/`)
    ? undefined
    : document.referrer;
}

/**
 * Sends a page view with the page's own description of itself in place of the URL and the
 * title. The same page twice in a row is one view. The referrer is the page before, as it was
 * sent, or for the first view the site the visitor came from.
 */
export function trackPage(page: AnalyticsPage, origin: string): void {
  const gtag = gtagOf();
  if (gtag === undefined) {
    return;
  }
  const location = `${origin}${page.path}`;
  const key = JSON.stringify([location, page.title, page.params ?? {}]);
  if (lastView?.key === key) {
    return;
  }
  const referrer = lastView?.location ?? outsideReferrer();
  gtag("event", "page_view", {
    page_location: location,
    page_title: page.title,
    ...(referrer === undefined ? {} : { page_referrer: referrer }),
    ...page.params,
  });
  lastView = { location, key };
}

/**
 * Keeps a page's view sent: when the page is known, when it changes, and when analytics become
 * active with the page already open. `undefined` while a page does not know yet what it shows,
 * which sends nothing.
 */
export function useAnalyticsPage(
  page: AnalyticsPage | undefined,
  origin: string,
  language: Language,
): void {
  const described =
    page === undefined
      ? undefined
      : { ...page, params: { site_language: language, ...page.params } };
  const key =
    described === undefined
      ? undefined
      : JSON.stringify([described.path, described.title, described.params]);
  const current = useRef(described);
  current.current = described;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the page
  useEffect(() => {
    if (current.current !== undefined) {
      trackPage(current.current, origin);
    }
  }, [key, origin]);
  useEffect(() => {
    const send = () => {
      if (current.current !== undefined) {
        trackPage(current.current, origin);
      }
    };
    window.addEventListener(ANALYTICS_ACTIVATED_EVENT, send);
    return () => window.removeEventListener(ANALYTICS_ACTIVATED_EVENT, send);
  }, [origin]);
}

/**
 * The pages that know what they are from their route alone. The page of an address and the
 * page of an account say so themselves, once the server has answered what they show.
 */
export function pageOfRoute(route: Route): AnalyticsPage | undefined {
  switch (route.name) {
    case "landing":
      return { path: PATHS.landing, title: "landing" };
    case "explore":
      return { path: PATHS.explore, title: "explore" };
    case "docs":
      return { path: docsHref(route.slug), title: "docs" };
    case "legal":
      return { path: route.kind === "terms" ? PATHS.terms : PATHS.privacy, title: route.kind };
    case "account":
      return { path: accountHref(route.section), title: "account" };
    // Without its query, which carries a sealed request.
    case "consent":
      return { path: PATHS.consent, title: "consent" };
    // Without the path, which is whatever was typed.
    case "bad-address":
      return { path: "/bad-address", title: "bad-address" };
    case "not-found":
      return { path: "/not-found", title: "not-found" };
    case "mount":
    case "owner":
    case "states":
    case "og-card":
      return undefined;
  }
}

/** What a view of an address shows, in a word. */
function viewOf(address: Address, view: MountView): string {
  if (view.kind !== "overview") {
    return view.kind;
  }
  if (view.query !== undefined) {
    return "search";
  }
  return view.path !== undefined && view.path !== address.path ? "folder" : "overview";
}

/**
 * The view of an address, once the server has answered: the address when the repository is
 * public, with the skill when the view is one and it loaded; a name for it when it is not
 * public or is nothing, which read the same to anyone else. Nothing while the answer is on its way.
 */
export function pageOfMount(
  address: Address,
  view: MountView,
  answer: {
    readonly mount?: RestMount | undefined;
    readonly error?: ApiError | undefined;
    readonly skillLoaded?: boolean;
  },
): AnalyticsPage | undefined {
  const title = "repository";
  const shown = viewOf(address, view);
  if (answer.error !== undefined) {
    return {
      path: WITHHELD_REPOSITORY_PATH,
      title,
      params: { view: shown, outcome: answer.error.status === 404 ? "not_found" : "error" },
    };
  }
  if (answer.mount === undefined) {
    return undefined;
  }
  if (answer.mount.repository.visibility !== "public") {
    return {
      path: WITHHELD_REPOSITORY_PATH,
      title,
      params: { view: shown, visibility: "private" },
    };
  }
  return {
    path: formatAddress(address),
    title,
    params: {
      view: shown,
      visibility: "public",
      ...(view.kind === "skill" && answer.skillLoaded === true ? { skill: view.path } : {}),
    },
  };
}

/** The page of an account, once the server has answered: the account, or a name for nothing. */
export function pageOfOwner(
  owner: OwnerPath,
  answer: { readonly ready: boolean; readonly error?: ApiError | undefined },
): AnalyticsPage | undefined {
  if (answer.error !== undefined) {
    return {
      path: WITHHELD_OWNER_PATH,
      title: "owner",
      params: { outcome: answer.error.status === 404 ? "not_found" : "error" },
    };
  }
  return answer.ready ? { path: formatOwnerPath(owner), title: "owner" } : undefined;
}

const SIGNING_IN_KEY = "skillcdn-signing-in";

/**
 * Remembers, for this tab, that the visitor left to sign in: the page they come back to, signed
 * in, is what tells analytics that a sign-in completed.
 */
export function rememberSignInStart(): void {
  try {
    window.sessionStorage.setItem(SIGNING_IN_KEY, "1");
  } catch {
    // Without storage a completed sign-in goes uncounted; nothing else depends on it.
  }
}

/** True once after `rememberSignInStart`, in the tab that left; false anywhere else. */
export function takeSignInStart(): boolean {
  try {
    const found = window.sessionStorage.getItem(SIGNING_IN_KEY) !== null;
    if (found) {
      window.sessionStorage.removeItem(SIGNING_IN_KEY);
    }
    return found;
  } catch {
    return false;
  }
}
