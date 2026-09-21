import { useEffect, useState } from "react";
import { useI18n } from "../i18n/index.js";
import styles from "./code-block.module.css";
import { Button } from "./ui.js";

const COPIED_FOR_MS = 1600;

export function CopyButton(props: { readonly text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        // Without a secure context there is no clipboard; the text stays selectable.
        navigator.clipboard?.writeText(props.text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      <span aria-live="polite">{copied ? t.common.copied : t.common.copy}</span>
    </Button>
  );
}

/** A block of text to read or copy as it is: a URL, a command, a config, a file. */
export function CodeBlock(props: {
  readonly code: string;
  readonly label?: string;
  readonly copy?: boolean;
  readonly wrap?: boolean;
}) {
  return (
    <figure className={styles.block}>
      {(props.label !== undefined || props.copy === true) && (
        <figcaption className={styles.bar}>
          <span className={styles.label}>{props.label}</span>
          {props.copy === true && <CopyButton text={props.code} />}
        </figcaption>
      )}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard */}
      <pre className={props.wrap === true ? styles.wrapped : styles.pre} tabIndex={0}>
        <code>{props.code}</code>
      </pre>
    </figure>
  );
}
