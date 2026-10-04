import { useState } from "react";
import { useI18n } from "../i18n/index.js";
import type { ConnectClient } from "./connect-clients.js";
import styles from "./connect-guide.module.css";
import { ConnectPreview } from "./connect-preview.js";

export function ConnectWalkthrough({
  client,
  name,
  url,
  description,
  signIn = false,
}: {
  readonly client: ConnectClient;
  readonly name: string;
  readonly url: string;
  readonly description: string;
  /** The repository is private: the steps that differ for it are shown in place of the usual. */
  readonly signIn?: boolean;
}) {
  const { t } = useI18n();
  const c = t.connect.clients[client];
  const [step, setStep] = useState(0);
  // The one step of an app's three that says how to authenticate, where it says so at all.
  const stepsForSignIn: Partial<Record<ConnectClient, string>> = t.connect.private.steps;
  const textOf = (text: string, index: number): string =>
    signIn && index === 1 ? (stepsForSignIn[client] ?? text) : text;

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
              <span className={styles.stepText}>{textOf(text, index)}</span>
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
              <ConnectPreview
                client={client}
                step={index}
                name={name}
                url={url}
                description={description}
                signIn={signIn}
              />
            </figure>
          </li>
        );
      })}
    </ol>
  );
}
