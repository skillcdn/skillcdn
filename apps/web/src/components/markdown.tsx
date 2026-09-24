import type { RestSkill } from "@skillcdn/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import styles from "./markdown.module.css";

// Repository content is untrusted. It is rendered as React elements, never as HTML: raw HTML in
// the source stays text, links are limited to a few schemes, and images are not loaded at all,
// because loading one tells a third party who is reading.

const SAFE_LINK = /^(https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolves a relative link against the directory of the file it is in. `undefined` when it
 * leaves the repository root or is not a plain path. A leading slash starts at the repository.
 */
export function resolveRelativePath(baseDirectory: string, href: string): string | undefined {
  const [path = ""] = href.split(/[?#]/);
  if (path === "" || path.startsWith("//") || path.includes("\\") || HAS_SCHEME.test(path)) {
    return undefined;
  }
  const segments = path.startsWith("/") || baseDirectory === "" ? [] : baseDirectory.split("/");
  for (const encoded of path.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
    if (/[\\/\p{Cc}\p{Cf}]/u.test(segment)) return undefined;
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? undefined : segments.join("/");
}

export function Markdown(props: {
  readonly source: string;
  /** Directory of the rendered file, relative to the repository root; `""` for the root. */
  readonly baseDirectory: string;
  /** The URL inside the app that shows a file of the same mount. */
  readonly fileHref: (path: string) => string;
  readonly references?: Extract<RestSkill, { status: "ready" }>["skill"]["references"];
}) {
  const { t } = useI18n();
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Everything passes through here unchanged; the components below decide what a URL may do.
        urlTransform={(url) => url}
        components={{
          a({ href, children }) {
            if (href === undefined || href === "") {
              return <span>{children}</span>;
            }
            if (href.startsWith("#")) {
              return <a href={href}>{children}</a>;
            }
            if (SAFE_LINK.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
                  {children}
                </a>
              );
            }
            const target = HAS_SCHEME.test(href)
              ? undefined
              : resolveRelativePath(props.baseDirectory, href);
            const reference = props.references?.find(
              (item) => item.href === href && item.path === target,
            );
            if (reference !== undefined && reference.status !== "available") {
              return <span title={t.file.referenceUnavailable}>{children}</span>;
            }
            return target === undefined ? (
              <span>{children}</span>
            ) : (
              <Link href={props.fileHref(target)}>{children}</Link>
            );
          },
          img({ alt }) {
            return (
              <span className={styles.image}>
                {alt === undefined || alt === "" ? "" : `${alt} `}({t.file.imageOmitted})
              </span>
            );
          },
        }}
      >
        {props.source}
      </ReactMarkdown>
    </div>
  );
}
