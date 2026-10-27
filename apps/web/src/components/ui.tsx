import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import styles from "./ui.module.css";

// Small building blocks. Each one is a class in ui.module.css and nothing more.

export function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly variant?: "primary" | "secondary" | "ghost";
    readonly size?: "md" | "sm";
  },
) {
  const { variant = "secondary", size = "md", className, type = "button", ...rest } = props;
  return (
    <button
      {...rest}
      type={type}
      className={cx(styles.button, styles[variant], size === "sm" && styles.small, className)}
    />
  );
}

export function Badge(props: {
  readonly tone?: "neutral" | "point" | "success" | "warning" | "danger";
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cx(styles.badge, styles[`tone-${props.tone ?? "neutral"}`])}
      title={props.title}
    >
      {/* A warning carries a mark, so that it is told from a count by its shape and not only
          by its colour. */}
      {props.tone === "warning" && (
        <svg
          viewBox="0 0 24 24"
          width="1em"
          height="1em"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3.5 2.5 20h19z" />
          <path d="M12 10v4.5M12 17.3h.01" />
        </svg>
      )}
      {props.children}
    </span>
  );
}

export function Callout(props: {
  readonly tone?: "info" | "warning" | "danger";
  readonly title?: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  const tone = props.tone ?? "info";
  return (
    <div
      className={cx(styles.callout, styles[`callout-${tone}`])}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div>
        {props.title !== undefined && <p className={styles.calloutTitle}>{props.title}</p>}
        {props.children !== undefined && <div className={styles.calloutBody}>{props.children}</div>}
      </div>
      {props.action}
    </div>
  );
}

/**
 * A picture loaded from elsewhere (ADR-0030, ADR-0031): lazily unless it is above the fold,
 * without a referrer, decorative next to the words that name what it shows, and gone as a
 * whole, frame included, when it cannot be loaded.
 */
export function Picture(props: {
  readonly src: string;
  readonly className?: string;
  readonly eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return null;
  }
  return (
    <div className={props.className}>
      <img
        src={props.src}
        alt=""
        loading={props.eager === true ? undefined : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/**
 * The owner's picture as the git host serves it (ADR-0031): a rounded square, so that a logo
 * keeps its corners and a face its frame, next to the name it belongs to.
 */
export function Avatar(props: {
  readonly src: string;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
  readonly eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // An owner with no picture anywhere, such as the one of a pack served from a directory of the
  // deployment, is given as an empty source.
  if (failed || props.src === "") {
    return null;
  }
  return (
    <img
      className={cx(styles.avatar, styles[`avatar-${props.size ?? "md"}`], props.className)}
      src={props.src}
      alt=""
      loading={props.eager === true ? undefined : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** A check in a filled circle, in the accent: what vouched-for content is marked with. */
export function VerifiedMark(props: { readonly label: string; readonly hint?: string }) {
  return (
    <span
      className={styles.verified}
      role="img"
      aria-label={props.label}
      title={props.hint ?? props.label}
    >
      <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path
          d="m7.5 12.5 3 3 6-6.5"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** An arrow to the right: what a link to a page of this site carries at its end. */
export function ArrowIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

/** An arrow up and out: what a link that leaves for a result, or another site, carries. */
export function ExternalIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

/** Arrows to two corners: what a result that opens over the page, larger, carries. */
export function ExpandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

/** A magnifier: the mark of a search box. */
export function SearchIcon(props: { readonly size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function Spinner(props: { readonly label: string }) {
  return (
    <span className={styles.spinner} role="status">
      <span className={styles.spinnerRing} aria-hidden="true" />
      <span className="visually-hidden">{props.label}</span>
    </span>
  );
}

/** Grey bars in place of content that is on its way. */
export function Skeleton(props: { readonly lines?: number; readonly label: string }) {
  return (
    <div className={styles.skeleton} role="status">
      <span className="visually-hidden">{props.label}</span>
      {Array.from({ length: props.lines ?? 3 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders in a fixed order
        <span key={index} className={styles.skeletonLine} aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyState(props: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{props.title}</p>
      {props.children !== undefined && <p className={styles.emptyBody}>{props.children}</p>}
    </div>
  );
}

export function Section(props: {
  readonly id?: string;
  readonly title: string;
  readonly lead?: string;
  readonly subtle?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={props.id}
      className={cx(styles.section, props.subtle === true && styles.sectionSubtle)}
    >
      <div className={styles.container}>
        <h2 className={styles.sectionTitle}>{props.title}</h2>
        {props.lead !== undefined && <p className={styles.sectionLead}>{props.lead}</p>}
        {props.children}
      </div>
    </section>
  );
}

export function Container(props: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={cx(styles.container, props.className)}>{props.children}</div>;
}
