import { AddressForm } from "../components/address-form.js";
import { Container, Section } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import { hostOf, LINKS } from "../site.js";
import styles from "./landing.module.css";

export function LandingPage(props: { readonly origin: string }) {
  const { t } = useI18n();
  const copy = t.landing;
  const host = hostOf(props.origin);

  return (
    <>
      <div className={styles.hero}>
        <Container>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.lead}>{copy.lead}</p>
          <div className={styles.try}>
            <AddressForm origin={props.origin} label={copy.tryLabel} large examples />
          </div>
        </Container>
      </div>

      <Section id="how" title={copy.how.title}>
        <ol className={styles.steps}>
          {copy.how.steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <h3 className={styles.itemTitle}>{step.title}</h3>
              <p className={styles.itemBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="addresses" title={copy.addresses.title} lead={copy.addresses.lead} subtle>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{copy.addresses.addressHeader}</th>
                <th scope="col">{copy.addresses.meaningHeader}</th>
              </tr>
            </thead>
            <tbody>
              {copy.addresses.rows.map((row) => (
                <tr key={row.address}>
                  <td>
                    <code>{`${host}${row.address}`}</code>
                  </td>
                  <td>{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="principles" title={copy.principles.title}>
        <ul className={styles.grid}>
          {copy.principles.items.map((item) => (
            <li key={item.title} className={styles.card}>
              <h3 className={styles.itemTitle}>{item.title}</h3>
              <p className={styles.itemBody}>{item.body}</p>
            </li>
          ))}
        </ul>
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
        <dl className={styles.faq}>
          {copy.faq.items.map((item) => (
            <div key={item.question} className={styles.faqItem}>
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
