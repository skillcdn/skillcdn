import { useEffect, useState } from "react";
import { AddressForm } from "../components/address-form.js";
import { Container, Section } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { HOW_CLIPS, LINKS } from "../site.js";
import styles from "./landing.module.css";

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
          {/* Decoration: the step beside it says the same thing in words. */}
          <figure className={styles.media} aria-hidden="true">
            <div className={styles.frame}>
              {clip !== undefined && (
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

      <Section id="authors" title={copy.authors.title} subtle>
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
