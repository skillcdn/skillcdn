import { type Address, formatAddress, type RestFile } from "@skillcdn/core";
import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { useResource } from "../api/use-resource.js";
import { CodeBlock } from "../components/code-block.js";
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

interface LaterPages {
  readonly key: string;
  readonly pages: readonly RestFile[];
  readonly loading: boolean;
  readonly error: ApiError | undefined;
}

/** One text file as `read_file` returns it, a page at a time. */
export function MountFile(props: { readonly address: Address; readonly path: string }) {
  const { t } = useI18n();
  const { address, path } = props;
  const key = `${formatAddress(address)} file ${path}`;
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

  const pages = [first.value, ...more.pages];
  const last = pages.at(-1) ?? first.value;
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
      (page) => setLater({ key, pages: [...more.pages, page], loading: false, error: undefined }),
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
          <div className={styles.toggle}>
            <Button
              size="sm"
              variant={mode === "rendered" ? "secondary" : "ghost"}
              aria-pressed={mode === "rendered"}
              onClick={() => setMode("rendered")}
            >
              {t.file.rendered}
            </Button>
            <Button
              size="sm"
              variant={mode === "source" ? "secondary" : "ghost"}
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              {t.file.source}
            </Button>
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
          {t.file.showing(first.value.offset, last.offset + last.content.length, last.totalLength)}
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
