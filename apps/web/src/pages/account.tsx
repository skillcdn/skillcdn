import type { RestUser } from "@skillcdn/core";
import { type ComponentType, useEffect, useState } from "react";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { signInHref, useSession } from "../auth/session.js";
import { ErrorCallout } from "../components/error-callout.js";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Container,
  cx,
  EmptyState,
  Skeleton,
} from "../components/ui.js";
import ui from "../components/ui.module.css";
import { useI18n } from "../i18n/index.js";
import type { Messages } from "../i18n/messages/en.js";
import { Link, navigate, useLocation } from "../navigation.js";
import { ACCOUNT_SECTIONS, type AccountSection, accountHref, ownerHref, PATHS } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./account.module.css";
import { NotFoundPage } from "./simple.js";

export interface AccountPageProps {
  readonly origin: string;
  readonly section: AccountSection;
}

interface SectionProps {
  readonly user: RestUser;
}

type LoginFailure = keyof Messages["auth"]["failures"];

/** What a sign-in that did not complete left in the URL, when it left something we know. */
function loginFailureOf(search: string, t: Messages): LoginFailure | undefined {
  const code = new URLSearchParams(search).get("login");
  return code !== null && code in t.auth.failures ? (code as LoginFailure) : undefined;
}

const profileHref = (user: RestUser): string =>
  ownerHref({ host: user.host, owner: user.login.toLowerCase() });

/**
 * A session that ended somewhere else (signed out in another tab, or the git host took the
 * sign-in back) shows here as a refusal. Asking again who is signed in puts the page in the
 * state it is really in, with the way to sign in again.
 */
function useEndedSession(refused: boolean): void {
  const { refresh } = useSession();
  useEffect(() => {
    if (refused) {
      refresh();
    }
  }, [refused, refresh]);
}

const isRefusal = (error: ApiError | undefined): boolean => error?.status === 401;

/** Who is signed in, and the ways from here to what is theirs. */
function Overview({ user }: SectionProps) {
  const { t } = useI18n();
  const { signOut } = useSession();
  const o = t.account.overview;
  const ways = [
    { title: o.profile, body: o.profileBody, href: profileHref(user), action: o.profileAction },
    {
      title: t.account.sections.repositories,
      body: o.repositoriesBody,
      href: accountHref("repositories"),
      action: o.repositoriesAction,
    },
    {
      title: t.account.sections.apps,
      body: o.appsBody,
      href: accountHref("apps"),
      action: o.appsAction,
    },
  ];
  return (
    <>
      <div className={styles.identity}>
        <Avatar src={user.avatar} size="lg" eager />
        <div>
          <p className={styles.name}>{user.name ?? user.login}</p>
          <p className={styles.login}>
            <code>{user.login}</code>
          </p>
        </div>
      </div>
      <p className={styles.lead}>{o.lead}</p>
      <ul className={styles.ways}>
        {ways.map((way) => (
          <li key={way.href} className={styles.way}>
            <div>
              <h3>{way.title}</h3>
              <p>{way.body}</p>
            </div>
            <Link className={cx(ui.button, ui.secondary, ui.small)} href={way.href}>
              {way.action}
            </Link>
          </li>
        ))}
      </ul>
      <div className={styles.leave}>
        <p>{o.signOutBody}</p>
        <Button
          size="sm"
          onClick={() => {
            void signOut().then(() => navigate(PATHS.landing));
          }}
        >
          {t.auth.signOut}
        </Button>
      </div>
    </>
  );
}

/** The private repositories the person can reach through the git host's app, and how to add more. */
function Repositories({ user }: SectionProps) {
  const { t } = useI18n();
  const r = t.account.repositories;
  const listed = useResource(resourceKeys.myRepositories(user.login), (signal) =>
    api.myRepositories(signal),
  );
  useEndedSession(listed.state === "error" && isRefusal(listed.error));
  const installUrl = listed.state === "ready" ? listed.value.installUrl : null;
  return (
    <>
      <p className={styles.lead}>{r.lead}</p>
      <ol className={styles.steps}>
        {r.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className={styles.actions}>
        {installUrl !== null && (
          <a
            className={cx(ui.button, ui.primary)}
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {r.install}
            <span aria-hidden="true">↗</span>
          </a>
        )}
        <Button onClick={listed.reload} disabled={listed.state === "loading"}>
          {r.refresh}
        </Button>
      </div>
      {installUrl !== null && <p className={styles.hint}>{r.installHint}</p>}

      {listed.state === "loading" && <Skeleton lines={4} label={t.common.loading} />}
      {listed.state === "error" && <ErrorCallout error={listed.error} onRetry={listed.reload} />}
      {listed.state === "ready" &&
        (listed.value.installations.length === 0 ? (
          <EmptyState title={r.none.title}>{r.none.body}</EmptyState>
        ) : (
          <ul className={styles.installations}>
            {listed.value.installations.map((installation) => (
              <li key={installation.account.login} className={styles.installation}>
                <div className={styles.installationHead}>
                  <Avatar src={installation.account.avatar} size="sm" />
                  <strong>{installation.account.login}</strong>
                  <span className={styles.selection}>{r.selection[installation.selection]}</span>
                  {installation.manageUrl !== null && (
                    <a href={installation.manageUrl} target="_blank" rel="noopener noreferrer">
                      {r.manage}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  )}
                </div>
                <ul className={styles.rows}>
                  {installation.repositories.map((repository) => (
                    <li key={repository.address} className={styles.row}>
                      <div className={styles.rowHead}>
                        <Link className={styles.rowLink} href={repository.address}>
                          {`${repository.owner}/${repository.name}`}
                        </Link>
                        <Badge>{r[repository.visibility]}</Badge>
                      </div>
                      {repository.description !== null && (
                        <p className={styles.rowText}>{repository.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
                {installation.truncated && <p className={styles.hint}>{r.truncated}</p>}
              </li>
            ))}
            {listed.value.truncated && <li className={styles.hint}>{r.moreInstallations}</li>}
          </ul>
        ))}
    </>
  );
}

/** The apps the person allowed to read a private address as them, and the way to take that back. */
function Apps({ user }: SectionProps) {
  const { t } = useI18n();
  const a = t.account.apps;
  const grants = useResource(resourceKeys.myGrants(user.login), (signal) => api.myGrants(signal));
  const [removing, setRemoving] = useState<string>();
  const [removed, setRemoved] = useState(false);
  const [failure, setFailure] = useState<ApiError>();
  useEndedSession((grants.state === "error" && isRefusal(grants.error)) || isRefusal(failure));

  const remove = (id: string) => {
    setRemoving(id);
    setFailure(undefined);
    api.removeGrant(id).then(
      () => {
        setRemoving(undefined);
        setRemoved(true);
        grants.reload();
      },
      (error: unknown) => {
        setRemoving(undefined);
        setFailure(
          error instanceof ApiError ? error : new ApiError(0, "unknown", "Unexpected failure."),
        );
      },
    );
  };

  return (
    <>
      <p className={styles.lead}>{a.lead}</p>
      {/* Said to whoever cannot see the row go, too. */}
      <p className="visually-hidden" role="status">
        {removed ? a.removed : ""}
      </p>
      {failure !== undefined && <ErrorCallout error={failure} />}
      {grants.state === "loading" && <Skeleton lines={3} label={t.common.loading} />}
      {grants.state === "error" && <ErrorCallout error={grants.error} onRetry={grants.reload} />}
      {grants.state === "ready" &&
        (grants.value.items.length === 0 ? (
          <EmptyState title={a.none.title}>{a.none.body}</EmptyState>
        ) : (
          <ul className={styles.rows}>
            {grants.value.items.map((grant) => (
              <li key={grant.id} className={cx(styles.row, styles.grant)}>
                <div>
                  <div className={styles.rowHead}>
                    <strong>{grant.client.name}</strong>
                    {/* The app's own word for where it lives: shown, never followed for it. */}
                    {grant.client.uri !== null && (
                      <span className={styles.selection}>{grant.client.uri}</span>
                    )}
                  </div>
                  <p className={styles.rowText}>
                    <Link href={grant.address}>{grant.address.replace(/^\/gh\//, "")}</Link>
                  </p>
                  <p className={styles.rowMeta}>
                    <span>{a.connected(grant.createdAt)}</span>
                    <span>
                      {grant.lastUsedAt === null ? a.neverUsed : a.lastUsed(grant.lastUsedAt)}
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={removing !== undefined}
                  aria-label={a.removeLabel(grant.client.name, grant.address)}
                  onClick={() => remove(grant.id)}
                >
                  {a.remove}
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

/**
 * What each section of the account pages shows. A feature that belongs to a person adds its
 * section to `ACCOUNT_SECTIONS` in the router, its words to the packs, and its page here; the
 * menu, the paths and the sign-in around it are already there.
 */
const SECTION_PAGES: Record<AccountSection, ComponentType<SectionProps>> = {
  overview: Overview,
  repositories: Repositories,
  apps: Apps,
};

/** The pages of whoever is signed in: one menu down the side, one section beside it. */
export function AccountPage(props: AccountPageProps) {
  const { t, language } = useI18n();
  const { session } = useSession();
  const location = useLocation();
  const { section, origin } = props;

  useEffect(() => {
    applyHead(buildHead({ name: "account", section }, language, origin));
  }, [section, language, origin]);

  if (session.status === "unknown") {
    return (
      <Container className={styles.page}>
        <Skeleton lines={6} label={t.common.loading} />
      </Container>
    );
  }
  // Where nobody can sign in there are no such pages.
  if (session.status === "disabled") {
    return <NotFoundPage />;
  }
  if (session.status === "anonymous") {
    const failure = loginFailureOf(location.search, t);
    return (
      <Container className={styles.page}>
        <div className={styles.signedOut}>
          {failure !== undefined && (
            <Callout tone="warning" title={t.auth.failures[failure].title}>
              {t.auth.failures[failure].body}
            </Callout>
          )}
          <h1 className={styles.title}>{t.account.signedOut.title}</h1>
          <p className={styles.lead}>{t.account.signedOut.body}</p>
          <p>
            <a
              className={cx(ui.button, ui.primary)}
              href={signInHref({ pathname: location.pathname, search: "" })}
            >
              {t.auth.signInWith}
            </a>
          </p>
        </div>
      </Container>
    );
  }

  const Section = SECTION_PAGES[section];
  return (
    <Container className={styles.page}>
      <h1 className={styles.title}>{t.account.title}</h1>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label={t.account.navigation}>
          <ul>
            {ACCOUNT_SECTIONS.map((name) => (
              <li key={name}>
                <Link href={accountHref(name)} aria-current={name === section ? "page" : undefined}>
                  {t.account.sections[name]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className={styles.panel} aria-labelledby="account-section">
          <h2 id="account-section" className={styles.heading}>
            {t.account.sections[section]}
          </h2>
          <Section key={`${section} ${session.user.login}`} user={session.user} />
        </section>
      </div>
    </Container>
  );
}
