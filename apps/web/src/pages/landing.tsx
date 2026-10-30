import type { LandingSection } from "@skillcdn/core";
import { useEffect, useRef } from "react";
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

/** Where the steps hold the scroll: a wide screen, tall enough to show them whole, and motion. */
const HOLD_QUERY =
  "(min-width: 52.01rem) and (min-height: 32rem) and (prefers-reduced-motion: no-preference)";
/** How long the page takes to settle the section in the middle of the window. */
const SETTLE_MS = 650;
/** How long the line takes across, and how long a ring and a step's words take to come up. */
const LINE_MS = 2100;
const RING_MS = 400;
const WORDS_MS = 600;
/** How long the three stand lit before the page scrolls again. */
const REST_MS = 700;

/**
 * How far down the window, in percent, the steps are caught on their way up it: just inside its
 * foot, so that the steps, dark until they play, are seen dark only while the page glides them
 * to the middle.
 */
const CATCH_LINE = 92;

/**
 * The steps hold the page's scroll on each pass down: when they come up into the window, the
 * page settles their section in the middle and stays while the line runs along the steps and
 * each lights in turn, then it scrolls on. The play is `Element.animate`, timed by where each
 * number stands on the line; the section keeps its place and size. Where the query does not
 * match, nothing holds and the stylesheet's own reveal stands.
 */
function useStepsHold() {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const timeline = ref.current;
    const section = timeline?.closest("section");
    if (
      timeline === null ||
      section === null ||
      section === undefined ||
      !window.matchMedia(HOLD_QUERY).matches
    ) {
      return;
    }
    const caught = timeline.getBoundingClientRect().top < (window.innerHeight * CATCH_LINE) / 100;
    timeline.dataset.hold = caught ? "done" : "waiting";
    const animations: Animation[] = [];
    let release: (() => void) | undefined;
    let timer: number | undefined;
    let settle: number | undefined;

    const play = () => {
      timeline.dataset.hold = "playing";
      animations.length = 0;
      // The document stops scrolling for the hold (base.css): a wheel or a touchpad mid-gesture
      // cannot be cancelled event by event, and would carry the page on past the middle.
      const root = document.documentElement;
      root.dataset.scrollHeld = "";
      release = () => {
        delete root.dataset.scrollHeld;
        release = undefined;
      };

      // The wheel lands where it lands: the page brings the section's middle to the window's,
      // and once more after the glide, should anything have moved it on the way.
      const held = section.getBoundingClientRect();
      const middle = window.scrollY + held.top + held.height / 2 - window.innerHeight / 2;
      window.scrollTo({ top: middle, behavior: "smooth" });
      settle = window.setTimeout(() => {
        if (Math.abs(window.scrollY - middle) > 1) {
          window.scrollTo({ top: middle, behavior: "smooth" });
        }
      }, SETTLE_MS);

      const box = timeline.getBoundingClientRect();
      animations.push(
        timeline.animate([{ scale: "0 1" }, { scale: "1 1" }], {
          duration: LINE_MS,
          delay: SETTLE_MS,
          fill: "both",
          pseudoElement: "::after",
        }),
      );
      let end = SETTLE_MS + LINE_MS;
      for (const number of timeline.querySelectorAll<HTMLElement>(`.${styles.stepNumber}`)) {
        const place = number.getBoundingClientRect();
        const at = SETTLE_MS + ((place.left + place.width / 2 - box.left) / box.width) * LINE_MS;
        animations.push(
          number.animate(
            [
              { opacity: 0, scale: "0.85" },
              { opacity: 1, scale: "1" },
            ],
            {
              duration: RING_MS,
              delay: at,
              easing: "ease-out",
              fill: "both",
              pseudoElement: "::after",
            },
          ),
        );
        for (const words of number.parentElement?.querySelectorAll(":scope > :not(span)") ?? []) {
          animations.push(
            words.animate(
              [
                { opacity: 0, translate: "0 0.75rem" },
                { opacity: 1, translate: "0 0" },
              ],
              { duration: WORDS_MS, delay: at + RING_MS / 3, easing: "ease-out", fill: "both" },
            ),
          );
        }
        end = Math.max(end, at + RING_MS / 3 + WORDS_MS);
      }
      timer = window.setTimeout(() => {
        timeline.dataset.hold = "done";
        for (const animation of animations) animation.cancel();
        release?.();
      }, end + REST_MS);
    };

    // The steps are caught when their top comes up past the catch line from below, and the page
    // then settles their section in the middle; a page that lands past them, as one restored
    // after a reload may, leaves them lit. Once they are below the window again, the next pass
    // down holds again.
    const catcher = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined || timeline.dataset.hold !== "waiting") return;
        const top = entry.boundingClientRect.top;
        if (entry.isIntersecting && top > 0) {
          play();
        } else if (top <= 0) {
          timeline.dataset.hold = "done";
        }
      },
      { rootMargin: `0px 0px -${100 - CATCH_LINE}% 0px` },
    );
    const rearm = new IntersectionObserver(([entry]) => {
      if (entry === undefined || timeline.dataset.hold !== "done") return;
      if (!entry.isIntersecting && entry.boundingClientRect.top > 0) {
        timeline.dataset.hold = "waiting";
      }
    });
    catcher.observe(timeline);
    rearm.observe(timeline);
    return () => {
      catcher.disconnect();
      rearm.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      for (const animation of animations) animation.cancel();
      release?.();
      delete timeline.dataset.hold;
    };
  }, []);
  return ref;
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

export function LandingPage(props: { readonly origin: string }) {
  const { t, language } = useI18n();
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
  const stepsRef = useStepsHold();

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
            <ol className={styles.timeline} ref={stepsRef}>
              {copy.steps.items.map((step, index) => {
                const href =
                  index === 0
                    ? `/gh/skillcdn/skills`
                    : index === 1
                      ? CONSOLE_PACK_ADDRESS
                      : docsHref(USE_GUIDE_SLUG);
                return (
                  <li key={step.title}>
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
        <section id="packs" className={styles.packs}>
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
              <div className={styles.buildersHead}>
                <div>
                  <p className={styles.kicker}>{copy.builders.eyebrow}</p>
                  <h2>{copy.builders.title}</h2>
                </div>
                <p className={styles.sectionLead}>{copy.builders.lead}</p>
              </div>
              <ul className={styles.features}>
                {copy.builders.features.map((feature) => (
                  <li key={feature.title}>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </li>
                ))}
              </ul>
              <div className={styles.buildersFoot}>
                <p className={styles.many}>{copy.builders.many}</p>
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
