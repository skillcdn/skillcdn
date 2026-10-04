import type { OwnerPath, RestOwner } from "@skillcdn/core";
import { useEffect } from "react";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useMorePages } from "../api/use-more-pages.js";
import { useResource } from "../api/use-resource.js";
import { useUser } from "../auth/session.js";
import { AddressForm } from "../components/address-form.js";
import { ErrorCallout } from "../components/error-callout.js";
import { RepositoryGrid } from "../components/repository-card.js";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Container,
  EmptyState,
  Skeleton,
} from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { accountHref } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./owner.module.css";

export interface OwnerPageProps {
  readonly origin: string;
  readonly owner: OwnerPath;
}

type ListedRepository = RestOwner["repositories"][number];

/**
 * One public repository as the host lists it: a way in, and what the host says about it. The
 * way in is for a person: opening a repository indexes it, most of an account's repositories
 * hold no skills, and a crawler that walked every list would have all of them read. So the link
 * asks not to be followed; what is indexed and has skills is linked from its card.
 */
function Repository(props: { readonly repository: ListedRepository }) {
  const { t } = useI18n();
  const { repository } = props;
  return (
    <li className={styles.repository}>
      <div className={styles.repositoryHead}>
        <Link className={styles.repositoryName} href={repository.address} rel="nofollow">
          {repository.name}
        </Link>
        {repository.fork && <Badge>{t.owner.fork}</Badge>}
        {repository.archived && <Badge>{t.owner.archived}</Badge>}
      </div>
      {repository.description !== null && (
        <p className={styles.repositoryText}>{repository.description}</p>
      )}
      <p className={styles.repositoryMeta}>
        {repository.stars > 0 && <span>{t.owner.stars(repository.stars)}</span>}
        {repository.pushedAt !== null && <span>{t.owner.updated(repository.pushedAt)}</span>}
      </p>
    </li>
  );
}

/**
 * The page of an account of the git host (ADR-0037): who it is, what of its repositories is
 * already indexed here and holds skills, and then its other public repositories as the host
 * lists them. Looking at the page indexes nothing; opening a repository does.
 */
export function OwnerPage(props: OwnerPageProps) {
  const { t, language } = useI18n();
  const { owner, origin } = props;
  const user = useUser();
  const first = useResource(resourceKeys.owner(owner), (signal) => api.owner(owner, 1, signal));
  const more = useMorePages((cursor, signal) => api.owner(owner, Number(cursor), signal));

  const profile = first.state === "ready" ? first.value.owner : undefined;
  // The head says who the page is about once it knows, and only then offers it to search engines.
  useEffect(() => {
    applyHead(buildHead({ name: "owner", owner }, language, origin, { owner: profile }));
  }, [owner, language, origin, profile]);

  if (first.state === "loading") {
    return (
      <Container className={styles.page}>
        <Skeleton lines={6} label={t.common.loading} />
      </Container>
    );
  }
  if (first.state === "error") {
    // An account that is not there is, most of the time, a slip of a character.
    return (
      <Container className={styles.page}>
        {first.error.code === "owner.not_found" ? (
          <Callout title={t.owner.notFound.title}>{t.owner.notFound.body}</Callout>
        ) : (
          <ErrorCallout error={first.error} onRetry={first.reload} />
        )}
        <div className={styles.lost}>
          <AddressForm origin={origin} initialValue={owner.owner} footnote />
        </div>
      </Container>
    );
  }

  const { indexed } = first.value;
  const account = first.value.owner;
  const pages = [first.value, ...more.pages];
  const repositories = pages.flatMap((page) => page.repositories);
  const nextPage = pages.at(-1)?.nextPage ?? null;
  const isYou = user !== undefined && user.login.toLowerCase() === account.login.toLowerCase();

  return (
    <Container className={styles.page}>
      <header className={styles.header}>
        <Avatar className={styles.avatar} src={account.avatar} size="lg" eager />
        <h1 className={styles.title}>{account.name ?? account.login}</h1>
        <p className={styles.facts}>
          <code>{account.login}</code>
          <span>{t.owner.kinds[account.kind]}</span>
          <span>{t.owner.publicCount(account.publicRepositories)}</span>
        </p>
        {account.bio !== null && <p className={styles.bio}>{account.bio}</p>}
        <p className={styles.links}>
          <a href={account.url} target="_blank" rel="noopener noreferrer">
            {t.owner.viewOnHost}
            <span aria-hidden="true"> ↗</span>
          </a>
          {isYou && (
            <>
              <Badge tone="point">{t.owner.you}</Badge>
              <Link href={accountHref()}>{t.owner.manage}</Link>
            </>
          )}
        </p>
      </header>

      {indexed.length > 0 && (
        <section className={styles.section} aria-labelledby="owner-indexed">
          <h2 id="owner-indexed" className={styles.heading}>
            {t.owner.indexed}
          </h2>
          <p className={styles.lead}>{t.owner.indexedLead}</p>
          <RepositoryGrid items={indexed} />
        </section>
      )}

      <section className={styles.section} aria-labelledby="owner-repositories">
        <h2 id="owner-repositories" className={styles.heading}>
          {indexed.length > 0 ? t.owner.repositoriesAfterIndexed : t.owner.repositories}
        </h2>
        {repositories.length === 0 && indexed.length === 0 ? (
          <EmptyState title={t.owner.empty.title}>{t.owner.empty.body}</EmptyState>
        ) : (
          repositories.length > 0 && (
            <>
              <p className={styles.lead}>{t.owner.repositoriesLead}</p>
              <ul className={styles.repositories}>
                {repositories.map((repository) => (
                  <Repository key={repository.address} repository={repository} />
                ))}
              </ul>
            </>
          )
        )}
        {more.error !== undefined && <ErrorCallout error={more.error} />}
        {nextPage !== null && (
          <p className={styles.more}>
            <Button disabled={more.loading} onClick={() => more.loadMore(String(nextPage))}>
              {more.loading ? t.common.loading : t.owner.more}
            </Button>
          </p>
        )}
      </section>
    </Container>
  );
}
