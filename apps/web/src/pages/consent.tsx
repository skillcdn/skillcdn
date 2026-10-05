import { CONSENT_ERROR_PARAM, CONSENT_REQUEST_PARAM } from "@skillcdn/core";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { useSession } from "../auth/session.js";
import { ErrorCallout } from "../components/error-callout.js";
import { SignIn } from "../components/sign-in.js";
import { Avatar, Button, Callout, Container, Skeleton, Spinner } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import type { Messages } from "../i18n/messages/en.js";
import { navigate, useLocation } from "../navigation.js";
import { PATHS } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./consent.module.css";
import { NotFoundPage } from "./simple.js";

export interface ConsentPageProps {
  readonly origin: string;
}

type ConsentError = keyof Messages["authorize"]["errors"];

/** Where a request waits while its person is away signing in, when it is too long to carry. */
const RESUME_KEY = "skillcdn-consent";
const RESUME_PARAM = "resume";
/** What a sign-in can carry back in its own state; a longer request waits in the browser. */
const MAX_CARRIED_LENGTH = 1500;

/**
 * What the authorization endpoint says about a request it would not put before a person. It
 * tells the browser here and never the app: anyone can register an app, so a request that is
 * merely wrong must not be a way to send someone to it.
 */
const REQUEST_ERRORS: ReadonlySet<string> = new Set([
  "invalid_request",
  "unsupported_response_type",
  "invalid_target",
]);

function Problem(props: { readonly kind: ConsentError; readonly detail?: string | undefined }) {
  const { t } = useI18n();
  const words = t.authorize.errors[props.kind];
  return (
    <Container className={styles.page}>
      <div className={styles.card}>
        <Callout tone={props.kind === "missing" ? "info" : "warning"} title={words.title}>
          <p>{words.body}</p>
          {/* For whoever builds the app: which rule the request broke, in the protocol's word. */}
          {props.detail !== undefined && (
            <p>
              <code>{props.detail}</code>
            </p>
          )}
        </Callout>
      </div>
    </Container>
  );
}

/**
 * Where a person is asked whether an app may read an address for them. The app sent their
 * browser to the authorization endpoint, which sent it here with the request sealed; this page
 * shows who asks, for what and where the answer goes, and sends the answer. Nothing is shared
 * until the person says so, and what the app calls itself is shown as just that.
 *
 * There is a question only when the person can open the address. When they cannot, be it
 * somebody else's repository, a name that is nothing or one the git host's app is not installed
 * on, the page says so in one sentence for all three, offers what may help, and leaves one
 * answer: back to the app, which is told no. A connection that could not work fails here, where
 * the person can read why, instead of answering "not found" to every call afterwards.
 */
export function ConsentPage(props: ConsentPageProps) {
  const { t, language } = useI18n();
  const { session, signOut } = useSession();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const request = params.get(CONSENT_REQUEST_PARAM);
  const refused = params.get(CONSENT_ERROR_PARAM);
  const resuming = params.has(RESUME_PARAM);
  const [answering, setAnswering] = useState(false);
  const [failure, setFailure] = useState<ApiError>();

  useEffect(() => {
    applyHead(buildHead({ name: "consent" }, language, props.origin));
  }, [language, props.origin]);

  // Back from signing in without the request in the URL: it waited here, in this tab.
  useEffect(() => {
    if (request !== null || !resuming) {
      return;
    }
    let kept: string | null = null;
    try {
      kept = window.sessionStorage.getItem(RESUME_KEY);
    } catch {
      kept = null;
    }
    if (kept?.startsWith(`${PATHS.consent}?`) === true) {
      navigate(kept, { replace: true });
    }
  }, [request, resuming]);

  const login = session.status === "user" ? session.user.login : undefined;
  const asked = useResource(
    resourceKeys.authorization(request ?? "", session.status === "unknown" ? "?" : login),
    async (signal) =>
      // Without a request there is nothing to ask about, and before the browser knows who is
      // signed in the answer would be for nobody.
      request === null || session.status === "unknown" || session.status === "disabled"
        ? undefined
        : api.authorization(request, signal),
  );

  if (session.status === "disabled") {
    return <NotFoundPage />;
  }
  if (request === null) {
    if (resuming && refused === null) {
      return (
        <Container className={styles.page}>
          <Skeleton lines={4} label={t.common.loading} />
        </Container>
      );
    }
    if (refused !== null && REQUEST_ERRORS.has(refused)) {
      return <Problem kind="invalid_request" detail={refused} />;
    }
    return (
      <Problem
        kind={
          refused === "invalid_client" || refused === "invalid_redirect_uri" ? refused : "missing"
        }
      />
    );
  }
  if (asked.state === "error") {
    return asked.error.status === 400 ? (
      <Problem kind="expired" />
    ) : (
      <Container className={styles.page}>
        <div className={styles.card}>
          <ErrorCallout error={asked.error} onRetry={asked.reload} />
        </div>
      </Container>
    );
  }
  if (asked.state === "loading" || asked.value === undefined) {
    return (
      <Container className={styles.page}>
        <div className={styles.card}>
          <Skeleton lines={5} label={t.common.loading} />
        </div>
      </Container>
    );
  }

  const { client, address, user, visible, installUrl } = asked.value;
  const here = `${location.pathname}${location.search}`;

  if (user === null) {
    // The request comes back with the person: in the sign-in's own state when it fits, and
    // otherwise it waits in this tab until they are back.
    const returnTo =
      here.length <= MAX_CARRIED_LENGTH ? here : `${PATHS.consent}?${RESUME_PARAM}=1`;
    return (
      <Container className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t.authorize.signIn.title(client.name)}</h1>
          <p className={styles.text}>{t.authorize.signIn.body}</p>
          {/* The same way out as in the sign-in dialog, here where the question already stands:
              a dialog over this page would only say "continue" a second time. */}
          <SignIn
            returnTo={returnTo}
            onLeave={() => {
              try {
                window.sessionStorage.setItem(RESUME_KEY, here);
              } catch {
                // Without storage the short way back is the only one; it is tried anyway.
              }
            }}
          />
        </div>
      </Container>
    );
  }

  const answer = (approve: boolean) => {
    setAnswering(true);
    setFailure(undefined);
    api.decide(request, approve).then(
      (redirect) => {
        // To the app, at the redirect URI it registered: a page of its own, an app on this
        // computer, or a scheme the app answers to. The server chose it; this page only goes.
        window.location.assign(redirect);
      },
      (error: unknown) => {
        setAnswering(false);
        if (error instanceof ApiError && error.code === "oauth.not_visible") {
          // They could open it when the page was drawn and cannot any more: the page says so.
          asked.reload();
          return;
        }
        setFailure(
          error instanceof ApiError ? error : new ApiError(0, "unknown", "Unexpected failure."),
        );
      },
    );
  };
  // Only someone who can open the address has something to allow. `null` is the git host not
  // answering: nothing is allowed on no answer either.
  const openable = visible === true;

  return (
    <Container className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {openable ? t.authorize.title(client.name) : t.authorize.refused.title(client.name)}
        </h1>
        <dl className={styles.facts}>
          <dt>{t.authorize.labels.app}</dt>
          <dd>
            <strong>{client.name}</strong>
            {client.uri !== null && <span className={styles.aside}>{client.uri}</span>}
          </dd>
          <dt>{t.authorize.labels.address}</dt>
          <dd>
            <code>{address.replace(/^\/gh\//, "")}</code>
          </dd>
          <dt>{t.authorize.labels.account}</dt>
          <dd className={styles.account}>
            <Avatar src={user.avatar} size="sm" eager />
            <span>{user.login}</span>
          </dd>
        </dl>
        {openable ? (
          <>
            <p className={styles.text}>{t.authorize.what}</p>
            <p className={styles.returns}>
              {t.authorize.returns(client.redirectHost)}
              {client.loopback && ` ${t.authorize.loopback}`}
            </p>
            <p className={styles.hint}>{t.authorize.selfNamed}</p>
          </>
        ) : visible === false ? (
          // The way to fix it goes under the words, not beside them: the card is one narrow
          // column, and a button at its side would leave the explanation half of it.
          <Callout tone="warning" title={t.authorize.notVisible.title}>
            <p>{t.authorize.notVisible.body}</p>
            <p>{t.authorize.notVisible.fix}</p>
            {installUrl !== null && (
              <p>
                <a href={installUrl} target="_blank" rel="noopener noreferrer">
                  {t.authorize.notVisible.install}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </p>
            )}
          </Callout>
        ) : (
          <Callout tone="warning" title={t.authorize.unknown.title}>
            <p>{t.authorize.unknown.body}</p>
          </Callout>
        )}
        {failure !== undefined &&
          (failure.status === 400 ? (
            <Callout tone="warning" title={t.authorize.errors.expired.title}>
              {t.authorize.errors.expired.body}
            </Callout>
          ) : (
            <ErrorCallout error={failure} />
          ))}
        <div className={styles.actions}>
          {openable ? (
            <>
              <Button variant="primary" disabled={answering} onClick={() => answer(true)}>
                {t.authorize.allow}
              </Button>
              <Button disabled={answering} onClick={() => answer(false)}>
                {t.authorize.deny}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={answering} onClick={asked.reload}>
                {t.authorize.refused.recheck}
              </Button>
              <Button disabled={answering} onClick={() => answer(false)}>
                {t.authorize.refused.back}
              </Button>
            </>
          )}
          {answering && <Spinner label={t.authorize.working} />}
        </div>
        {!openable && (
          <p className={styles.hint}>
            {t.authorize.refused.backHint(client.redirectHost)}
            {client.loopback && ` ${t.authorize.loopback}`}
          </p>
        )}
        <p className={styles.notYou}>
          {/* Signed out, the page offers to sign in again, and the git host asks as whom. */}
          <button type="button" disabled={answering} onClick={() => void signOut()}>
            {t.authorize.notYou}
          </button>
        </p>
      </div>
    </Container>
  );
}
