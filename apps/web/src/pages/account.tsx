import {
  formatAddress,
  parseAddress,
  REPO_TOKEN_DEFAULT_DAYS,
  REPO_TOKEN_LIFETIMES_DAYS,
  REPO_TOKEN_MAX_LABEL_LENGTH,
  type RestNewRepoToken,
  type RestUser,
  ROOT_PATH,
} from "@skillcdn/core";
import { type ComponentType, type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { signInHref, useSession } from "../auth/session.js";
import { CodeBlock } from "../components/code-block.js";
import { tokenSetup } from "../components/connect-clients.js";
import { serverNameOf } from "../components/connect-guide.js";
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
import { Link, navigate, useLocation } from "../navigation.js";
import {
  ACCOUNT_SECTIONS,
  type AccountSection,
  accountHref,
  ownerHref,
  PATHS,
  TOKEN_REPOSITORY_PARAM,
} from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./account.module.css";
import { NotFoundPage } from "./simple.js";

export interface AccountPageProps {
  readonly origin: string;
  readonly section: AccountSection;
}

interface SectionProps {
  readonly user: RestUser;
  /** The origin of the deployment: what an address is a path of. */
  readonly origin: string;
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
    {
      title: t.account.sections.tokens,
      body: o.tokensBody,
      href: accountHref("tokens"),
      action: o.tokensAction,
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

/** A repository as an address names it, when the text is the address of one and nothing more. */
function repositoryOf(text: string | null): string | undefined {
  const parsed = text === null ? undefined : parseAddress(text);
  return parsed?.ok === true && parsed.value.ref === undefined && parsed.value.path === ROOT_PATH
    ? formatAddress(parsed.value)
    : undefined;
}

/** How a repository is written where it is read, not typed: without the host's key. */
const shortName = (address: string): string => address.replace(/^\/gh\//, "");

const failureOf = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError(0, "unknown", "Unexpected failure.");

/**
 * The tokens the person made for agents that have nobody to sign in, the way to make one and
 * the way to take one back. A token's secret is on the page once, right after it was made.
 */
function Tokens({ user, origin }: SectionProps) {
  const { t } = useI18n();
  const k = t.account.tokens;
  const location = useLocation();
  const tokens = useResource(resourceKeys.myTokens(user.login), (signal) => api.myTokens(signal));
  const mine = useResource(resourceKeys.myRepositories(user.login), (signal) =>
    api.myRepositories(signal),
  );
  const [chosen, setChosen] = useState<string>();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number>(REPO_TOKEN_DEFAULT_DAYS);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<RestNewRepoToken>();
  const [removing, setRemoving] = useState<string>();
  const [removed, setRemoved] = useState(false);
  const [failure, setFailure] = useState<ApiError>();
  useEndedSession(
    (tokens.state === "error" && isRefusal(tokens.error)) ||
      (mine.state === "error" && isRefusal(mine.error)) ||
      isRefusal(failure),
  );

  // The page of a private repository sends people here with its address, which is then the
  // first choice; the rest are the private repositories the app is installed on for them.
  const wanted = repositoryOf(new URLSearchParams(location.search).get(TOKEN_REPOSITORY_PARAM));
  const listed =
    mine.state === "ready"
      ? mine.value.installations.flatMap((installation) =>
          installation.repositories
            .filter((repository) => repository.visibility === "private")
            .map((repository) => repository.address),
        )
      : [];
  const choices = [...new Set([...(wanted === undefined ? [] : [wanted]), ...listed])];
  const address = chosen !== undefined && choices.includes(chosen) ? chosen : choices[0];

  const make = (event: FormEvent) => {
    event.preventDefault();
    if (address === undefined || label.trim() === "" || making) {
      return;
    }
    setMaking(true);
    setFailure(undefined);
    setRemoved(false);
    api.makeToken({ address, label: label.trim(), expiresInDays: days }).then(
      (token) => {
        setMaking(false);
        setMade(token);
        setLabel("");
        tokens.reload();
      },
      (error: unknown) => {
        setMaking(false);
        setFailure(failureOf(error));
      },
    );
  };

  const remove = (id: string) => {
    setRemoving(id);
    setFailure(undefined);
    api.removeToken(id).then(
      () => {
        setRemoving(undefined);
        setRemoved(true);
        // A secret that no longer opens anything is not worth showing.
        setMade((current) => (current?.item.id === id ? undefined : current));
        tokens.reload();
      },
      (error: unknown) => {
        setRemoving(undefined);
        setFailure(failureOf(error));
      },
    );
  };

  const madeFor = made === undefined ? undefined : parseAddress(made.item.address);
  const agent =
    made === undefined || madeFor?.ok !== true
      ? undefined
      : { name: serverNameOf(madeFor.value), url: `${origin}${made.item.address}` };

  return (
    <>
      <p className={styles.lead}>{k.lead}</p>
      {/* Said to whoever cannot see the row go, too. */}
      <p className="visually-hidden" role="status">
        {removed ? k.removed : ""}
      </p>
      {failure !== undefined && <ErrorCallout error={failure} />}

      {made !== undefined && agent !== undefined && (
        <div className={styles.made}>
          <Callout tone="warning" title={k.made.title}>
            {k.made.body}
          </Callout>
          <CodeBlock code={made.token} label={k.made.token} copy />
          <h3 className={styles.subheading}>{k.made.give}</h3>
          <p className={styles.rowText}>{k.made.giveBody(shortName(made.item.address))}</p>
          <CodeBlock
            code={tokenSetup("claudeCode", agent.name, agent.url, made.token)}
            label={k.made.claudeCode}
            copy
          />
          <CodeBlock
            code={tokenSetup("codex", agent.name, agent.url, made.token)}
            label={k.made.codex}
            copy
          />
          <p className={styles.rowText}>{k.made.otherHint}</p>
          <CodeBlock code={agent.url} label={k.made.address} copy />
          <CodeBlock
            code={tokenSetup("other", agent.name, agent.url, made.token)}
            label={k.made.other}
            copy
          />
          <div className={styles.formActions}>
            <Button size="sm" onClick={() => setMade(undefined)}>
              {k.made.done}
            </Button>
          </div>
        </div>
      )}

      {mine.state === "loading" && <Skeleton lines={3} label={t.common.loading} />}
      {mine.state === "error" && <ErrorCallout error={mine.error} onRetry={mine.reload} />}
      {mine.state === "ready" &&
        (address === undefined ? (
          <EmptyState title={k.noRepositories.title}>
            <p>{k.noRepositories.body}</p>
            <p>
              <Link
                className={cx(ui.button, ui.secondary, ui.small)}
                href={accountHref("repositories")}
              >
                {k.noRepositories.action}
              </Link>
            </p>
          </EmptyState>
        ) : (
          <form className={styles.tokenForm} onSubmit={make}>
            <h3 className={styles.subheading}>{k.form.title}</h3>
            <div className={styles.fields}>
              <div className={styles.field}>
                <label htmlFor="token-repository">{k.form.repository}</label>
                <select
                  id="token-repository"
                  className={styles.control}
                  value={address}
                  disabled={making}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {shortName(choice)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="token-name">{k.form.name}</label>
                <input
                  id="token-name"
                  className={styles.control}
                  type="text"
                  autoComplete="off"
                  maxLength={REPO_TOKEN_MAX_LABEL_LENGTH}
                  placeholder={k.form.namePlaceholder}
                  aria-describedby="token-name-hint"
                  value={label}
                  disabled={making}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="token-expires">{k.form.expires}</label>
                <select
                  id="token-expires"
                  className={styles.control}
                  value={days}
                  disabled={making}
                  onChange={(event) => setDays(Number(event.target.value))}
                >
                  {REPO_TOKEN_LIFETIMES_DAYS.map((lifetime) => (
                    <option key={lifetime} value={lifetime}>
                      {k.form.lifetime(lifetime)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p id="token-name-hint" className={styles.hint}>
              {k.form.nameHint}
            </p>
            <div className={styles.formActions}>
              <Button type="submit" variant="primary" disabled={making || label.trim() === ""}>
                {making ? k.form.making : k.form.make}
              </Button>
            </div>
          </form>
        ))}

      <h3 className={styles.subheading}>{k.list}</h3>
      {tokens.state === "loading" && <Skeleton lines={3} label={t.common.loading} />}
      {tokens.state === "error" && <ErrorCallout error={tokens.error} onRetry={tokens.reload} />}
      {tokens.state === "ready" &&
        (tokens.value.items.length === 0 ? (
          <EmptyState title={k.none.title}>{k.none.body}</EmptyState>
        ) : (
          <ul className={styles.rows}>
            {tokens.value.items.map((token) => (
              <li key={token.id} className={cx(styles.row, styles.grant)}>
                <div>
                  <div className={styles.rowHead}>
                    <strong>{token.label}</strong>
                  </div>
                  <p className={styles.rowText}>
                    <Link href={token.address}>{shortName(token.address)}</Link>
                  </p>
                  <p className={styles.rowMeta}>
                    <span>{k.madeAt(token.createdAt)}</span>
                    <span>{k.expiresAt(token.expiresAt)}</span>
                    <span>
                      {token.lastUsedAt === null ? k.neverUsed : k.lastUsed(token.lastUsedAt)}
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={removing !== undefined}
                  aria-label={k.removeLabel(token.label, shortName(token.address))}
                  onClick={() => remove(token.id)}
                >
                  {k.remove}
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
  tokens: Tokens,
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

  // Nothing here is anyone's until somebody is signed in: the way in is the sign-in page, which
  // comes back to this section as it was asked for. It takes this page's place in the history,
  // so that going back does not land on a page that sends the person away again.
  const signedOut = session.status === "anonymous";
  const signIn = signInHref(location);
  useEffect(() => {
    if (signedOut) {
      navigate(signIn, { replace: true });
    }
  }, [signedOut, signIn]);

  // Where nobody can sign in there are no such pages.
  if (session.status === "disabled") {
    return <NotFoundPage />;
  }
  if (session.status !== "user") {
    return (
      <Container className={styles.page}>
        <Skeleton lines={6} label={t.common.loading} />
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
          <Section key={`${section} ${session.user.login}`} user={session.user} origin={origin} />
        </section>
      </div>
    </Container>
  );
}
