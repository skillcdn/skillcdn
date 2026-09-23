import type { Address, RestMount, RestSkill } from "@skillcdn/core";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { ConnectGuide } from "../components/connect-guide.js";
import { ErrorCallout } from "../components/error-callout.js";
import { Badge, Callout, Container, Skeleton, Spinner } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { repositoryDescription, repositoryName, translationFor } from "../i18n/repository-text.js";
import type { MountView } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./mount.module.css";
import { MountFile } from "./mount-file.js";
import { MountOverview } from "./mount-overview.js";
import { MountSkill } from "./mount-skill.js";

function MountHeader(props: { readonly address: Address; readonly mount: RestMount | undefined }) {
  const { t, language } = useI18n();
  const { address, mount } = props;
  const repository =
    mount === undefined
      ? `${address.owner}/${address.repo}`
      : `${mount.repository.owner}/${mount.repository.name}`;
  // A repository with a manifest goes by the name and the description it gives itself, in the
  // visitor's language when it translated them.
  const manifest = mount?.index.status === "ready" ? mount.index.manifest : null;
  const name = (manifest === null ? null : repositoryName(manifest, language)) ?? repository;
  const description =
    manifest === null ? mount?.repository.description : repositoryDescription(manifest, language);
  // Text shown as the author wrote it is in the repository's language, when the manifest says.
  const descriptionLanguage =
    manifest !== null && translationFor(manifest.translations, language)?.description == null
      ? (manifest.language ?? undefined)
      : undefined;
  const hostUrl =
    mount === undefined
      ? undefined
      : `https://github.com/${mount.repository.owner}/${mount.repository.name}/tree/${mount.commit}${
          mount.path === "" ? "" : `/${mount.path}`
        }`;

  return (
    <header className={styles.header}>
      <p className={styles.kicker}>{t.mount.repository}</p>
      {/* The badges belong to the name: they say what this address resolves to, and whether
          anyone has vouched for what it resolves to. */}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{name}</h1>
        {mount !== undefined && (
          <ul className={styles.badges}>
            <li>
              {mount.pinned ? (
                <Badge tone="success">{t.mount.pinned}</Badge>
              ) : (
                <Badge tone="accent">
                  {mount.ref ?? `${mount.repository.defaultBranch} · ${t.mount.defaultBranch}`}
                </Badge>
              )}
            </li>
            {!mount.verified && (
              <li>
                <Badge tone="warning" title={t.mount.unverifiedHint}>
                  {t.mount.unverified}
                </Badge>
              </li>
            )}
          </ul>
        )}
      </div>
      {description != null && (
        <p className={styles.description} lang={descriptionLanguage}>
          {description}
        </p>
      )}
      {mount !== undefined && (
        <div className={styles.facts}>
          {/* A small label, then the value in the code face. */}
          <ul className={styles.factList}>
            {name !== repository && (
              <li className={styles.fact}>
                <span className={styles.factLabel}>{t.mount.repository}</span>
                <code>{repository}</code>
              </li>
            )}
            <li className={styles.fact}>
              <span className={styles.factLabel}>{t.mount.commit}</span>
              <code>{mount.commit.slice(0, 7)}</code>
            </li>
            {mount.path !== "" && (
              <li className={styles.fact}>
                <span className={styles.factLabel}>{t.mount.path}</span>
                <code>{mount.path}</code>
              </li>
            )}
          </ul>
          {hostUrl !== undefined && (
            <a className={styles.hostLink} href={hostUrl} target="_blank" rel="noopener noreferrer">
              {t.mount.viewOnHost}
            </a>
          )}
        </div>
      )}
    </header>
  );
}

function MountBody(props: {
  readonly address: Address;
  readonly view: MountView;
  readonly mount: RestMount;
  readonly stalled: boolean;
  readonly onSkill: (skill: RestSkill | undefined) => void;
}) {
  const { t } = useI18n();
  const { address, view, mount } = props;

  // A file can be read while the index is still being built; everything else needs the index.
  if (view.kind === "file") {
    return <MountFile address={address} path={view.path} />;
  }
  if (mount.index.status === "indexing") {
    return (
      <Callout
        title={t.mount.indexing.title}
        action={props.stalled ? undefined : <Spinner label={t.common.loading} />}
      >
        {props.stalled ? t.mount.indexing.slow : t.mount.indexing.body}
      </Callout>
    );
  }
  if (mount.index.status === "failed") {
    return (
      <Callout tone="warning" title={t.mount.failed.title}>
        {t.mount.failed.body(mount.index.errorCode)}
      </Callout>
    );
  }
  return view.kind === "skill" ? (
    <MountSkill address={address} name={view.name} onLoaded={props.onSkill} />
  ) : (
    <MountOverview address={address} index={mount.index} query={view.query} />
  );
}

export interface MountPageProps {
  readonly origin: string;
  readonly address: Address;
  readonly view: MountView;
}

/** The explorer view of one address: what it serves, and how to connect an agent to it. */
export function MountPage(props: MountPageProps) {
  const { t, language } = useI18n();
  const { address, view, origin } = props;
  const mount = useResource(
    resourceKeys.mount(address),
    (signal) => api.mount(address, signal),
    (value) => value.index.status === "indexing",
  );
  const [skill, setSkill] = useState<RestSkill | undefined>(undefined);
  const loaded = mount.state === "ready" ? mount.value : undefined;

  // The head says what this view shows, once it knows: the same head the server writes.
  useEffect(() => {
    applyHead(
      buildHead({ name: "mount", address, view }, language, origin, {
        mount: loaded,
        skill: view.kind === "skill" ? skill : undefined,
      }),
    );
  }, [address, view, language, origin, loaded, skill]);

  // Name and description, then how to connect an agent, then what it gets. A skill or a file
  // is what the visitor came for, so on those views the guide follows the content instead.
  const guide =
    mount.state === "error" ? null : (
      <ConnectGuide origin={origin} address={address} mount={loaded} />
    );
  const content = (
    <div className={styles.content}>
      {mount.state === "loading" && <Skeleton lines={6} label={t.common.loading} />}
      {mount.state === "error" && <ErrorCallout error={mount.error} onRetry={mount.reload} />}
      {mount.state === "ready" && (
        <>
          {mount.value.index.status === "ready" && mount.value.index.truncated && (
            <Callout tone="warning">{t.mount.truncated}</Callout>
          )}
          <MountBody
            address={address}
            view={view}
            mount={mount.value}
            stalled={mount.stalled}
            onSkill={setSkill}
          />
        </>
      )}
    </div>
  );

  return (
    <Container className={styles.page}>
      <MountHeader address={address} mount={loaded} />
      {view.kind === "overview" ? (
        <>
          {guide}
          {content}
        </>
      ) : (
        <>
          {content}
          {guide}
        </>
      )}
    </Container>
  );
}
