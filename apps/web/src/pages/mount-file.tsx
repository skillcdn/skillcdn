import { type Address, outlineMarkdown, type RestFile, type RestMount } from "@skillcdn/core";
import { useEffect, useState } from "react";
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
import { hostRawUrl } from "./host-links.js";
import styles from "./mount.module.css";
import { contentHref, MountPath, parentDirectory } from "./mount-path.js";

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

/** A directory as `read_repo_file` lists it: what it contains, subdirectories first. */
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
            <Link
              href={
                entry.kind === "directory"
                  ? mountHref(address, { kind: "overview", path: entry.path, query: undefined })
                  : contentHref(address, entry.path)
              }
            >
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

/**
 * One text file as `read_repo_file` returns it, a page at a time. Opened at a section (ADR-0063),
 * the pages up to it are loaded and the heading that starts it is scrolled to.
 */
export function MountFile(props: {
  readonly address: Address;
  readonly mount: RestMount;
  readonly path: string;
  /** The character offset of the section to open at, as a search result named it. */
  readonly section?: number | undefined;
}) {
  const { t } = useI18n();
  const { address, mount, path } = props;
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

  const filePages: readonly FilePage[] =
    first.state === "ready" && first.value.kind === "file" ? [first.value, ...more.pages] : [];
  const lastPage = filePages.at(-1);
  const loadNext = () => {
    if (lastPage === undefined || lastPage.nextOffset === null || more.loading) {
      return;
    }
    const offset = lastPage.nextOffset;
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

  // The section is named by where it starts in the file; the heading there is found by its place
  // among the headings, which is how the rendered headings are named (`section-<n>`). The pages
  // up to the offset are loaded first, since a section may be past the first.
  const wanted = props.section;
  const loaded = lastPage === undefined ? 0 : lastPage.offset + lastPage.content.length;
  const needsMore =
    wanted !== undefined &&
    lastPage !== undefined &&
    lastPage.nextOffset !== null &&
    lastPage.nextOffset <= wanted;
  const headingAt =
    wanted === undefined || lastPage === undefined || (wanted >= loaded && needsMore)
      ? -1
      : outlineMarkdown(filePages.map((page) => page.content).join("")).headings.findIndex(
          (heading) => heading.offset === wanted,
        );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pages loaded so far are the trigger
  useEffect(() => {
    if (needsMore) loadNext();
  }, [needsMore, filePages.length]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the heading, once known, is the trigger
  useEffect(() => {
    if (headingAt >= 0 && mode === "rendered") {
      document.getElementById(`section-${headingAt}`)?.scrollIntoView({ block: "start" });
    }
  }, [headingAt, mode, path]);

  const back = <MountPath address={address} path={parentDirectory(path)} />;

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
            under={2}
            anchors="ordinal"
            references={pages.flatMap((page) => page.references ?? [])}
            fileHref={(target) => contentHref(address, target)}
            imageSrc={(target) => hostRawUrl(mount, target)}
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
      {more.error !== undefined && <ErrorCallout error={more.error} onRetry={loadNext} />}
      {last.nextOffset !== null && (
        <p>
          <Button onClick={loadNext} disabled={more.loading}>
            {more.loading ? t.common.loading : t.file.more}
          </Button>
        </p>
      )}
    </article>
  );
}
