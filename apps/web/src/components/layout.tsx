import type { ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { LINKS } from "../site.js";
import { BrandSymbol } from "./brand.js";
import { LanguageSwitcher } from "./language-switcher.js";
import styles from "./layout.module.css";

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
            <BrandSymbol className={styles.symbol} />
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
          {/* The name and the links share one line, at the two ends of the page; what the site is
              and what it is licensed under sits under them, quietly. */}
          <div className={styles.footerTop}>
            <p className={styles.footerBrand}>
              <BrandSymbol className={styles.symbol} />
              <span>{t.meta.siteName}</span>
            </p>
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
          <p className={styles.footerNote}>
            <span>{t.footer.tagline}</span>
            <span>{t.footer.sourceAvailable}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
