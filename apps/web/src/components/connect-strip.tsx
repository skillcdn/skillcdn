import { type Address, formatAddress } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { appHref } from "../navigation.js";
import { mountHref } from "../router.js";
import { CopyButton } from "./code-block.js";
import styles from "./connect-strip.module.css";

/** The anchor of the connection guide's title, on the page of the address. */
const GUIDE_ANCHOR = "connect-title";

/** Two links of a chain: what an address that connects something looks like. */
function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.9" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13 19.1" />
    </svg>
  );
}

/**
 * The address to connect with, under the name on every page of it: the address itself in a
 * field with its copy button, and one line under it saying what connecting it gives and where
 * the steps are. On the page of the address the guide is further down the same page; on a
 * folder, a skill or a file of it, it is on that page. A plain anchor either way, so that the
 * browser lands on the guide itself and not at the top of the page it is on.
 */
export function ConnectStrip(props: {
  readonly origin: string;
  readonly address: Address;
  /** What the page shows: the line names the skills, or the one skill, the address is for. */
  readonly kind: "root" | "skill" | "folder";
}) {
  const { t } = useI18n();
  const url = `${props.origin}${formatAddress(props.address)}`;
  const guide =
    props.kind === "root"
      ? `#${GUIDE_ANCHOR}`
      : appHref(`${mountHref(props.address)}#${GUIDE_ANCHOR}`);
  return (
    <div className={styles.strip}>
      <div className={styles.field}>
        <span className={styles.mark}>
          <LinkIcon />
        </span>
        <code className={styles.address}>{url}</code>
        <CopyButton
          text={url}
          label={t.common.copy}
          variant="secondary"
          size="sm"
          className={styles.copy}
        />
      </div>
      <p className={styles.lead}>
        {props.kind === "skill" ? t.mount.use.this : t.mount.use.these}{" "}
        <a className={styles.guide} href={guide}>
          {t.mount.use.guide}
          <span aria-hidden="true"> →</span>
        </a>
      </p>
    </div>
  );
}
