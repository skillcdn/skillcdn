import {
  SIGN_IN_FAILURES,
  SIGN_IN_PARAM,
  SIGN_IN_REQUESTS,
  type SignInFailure,
  type SignInRequest,
} from "@skillcdn/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useSession } from "../auth/session.js";
import { useI18n } from "../i18n/index.js";
import { type AppLocation, navigate, useLocation } from "../navigation.js";
import { BrandSymbol } from "./brand.js";
import { SignIn } from "./sign-in.js";
import styles from "./sign-in-dialog.module.css";
import { Callout } from "./ui.js";

// Where a person chooses to sign in (ADR-0043): a dialog over the page they are on, which is
// also the page they come back to. Whatever offers signing in opens it; the server asks a page
// to open it, for a sign-in that did not begin on these pages or did not complete.

/** What a page's URL asks of the dialog, when it asks something we know. */
function requestOf(search: string): SignInRequest | undefined {
  const asked = new URLSearchParams(search).get(SIGN_IN_PARAM);
  return SIGN_IN_REQUESTS.find((request) => request === asked);
}

/**
 * The page without what it was asked: what stays in the address bar, and where to come back to.
 * The rest of its query is kept as it is written, not written again.
 */
function pageOf(location: AppLocation): string {
  const kept = location.search
    .slice(1)
    .split("&")
    .filter((part) => part !== "" && part.split("=", 1)[0] !== SIGN_IN_PARAM);
  return kept.length === 0 ? location.pathname : `${location.pathname}?${kept.join("&")}`;
}

const SignInDialogContext = createContext<() => void>(() => undefined);

/** The way to offer signing in from anywhere on a page: call it, and the dialog opens. */
export function useSignInDialog(): () => void {
  return useContext(SignInDialogContext);
}

function SignInDialog(props: {
  readonly failure: SignInFailure | undefined;
  readonly returnTo: string;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();

  // Shown as a modal, which a dialog only is when a script opens it: the browser then keeps the
  // focus inside, closes it on Escape, and gives the focus back to what opened it.
  useEffect(() => {
    if (dialog.current !== null && !dialog.current.open) {
      dialog.current.showModal();
    }
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a press beside the dialog closes it, as Escape does by itself
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={title}
      onClose={props.onClose}
      onClick={(event) => {
        // The dialog is filled by its card, so a press on the dialog itself is one beside it.
        if (event.target === event.currentTarget) {
          event.currentTarget.close();
        }
      }}
    >
      <div className={styles.card}>
        <div className={styles.stage} aria-hidden="true">
          <span className={styles.ring} />
          <span className={styles.ring} />
          <span className={styles.badge}>
            <BrandSymbol className={styles.symbol} />
          </span>
        </div>
        <h2 id={title} className={styles.title}>
          {t.auth.dialog.title}
        </h2>
        <p className={styles.lead}>{t.auth.dialog.lead}</p>
        {props.failure !== undefined && (
          <div className={styles.problem}>
            <Callout tone="warning" title={t.auth.failures[props.failure].title}>
              {t.auth.failures[props.failure].body}
            </Callout>
          </div>
        )}
        <SignIn returnTo={props.returnTo} />
        {/* After the way out in the document, so that the dialog opens with the focus on that. */}
        <button
          type="button"
          className={styles.close}
          aria-label={t.auth.dialog.close}
          onClick={() => dialog.current?.close()}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </div>
    </dialog>
  );
}

/**
 * Holds the sign-in dialog for the whole app and opens it for whoever asks: a button on the
 * page, or the server, through the page's URL. The dialog exists only for someone the browser
 * knows is signed out, so the server renders none and nobody signed in is offered one.
 */
export function SignInDialogProvider(props: { readonly children: ReactNode }) {
  const { session } = useSession();
  const location = useLocation();
  const asked = requestOf(location.search);
  const [request, setRequest] = useState(asked);

  // What the URL asked is taken once and leaves the URL: a reload or a copied link is the page
  // itself, not the question again.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has(SIGN_IN_PARAM)) {
      return;
    }
    if (asked !== undefined) {
      setRequest(asked);
    }
    navigate(`${pageOf(location)}${window.location.hash}`, { replace: true });
  }, [location, asked]);

  // Signed in, here or in another tab, or on a deployment where nobody signs in: nothing is
  // left to offer, now or once they sign out.
  const offered = session.status === "anonymous" || session.status === "unknown";
  useEffect(() => {
    if (!offered) {
      setRequest(undefined);
    }
  }, [offered]);

  // Opening what is open already keeps what it says: a page that offers signing in by itself
  // does not wipe why the last attempt did not complete.
  const open = useCallback(() => setRequest((current) => current ?? "open"), []);
  const close = useCallback(() => setRequest(undefined), []);

  return (
    <SignInDialogContext.Provider value={open}>
      {props.children}
      {session.status === "anonymous" && request !== undefined && (
        <SignInDialog
          failure={SIGN_IN_FAILURES.find((failure) => failure === request)}
          returnTo={pageOf(location)}
          onClose={close}
        />
      )}
    </SignInDialogContext.Provider>
  );
}
