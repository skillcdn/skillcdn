import type { Address, RestFile } from "@skillcdn/core";
import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { CodeBlock } from "../components/code-block.js";
import controls from "../components/controls.module.css";
import { ErrorCallout } from "../components/error-callout.js";
import { Markdown } from "../components/markdown.js";
import { Button, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { mountHref } from "../router.js";
import styles from "./mount.module.css";

const MARKDOWN_FILE = /\.(md|markdown)$/i;
/** YAML front-matter at the top of a file. It is shown as it is, not rendered as Markdown. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

type FilePage = Extract<RestFile, { kind: "file" }>;
type DirectoryListing = Extract<RestFile, { kind: "directory" }>;

interface LaterPages {
  readonly key: string;
  readonly pages: readonly FilePage[];
  readonly loading: boolean;
  readonly error: ApiError | undefined;
}

/** A directory as `read_file` lists it: what it contains, subdirectories first. */
function DirectoryView(props: { readonly address: Address; readonly listing: DirectoryListing }) {
  const { t } = useI18n();
  const { address, listing } = props;
  return (
    <section>
      <header className={styles.fileHeader}>
        <h2 className={styles.filePath}>
          <span className={styles.kicker}>{t.file.directory}</span>{" "}
          <code>{listing.path === "" ? t.skill.root : `${listing.path}/`}</code>
        </h2>
      </header>
      <ul className={styles.files}>
        {listing.entries.map((entry) => (
          <li key={entry.path} className={styles.entry}>
            <Link href={mountHref(address, { kind: "file", path: entry.path })}>
              <code>{entry.kind === "directory" ? `${entry.path}/` : entry.path}</code>
            </Link>
            {entry.size !== null && (
              <span className={styles.entrySize}>{t.file.bytes(entry.size)}</span>
            )}
          </li>
        ))}
      </ul>
      {listing.truncated && <p className={styles.note}>{t.file.directoryTruncated}</p>}
    </section>
  );
}

/** One text file as `read_file` returns it, a page at a time. */
export function MountFile(props: { readonly address: Address; readonly path: string }) {
  const { t } = useI18n();
  const { address, path } = props;
  const key = resourceKeys.file(address, path);
  const first = useResource(key, (signal) => api.file(address, path, 0, signal));
  const [later, setLater] = useState<LaterPages>({
    key,
    pages: [],
    loading: false,
    error: undefined,
  });
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  // Pages loaded for another file are not this file's.
  const more = later.key === key ? later : { key, pages: [], loading: false, error: undefined };

  const back = (
    <p>
      <Link className={styles.back} href={mountHref(address)}>
        ← {t.skill.all}
      </Link>
    </p>
  );

  if (first.state === "loading") {
    return (
      <div className={styles.stack}>
        {back}
        <Skeleton lines={8} label={t.common.loading} />
      </div>
    );
  }
  if (first.state === "error") {
    return (
      <div className={styles.stack}>
        {back}
        <ErrorCallout error={first.error} onRetry={first.reload} />
      </div>
    );
  }

  const answer = first.value;
  if (answer.kind === "directory") {
    return (
      <article className={styles.stack}>
        {back}
        <DirectoryView address={address} listing={answer} />
      </article>
    );
  }

  const pages = [answer, ...more.pages];
  const last = pages.at(-1) ?? answer;
  const content = pages.map((page) => page.content).join("");
  const isMarkdown = MARKDOWN_FILE.test(path);
  const frontMatter = isMarkdown ? FRONT_MATTER.exec(content)?.[0] : undefined;
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  const loadMore = () => {
    if (last.nextOffset === null || more.loading) {
      return;
    }
    const offset = last.nextOffset;
    setLater({ ...more, loading: true, error: undefined });
    api.file(address, path, offset, new AbortController().signal).then(
      (page) =>
        setLater(
          page.kind === "file"
            ? { key, pages: [...more.pages, page], loading: false, error: undefined }
            : {
                ...more,
                loading: false,
                error: new ApiError(0, "invalid_response", "The server answered unexpectedly."),
              },
        ),
      (error: unknown) =>
        setLater({
          ...more,
          loading: false,
          error:
            error instanceof ApiError ? error : new ApiError(0, "unknown", "Unexpected failure."),
        }),
    );
  };

  return (
    <article className={styles.stack}>
      {back}
      <header className={styles.fileHeader}>
        <h2 className={styles.filePath}>
          <code>{path}</code>
        </h2>
        {isMarkdown && (
          <div className={controls.segmented}>
            <button
              type="button"
              className={mode === "rendered" ? controls.activeSegment : controls.segment}
              aria-pressed={mode === "rendered"}
              onClick={() => setMode("rendered")}
            >
              {t.file.rendered}
            </button>
            <button
              type="button"
              className={mode === "source" ? controls.activeSegment : controls.segment}
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              {t.file.source}
            </button>
          </div>
        )}
      </header>

      {isMarkdown && mode === "rendered" ? (
        <div className={styles.document}>
          {frontMatter !== undefined && <CodeBlock code={frontMatter.trimEnd()} />}
          <Markdown
            source={frontMatter === undefined ? content : content.slice(frontMatter.length)}
            baseDirectory={directory}
            fileHref={(target) => mountHref(address, { kind: "file", path: target })}
          />
        </div>
      ) : (
        <CodeBlock code={content} copy />
      )}

      {(last.nextOffset !== null || pages.length > 1) && (
        <p className={styles.note}>
          {t.file.showing(answer.offset, last.offset + last.content.length, last.totalLength)}
        </p>
      )}
      {more.error !== undefined && <ErrorCallout error={more.error} onRetry={loadMore} />}
      {last.nextOffset !== null && (
        <p>
          <Button onClick={loadMore} disabled={more.loading}>
            {more.loading ? t.common.loading : t.file.more}
          </Button>
        </p>
      )}
    </article>
  );
}
