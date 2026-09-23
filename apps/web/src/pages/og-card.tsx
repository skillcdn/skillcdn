import { BrandSymbol } from "../components/brand.js";
import { useI18n } from "../i18n/index.js";
import { FEATURED_VIDEO } from "../site.js";
import styles from "./og-card.module.css";

// Development-only source for the 1200 x 630 social-preview images in public/og/.
export function OgCard() {
  const { t } = useI18n();
  return (
    <div className={styles.card}>
      <img className={styles.art} src={FEATURED_VIDEO.poster} alt="" />
      <div className={styles.brand}>
        <BrandSymbol />
        <span>{t.meta.siteName}</span>
      </div>
      <p className={styles.title}>
        {t.landing.title}
        <span>{t.landing.titleAccent}</span>
      </p>
      <p className={styles.tagline}>{t.landing.lead}</p>
      <p className={styles.address}>skillcdn.ai</p>
    </div>
  );
}
