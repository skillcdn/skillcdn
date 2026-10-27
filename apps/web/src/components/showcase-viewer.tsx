import type { RestShowcaseEntry } from "@skillcdn/core";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";
import type { Language } from "../i18n/languages.js";
import { showcaseTexts } from "../showcase.js";
import styles from "./showcase-viewer.module.css";
import { cx, ExternalIcon } from "./ui.js";

// A showcase entry's result, shown over the page it was on (ADR-0028): a picture as itself, a
// document as the browser draws one. The page stays where it was, behind a veil; a press beside
// the result, Escape, the close button and the browser's own back all close it, since opening
// it is a step in history, the one way a phone's back button can close anything.

/** What the viewer can show in place. */
export type Viewable = "picture" | "document" | "clip";

/** The mark of the viewer's step in history, so that going back closes it and nothing else. */
const HISTORY_KEY = "skillcdn:showcase";

/**
 * Whether an entry's result can be shown over the page, by the type the deployment knows it by:
 * an upload of its own, or a file of the build. A result elsewhere is a page, and opens as one.
 */
export function viewable(entry: RestShowcaseEntry): Viewable | undefined {
  const type = entry.link === undefined || entry.link === null ? null : (entry.linkType ?? null);
  if (type === null) return undefined;
  if (type.startsWith("image/")) return "picture";
  if (type.startsWith("video/")) return "clip";
  if (type === "application/pdf") return "document";
  return undefined;
}

/**
 * Whether the result is shown here rather than opened: a picture or a clip always; a document only where
 * the browser can draw the whole of it in a frame, which a touch screen's browser does not (it
 * shows the first page and stops), so there the document opens in a tab of its own.
 */
export function shownInPlace(kind: Viewable): boolean {
  return kind !== "document" || window.matchMedia("(pointer: fine)").matches;
}

function marked(state: unknown): boolean {
  return typeof state === "object" && state !== null && HISTORY_KEY in state;
}

export function ShowcaseViewer(props: {
  readonly entry: RestShowcaseEntry;
  readonly kind: Viewable;
  readonly language: Language;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const copy = t.landing.showcase.viewer;
  const texts = showcaseTexts(props.entry, props.language);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [loaded, setLoaded] = useState(false);
  const done = useRef(false);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const link = props.entry.link ?? "";

  // Shown as a modal, which a dialog only is when a script opens it: the browser then keeps the
  // focus inside, closes it on Escape, and gives the focus back to what opened it. Opening it
  // is a step in history, which going back takes away, along with the viewer.
  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: true }, "");
    if (!node.open) node.showModal();
    const popped = () => {
      if (done.current) return;
      done.current = true;
      if (node.open) node.close();
      close.current();
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, []);

  // Closed from inside (Escape, the button, a press beside it): the step in history goes too,
  // and its going is what ends the viewer; without one, the viewer ends here.
  const closed = () => {
    if (done.current) return;
    if (marked(window.history.state)) {
      window.history.back();
    } else {
      done.current = true;
      close.current();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a press beside the result closes it, as Escape does by itself
    <dialog
      ref={dialog}
      className={cx(styles.dialog, props.kind === "clip" && styles.tall)}
      aria-labelledby={title}
      onClose={closed}
      onClick={(event) => {
        // The dialog is filled by its frame, so a press on the dialog itself is one beside it.
        if (event.target === event.currentTarget) {
          event.currentTarget.close();
        }
      }}
    >
      <div className={styles.frame}>
        <div className={styles.bar}>
          <p id={title} className={styles.title}>
            {texts.title}
          </p>
          {/* First among the controls, so that the viewer opens with the focus on the way out. */}
          <button
            type="button"
            className={styles.close}
            aria-label={copy.close}
            onClick={() => dialog.current?.close()}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
          <a className={styles.open} href={link} target="_blank" rel="noopener noreferrer">
            {copy.open}
            <ExternalIcon />
          </a>
        </div>
        <div className={cx(styles.stage, props.kind === "document" && styles.document)}>
          {props.kind === "picture" ? (
            <>
              {/* The poster stands while the picture loads, and under it after. */}
              <img
                className={styles.poster}
                src={props.entry.media.poster.url}
                alt=""
                width={props.entry.width}
                height={props.entry.height}
              />
              <img
                className={cx(styles.picture, loaded && styles.loaded)}
                src={link}
                alt={texts.clip ?? texts.title}
                onLoad={() => setLoaded(true)}
              />
            </>
          ) : props.kind === "clip" ? (
            // biome-ignore lint/a11y/useMediaCaption: nothing is said in the clip; the card's words describe it
            <video
              className={styles.clip}
              src={link}
              poster={props.entry.media.poster.url}
              controls
              autoPlay
              playsInline
              aria-label={texts.clip ?? texts.title}
            />
          ) : (
            <iframe className={styles.frameOf} src={link} title={texts.title} />
          )}
        </div>
      </div>
    </dialog>
  );
}
