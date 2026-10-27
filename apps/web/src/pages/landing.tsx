import type { LandingSection } from "@skillcdn/core";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { track } from "../analytics.js";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { AddressForm } from "../components/address-form.js";
import { BrandSymbol } from "../components/brand.js";
import { ConsoleDemo } from "../components/console-demo.js";
import glass from "../components/glass.module.css";
import { OrganizationsStrip } from "../components/organizations-strip.js";
import { SearchForm } from "../components/search-form.js";
import { ShowcaseGrid } from "../components/showcase-card.js";
import { ArrowIcon, Container, cx, ExternalIcon, VerifiedMark } from "../components/ui.js";
import { AUTHORS_GUIDE_SLUG, USE_GUIDE_SLUG } from "../docs/catalog.js";
import { useFeatures } from "../features.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { docsHref, PATHS, searchHref } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import { showcaseEntries, showcaseOrganizations } from "../showcase.js";
import { CONSOLE_PACK_ADDRESS, hostOf, LINKS } from "../site.js";
import styles from "./landing.module.css";

/** The clients named under the search box, each with its mark from `public/clients/`. */
const CLIENTS = [
  { client: "chatgpt", icon: "openai" },
  { client: "claude", icon: "claude" },
  { client: "cursor", icon: "cursor" },
  { client: "codex", icon: "codex" },
  { client: "gemini", icon: "gemini" },
] as const;

/** The caret at the end of a question: down while the answer is folded, up once it is open. */
function FaqCaret() {
  return (
    <svg
      className={styles.faqCaret}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SectionHead(props: {
  readonly kicker: string;
  readonly title: string;
  readonly lead?: string;
  readonly centered?: boolean;
}) {
  return (
    <div
      className={cx(styles.sectionHead, props.centered === true && styles.centered, glass.reveal)}
    >
      <p className={styles.kicker}>{props.kicker}</p>
      <h2>{props.title}</h2>
      {props.lead !== undefined && <p className={styles.sectionLead}>{props.lead}</p>}
    </div>
  );
}

/**
 * The well-known packs, as the explorer features them, in a loose cloud rather than a grid: a
 * glance at what is there, and the way to all of it. The list is the operator's; a failure to
 * load it leaves the address field to speak for the section.
 */
function PackCloud() {
  const { t } = useI18n();
  const featured = useResource("featured", (signal) => api.featured(signal));
  if (featured.state !== "ready") {
    return null;
  }
  const seen = new Set<string>();
  const items = featured.value.items.filter((item) => {
    const key = `${item.repository.owner}/${item.repository.name}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return item.status === "ready";
  });
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className={styles.cloud}>
      {items.slice(0, 9).map((item) => (
        <li key={item.address}>
          <Link className={styles.pill} href={item.address}>
            <span className={styles.pillOwner}>{item.repository.owner}/</span>
            <span className={styles.pillName}>{item.repository.name}</span>
            {item.verified && <VerifiedMark label={t.mount.verified} hint={t.mount.verifiedHint} />}
            {item.skillCount !== null && item.skillCount > 0 && (
              <span className={styles.pillCount}>{t.landing.packs.skills(item.skillCount)}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The cloud of packs leans after the pointer, like stars at their distances: where the pointer
 * is across the section, -1 to 1 each way, is written on the section for the pills to read, at
 * most once a frame, and goes back to the middle when the pointer leaves. A finger does not lean
 * it: a touch moves the page.
 */
function useLean() {
  const frame = useRef(0);
  const at = useRef({ x: 0, y: 0 });
  const write = (node: HTMLElement) => {
    frame.current = 0;
    node.style.setProperty("--lean-x", at.current.x.toFixed(3));
    node.style.setProperty("--lean-y", at.current.y.toFixed(3));
  };
  return {
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "mouse") return;
      const node = event.currentTarget;
      const rect = node.getBoundingClientRect();
      at.current = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
      };
      if (frame.current === 0) frame.current = window.requestAnimationFrame(() => write(node));
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
      window.cancelAnimationFrame(frame.current);
      at.current = { x: 0, y: 0 };
      write(event.currentTarget);
    },
  };
}

export function LandingPage(props: { readonly origin: string }) {
  const { t, language } = useI18n();
  const lean = useLean();
  const copy = t.landing;
  const features = useFeatures();
  const host = hostOf(props.origin);
  // The operator's showcase and organizations (ADR-0028), which the server hands to a rendered
  // page; while they are not there, and when there are none, the build's own stand.
  const showcase = useResource(resourceKeys.showcase(), (signal) => api.showcase(signal));
  const loaded = showcase.state === "ready" ? showcase.value : undefined;
  const entries = showcaseEntries(loaded, language);
  const organizations = showcaseOrganizations(loaded);
  const shows = (section: LandingSection) => features.landingSections.includes(section);

  // The head describes the showcase the page shows: the same head the server writes.
  useEffect(() => {
    applyHead(buildHead({ name: "landing" }, language, props.origin, { showcase: loaded }));
  }, [language, props.origin, loaded]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <Container>
          <p className={styles.eyebrow}>
            <span />
            {copy.eyebrow}
          </p>
          <h1 className={styles.title}>
            {copy.title}
            <span>{copy.titleAccent}</span>
          </h1>
          <p className={styles.lead}>{copy.lead}</p>
          {features.search ? (
            <SearchForm
              className={styles.search}
              from="hero"
              placeholder={copy.search.placeholder}
              chips={copy.search.chips}
            />
          ) : (
            <div className={styles.actions}>
              <Link
                className={styles.primary}
                href={PATHS.explore}
                onClick={() => track("cta_click", { id: "hero" })}
              >
                {t.explore.title}
                <ArrowIcon />
              </Link>
            </div>
          )}
          <div className={styles.clients}>
            <span>{copy.clients}</span>
            <div>
              {CLIENTS.map(({ client, icon }) => (
                <span key={client}>
                  <img src={`/clients/${icon}.svg`} alt="" width="20" height="20" />
                  {t.connect.clients[client].label}
                </span>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {shows("organizations") && <OrganizationsStrip organizations={organizations} />}

      {shows("showcase") && (
        <section id="showcase" className={styles.showcase}>
          <Container>
            <SectionHead
              kicker={copy.showcase.eyebrow}
              title={copy.showcase.title}
              lead={copy.showcase.lead}
            />
            <ShowcaseGrid entries={entries} language={language} />
          </Container>
        </section>
      )}

      {shows("console") && (
        <section id="console" className={styles.console}>
          <Container>
            <SectionHead
              kicker={copy.console.eyebrow}
              title={copy.console.title}
              lead={copy.console.lead}
              centered
            />
            <div className={cx(styles.consoleStage, glass.reveal)}>
              {/* Remounted per language, since the board's words become its state. */}
              <ConsoleDemo key={language} />
              <p className={styles.caption}>{copy.console.window.caption}</p>
            </div>
            <ul className={styles.points}>
              {copy.console.points.map((point, index) => (
                <li
                  key={point.title}
                  className={cx(
                    glass.reveal,
                    index === 1 && glass.late,
                    index === 2 && glass.later,
                  )}
                >
                  <h3>{point.title}</h3>
                  <p>{point.body}</p>
                </li>
              ))}
            </ul>
            <div className={cx(glass.pane, styles.packBar, glass.reveal)}>
              <p>
                {copy.console.pack.lead}
                <code>{`${host}${CONSOLE_PACK_ADDRESS}`}</code>
              </p>
              <div className={styles.packBarActions}>
                <Link
                  className={styles.primary}
                  href={CONSOLE_PACK_ADDRESS}
                  onClick={() => track("cta_click", { id: "console_pack" })}
                >
                  {copy.console.pack.open}
                  <ArrowIcon />
                </Link>
                <Link className={styles.ghost} href={CONSOLE_PACK_ADDRESS}>
                  {copy.console.pack.guide}
                </Link>
              </div>
            </div>
          </Container>
        </section>
      )}

      {shows("steps") && (
        <section id="steps" className={styles.steps}>
          <Container>
            <SectionHead kicker={copy.steps.eyebrow} title={copy.steps.title} />
            <ol className={styles.timeline}>
              {copy.steps.items.map((step, index) => {
                const href =
                  index === 0
                    ? `/gh/skillcdn/skills`
                    : index === 1
                      ? CONSOLE_PACK_ADDRESS
                      : docsHref(USE_GUIDE_SLUG);
                return (
                  <li
                    key={step.title}
                    className={cx(
                      glass.reveal,
                      index === 1 && glass.late,
                      index === 2 && glass.later,
                    )}
                  >
                    <span className={styles.stepNumber} aria-hidden="true">
                      {index + 1}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                    <Link className={styles.stepLink} href={href}>
                      {step.link}
                      <ArrowIcon />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Container>
        </section>
      )}

      {shows("packs") && (
        <section id="packs" className={styles.packs} {...lean}>
          <Container className={styles.packsGrid}>
            <div className={glass.reveal}>
              <SectionHead
                kicker={copy.packs.eyebrow}
                title={copy.packs.title}
                lead={copy.packs.lead}
              />
              <AddressForm origin={props.origin} label={copy.authors.check} />
              <p className={styles.packsAll}>
                <Link
                  href={PATHS.explore}
                  onClick={() => track("cta_click", { id: "featured_all" })}
                >
                  {copy.packs.all}
                  <ArrowIcon />
                </Link>
              </p>
            </div>
            <div className={cx(styles.cloudSide, glass.reveal, glass.late)}>
              <PackCloud />
            </div>
          </Container>
        </section>
      )}

      {shows("builders") && (
        <section id="builders" className={styles.builders}>
          <Container>
            <div className={cx(glass.pane, styles.buildersPanel, glass.reveal)}>
              <p className={styles.kicker}>{copy.builders.eyebrow}</p>
              <h2>{copy.builders.title}</h2>
              <p className={styles.sectionLead}>{copy.builders.lead}</p>
              <ul className={styles.features}>
                {copy.builders.features.map((feature) => (
                  <li key={feature.title}>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </li>
                ))}
              </ul>
              <p className={styles.many}>{copy.builders.many}</p>
              <div className={styles.actions}>
                <a
                  className={cx(styles.primary, styles.large)}
                  href={LINKS.builders}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("cta_click", { id: "builders_join" })}
                >
                  {copy.builders.join}
                  <ExternalIcon />
                </a>
              </div>
            </div>
          </Container>
        </section>
      )}

      {shows("faq") && (
        <section id="faq" className={styles.faqSection}>
          <Container className={styles.faqGrid}>
            <h2 className={glass.reveal}>{copy.faq.title}</h2>
            <div className={glass.reveal}>
              {copy.faq.items.map((item) => (
                <details key={item.question} className={styles.faqItem}>
                  <summary>
                    {item.question}
                    <FaqCaret />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </Container>
        </section>
      )}

      {shows("cta") && (
        <section className={styles.cta}>
          <Container className={glass.reveal}>
            <BrandSymbol className={styles.ctaSymbol} />
            <h2>{copy.cta.title}</h2>
            <div className={cx(styles.actions, styles.centered)}>
              <Link
                className={cx(styles.primary, styles.large)}
                href={features.search ? searchHref() : PATHS.explore}
                onClick={() => track("cta_click", { id: "start" })}
              >
                {copy.cta.search}
                <ArrowIcon />
              </Link>
              {shows("builders") && (
                <a
                  className={cx(styles.ghost, styles.large)}
                  href={LINKS.builders}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {copy.cta.join}
                  <ExternalIcon />
                </a>
              )}
            </div>
            <p className={styles.share}>
              <Link href={docsHref(AUTHORS_GUIDE_SLUG)}>
                {copy.cta.share}
                <ArrowIcon />
              </Link>
            </p>
          </Container>
        </section>
      )}
    </div>
  );
}
