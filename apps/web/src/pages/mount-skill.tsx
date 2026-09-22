import type { Address, RestSkill } from "@skillcdn/core";
import { useEffect } from "react";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { ErrorCallout } from "../components/error-callout.js";
import { Markdown } from "../components/markdown.js";
import { Callout, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { mountHref } from "../router.js";
import styles from "./mount.module.css";

/** The directory of a file of the mount; the root when the file is not in the mount. */
function directoryOf(path: string | null): string {
  const slash = path?.lastIndexOf("/") ?? -1;
  return path === null || slash < 0 ? "" : path.slice(0, slash);
}

/** One skill as `get` returns it: front-matter, instructions and the files next to it. */
export function MountSkill(props: {
  readonly address: Address;
  readonly name: string;
  /** Told what was loaded, or that nothing is, so that the page can say so in its head. */
  readonly onLoaded?: (skill: RestSkill | undefined) => void;
}) {
  const { t } = useI18n();
  const { address, name, onLoaded } = props;
  const answer = useResource(
    resourceKeys.skill(address, name),
    (signal) => api.skill(address, name, signal),
    (value) => value.status === "indexing",
  );
  const loaded =
    answer.state === "ready" && answer.value.status === "ready" ? answer.value : undefined;
  useEffect(() => {
    onLoaded?.(loaded);
  }, [onLoaded, loaded]);
  const back = (
    <p>
      <Link className={styles.back} href={mountHref(address)}>
        ← {t.skill.all}
      </Link>
    </p>
  );

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
                  href={mountHref(address, { kind: "skill", name: directory })}
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

  const { skill } = answer.value;
  const facts: (readonly [string, string])[] = [
    [t.skill.directory, skill.directory === "" ? t.skill.root : skill.directory],
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
        <h2 className={styles.viewTitle}>{skill.name}</h2>
        <p className={styles.viewLead}>{skill.description}</p>
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

      {skill.rules !== null && (
        <section>
          <h3 className={styles.subheading}>{t.skill.rules}</h3>
          <p className={styles.note}>
            {skill.rules.path === null ? t.skill.rulesAbove : t.skill.rulesSource(skill.rules.path)}
          </p>
          <div className={styles.document}>
            <Markdown
              source={skill.rules.body}
              baseDirectory={directoryOf(skill.rules.path)}
              fileHref={(path) => mountHref(address, { kind: "file", path })}
            />
          </div>
          {skill.rules.truncated && <p className={styles.note}>{t.skill.rulesTruncated}</p>}
        </section>
      )}

      <div className={styles.document}>
        <Markdown
          source={skill.body}
          baseDirectory={skill.directory}
          fileHref={(path) => mountHref(address, { kind: "file", path })}
        />
      </div>

      <section>
        <h3 className={styles.subheading}>{t.skill.files}</h3>
        {skill.files.length === 0 ? (
          <p className={styles.note}>{t.skill.noFiles}</p>
        ) : (
          <ul className={styles.files}>
            {skill.files.map((file) => (
              <li key={file}>
                <Link href={mountHref(address, { kind: "file", path: file })}>
                  <code>{file}</code>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {skill.filesTruncated && <p className={styles.note}>{t.skill.filesTruncated}</p>}
      </section>
    </article>
  );
}
