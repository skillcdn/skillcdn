import { type ReactNode, useEffect, useState } from "react";
import { AddressForm } from "../components/address-form.js";
import { Container, Section } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { FEATURED_ADDRESSES, HOW_CLIPS, hostOf, LINKS } from "../site.js";
import styles from "./landing.module.css";

/* Decoration for the three tiles, in the order of their copy: one skill, several skills, and a
   set where one is broken. Drawn here rather than shipped as files, so they take the tokens. */
const TILE_ART: readonly ReactNode[] = [
  <>
    <rect x="18" y="10" width="28" height="44" rx="3" />
    <path d="M25 22h14M25 30h14M25 38h8" />
  </>,
  <>
    <rect x="8" y="12" width="22" height="18" rx="3" />
    <rect x="34" y="12" width="22" height="18" rx="3" />
    <rect x="8" y="34" width="22" height="18" rx="3" />
    <rect x="34" y="34" width="22" height="18" rx="3" />
  </>,
  <>
    <rect x="8" y="12" width="22" height="18" rx="3" />
    <rect x="34" y="34" width="22" height="18" rx="3" />
    <g className={styles.tileArtBroken}>
      <rect x="34" y="12" width="22" height="18" rx="3" strokeDasharray="4 4" />
      <rect x="8" y="34" width="22" height="18" rx="3" strokeDasharray="4 4" />
      <path d="M39 17l12 8M51 17l-12 8M13 39l12 8M25 39l-12 8" />
    </g>
  </>,
];

/**
 * What the step beside it looks like in practice: a repository, the addresses it answers to, and
 * the calls an agent makes. All of it is code, so it reads the same in every language and stays
 * out of the language packs. A marked line is the one the step is about; `id` names the line,
 * because two of them can hold the same text.
 */
type PanelLine = { readonly id: string; readonly text: string; readonly mark?: boolean };

function howPanels(host: string): readonly (readonly PanelLine[])[] {
  return [
    [
      { id: "root", text: "my-repo/" },
      { id: "skills", text: "  skills/" },
      { id: "notes", text: "    release-notes/" },
      { id: "notes-manifest", text: "      SKILL.md", mark: true },
      { id: "notes-checklist", text: "      checklist.md" },
      { id: "review", text: "    incident-review/" },
      { id: "review-manifest", text: "      SKILL.md", mark: true },
      { id: "docs", text: "  docs/" },
      { id: "docs-style", text: "    style-guide.md" },
    ],
    [
      { id: "default", text: `${host}/gh/my-org/my-repo`, mark: true },
      { id: "tag", text: `${host}/gh/my-org/my-repo@v1.2.0` },
      { id: "subpath", text: `${host}/gh/my-org/my-repo@main/skills` },
      { id: "gap", text: "" },
      { id: "add", text: "claude mcp add --transport http \\" },
      { id: "add-args", text: `  my-repo ${host}/gh/my-org/my-repo` },
    ],
    [
      { id: "find", text: 'find("release notes")', mark: true },
      { id: "find-skill", text: "  skills/release-notes" },
      { id: "find-doc", text: "  docs/style-guide.md" },
      { id: "gap-get", text: "" },
      { id: "get", text: 'get("skills/release-notes")', mark: true },
      { id: "get-files", text: "  SKILL.md, checklist.md" },
      { id: "gap-read", text: "" },
      { id: "read", text: 'read_file("docs/style-guide.md")', mark: true },
    ],
  ];
}

/** How long a step keeps the frame beside it before the next one takes over. */
const STEP_MS = 6000;

export function LandingPage(props: { readonly origin: string }) {
  const { t } = useI18n();
  const copy = t.landing;
  // Every step is on the page whatever is selected; only the clip beside them changes.
  const [step, setStep] = useState(0);
  // The steps go round by themselves. Picking one stops that for good; a pointer or the keyboard
  // inside the section holds it for as long as it stays there.
  const [picked, setPicked] = useState(false);
  const [held, setHeld] = useState(false);
  const clip = HOW_CLIPS[step];
  const panel = howPanels(hostOf(props.origin))[step];
  const stepCount = copy.how.steps.length;

  useEffect(() => {
    // Read in an effect: the server renders the first step and knows none of this.
    if (picked || held || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setInterval(
      () => setStep((current) => (current + 1) % stepCount),
      STEP_MS,
    );
    return () => window.clearInterval(timer);
  }, [picked, held, stepCount]);

  return (
    <>
      <div className={styles.hero}>
        <Container>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.lead}>{copy.lead}</p>
          <div className={styles.try}>
            <AddressForm origin={props.origin} label={copy.tryLabel} large />
          </div>
        </Container>
      </div>

      <Section id="featured" title={copy.featured.title} lead={copy.featured.lead}>
        <ul className={styles.featured}>
          {copy.featured.items.map((item, index) => (
            <li key={item.title}>
              <Link className={styles.tile} href={`/gh/${FEATURED_ADDRESSES[index]}`}>
                <svg
                  className={styles.tileArt}
                  viewBox="0 0 64 64"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  {TILE_ART[index]}
                </svg>
                <span className={styles.tileTitle}>{item.title}</span>
                <span className={styles.tileBody}>{item.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="how" title={copy.how.title}>
        <div
          className={styles.how}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocusCapture={() => setHeld(true)}
          onBlurCapture={() => setHeld(false)}
        >
          <ol className={styles.steps}>
            {copy.how.steps.map((item, index) => (
              <li key={item.title} className={index === step ? styles.stepActive : styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className={styles.itemTitle}>
                  {/* The button covers its whole step, so the text next to it selects too. */}
                  <button
                    type="button"
                    className={styles.stepButton}
                    aria-current={index === step ? "true" : undefined}
                    onClick={() => {
                      setStep(index);
                      setPicked(true);
                    }}
                  >
                    {item.title}
                  </button>
                </h3>
                <p className={styles.itemBody}>{item.body}</p>
              </li>
            ))}
          </ol>
          {/* Decoration: the step next to it says the same thing in words. */}
          <figure className={styles.media} aria-hidden="true">
            <div className={styles.frame}>
              {clip === undefined ? (
                <pre className={styles.panel}>
                  <span className={styles.panelLines}>
                    {panel?.map((line) => (
                      <span
                        key={line.id}
                        className={line.mark === true ? styles.panelMark : undefined}
                      >
                        {line.text}
                        {"\n"}
                      </span>
                    ))}
                  </span>
                </pre>
              ) : (
                <video
                  key={clip}
                  className={styles.clip}
                  src={clip}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              )}
            </div>
          </figure>
        </div>
      </Section>

      <Section id="authors" title={copy.authors.title}>
        <p className={styles.prose}>{copy.authors.body}</p>
        <p className={styles.actions}>
          <Link className={styles.primaryLink} href={PATHS.explore}>
            {copy.authors.check}
          </Link>
          <a className={styles.secondaryLink} href={LINKS.convention}>
            {copy.authors.convention}
          </a>
        </p>
      </Section>

      <Section id="faq" title={copy.faq.title}>
        <div className={styles.faq}>
          {copy.faq.items.map((item) => (
            <details key={item.question} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{item.question}</summary>
              <p className={styles.faqAnswer}>{item.answer}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}
