import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../i18n/index.js";
import { TypedText } from "./connect-animation.js";
import styles from "./connect-preview.module.css";

/** Keep selected text stable even while the surrounding illustration repeats. */
export function PreviewCopy({
  text,
  appearance = "command",
  animated = true,
}: {
  readonly text: string;
  readonly appearance?: "command" | "code" | "field" | "url" | "text";
  readonly animated?: boolean;
}) {
  const { t } = useI18n();
  const code = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<"idle" | "selected" | "copied">("idle");
  useEffect(() => {
    if (!revealed) return;
    const resume = () => {
      const element = code.current;
      if (element === null || element.closest("button") === document.activeElement) return;
      const selection = window.getSelection();
      if (selection !== null && !selection.isCollapsed && selection.containsNode(element, true))
        return;
      setRevealed(false);
      setStatus("idle");
    };
    document.addEventListener("selectionchange", resume);
    document.addEventListener("focusout", resume);
    return () => {
      document.removeEventListener("selectionchange", resume);
      document.removeEventListener("focusout", resume);
    };
  }, [revealed]);
  const compact = appearance === "field" || appearance === "url" || appearance === "text";
  const Content = appearance === "field" || appearance === "text" ? "span" : "code";
  const variant =
    appearance === "field"
      ? styles.input
      : appearance === "url"
        ? styles.inputHighlight
        : appearance === "text"
          ? styles.copyText
          : appearance === "code"
            ? styles.editorCode
            : styles.command;

  const copy = () => {
    // Commit the complete text before selecting it, including programmatic activation.
    flushSync(() => setRevealed(true));
    if (code.current !== null) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setStatus("selected");
    // Selection remains usable for manual copy if clipboard access is unavailable.
    navigator.clipboard?.writeText(text).then(
      () => setStatus("copied"),
      () => setStatus("selected"),
    );
  };

  return (
    <button
      type="button"
      className={`${styles.copyable} ${variant}`}
      aria-label={`${t.common.copy}: ${text}`}
      title={t.connect.preview.copyHint}
      data-copied={status === "copied"}
      onPointerDown={() => setRevealed(true)}
      onFocus={() => setRevealed(true)}
      onClick={copy}
    >
      {appearance === "command" && (
        <span className={styles.prompt} aria-hidden="true">
          ›
        </span>
      )}
      <span className={styles.copyBody}>
        <Content ref={code}>{revealed || !animated ? text : <TypedText text={text} />}</Content>
        <span className={compact ? "visually-hidden" : styles.copyHint} aria-live="polite">
          {status === "copied"
            ? t.common.copied
            : status === "selected"
              ? t.connect.preview.copySelected
              : t.connect.preview.copyHint}
        </span>
      </span>
      {compact && status === "copied" && (
        <span className={styles.copyBadge} aria-hidden="true">
          {t.common.copied}
        </span>
      )}
    </button>
  );
}
