import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { FEATURED_VIDEO } from "../site.js";
import { BrandSymbol } from "./brand.js";
import styles from "./creation-demo.module.css";

const CYCLE_MS = 27000;

/** Runs only on screen, respects a live motion preference, and holds while being read. */
export function CreationDemo() {
  const { t } = useI18n();
  const copy = t.landing.demo;
  const root = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reading, setReading] = useState(false);
  const held = hovered || focused || reading;
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const sync = () => {
      window.clearInterval(timer);
      if (motion.matches) {
        setElapsed(null);
        return;
      }
      if (!inView || held || document.hidden) return;
      timer = window.setInterval(
        () => setElapsed((time) => (time === null ? 0 : (time + 80) % CYCLE_MS)),
        80,
      );
    };
    sync();
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [inView, held]);

  const time = elapsed ?? CYCLE_MS - 1;
  const phase = time < 7500 ? 0 : time < 17000 ? 1 : 2;
  const prompt = copy.prompt.slice(0, Math.floor(time / 45));
  const question = copy.question.slice(0, Math.max(0, Math.floor((time - 2100) / 24)));
  const answer = copy.answer.slice(0, Math.max(0, Math.floor((time - 7700) / 36)));
  const plan = copy.plan.slice(0, Math.max(0, Math.floor((time - 10200) / 24)));
  const consent = copy.consent.slice(0, Math.max(0, Math.floor((time - 17300) / 36)));
  const finished = time > 20500;

  return (
    <div
      ref={root}
      className={styles.root}
      data-held={held}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        className={styles.window}
        aria-hidden="true"
        data-demo-phase={phase}
        data-demo-time={elapsed}
      >
        <div className={styles.chrome}>
          <BrandSymbol className={styles.symbol} />
          <span>
            {copy.title}
            <small>{copy.label}</small>
          </span>
          <span className={styles.chromeStatus} />
        </div>
        <div className={styles.conversation}>
          {phase === 0 && (
            <div className={styles.scene}>
              <div className={styles.user}>
                <small>{copy.user}</small>
                <p>
                  {prompt}
                  <span className={prompt.length < copy.prompt.length ? styles.caret : undefined} />
                </p>
              </div>
              {time > 1700 && (
                <div className={styles.assistant}>
                  <BrandSymbol />
                  <div>
                    <small>{copy.assistant}</small>
                    {question.length > 0 ? (
                      <p>{question}</p>
                    ) : (
                      <span className={styles.thinking}>
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {phase === 1 && (
            <div className={styles.scene}>
              <div className={styles.user}>
                <small>{copy.user}</small>
                <p>
                  {answer}
                  <span className={answer.length < copy.answer.length ? styles.caret : undefined} />
                </p>
                <div className={styles.attachments}>
                  <span>
                    <img src={FEATURED_VIDEO.image} alt="" />
                    {copy.product}
                  </span>
                  <span>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="3" />
                      <path d="m10 8 5 4-5 4z" />
                    </svg>
                    {copy.reference}
                  </span>
                </div>
              </div>
              {time > 9900 && (
                <div className={styles.assistant}>
                  <BrandSymbol />
                  <div>
                    <small>{copy.assistant}</small>
                    {plan.length > 0 ? (
                      <p>{plan}</p>
                    ) : (
                      <span className={styles.thinking}>
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {phase === 2 && (
            <div className={styles.scene}>
              <div className={styles.approved}>
                <span>✓</span>
                {copy.approval}
              </div>
              <div className={styles.user}>
                <small>{copy.user}</small>
                <p>
                  {consent}
                  <span
                    className={consent.length < copy.consent.length ? styles.caret : undefined}
                  />
                </p>
              </div>
              {time > 19300 && (
                <div className={styles.result} data-finished={finished}>
                  <div className={styles.resultImage}>
                    <img src={FEATURED_VIDEO.image} alt="" />
                    <span>{finished ? copy.resultLabel : copy.working}</span>
                    {!finished && <span className={styles.progress} />}
                  </div>
                  <div className={styles.resultText}>
                    <strong>{copy.result}</strong>
                    <span>{copy.resultDetail}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className={styles.stages}>
          {copy.stages.map((stage, index) => (
            <span key={stage} data-active={index === phase}>
              <i />
              {stage}
            </span>
          ))}
        </div>
      </div>
      <details
        className={styles.transcript}
        onToggle={(event) => setReading(event.currentTarget.open)}
      >
        <summary>{copy.transcript}</summary>
        <ol>
          <li>
            <strong>{copy.user}</strong>
            <p>{copy.prompt}</p>
          </li>
          <li>
            <strong>{copy.assistant}</strong>
            <p>{copy.question}</p>
          </li>
          <li>
            <strong>{copy.user}</strong>
            <p>
              {copy.answer} · {copy.product} · {copy.reference}
            </p>
          </li>
          <li>
            <strong>{copy.assistant}</strong>
            <p>{copy.plan}</p>
          </li>
          <li>
            <strong>{copy.user}</strong>
            <p>{copy.consent}</p>
          </li>
          <li>
            <strong>{copy.resultLabel}</strong>
            <p>{copy.resultDetail}</p>
          </li>
        </ol>
      </details>
    </div>
  );
}
