import { SIGN_IN_ERROR_PARAM, SIGN_IN_FAILURES, type SignInFailure } from "@skillcdn/core";
import { useEffect } from "react";
import { useSession } from "../auth/session.js";
import { SignIn } from "../components/sign-in.js";
import { Callout, Container, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { navigate, useLocation } from "../navigation.js";
import { accountHref, returnPathOf } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./sign-in.module.css";
import { NotFoundPage } from "./simple.js";

export interface SignInPageProps {
  readonly origin: string;
}

/** What a sign-in that did not complete left in the URL, when it left something we know. */
function failureOf(search: string): SignInFailure | undefined {
  const code = new URLSearchParams(search).get(SIGN_IN_ERROR_PARAM);
  return SIGN_IN_FAILURES.find((failure) => failure === code);
}

/**
 * Where a person chooses to sign in (ADR-0041). The header's button, a private repository that
 * was not found and the account pages all lead here, with the page to come back to; the page
 * says what signing in is for, shows the one way out to the git host with what continuing
 * agrees to, and is where a sign-in that did not complete says so. Signing in creates the
 * account, so there is no second page for signing up.
 */
export function SignInPage(props: SignInPageProps) {
  const { t, language } = useI18n();
  const { session } = useSession();
  const location = useLocation();
  // Someone who came here on their own has nowhere to go back to: they land on what is theirs.
  const returnTo = returnPathOf(location.search) ?? accountHref();
  const failure = failureOf(location.search);

  useEffect(() => {
    applyHead(buildHead({ name: "sign-in" }, language, props.origin));
  }, [language, props.origin]);

  // Signed in already, here or a moment ago in another tab: there is nothing left to choose.
  const signedIn = session.status === "user";
  useEffect(() => {
    if (signedIn) {
      navigate(returnTo, { replace: true });
    }
  }, [signedIn, returnTo]);

  // Where nobody can sign in there is no such page.
  if (session.status === "disabled") {
    return <NotFoundPage />;
  }
  if (session.status !== "anonymous") {
    return (
      <Container className={styles.page}>
        <div className={styles.card}>
          <Skeleton lines={4} label={t.common.loading} />
        </div>
      </Container>
    );
  }
  return (
    <Container className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t.auth.page.title}</h1>
        <p className={styles.lead}>{t.auth.page.lead}</p>
        {failure !== undefined && (
          <div className={styles.problem}>
            <Callout tone="warning" title={t.auth.failures[failure].title}>
              {t.auth.failures[failure].body}
            </Callout>
          </div>
        )}
        <SignIn returnTo={returnTo} />
      </div>
    </Container>
  );
}
