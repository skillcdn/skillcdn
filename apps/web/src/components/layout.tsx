import { type ReactNode, useEffect, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { type LegalLinks, LINKS, readLegalLinks } from "../site.js";
import { BrandSymbol } from "./brand.js";
import { LanguageSwitcher } from "./language-switcher.js";
import styles from "./layout.module.css";

export function Layout(props: { readonly children: ReactNode }) {
  const { t } = useI18n();
  // The deployment's own pages are written into the head by the server, so they are read once
  // the page is up: prerendered markup has none, and the first render must match it.
  const [legal, setLegal] = useState<LegalLinks>({});
  useEffect(() => {
    setLegal(readLegalLinks());
  }, []);
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
          {/* The name and the links share one line, at the two ends of the page; what the site
              promises sits under them, quietly. */}
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
              {legal.termsUrl !== undefined && (
                <li>
                  <a href={legal.termsUrl}>{t.footer.terms}</a>
                </li>
              )}
              {legal.privacyUrl !== undefined && (
                <li>
                  <a href={legal.privacyUrl}>{t.footer.privacy}</a>
                </li>
              )}
              {legal.contactEmail !== undefined && (
                <li>
                  <a href={`mailto:${legal.contactEmail}`}>{t.footer.report}</a>
                </li>
              )}
            </ul>
          </div>
          <p className={styles.footerNote}>{t.footer.tagline}</p>
        </div>
      </footer>
    </div>
  );
}
