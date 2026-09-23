import styles from "./client-icon.module.css";
import { CLIENT_DETAILS, type ConnectClient } from "./connect-clients.js";

/** Bundled, decorative marks: the adjacent app name is the accessible label. */
export function ClientIcon({ client }: { readonly client: ConnectClient }) {
  const icon = CLIENT_DETAILS[client].icon;
  return (
    <span className={styles.icon} data-brand={icon ?? "other"} aria-hidden="true">
      {icon === undefined ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          focusable="false"
          aria-hidden="true"
        >
          <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4" />
        </svg>
      ) : (
        <img src={`/clients/${icon}.svg`} alt="" width="28" height="28" />
      )}
    </span>
  );
}
