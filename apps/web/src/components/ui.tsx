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
  if (failed) {
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
