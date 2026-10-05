import { type RestUser, SIGN_IN_PAGE_PATH, signInPagePath } from "@skillcdn/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, api } from "../api/client.js";
import { readSignIn } from "../site.js";

// Who is signed in on this browser. Everything that depends on a person hangs off this one
// value: the menu in the header, the pages of the account, and what a page of a private
// repository says to someone who cannot open it. A later feature that belongs to a person reads
// it the same way.

export type Session =
  /** Not asked yet: what the server renders, and the browser until it has asked. */
  | { readonly status: "unknown" }
  /** Nobody can sign in on this deployment: nothing about signing in is shown. */
  | { readonly status: "disabled" }
  | { readonly status: "anonymous" }
  | { readonly status: "user"; readonly user: RestUser };

export interface SessionValue {
  readonly session: Session;
  /** Asks again who is signed in, after something that may have changed it. */
  readonly refresh: () => void;
  /** Ends the session on this browser. Resolves once the server has forgotten it. */
  readonly signOut: () => Promise<void>;
}

/** Provided by `SessionProvider`; a test provides it directly to render a page for someone. */
export const SessionContext = createContext<SessionValue>({
  session: { status: "unknown" },
  refresh: () => undefined,
  signOut: async () => undefined,
});

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** The person signed in, or `undefined` for every other state. */
export function useUser(): RestUser | undefined {
  const { session } = useSession();
  return session.status === "user" ? session.user : undefined;
}

/**
 * Where a person goes to sign in and come back to the page they are on: the sign-in page, which
 * shows what they continue with and what they agree to before the browser leaves for the git
 * host (`components/sign-in.tsx`). On that page it is the page itself, as it is.
 */
export function signInHref(location: { readonly pathname: string; readonly search: string }) {
  const here = `${location.pathname}${location.search}`;
  return location.pathname === SIGN_IN_PAGE_PATH ? here : signInPagePath(here);
}

/**
 * Tells `restored` whenever the browser brings the page back as it was left, out of its
 * back-forward cache, instead of loading it. Such a page still shows who was signed in when it
 * was left: someone who signed in and goes back would find a page that offers to sign them in.
 * Returns the way to stop listening.
 */
export function onPageRestored(page: EventTarget, restored: () => void): () => void {
  const shown = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) {
      restored();
    }
  };
  page.addEventListener("pageshow", shown);
  return () => page.removeEventListener("pageshow", shown);
}

/**
 * Asks the server who is signed in, once the page is up, and again when the browser brings the
 * page back out of its cache. The server renders every page without knowing, so that one
 * document serves everyone; the first render in the browser matches it, and the answer arrives
 * after.
 */
export function SessionProvider(props: { readonly children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "unknown" });
  const [asked, setAsked] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` is the trigger
  useEffect(() => {
    if (!readSignIn()) {
      setSession({ status: "disabled" });
      return;
    }
    const controller = new AbortController();
    api.me(controller.signal).then(
      (me) => {
        if (!controller.signal.aborted) {
          setSession(
            me.user === null ? { status: "anonymous" } : { status: "user", user: me.user },
          );
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        // A server that does not know the question is one where nobody signs in. Anything else
        // is a server in trouble: the page works as it does for a visitor who is not signed in.
        setSession(
          error instanceof ApiError && error.status === 404
            ? { status: "disabled" }
            : { status: "anonymous" },
        );
      },
    );
    return () => controller.abort();
  }, [asked]);

  const refresh = useCallback(() => setAsked((count) => count + 1), []);
  useEffect(() => onPageRestored(window, refresh), [refresh]);
  const signOut = useCallback(async () => {
    await api.signOut();
    setSession({ status: "anonymous" });
  }, []);
  const value = useMemo(() => ({ session, refresh, signOut }), [session, refresh, signOut]);
  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}
