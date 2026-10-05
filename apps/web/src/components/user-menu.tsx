import { useEffect, useRef } from "react";
import { useSession } from "../auth/session.js";
import { useI18n } from "../i18n/index.js";
import { Link, navigate, useLocation } from "../navigation.js";
import { accountHref, ownerHref, PATHS } from "../router.js";
import { useSignInDialog } from "./sign-in-dialog.js";
import { Avatar, Button } from "./ui.js";
import styles from "./user-menu.module.css";

/**
 * Who is signed in, at the end of the header: the way to the sign-in dialog, or the person's
 * picture with the pages that are theirs behind it. Where nobody can sign in, and until the
 * browser has asked who is, it is nothing at all, which is also what the server renders.
 */
export function UserMenu() {
  const { t } = useI18n();
  const { session, signOut } = useSession();
  const location = useLocation();
  const openSignIn = useSignInDialog();
  const disclosure = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        disclosure.current !== null &&
        !disclosure.current.contains(event.target)
      ) {
        disclosure.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  if (session.status === "unknown" || session.status === "disabled") {
    return null;
  }
  if (session.status === "anonymous") {
    // Opens the dialog over this page, which is where the person is back afterwards: what it
    // shows before the browser leaves for the git host is not something a header has room for.
    return (
      <Button size="sm" className={styles.signIn} onClick={openSignIn}>
        {t.auth.signIn}
      </Button>
    );
  }

  const { user } = session;
  const close = () => {
    if (disclosure.current !== null) {
      disclosure.current.open = false;
    }
  };
  const links = [
    {
      href: ownerHref({ host: user.host, owner: user.login.toLowerCase() }),
      label: t.auth.profile,
    },
    { href: accountHref("overview"), label: t.auth.account },
    { href: accountHref("repositories"), label: t.auth.repositories },
    { href: accountHref("apps"), label: t.auth.apps },
    { href: accountHref("tokens"), label: t.auth.tokens },
  ];
  return (
    <details
      ref={disclosure}
      className={styles.menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && disclosure.current?.open === true) {
          close();
          disclosure.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={t.auth.menu(user.login)}>
        <Avatar src={user.avatar} size="sm" eager />
        <span className={styles.login}>{user.login}</span>
        <svg
          className={styles.caret}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <ul className={styles.list}>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} onClick={close}>
              {link.label}
            </Link>
          </li>
        ))}
        <li className={styles.separated}>
          <button
            type="button"
            onClick={() => {
              close();
              // Whatever page this is, it was shown to someone signed in: the account pages
              // have nothing to show any more, and every other page shows itself again.
              void signOut().then(() => {
                if (location.pathname.startsWith(PATHS.account)) {
                  navigate(PATHS.landing);
                }
              });
            }}
          >
            {t.auth.signOut}
          </button>
        </li>
      </ul>
    </details>
  );
}
