import { DOCS_CONTENT } from "virtual:skillcdn-docs-content";
import { Markdown } from "../components/markdown.js";
import { Container } from "../components/ui.js";
import { DOCS_SECTIONS, docsNeighbours, docsPage, docsSectionLabel } from "../docs/catalog.js";
import type { DocsPage as DocsEntry } from "../docs/types.js";
import { useI18n } from "../i18n/index.js";
import { DEFAULT_LANGUAGE, LANGUAGE_INFO } from "../i18n/languages.js";
import { Link } from "../navigation.js";
import { docsHref, PATHS } from "../router.js";
import { REPOSITORY_URL } from "../site.js";
import styles from "./docs.module.css";
import { NotFoundPage } from "./simple.js";

export interface DocsPageProps {
  readonly origin: string;
  /** The page, or the index when there is none. */
  readonly slug: string | undefined;
}

/**
 * The documentation (ADR-0049): the repository's own Markdown, read when the pages were built
 * and rendered here with the list of pages beside it and, on a wide enough screen, the outline
 * of the page on the other side. The pages are written in English; the frame around them is in
 * the visitor's language.
 */
export function DocsPage(props: DocsPageProps) {
  const { t, language } = useI18n();
  const page = props.slug === undefined ? undefined : docsPage(props.slug);
  if (props.slug !== undefined && page === undefined) {
    return <NotFoundPage />;
  }
  const contentLanguage = LANGUAGE_INFO[DEFAULT_LANGUAGE].htmlLang;
  return (
    <Container className={styles.page}>
      <div className={styles.layout}>
        {/* The same list twice: open beside the page where there is room, and folded above it
            where there is not. One of the two is always hidden. */}
        <aside className={styles.sidebar}>
          <DocsNav current={props.slug} />
        </aside>
        <details className={styles.drawer}>
          <summary className={styles.drawerSummary}>{t.docs.allPages}</summary>
          <DocsNav current={props.slug} />
        </details>
        {page === undefined ? (
          <div className={styles.article}>
            <DocsIndex />
          </div>
        ) : (
          <article
            className={styles.article}
            lang={language === DEFAULT_LANGUAGE ? undefined : contentLanguage}
          >
            <DocsArticle page={page} />
          </article>
        )}
        {page !== undefined && page.headings.length > 0 && (
          <aside className={styles.toc}>
            <nav aria-label={t.docs.onThisPage}>
              <p className={styles.tocTitle}>{t.docs.onThisPage}</p>
              <ol className={styles.tocList}>
                {page.headings.map((heading) => (
                  <li key={heading.id} className={heading.level === 3 ? styles.tocDeep : undefined}>
                    <a href={`#${heading.id}`}>{heading.text}</a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        )}
      </div>
    </Container>
  );
}

function DocsNav(props: { readonly current: string | undefined }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.docs.navLabel}>
      <Link
        href={PATHS.docs}
        className={styles.navHome}
        aria-current={props.current === undefined ? "page" : undefined}
      >
        {t.docs.title}
      </Link>
      {DOCS_SECTIONS.map((section) => (
        <div key={section.id} className={styles.navSection}>
          <p className={styles.navTitle}>{docsSectionLabel(t, section.id)}</p>
          <ul className={styles.navList}>
            {section.pages.map((page) => (
              <li key={page.slug}>
                <Link
                  href={docsHref(page.slug)}
                  aria-current={page.slug === props.current ? "page" : undefined}
                >
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The index: every section with its pages and what each is about. */
function DocsIndex() {
  const { t } = useI18n();
  return (
    <>
      <h1 className={styles.title}>{t.docs.title}</h1>
      <p className={styles.lead}>{t.docs.lead}</p>
      {DOCS_SECTIONS.map((section) => (
        <section key={section.id} className={styles.indexSection}>
          <h2 className={styles.indexTitle}>{docsSectionLabel(t, section.id)}</h2>
          <ul className={styles.indexList}>
            {section.pages.map((page) => (
              <li key={page.slug}>
                <Link href={docsHref(page.slug)}>{page.title}</Link>
                <p lang={LANGUAGE_INFO[DEFAULT_LANGUAGE].htmlLang}>{page.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function DocsArticle(props: { readonly page: DocsEntry }) {
  const { t, language } = useI18n();
  const { page } = props;
  const text = DOCS_CONTENT[page.slug];
  const { previous, next } = docsNeighbours(page.slug);
  return (
    <>
      <p className={styles.kicker}>{docsSectionLabel(t, page.section)}</p>
      <h1 className={styles.title}>{page.title}</h1>
      {language !== DEFAULT_LANGUAGE && <p className={styles.note}>{t.docs.inEnglish}</p>}
      <div className={styles.body}>
        <Markdown
          source={text?.body ?? ""}
          baseDirectory=""
          under={1}
          own
          fileHref={(path) => `/${path}`}
        />
      </div>
      <footer className={styles.articleFooter}>
        <p className={styles.sourceLinks}>
          <a href={`${REPOSITORY_URL}/edit/main/${page.file}`}>{t.docs.edit}</a>
          <a href={`${docsHref(page.slug)}.md`}>{t.docs.source}</a>
        </p>
        {(previous !== undefined || next !== undefined) && (
          <nav className={styles.neighbours} aria-label={t.docs.neighbours}>
            {previous !== undefined && (
              <Link href={docsHref(previous.slug)} rel="prev">
                <span>{t.docs.previous}</span>
                {previous.title}
              </Link>
            )}
            {next !== undefined && (
              <Link href={docsHref(next.slug)} rel="next" className={styles.next}>
                <span>{t.docs.next}</span>
                {next.title}
              </Link>
            )}
          </nav>
        )}
      </footer>
    </>
  );
}
