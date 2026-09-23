import { AddressForm } from "../components/address-form.js";
import { BrandSymbol } from "../components/brand.js";
import { CreationDemo } from "../components/creation-demo.js";
import { ArrowIcon, FeaturedSkill } from "../components/featured-skill.js";
import { Container } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { FEATURED_VIDEO, LINKS } from "../site.js";
import styles from "./landing.module.css";

export function LandingPage(props: { readonly origin: string }) {
  const { t, language } = useI18n();
  const copy = t.landing;
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
          <div className={styles.actions}>
            <Link className={styles.primary} href={PATHS.explore}>
              {copy.primary}
              <ArrowIcon />
            </Link>
            <a className={styles.secondary} href="#how">
              {copy.secondary}
              <span aria-hidden="true">↘</span>
            </a>
          </div>
          <div className={styles.compatibility}>
            <span>{copy.compatibility}</span>
            <div>
              {(["chatgpt", "claude", "cursor"] as const).map((client) => (
                <span key={client}>
                  <img
                    src={`/clients/${client === "chatgpt" ? "openai" : client}.svg`}
                    alt=""
                    width="20"
                    height="20"
                  />
                  {t.connect.clients[client].label}
                </span>
              ))}
              <span className={styles.moreApps}>{copy.moreApps}</span>
            </div>
          </div>
        </Container>
      </section>
      <section id="featured" className={styles.featured}>
        <Container>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>{copy.featured.eyebrow}</p>
              <h2>{copy.featured.title}</h2>
            </div>
            <Link href={PATHS.explore}>
              {copy.featured.all}
              <ArrowIcon />
            </Link>
          </div>
          <FeaturedSkill />
        </Container>
      </section>
      <section id="how" className={styles.how}>
        <Container className={styles.howGrid}>
          <div className={styles.howCopy}>
            <p className={styles.kicker}>{copy.how.eyebrow}</p>
            <h2>{copy.how.title}</h2>
            <p className={styles.sectionLead}>{copy.how.lead}</p>
            <ol className={styles.steps}>
              {copy.how.steps.map((step, index) => (
                <li key={step.title}>
                  <span aria-hidden="true">0{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link className={styles.textLink} href={FEATURED_VIDEO.href}>
              {copy.how.action}
              <ArrowIcon />
            </Link>
          </div>
          <CreationDemo key={language} />
        </Container>
      </section>
      <section className={styles.start}>
        <Container>
          <BrandSymbol className={styles.startSymbol} />
          <p className={styles.kicker}>{copy.start.eyebrow}</p>
          <h2>{copy.start.title}</h2>
          <p className={styles.sectionLead}>{copy.start.body}</p>
          <ol className={styles.startSteps}>
            {copy.start.steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <Link className={styles.primary} href={PATHS.explore}>
            {copy.start.action}
            <ArrowIcon />
          </Link>
        </Container>
      </section>
      <section id="faq" className={styles.faqSection}>
        <Container className={styles.faqGrid}>
          <h2>{copy.faq.title}</h2>
          <div>
            {copy.faq.items.map((item) => (
              <details key={item.question} className={styles.faqItem}>
                <summary>
                  {item.question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
      <Container>
        <section className={styles.repository}>
          <div>
            <h2>{copy.authors.title}</h2>
            <p>{copy.authors.body}</p>
            <a href={LINKS.convention}>
              {copy.authors.convention}
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>
          <AddressForm origin={props.origin} label={copy.authors.check} />
        </section>
      </Container>
    </div>
  );
}
