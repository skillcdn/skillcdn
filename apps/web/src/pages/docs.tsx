import { DOCS_CONTENT } from "virtual:skillcdn-docs-content";
import { useEffect, useState } from "react";
import { Markdown } from "../components/markdown.js";
import { Container } from "../components/ui.js";
import { DOCS_SECTIONS, docsNeighbours, docsPage, docsSectionLabel } from "../docs/catalog.js";
import type { DocsPage as DocsEntry, DocsHeading } from "../docs/types.js";
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
 * and rendered here between the list of pages and, on a wide enough screen, the outline of the
 * page. On a narrow screen the list waits behind a bar under the header, which also says where
 * the reader is. The pages are written in English; the frame around them is in the visitor's
 * language.
 */
export function DocsPage(props: DocsPageProps) {
  const { t, language } = useI18n();
  const page = props.slug === undefined ? undefined : docsPage(props.slug);
  if (props.slug !== undefined && page === undefined) {
    return <NotFoundPage />;
  }
  const contentLanguage = LANGUAGE_INFO[DEFAULT_LANGUAGE].htmlLang;
  return (
    <div className={styles.page}>
      {/* The same list twice: open beside the page where there is room, and behind the bar
          where there is not. One of the two is always hidden. The bar starts afresh on every
          page, so that the list it opened is closed on the next. */}
      <DocsBar key={props.slug ?? ""} page={page} />
      <Container>
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <DocsNav current={props.slug} />
          </aside>
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
                <DocsOutline headings={page.headings} />
              </nav>
            </aside>
          )}
        </div>
      </Container>
    </div>
  );
}

/**
 * The bar under the header on a narrow screen: the button that opens the list of pages as a
 * sheet over the page, and where the reader is, the section and the page.
 */
function DocsBar(props: { readonly page: DocsEntry | undefined }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <div className={styles.bar}>
        <div className={styles.barInner}>
          <button
            type="button"
            className={styles.menu}
            aria-expanded={open}
            aria-controls="docs-menu"
            onClick={() => setOpen((was) => !was)}
          >
            <svg
              className={styles.menuOpen}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
            </svg>
            <svg
              className={styles.menuClose}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
            </svg>
            {t.docs.menu}
          </button>
          <ol className={styles.crumbs}>
            {props.page === undefined ? (
              <li className={styles.crumbSection}>{t.docs.title}</li>
            ) : (
              <>
                <li className={styles.crumbSection}>{docsSectionLabel(t, props.page.section)}</li>
                <li className={styles.crumbPage}>{props.page.title}</li>
              </>
            )}
          </ol>
        </div>
      </div>
      {open && (
        <div id="docs-menu" className={styles.sheet}>
          <DocsNav current={props.page?.slug} onFollow={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function DocsNav(props: {
  readonly current: string | undefined;
  /** Called when a link of the list is followed: the sheet closes behind it. */
  readonly onFollow?: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.docs.navLabel}>
      <Link
        href={PATHS.docs}
        className={styles.navHome}
        aria-current={props.current === undefined ? "page" : undefined}
        onClick={props.onFollow}
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
                  onClick={props.onFollow}
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
        <section key={section.id} id={section.id} className={styles.indexSection}>
          <h2 className={styles.indexTitle}>{docsSectionLabel(t, section.id)}</h2>
          <ul className={styles.indexList}>
            {section.pages.map((page) => (
              <li key={page.slug} className={styles.card}>
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
              <Link href={docsHref(previous.slug)} rel="prev" className={styles.previous}>
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

/** The outline of the page, with the heading the reader is at marked. */
function DocsOutline(props: { readonly headings: readonly DocsHeading[] }) {
  const active = useActiveHeading(props.headings);
  return (
    <ol className={styles.tocList}>
      {props.headings.map((heading) => (
        <li key={heading.id} className={heading.level === 3 ? styles.tocDeep : undefined}>
          <a href={`#${heading.id}`} aria-current={heading.id === active ? "location" : undefined}>
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The heading the reader is at: the last one that has reached the line a heading scrolls to
 * when its link is followed, so that the mark in the outline agrees with the link, or the last
 * one of the page once its foot is in view. Known only in the browser, and only once the page
 * is on screen; until then there is none, which is also what the server renders.
 */
function useActiveHeading(headings: readonly DocsHeading[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(undefined);
  const ids = headings.map((heading) => heading.id).join("\n");
  useEffect(() => {
    const elements = ids
      .split("\n")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    const first = elements[0];
    if (first === undefined) return;
    // The line is the document's scroll padding and the heading's own scroll margin together,
    // which is where the browser puts a heading whose fragment is followed.
    const line =
      lengthOf(getComputedStyle(document.documentElement).scrollPaddingTop) +
      lengthOf(getComputedStyle(first).scrollMarginTop);
    let frame = 0;
    const update = () => {
      frame = 0;
      const foot = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
      let current: string | undefined;
      for (const element of elements) {
        if (element.getBoundingClientRect().top > line + 1) break;
        current = element.id;
      }
      setActive(foot ? elements[elements.length - 1]?.id : current);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ids]);
  return active;
}

/** A computed length in pixels; `auto` and anything else that is not one count as nothing. */
function lengthOf(value: string): number {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}
