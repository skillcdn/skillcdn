import type {
  Address,
  RestBrowse,
  RestBrowseEntry,
  RestFind,
  RestLicense,
  RestMount,
  RestSkillSummary,
  RestSkillTranslation,
} from "@skillcdn/core";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useMorePages } from "../api/use-more-pages.js";
import { useResource } from "../api/use-resource.js";
import { ErrorCallout } from "../components/error-callout.js";
import { Badge, Button, Callout, EmptyState, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { skillDescription, skillTitle } from "../i18n/repository-text.js";
import { appHref, Link, navigate } from "../navigation.js";
import { mountHref } from "../router.js";
import { licenseLabel } from "./license.js";
import styles from "./mount.module.css";
import { contentHref, MountPath } from "./mount-path.js";

type ReadyIndex = Extract<RestMount["index"], { status: "ready" }>;
type ReadySearch = Extract<RestFind, { status: "ready" }>;
type ReadyBrowse = Extract<RestBrowse, { status: "ready" }>;

function lastSegment(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.8l2 2h8.2A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

/**
 * A folder of the repository: what it is called (its manifest's name, else the folder), what it
 * is for, and what it holds. The folder name is shown once: as the title when there is no other
 * name, in the code face beside the name when there is.
 */
function FolderCard(props: { readonly address: Address; readonly entry: RestBrowseEntry }) {
  const { t } = useI18n();
  const { address, entry } = props;
  const folder = lastSegment(entry.path);
  const name = entry.name ?? folder;
  return (
    <li className={styles.folder}>
      <Link
        className={styles.folderLink}
        href={mountHref(address, { kind: "overview", path: entry.path, query: undefined })}
      >
        <FolderIcon />
        <span className={styles.folderText}>
          <span className={styles.folderName}>
            {name}
            {name !== folder && <code>{folder}</code>}
          </span>
          {entry.description !== null && (
            <span className={styles.cardBody} lang={entry.language ?? undefined}>
              {entry.description}
            </span>
          )}
          <span className={styles.folderMeta}>
            {t.mount.browse.holds(entry.skillCount, entry.documentCount)}
          </span>
        </span>
      </Link>
      {entry.overviewPath !== undefined && (
        <Link className={styles.folderReadme} href={contentHref(address, entry.overviewPath)}>
          {t.mount.browse.introduction}
        </Link>
      )}
    </li>
  );
}

/**
 * A skill in a list: its title in the visitor's language, what it does, and how it is served.
 * `where` names its folder when the list spans folders, as search results do.
 */
function SkillCard(props: {
  readonly address: Address;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly translations: Readonly<Record<string, RestSkillTranslation>>;
  readonly where?: string;
  readonly license?: RestLicense | undefined;
  readonly describedOnly?: boolean | undefined;
  /** Skills nested under this one, when the folder holds more than the skill itself. */
  readonly nested?: number;
  readonly warnings?: number;
  readonly language?: string | null | undefined;
}) {
  const { t, language } = useI18n();
  const title = skillTitle(props, language);
  const description = skillDescription(props, language);
  const translated = title !== props.name || description !== props.description;
  const license =
    props.license === undefined || props.license.kind === "none"
      ? undefined
      : licenseLabel(t.skill, props.license);
  return (
    <li>
      <Link className={styles.card} href={contentHref(props.address, props.path)}>
        <span className={styles.cardHead}>
          <span className={styles.cardTitle}>{title}</span>
          {title !== props.name && <span className={styles.cardName}>{props.name}</span>}
          {props.describedOnly === true && (
            <Badge tone="warning" title={t.mount.browse.describedOnlyHint}>
              {t.mount.browse.describedOnly}
            </Badge>
          )}
          {props.nested !== undefined && props.nested > 0 && (
            <Badge tone="accent">{t.mount.browse.nested(props.nested)}</Badge>
          )}
          {props.warnings !== undefined && props.warnings > 0 && (
            <Badge tone="warning">{t.mount.warnings(props.warnings)}</Badge>
          )}
        </span>
        <span
          className={styles.cardBody}
          lang={translated ? undefined : (props.language ?? undefined)}
        >
          {description}
        </span>
        {(props.where !== undefined || license !== undefined) && (
          <span className={styles.cardFoot}>
            {props.where !== undefined && <span className={styles.cardPath}>{props.where}</span>}
            {license !== undefined && <span>{license}</span>}
          </span>
        )}
        {translated && <span className={styles.note}>{t.skill.translationNote}</span>}
      </Link>
    </li>
  );
}

/** A document: its title when it has one, else its file name, its summary, and where it is. */
function DocumentCard(props: {
  readonly address: Address;
  readonly path: string;
  readonly title: string | null;
  readonly summary: string | null;
  /** The skill the document belongs to, when a search turned up one of a skill's own files. */
  readonly partOf?: string | null;
  readonly language?: string | null | undefined;
}) {
  const { t } = useI18n();
  return (
    <li>
      <Link
        className={styles.card}
        href={mountHref(props.address, { kind: "file", path: props.path })}
      >
        <span className={styles.cardHead}>
          <span className={styles.cardTitle}>{props.title ?? lastSegment(props.path)}</span>
          {props.partOf != null && <Badge tone="accent">{t.mount.partOfSkill(props.partOf)}</Badge>}
        </span>
        {props.summary !== null && (
          <span className={styles.cardBody} lang={props.language ?? undefined}>
            {props.summary}
          </span>
        )}
        <span className={styles.cardPath}>{props.path}</span>
      </Link>
    </li>
  );
}

function LoadMore(props: {
  readonly cursor: string | null;
  readonly more: ReturnType<typeof useMorePages>;
  readonly reload: () => void;
}) {
  const { t } = useI18n();
  const { cursor, more } = props;
  return (
    <>
      {more.error !== undefined && (
        <>
          <ErrorCallout error={more.error} onRetry={() => more.loadMore(cursor)} />
          <p>
            <Button
              onClick={() => {
                more.reset();
                props.reload();
              }}
            >
              {t.common.reload}
            </Button>
          </p>
        </>
      )}
      {cursor !== null && (
        <p>
          <Button onClick={() => more.loadMore(cursor)} disabled={more.loading}>
            {more.loading ? t.common.loading : t.file.more}
          </Button>
        </p>
      )}
    </>
  );
}

function SearchResults(props: {
  readonly address: Address;
  readonly query: string;
  readonly path: string;
}) {
  const { t } = useI18n();
  const { address, query, path } = props;
  const found = useResource(
    resourceKeys.find(address, query, path),
    (signal) => api.find(address, query, path, signal),
    (value) => value.status === "indexing",
  );
  const more = useMorePages<ReadySearch>(async (cursor, signal) => {
    const page = await api.find(address, query, path, signal, cursor);
    if (page.status !== "ready")
      throw new ApiError(0, "index.not_ready", "The index is not ready.");
    return page;
  });
  if (found.state === "loading") return <Skeleton lines={4} label={t.common.loading} />;
  if (found.state === "error") return <ErrorCallout error={found.error} onRetry={found.reload} />;
  if (found.value.status === "failed") {
    return (
      <Callout tone="warning" title={t.mount.failed.title}>
        {t.mount.failed.body(found.value.errorCode)}
      </Callout>
    );
  }
  if (found.value.status !== "ready") return <Skeleton lines={4} label={t.mount.indexing.title} />;
  const pages = [found.value, ...more.pages];
  const items = pages.flatMap((page) => page.items);
  const cursor = (pages.at(-1) ?? found.value).nextCursor ?? null;
  return (
    <section className={styles.stack} aria-live="polite" aria-busy={more.loading}>
      <h3 className={styles.resultsTitle}>{t.mount.search.resultsFor(query)}</h3>
      {items.length === 0 ? (
        <EmptyState title={t.mount.search.none} />
      ) : (
        <ol className={styles.list}>
          {items.flatMap((item) =>
            item.kind === "skill"
              ? [
                  <SkillCard
                    key={`skill ${item.directory}`}
                    address={address}
                    path={item.path ?? `${item.directory}/SKILL.md`}
                    name={item.name}
                    description={item.description}
                    translations={item.translations}
                    where={item.directory}
                    license={item.license}
                    describedOnly={item.describedOnly}
                  />,
                  ...item.files.map((file) => (
                    <DocumentCard
                      key={`file ${file.path}`}
                      address={address}
                      path={file.path}
                      title={file.title}
                      summary={file.summary}
                      partOf={item.directory}
                    />
                  )),
                ]
              : [
                  <DocumentCard
                    key={`document ${item.path}`}
                    address={address}
                    path={item.path}
                    title={item.title}
                    summary={item.summary}
                    partOf={item.skillDirectory}
                  />,
                ],
          )}
        </ol>
      )}
      <LoadMore cursor={cursor} more={more} reload={found.reload} />
    </section>
  );
}

/**
 * One folder of the repository, as `browse_repo` lists it, in three groups: the folders in it,
 * the skills, and the documents. A skill's title and description are translated when the
 * overview of the mount lists the skill with a translation.
 */
function BrowseResults(props: {
  readonly address: Address;
  readonly path: string;
  readonly summaries: ReadonlyMap<string, RestSkillSummary>;
  /** The description the header already shows, which the folder's introduction need not repeat. */
  readonly shown: string | undefined;
}) {
  const { t } = useI18n();
  const { address, path, summaries } = props;
  const found = useResource(
    resourceKeys.browse(address, path),
    (signal) => api.browse(address, path, signal),
    (value) => value.status === "indexing",
  );
  const more = useMorePages<ReadyBrowse>(async (cursor, signal) => {
    const page = await api.browse(address, path, signal, cursor);
    if (page.status !== "ready")
      throw new ApiError(0, "index.not_ready", "The index is not ready.");
    return page;
  });
  if (found.state === "loading") return <Skeleton lines={4} label={t.common.loading} />;
  if (found.state === "error") return <ErrorCallout error={found.error} onRetry={found.reload} />;
  if (found.value.status === "failed") {
    return (
      <Callout tone="warning" title={t.mount.failed.title}>
        {t.mount.failed.body(found.value.errorCode)}
      </Callout>
    );
  }
  if (found.value.status !== "ready") return <Skeleton lines={4} label={t.mount.indexing.title} />;
  const pages = [found.value, ...more.pages];
  const entries = pages.flatMap((page) => page.entries);
  const cursor = (pages.at(-1) ?? found.value).nextCursor ?? null;
  const overview = found.value.overview;
  const folders = entries.filter((entry) => entry.kind === "directory");
  const skills = entries.filter((entry) => entry.kind === "skill");
  const documents = entries.filter((entry) => entry.kind === "file");
  return (
    <section className={styles.stack} aria-live="polite" aria-busy={more.loading}>
      {overview !== undefined && (
        <div className={styles.intro}>
          {overview.description !== null && overview.description !== props.shown && (
            <p>{overview.description}</p>
          )}
          <p>
            <Link href={contentHref(address, overview.path)}>
              {t.mount.browse.introduction}
              <span aria-hidden="true"> →</span>
            </Link>
          </p>
        </div>
      )}
      {entries.length === 0 && <EmptyState title={t.mount.browse.empty} />}
      {folders.length > 0 && (
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t.mount.browse.folders}</h3>
          <ul className={styles.folders}>
            {folders.map((entry) => (
              <FolderCard key={entry.path} address={address} entry={entry} />
            ))}
          </ul>
        </section>
      )}
      {skills.length > 0 && (
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t.mount.browse.skills}</h3>
          <ul className={styles.list}>
            {skills.map((entry) => {
              const summary = summaries.get(entry.path);
              const name = entry.name ?? lastSegment(entry.path);
              return (
                <SkillCard
                  key={entry.path}
                  address={address}
                  path={entry.path}
                  name={name}
                  description={entry.description ?? ""}
                  translations={summary?.translations ?? {}}
                  license={entry.license}
                  describedOnly={entry.describedOnly}
                  nested={entry.skillCount - 1}
                  warnings={summary?.warnings.length}
                  language={entry.language}
                />
              );
            })}
          </ul>
        </section>
      )}
      {documents.length > 0 && (
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t.mount.browse.documents}</h3>
          <ul className={styles.list}>
            {documents.map((entry) => (
              <DocumentCard
                key={entry.path}
                address={address}
                path={entry.path}
                title={entry.name}
                summary={entry.description}
                language={entry.language}
              />
            ))}
          </ul>
        </section>
      )}
      <LoadMore cursor={cursor} more={more} reload={found.reload} />
    </section>
  );
}

export function MountOverview(props: {
  readonly address: Address;
  readonly index: ReadyIndex;
  readonly query: string | undefined;
  readonly path: string;
}) {
  const { t } = useI18n();
  const { address, index, query, path } = props;
  const [text, setText] = useState(query ?? "");
  const search = (next: string | undefined) =>
    navigate(appHref(mountHref(address, { kind: "overview", query: next, path })));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    search(text.trim() || undefined);
  };
  // The overview lists the first skills with their translations; browse entries carry none.
  const summaries = new Map(
    index.skills.map((skill) => [
      skill.path ?? (skill.directory === "" ? "SKILL.md" : `${skill.directory}/SKILL.md`),
      skill,
    ]),
  );
  return (
    <div className={styles.stack}>
      <header className={styles.browseHeader}>
        <h2 className={styles.subheading}>{t.mount.browse.title}</h2>
        {path === address.path && (
          <p className={styles.note}>
            {t.mount.browse.counts(index.skillCount, index.documentCount)}
          </p>
        )}
      </header>
      <MountPath address={address} path={path} />
      <search>
        <form className={styles.search} onSubmit={onSubmit}>
          <label className="visually-hidden" htmlFor="mount-search">
            {t.mount.search.label}
          </label>
          <input
            id="mount-search"
            className={styles.searchInput}
            type="search"
            maxLength={500}
            aria-describedby="mount-search-hint"
            placeholder={t.mount.search.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit">{t.mount.search.submit}</Button>
          {query !== undefined && (
            <Button
              variant="ghost"
              onClick={() => {
                setText("");
                search(undefined);
              }}
            >
              {t.mount.search.clear}
            </Button>
          )}
        </form>
        <p id="mount-search-hint" className={styles.note}>
          {t.mount.search.hint}
        </p>
      </search>
      {query === undefined ? (
        <BrowseResults
          key={path}
          address={address}
          path={path}
          summaries={summaries}
          shown={path === address.path ? (index.manifest?.description ?? undefined) : undefined}
        />
      ) : (
        <SearchResults key={`${path} ${query}`} address={address} path={path} query={query} />
      )}
      {index.diagnostics.length > 0 && (
        <details className={styles.diagnosticDetails}>
          <summary>{t.mount.tabs.diagnostics(index.diagnostics.length)}</summary>
          <p className={styles.note}>{t.mount.diagnostics.lead}</p>
          <ul className={styles.diagnostics}>
            {index.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.path} ${diagnostic.code}`} className={styles.diagnostic}>
                <span className={styles.cardHead}>
                  <code>{diagnostic.path}</code>
                  <Badge tone="danger">{diagnostic.code}</Badge>
                </span>
                <span className={styles.diagnosticBody}>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
