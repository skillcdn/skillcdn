import { useState } from "react";
import { useI18n } from "../i18n/index.js";
import type { ConnectClient } from "./connect-clients.js";
import styles from "./connect-guide.module.css";
import { ConnectPreview } from "./connect-preview.js";

export function ConnectWalkthrough({
  client,
  name,
  url,
}: {
  readonly client: ConnectClient;
  readonly name: string;
  readonly url: string;
}) {
  const { t } = useI18n();
  const c = t.connect.clients[client];
  const [step, setStep] = useState(0);

  return (
    <ol className={styles.walkthrough} aria-label={t.connect.follow(c.label)}>
      {c.steps.map((text, index) => {
        const heading = (
          <>
            <span className={styles.stepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <strong>{c.titles[index]}</strong>
              <span className={styles.stepText}>{text}</span>
            </span>
          </>
        );
        return (
          <li className={styles.stepRow} key={c.titles[index]}>
            <button
              type="button"
              className={styles.step}
              aria-current={index === step ? "step" : undefined}
              onClick={() => setStep(index)}
            >
              {heading}
            </button>
            <div className={`${styles.step} ${styles.stepHeading}`}>{heading}</div>
            <figure
              className={styles.preview}
              data-active={index === step}
              aria-label={`${c.label} — ${c.titles[index]}`}
            >
              <ConnectPreview client={client} step={index} name={name} url={url} />
            </figure>
          </li>
        );
      })}
    </ol>
  );
}
