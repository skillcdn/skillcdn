import { type Address, formatAddress, type RestMount, type RestSkill } from "@skillcdn/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { signInHref, useSession } from "../auth/session.js";
import { AddressForm } from "../components/address-form.js";
import { ConnectGuide } from "../components/connect-guide.js";
import { ConnectStrip } from "../components/connect-strip.js";
import { ErrorCallout } from "../components/error-callout.js";
import {
  Avatar,
  Badge,
  Callout,
  Container,
  cx,
  Picture,
  Skeleton,
  Spinner,
  VerifiedMark,
} from "../components/ui.js";
import ui from "../components/ui.module.css";
import { useI18n } from "../i18n/index.js";
import { repositoryDescription, repositoryName, translationFor } from "../i18n/repository-text.js";
import { Link, useLocation } from "../navigation.js";
import { accountHref, type MountView, PATHS } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import { hostTreeUrl } from "./host-links.js";
import { LicenseValue } from "./license.js";
import styles from "./mount.module.css";
import { MountFile } from "./mount-file.js";
import { MountOverview } from "./mount-overview.js";
import { MountSkill } from "./mount-skill.js";

/** A small label, then the value in the code face. */
function Fact(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <li className={styles.fact}>
      <span className={styles.factLabel}>{props.label}</span>
      <code>{props.children}</code>
    </li>
  );
}

function MountHeader(props: {
  readonly origin: string;
  readonly address: Address;
  readonly mount: RestMount | undefined;
  /**
   * What the page shows, for the address under the name; none on the page of the address,
   * which has the guide itself, and while the address cannot be served.
   */
  readonly use: "skill" | "folder" | undefined;
}) {
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

  return (
    <header className={styles.header}>
      {/* The repository's picture over the header when it has one, and its owner's on the lower
          edge of it; without one, the owner's stands alone above the name (ADR-0031). */}
      {mount?.image != null && <Picture className={styles.banner} src={mount.image} eager />}
      {mount !== undefined && (
        <Avatar className={styles.avatar} src={mount.repository.avatar} size="lg" eager />
      )}
      {/* The mark belongs to the name: it says someone vouches for what this address resolves to. */}
      <h1 className={styles.title}>
        {name}
        {mount?.verified === true && (
          <>
            {" "}
            <VerifiedMark label={t.mount.verified} hint={t.mount.verifiedHint} />
          </>
        )}
      </h1>
      {description != null && (
        <p className={styles.description} lang={descriptionLanguage}>
          {description}
        </p>
      )}
      {/* Away from the guide, the address to connect with comes before the facts about the
          commit: the one is what the visitor came for, the other is there for whoever asks. */}
      {props.use !== undefined && (
        <ConnectStrip origin={props.origin} address={address} kind={props.use} />
      )}
      {mount !== undefined && (
        <div className={styles.facts}>
          {/* What the address resolved to, under the name: the branch or ref it follows, the
              commit, and the license, linked to its file where there is one. */}
          <ul className={styles.factList}>
            {/* Said first: who else can open this page is what a person checks before sharing it. */}
            {mount.repository.visibility === "private" && (
              <li>
                <Badge title={t.mount.privateHint}>{t.mount.private}</Badge>
              </li>
            )}
            {!mount.verified && (
              <li>
                <Badge tone="warning" title={t.mount.unverifiedHint}>
                  {t.mount.unverified}
                </Badge>
              </li>
            )}
            {name !== repository && <Fact label={t.mount.repository}>{repository}</Fact>}
            {mount.pinned ? (
              <Fact label={t.mount.pinned}>{mount.commit.slice(0, 7)}</Fact>
            ) : (
              <>
                <Fact label={mount.ref === null ? t.mount.defaultBranch : t.mount.ref}>
                  {mount.ref ?? mount.repository.defaultBranch}
                </Fact>
                <Fact label={t.mount.commit}>{mount.commit.slice(0, 7)}</Fact>
              </>
            )}
            {mount.path !== "" && <Fact label={t.mount.path}>{mount.path}</Fact>}
            {mount.index.status === "ready" && mount.index.license !== undefined && (
              <Fact label={t.mount.license}>
                <LicenseValue license={mount.index.license} mount={mount} />
              </Fact>
            )}
          </ul>
          <a
            className={styles.hostLink}
            href={hostTreeUrl(mount)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.mount.viewOnHost}
          </a>
        </div>
      )}
    </header>
  );
}

/**
 * Under a repository that was not found: it may be one the visitor has to sign in for, or one
 * the git host's app is not installed on. The server answers the same for those and for a name
 * that does not exist (docs/specs/permissions.md), so this says what to try, not what is the case.
 */
function PrivateHint() {
  const { t } = useI18n();
  const { session } = useSession();
  const location = useLocation();
  if (session.status === "anonymous") {
    return (
      <Callout
        action={
          // A real navigation: signing in happens at the git host, and comes back here.
          <a className={cx(ui.button, ui.secondary, ui.small)} href={signInHref(location)}>
            {t.auth.signInWith}
          </a>
        }
      >
        {t.auth.privateSignedOut}
      </Callout>
    );
  }
  if (session.status === "user") {
    return (
      <Callout
        action={
          <Link
            className={cx(ui.button, ui.secondary, ui.small)}
            href={accountHref("repositories")}
          >
            {t.auth.privateManage}
          </Link>
        }
      >
        {t.auth.privateSignedIn}
      </Callout>
    );
  }
  return null;
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

  // Every read needs the indexed publication policy, including direct README links.
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
  if (view.kind === "file") {
    return <MountFile address={address} mount={mount} path={view.path} />;
  }
  return view.kind === "skill" ? (
    <MountSkill
      key={view.path}
      address={address}
      mount={mount}
      path={view.path}
      onLoaded={props.onSkill}
    />
  ) : (
    <MountOverview
      key={`${view.path ?? address.path} ${view.query ?? ""}`}
      address={address}
      index={mount.index}
      query={view.query}
      path={view.path ?? address.path}
    />
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

  // What a private repository shows was answered for the person who was signed in. Once they
  // sign out the address is asked again, as anyone, and the page shows what anyone is shown.
  const { session } = useSession();
  const signedIn = session.status === "user";
  const wasSignedIn = useRef(signedIn);
  const forOne = loaded?.repository.visibility === "private";
  // biome-ignore lint/correctness/useExhaustiveDependencies: who is signed in is the trigger
  useEffect(() => {
    if (wasSignedIn.current && !signedIn && forOne) {
      mount.reload();
    }
    wasSignedIn.current = signedIn;
  }, [signedIn]);

  // The head says what this view shows, once it knows: the same head the server writes.
  useEffect(() => {
    applyHead(
      buildHead({ name: "mount", address, view }, language, origin, {
        mount: loaded,
        skill: view.kind === "skill" ? skill : undefined,
      }),
    );
  }, [address, view, language, origin, loaded, skill]);

  // Name and description, then how to connect an agent, then what it serves. The guide is for
  // the address as a whole, so it is on the page of the address: a folder, a skill, a file or
  // a search is what the visitor came for, and carries the address under the name instead,
  // which leads back to the guide.
  const atRoot =
    view.kind === "overview" &&
    view.query === undefined &&
    (view.path === undefined || view.path === address.path);
  const use =
    atRoot || mount.state === "error" ? undefined : view.kind === "skill" ? "skill" : "folder";

  return (
    <Container className={styles.page}>
      <MountHeader origin={origin} address={address} mount={loaded} use={use} />
      {atRoot && mount.state !== "error" && (
        <ConnectGuide origin={origin} address={address} mount={loaded} />
      )}
      <div className={styles.content}>
        {mount.state === "loading" && <Skeleton lines={6} label={t.common.loading} />}
        {mount.state === "error" && <ErrorCallout error={mount.error} onRetry={mount.reload} />}
        {mount.state === "error" && mount.error.code === "mount.repo_not_found" && <PrivateHint />}
        {/* An address that resolves to nothing is, most of the time, a slip of a character: the
            address stays in a field to fix, and the featured skills are a way out. */}
        {mount.state === "error" && mount.error.status === 404 && (
          <div className={styles.lost}>
            <p className={styles.note}>{t.mount.lost.lead}</p>
            <AddressForm
              origin={origin}
              initialValue={formatAddress(address).replace(/^\/gh\//, "")}
            />
            <p className={styles.note}>
              <Link href={PATHS.explore}>
                {t.mount.lost.explore}
                <span aria-hidden="true"> →</span>
              </Link>
            </p>
          </div>
        )}
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
    </Container>
  );
}
