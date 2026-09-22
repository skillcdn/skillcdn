import {
  type Address,
  REST_MOUNT_LIST_LIMIT,
  type RestDocumentSummary,
  type RestMount,
  type RestSkillSummary,
} from "@skillcdn/core";
import { type FormEvent, useState } from "react";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { ErrorCallout } from "../components/error-callout.js";
import { Tabs } from "../components/tabs.js";
import { Badge, Button, EmptyState, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { appHref, Link, navigate } from "../navigation.js";
import { mountHref } from "../router.js";
import styles from "./mount.module.css";

type ReadyIndex = Extract<RestMount["index"], { status: "ready" }>;

/** A skill is opened by its directory, which is unique; the skill at the root only has its name. */
function skillKey(skill: { readonly name: string; readonly directory: string }): string {
  return skill.directory === "" ? skill.name : skill.directory;
}

function SkillItem(props: { readonly address: Address; readonly skill: RestSkillSummary }) {
  const { t } = useI18n();
  const { skill } = props;
  return (
    <li>
      <Link
        className={styles.item}
        href={mountHref(props.address, { kind: "skill", name: skillKey(skill) })}
      >
        <span className={styles.itemHead}>
          <span className={styles.itemName}>{skill.name}</span>
          {skill.warnings.length > 0 && (
            <Badge tone="warning">{t.mount.warnings(skill.warnings.length)}</Badge>
          )}
        </span>
        <span className={styles.itemBody}>{skill.description}</span>
        <span className={styles.itemPath}>
          {skill.directory === "" ? t.skill.root : skill.directory}
        </span>
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

function SearchResults(props: { readonly address: Address; readonly query: string }) {
  const { t } = useI18n();
  const { address, query } = props;
  const found = useResource(
    resourceKeys.find(address, query),
    (signal) => api.find(address, query, signal),
    (value) => value.status === "indexing",
  );

  if (found.state === "loading") {
    return <Skeleton lines={4} label={t.common.loading} />;
  }
  if (found.state === "error") {
    return <ErrorCallout error={found.error} onRetry={found.reload} />;
  }
  if (found.value.status !== "ready") {
    return <Skeleton lines={4} label={t.mount.indexing.title} />;
  }
  return (
    <section aria-live="polite">
      <h2 className={styles.resultsTitle}>{t.mount.search.resultsFor(query)}</h2>
      {found.value.items.length === 0 ? (
        <EmptyState title={t.mount.search.none} />
      ) : (
        <ol className={styles.list}>
          {found.value.items.map((item) =>
            item.kind === "skill" ? (
              <SkillItem
                key={`skill ${item.directory} ${item.name}`}
                address={address}
                skill={{ ...item, warnings: [] }}
              />
            ) : (
              <DocumentItem
                key={`document ${item.path}`}
                address={address}
                document={item}
                skillDirectory={item.skillDirectory}
              />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

export function MountOverview(props: {
  readonly address: Address;
  readonly index: ReadyIndex;
  readonly query: string | undefined;
}) {
  const { t } = useI18n();
  const { address, index, query } = props;
  const [text, setText] = useState(query ?? "");

  const search = (next: string | undefined) =>
    navigate(appHref(mountHref(address, { kind: "overview", query: next })));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    search(trimmed === "" ? undefined : trimmed);
  };

  if (index.skillCount === 0 && index.documentCount === 0 && index.diagnostics.length === 0) {
    return <EmptyState title={t.mount.empty.title}>{t.mount.empty.body}</EmptyState>;
  }

  const limited = (shown: number, total: number) =>
    total > shown && shown >= REST_MOUNT_LIST_LIMIT ? (
      <p className={styles.note}>{t.mount.listLimited(shown, total)}</p>
    ) : null;

  return (
    <div className={styles.stack}>
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
      </search>

      {query !== undefined ? (
        <SearchResults address={address} query={query} />
      ) : (
        <Tabs
          label={t.skill.all}
          tabs={[
            {
              id: "skills",
              label: t.mount.tabs.skills(index.skillCount),
              content:
                index.skills.length === 0 ? (
                  <EmptyState title={t.mount.noSkills.title}>{t.mount.noSkills.body}</EmptyState>
                ) : (
                  <>
                    <ul className={styles.list}>
                      {index.skills.map((skill) => (
                        <SkillItem key={skillKey(skill)} address={address} skill={skill} />
                      ))}
                    </ul>
                    {limited(index.skills.length, index.skillCount)}
                  </>
                ),
            },
            {
              id: "documents",
              label: t.mount.tabs.documents(index.documentCount),
              content:
                index.documents.length === 0 ? (
                  <EmptyState title={t.mount.noDocuments} />
                ) : (
                  <>
                    <ul className={styles.list}>
                      {index.documents.map((document) => (
                        <DocumentItem key={document.path} address={address} document={document} />
                      ))}
                    </ul>
                    {limited(index.documents.length, index.documentCount)}
                  </>
                ),
            },
            ...(index.diagnostics.length === 0
              ? []
              : [
                  {
                    id: "diagnostics",
                    label: t.mount.tabs.diagnostics(index.diagnostics.length),
                    content: (
                      <>
                        <p className={styles.note}>{t.mount.diagnostics.lead}</p>
                        <ul className={styles.diagnostics}>
                          {index.diagnostics.map((diagnostic) => (
                            <li
                              key={`${diagnostic.path} ${diagnostic.code}`}
                              className={styles.diagnostic}
                            >
                              <span className={styles.itemHead}>
                                <code>{diagnostic.path}</code>
                                <Badge tone="danger">{diagnostic.code}</Badge>
                              </span>
                              <span className={styles.diagnosticBody}>{diagnostic.message}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ),
                  },
                ]),
          ]}
        />
      )}
    </div>
  );
}
