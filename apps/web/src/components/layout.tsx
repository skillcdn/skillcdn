import type { ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { LINKS } from "../site.js";
import { LanguageSwitcher } from "./language-switcher.js";
import styles from "./layout.module.css";

/** The placeholder symbol, inline so that it takes the text color. Same drawing as public/brand/symbol.svg. */
function BrandSymbol() {
  return (
    <svg className={styles.symbol} viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
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
  );
}

export function Layout(props: { readonly children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#content">
        {t.nav.skipToContent}
      </a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link className={styles.brand} href={PATHS.landing} aria-label={t.nav.home}>
            <BrandSymbol />
            <span>{t.meta.siteName}</span>
          </Link>
          <nav className={styles.nav} aria-label={t.nav.main}>
            <Link href={PATHS.explore}>{t.nav.explore}</Link>
            <a href={LINKS.docs}>{t.nav.docs}</a>
            <a href={LINKS.repository}>{t.nav.github}</a>
          </nav>
          <div className={styles.controls}>
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main id="content" className={styles.main}>
        {props.children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <p className={styles.footerBrand}>{t.meta.siteName}</p>
            <p className={styles.footerText}>{t.footer.tagline}</p>
            <p className={styles.footerText}>{t.footer.sourceAvailable}</p>
          </div>
          <ul className={styles.footerLinks}>
            <li>
              <a href={LINKS.docs}>{t.nav.docs}</a>
            </li>
            <li>
              <a href={LINKS.repository}>{t.footer.source}</a>
            </li>
            <li>
              <a href={LINKS.license}>{t.footer.license}</a>
            </li>
            <li>
              <a href={LINKS.trademarks}>{t.footer.trademarks}</a>
            </li>
            <li>
              <a href={LINKS.security}>{t.footer.security}</a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
