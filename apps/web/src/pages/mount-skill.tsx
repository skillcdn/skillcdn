import type { Address, RestSkill } from "@skillcdn/core";
import { useEffect } from "react";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useMorePages } from "../api/use-more-pages.js";
import { useResource } from "../api/use-resource.js";
import { ErrorCallout } from "../components/error-callout.js";
import { Markdown } from "../components/markdown.js";
import { Badge, Button, Callout, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { skillDescription, skillTitle } from "../i18n/repository-text.js";
import { Link } from "../navigation.js";
import { mountHref } from "../router.js";
import styles from "./mount.module.css";
import { contentHref, MountPath, parentDirectory } from "./mount-path.js";

type ReadySkill = Extract<RestSkill, { status: "ready" }>;

/** One skill and its inherited rules, continued until every context page has been loaded. */
export function MountSkill(props: {
  readonly address: Address;
  readonly path: string;
  /** Told what was loaded, or that nothing is, so that the page can say so in its head. */
  readonly onLoaded?: (skill: RestSkill | undefined) => void;
}) {
  const { t, language } = useI18n();
  const { address, path, onLoaded } = props;
  const answer = useResource(
    resourceKeys.skill(address, path),
    (signal) => api.skill(address, path, signal),
    (value) => value.status === "indexing",
  );
  const more = useMorePages<ReadySkill>(async (cursor, signal) => {
    const page = await api.skill(address, path, signal, cursor);
    if (page.status !== "ready")
      throw new ApiError(0, "index.not_ready", "The index is not ready.");
    return page;
  });
  const loaded =
    answer.state === "ready" && answer.value.status === "ready" ? answer.value : undefined;
  useEffect(() => {
    onLoaded?.(loaded);
  }, [onLoaded, loaded]);
  const back = <MountPath address={address} path={parentDirectory(path)} />;

  if (answer.state === "loading" || (answer.state === "ready" && answer.value.status !== "ready")) {
    return (
      <div className={styles.stack}>
        {back}
        <Skeleton lines={8} label={t.common.loading} />
      </div>
    );
  }
  if (answer.state === "error") {
    return (
      <div className={styles.stack}>
        {back}
        <ErrorCallout error={answer.error} onRetry={answer.reload} />
        {answer.error.directories.length > 0 && (
          <ul className={styles.list}>
            {answer.error.directories.map((directory) => (
              <li key={directory}>
                <Link
                  className={styles.item}
                  href={mountHref(address, {
                    kind: "skill",
                    path: directory === "" ? "SKILL.md" : `${directory}/SKILL.md`,
                  })}
                >
                  <span className={styles.itemPath}>{directory}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (answer.value.status !== "ready") {
    return null;
  }

  const pages = [answer.value, ...more.pages];
  const { skill } = answer.value;
  const last = (pages.at(-1) ?? answer.value).skill;
  const body = pages.map((page) => page.skill.body).join("");
  const rules = new Map<string, string>();
  const includedContents = new Map<string, string>();
  for (const page of pages) {
    for (const file of page.skill.includedContents ?? []) {
      if (file.content !== null)
        includedContents.set(file.path, (includedContents.get(file.path) ?? "") + file.content);
    }
    for (const rule of page.skill.ruleChain ?? []) {
      rules.set(rule.path, (rules.get(rule.path) ?? "") + rule.body);
    }
  }
  // Keep the original name visible alongside a translated title.
  const title = skillTitle(skill, language);
  const description = skillDescription(skill, language);
  const translated = title !== skill.name || description !== skill.description;
  const facts: (readonly [string, string])[] = [
    ...(title === skill.name ? [] : [[t.skill.name, skill.name] as const]),
    [t.mount.path, skill.path ?? path],
    ...(skill.license === null ? [] : [[t.skill.license, skill.license] as const]),
    ...(skill.compatibility === null
      ? []
      : [[t.skill.compatibility, skill.compatibility] as const]),
    ...(skill.allowedTools === null ? [] : [[t.skill.allowedTools, skill.allowedTools] as const]),
    ...Object.entries(skill.metadata).map(([key, value]) => [key, value] as const),
  ];

  return (
    <article className={styles.stack}>
      {back}
      <header>
        <p className={styles.kicker}>{t.mount.kinds.skill}</p>
        <h2 className={styles.viewTitle}>{title}</h2>
        <p className={styles.viewLead}>{description}</p>
        {translated && <p className={styles.note}>{t.skill.translationNote}</p>}
      </header>

      <dl className={styles.meta}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.metaRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {skill.warnings.length > 0 && (
        <Callout tone="warning" title={t.skill.warnings}>
          <ul className={styles.bullets}>
            {skill.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      )}

      {[...rules].map(([rulePath, ruleBody]) => (
        <section key={rulePath}>
          <h3 className={styles.subheading}>{t.skill.rules}</h3>
          <p className={styles.note}>{t.skill.rulesSource(rulePath)}</p>
          <div className={styles.document}>
            <Markdown
              source={ruleBody}
              baseDirectory={parentDirectory(rulePath)}
              fileHref={(target) => contentHref(address, target)}
            />
          </div>
        </section>
      ))}

      <div className={styles.document}>
        <Markdown
          source={body}
          baseDirectory={skill.directory}
          references={pages.flatMap((page) => page.skill.references ?? [])}
          fileHref={(target) => contentHref(address, target)}
        />
      </div>

      {[...includedContents].map(([filePath, content]) => (
        <section key={filePath}>
          <h3 className={styles.subheading}>
            <code>{filePath}</code>
          </h3>
          <div className={styles.document}>
            <Markdown
              source={content}
              baseDirectory={parentDirectory(filePath)}
              fileHref={(target) => contentHref(address, target)}
            />
          </div>
        </section>
      ))}
      {last.complete === false && <Callout tone="warning">{t.skill.incomplete}</Callout>}
      {more.error !== undefined && (
        <>
          <ErrorCallout error={more.error} onRetry={() => more.loadMore(last.nextCursor ?? null)} />
          <p>
            <Button
              onClick={() => {
                more.reset();
                answer.reload();
              }}
            >
              {t.common.reload}
            </Button>
          </p>
        </>
      )}
      {last.nextCursor != null && (
        <p>
          <Button onClick={() => more.loadMore(last.nextCursor ?? null)} disabled={more.loading}>
            {more.loading ? t.common.loading : t.skill.moreContext}
          </Button>
        </p>
      )}

      <section>
        <h3 className={styles.subheading}>{t.skill.files}</h3>
        {skill.files.length === 0 ? (
          <p className={styles.note}>{t.skill.noFiles}</p>
        ) : (
          <ul className={styles.files}>
            {skill.files.map((file) => (
              <li key={file}>
                <Link href={contentHref(address, file)}>
                  <code>{file}</code>
                </Link>
                {skill.included.includes(file) && (
                  <>
                    {" "}
                    <Badge tone="accent">{t.skill.included}</Badge>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {skill.filesTruncated && <p className={styles.note}>{t.skill.filesTruncated}</p>}
        <p className={styles.note}>
          <Link
            href={mountHref(address, { kind: "overview", path: skill.directory, query: undefined })}
          >
            {t.skill.browseFiles}
          </Link>
        </p>
      </section>
    </article>
  );
}
