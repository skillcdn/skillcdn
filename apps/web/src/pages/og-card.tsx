import { useI18n } from "../i18n/index.js";
import styles from "./og-card.module.css";

// Development only: the source of the social-preview images in public/og/. Open /dev/og (and
// /dev/og?lang=ko) in a 1200x630 window and take a screenshot; README.md has the command.
// Crawlers want a bitmap, so the images are committed rather than made at build time.

/** Where the hosted service lives. A deployment elsewhere replaces the images anyway. */
const SHOWN_HOST = "skillcdn.ai";

export function OgCard() {
  const { t } = useI18n();
  return (
    <div className={styles.card}>
      <div className={styles.brand}>
        <svg viewBox="0 0 32 32" width="56" height="56" aria-hidden="true">
          <path
            d="M10 16h4.5c3.5 0 3-6 7.5-6M14.5 16c3.5 0 3 6 7.5 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="10" cy="16" r="3" fill="currentColor" />
          <circle cx="22.4" cy="10" r="2.5" fill="currentColor" />
          <circle cx="22.4" cy="22" r="2.5" fill="currentColor" />
        </svg>
        <span>{t.meta.siteName}</span>
      </div>
      <p className={styles.title}>{t.landing.title}</p>
      <p className={styles.address}>
        <span className={styles.host}>{SHOWN_HOST}</span>/gh/owner/repo
      </p>
      <p className={styles.tagline}>{t.footer.tagline}</p>
    </div>
  );
}
