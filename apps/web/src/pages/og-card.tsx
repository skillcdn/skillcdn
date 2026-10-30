import { BrandLogo } from "../components/brand.js";
import { useI18n } from "../i18n/index.js";
import { DEFAULT_SHOWCASE_MEDIA, localizedPath } from "../site.js";
import styles from "./og-card.module.css";

// Development-only source for the 1200 x 630 social-preview images in public/og/. It shows the
// first result of the build's own showcase; an operator's entry can bring its own picture for
// link previews.
export function OgCard() {
  const { t, language } = useI18n();
  return (
    <div className={styles.card}>
      <img
        className={styles.art}
        src={localizedPath(DEFAULT_SHOWCASE_MEDIA.entries.cards.poster, language)}
        alt=""
      />
      <BrandLogo className={styles.brand} />
      <p className={styles.title}>
        {t.landing.title}
        <span>{t.landing.titleAccent}</span>
      </p>
      <p className={styles.tagline}>{t.landing.eyebrow}</p>
      <p className={styles.address}>skillcdn.ai</p>
    </div>
  );
}
