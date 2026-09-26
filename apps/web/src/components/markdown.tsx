import type { RestSkill } from "@skillcdn/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import styles from "./markdown.module.css";

// Repository content is untrusted. It is rendered as React elements, never as HTML: raw HTML in
// the source stays text, and links are limited to a few schemes. Pictures are shown (ADR-0030):
// from the web over https, or from the git host for a path of the repository, loaded lazily and
// without a referrer, so that the reader's page is not told to the picture's host.

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^https:\/\//i;
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

/**
 * Where a picture in Markdown is loaded from: its own https URL, or the host's copy of a file of
 * the repository when the page knows where that is. `undefined` for anything else (another
 * scheme, a path that leaves the repository, or a file with no host to load it from), which is
 * then shown as its text.
 */
export function imageUrl(
  source: string | undefined,
  baseDirectory: string,
  hostUrl: ((path: string) => string) | undefined,
): string | undefined {
  if (source === undefined || source === "") return undefined;
  if (SAFE_IMAGE.test(source)) return source;
  if (HAS_SCHEME.test(source) || source.startsWith("//")) return undefined;
  const target = resolveRelativePath(baseDirectory, source);
  return target === undefined || hostUrl === undefined ? undefined : hostUrl(target);
}

export function Markdown(props: {
  readonly source: string;
  /** Directory of the rendered file, relative to the repository root; `""` for the root. */
  readonly baseDirectory: string;
  /** The URL inside the app that shows a file of the same mount. */
  readonly fileHref: (path: string) => string;
  /** Where a picture that is a file of the repository is loaded from: its copy at the git host. */
  readonly imageSrc?: (path: string) => string;
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
          img({ src, alt, title }) {
            const url = imageUrl(
              typeof src === "string" ? src : undefined,
              props.baseDirectory,
              props.imageSrc,
            );
            if (url === undefined) {
              return <span className={styles.image}>{alt ?? ""}</span>;
            }
            // Lazy, so that a picture is fetched only once the reader scrolls to it, and without
            // a referrer, so that its host is not told which page it was read on.
            return (
              <img
                src={url}
                alt={alt ?? ""}
                title={title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            );
          },
        }}
      >
        {props.source}
      </ReactMarkdown>
    </div>
  );
}
