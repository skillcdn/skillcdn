import { type ReactNode, useEffect, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { type LegalLinks, LINKS, readLegalLinks } from "../site.js";
import { BrandSymbol } from "./brand.js";
import { ConsentBanner } from "./consent-banner.js";
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
  const links = [
    ...(legal.termsUrl === undefined ? [] : [{ href: legal.termsUrl, label: t.footer.terms }]),
    ...(legal.privacyUrl === undefined
      ? []
      : [{ href: legal.privacyUrl, label: t.footer.privacy }]),
    ...(legal.contactEmail === undefined
      ? []
      : [{ href: `mailto:${legal.contactEmail}`, label: t.footer.report }]),
  ];
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
          {/* The name and the deployment's own pages share one line, at the two ends of the
              page: its terms, its privacy policy and whom to write to, each only where the
              deployment has it. What the site promises sits under them, quietly. */}
          <div className={styles.footerTop}>
            <p className={styles.footerBrand}>
              <BrandSymbol className={styles.symbol} />
              <span>{t.meta.siteName}</span>
            </p>
            {links.length > 0 && (
              <ul className={styles.footerLinks}>
                {links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className={styles.footerNote}>{t.footer.tagline}</p>
        </div>
      </footer>
      <ConsentBanner />
    </div>
  );
}
