import type {
  Address,
  RestBrowse,
  RestDocumentSummary,
  RestFind,
  RestMount,
  RestSkillSummary,
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
import styles from "./mount.module.css";
import { contentHref, MountPath, parentDirectory } from "./mount-path.js";

type ReadyIndex = Extract<RestMount["index"], { status: "ready" }>;

function SkillItem(props: { readonly address: Address; readonly skill: RestSkillSummary }) {
  const { t, language } = useI18n();
  const { skill } = props;
  // A translated title stands in for the name, which then stays visible next to the directory.
  const title = skillTitle(skill, language);
  const description = skillDescription(skill, language);
  const translated = title !== skill.name || description !== skill.description;
  const where = skill.directory === "" ? "SKILL.md" : `${skill.directory}/SKILL.md`;
  return (
    <li>
      <Link className={styles.item} href={contentHref(props.address, where)}>
        <span className={styles.itemHead}>
          <span className={styles.itemName}>{title}</span>
          {skill.warnings.length > 0 && (
            <Badge tone="warning">{t.mount.warnings(skill.warnings.length)}</Badge>
          )}
        </span>
        <span className={styles.itemBody}>{description}</span>
        <span className={styles.itemPath}>
          {title === skill.name ? where : `${skill.name} · ${where}`}
        </span>
        {translated && <span className={styles.note}>{t.skill.translationNote}</span>}
      </Link>
    </li>
  );
}

function DocumentItem(props: {
  readonly address: Address;
  readonly document: RestDocumentSummary;
  /** The skill the document belongs to, when a search turned up one of a skill's own files. */
  readonly skillDirectory?: string | null;
}) {
  const { t } = useI18n();
  const { document, skillDirectory } = props;
  return (
    <li>
      <Link
        className={styles.item}
        href={mountHref(props.address, { kind: "file", path: document.path })}
      >
        <span className={styles.itemHead}>
          <span className={styles.itemTitle}>{document.title ?? document.path}</span>
          {skillDirectory != null && (
            <Badge tone="accent">{t.mount.partOfSkill(skillDirectory)}</Badge>
          )}
        </span>
        {document.summary !== null && <span className={styles.itemBody}>{document.summary}</span>}
        <span className={styles.itemPath}>{document.path}</span>
      </Link>
    </li>
  );
}

type ReadySearch = Extract<RestFind, { status: "ready" }>;
type ReadyBrowse = Extract<RestBrowse, { status: "ready" }>;

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
      <h2 className={styles.resultsTitle}>{t.mount.search.resultsFor(query)}</h2>
      {items.length === 0 ? (
        <EmptyState title={t.mount.search.none} />
      ) : (
        <ol className={styles.list}>
          {items.flatMap((item) =>
            item.kind === "skill"
              ? [
                  <SkillItem
                    key={`skill ${item.directory}`}
                    address={address}
                    skill={{ ...item, warnings: [] }}
                  />,
                  ...item.files.map((file) => (
                    <DocumentItem
                      key={`file ${file.path}`}
                      address={address}
                      document={file}
                      skillDirectory={item.directory}
                    />
                  )),
                ]
              : [
                  <DocumentItem
                    key={`document ${item.path}`}
                    address={address}
                    document={item}
                    skillDirectory={item.skillDirectory}
                  />,
                ],
          )}
        </ol>
      )}
      {more.error !== undefined && (
        <>
          <ErrorCallout error={more.error} onRetry={() => more.loadMore(cursor)} />
          <p>
            <Button
              onClick={() => {
                more.reset();
                found.reload();
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
    </section>
  );
}

function BrowseResults(props: { readonly address: Address; readonly path: string }) {
  const { t } = useI18n();
  const { address, path } = props;
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
  return (
    <section className={styles.stack} aria-live="polite" aria-busy={more.loading}>
      {overview !== undefined && (
        <div className={styles.stack}>
          {overview.description !== null && <p>{overview.description}</p>}
          <p>
            <Link href={contentHref(address, overview.path)}>{t.mount.browse.introduction}</Link>
          </p>
        </div>
      )}
      {entries.length === 0 ? (
        <EmptyState title={t.mount.browse.empty} />
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.path}>
              <Link
                className={styles.item}
                href={
                  entry.kind === "directory"
                    ? mountHref(address, { kind: "overview", path: entry.path, query: undefined })
                    : contentHref(address, entry.path)
                }
              >
                <span className={styles.itemHead}>
                  <Badge tone={entry.kind === "directory" ? "accent" : "neutral"}>
                    {entry.kind === "directory"
                      ? t.file.directory
                      : entry.kind === "skill"
                        ? t.mount.kinds.skill
                        : t.mount.kinds.document}
                  </Badge>
                  <span className={styles.itemTitle}>
                    {entry.name ?? entry.path.split("/").at(-1)}
                  </span>
                </span>
                {entry.description !== null && (
                  <span className={styles.itemBody} lang={entry.language ?? undefined}>
                    {entry.description}
                  </span>
                )}
                <span className={styles.itemFoot}>
                  <span className={styles.itemPath}>{entry.path}</span>
                  {(entry.kind === "directory" || entry.skillCount > 1) && (
                    <span className={styles.entrySize}>
                      {t.mount.browse.counts(entry.skillCount, entry.documentCount)}
                    </span>
                  )}
                </span>
              </Link>
              {(entry.kind === "skill" || entry.overviewPath !== undefined) && (
                <p className={styles.itemActions}>
                  {entry.kind === "skill" && (
                    <Link
                      href={mountHref(address, {
                        kind: "overview",
                        path: parentDirectory(entry.path),
                        query: undefined,
                      })}
                    >
                      {entry.skillCount > 1 ? t.skill.browseChildren : t.skill.browseFiles}
                    </Link>
                  )}
                  {entry.overviewPath !== undefined && (
                    <Link href={contentHref(address, entry.overviewPath)}>
                      {t.mount.browse.introduction}
                    </Link>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {more.error !== undefined && (
        <>
          <ErrorCallout error={more.error} onRetry={() => more.loadMore(cursor)} />
          <p>
            <Button
              onClick={() => {
                more.reset();
                found.reload();
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
        <BrowseResults key={path} address={address} path={path} />
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
                <span className={styles.itemHead}>
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
