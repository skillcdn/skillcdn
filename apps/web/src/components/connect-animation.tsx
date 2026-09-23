import { createContext, type RefObject, useContext, useEffect, useRef, useState } from "react";
import styles from "./connect-preview.module.css";

const LOOP_MS = 6400;
const CLICK_LOOP_MS = 3000;
const FRAME_MS = 80;

export const PreviewTime = createContext(LOOP_MS);

/** A single clock keeps typing, the pointer and clicks together; nothing advances the step. */
export function usePreviewLoop(typing: boolean): {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly time: number;
} {
  const root = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(LOOP_MS);
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (motion.matches || document.hidden || !inView) {
        setTime(LOOP_MS);
        return;
      }
      const started = performance.now();
      setTime(0);
      const duration = typing ? LOOP_MS : CLICK_LOOP_MS;
      timer = setInterval(() => setTime((performance.now() - started) % duration), FRAME_MS);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? false;
        update();
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [typing]);
  return { root, time };
}

export function previewPhase(time: number): string {
  if (time >= LOOP_MS) return "still";
  if (time < 720) return "approach";
  if (time < 1120) return "hover";
  if (time < 1520) return "click";
  if (time < 3920) return "type";
  if (time < 4560) return "action";
  if (time < 4960) return "submit";
  return "done";
}

export function TypedText({ text }: { readonly text: string }) {
  const time = useContext(PreviewTime);
  const progress = Math.min(1, Math.max(0, (time - 1520) / 2200));
  const characters = Array.from(text);
  return (
    <span className={styles.typed}>
      <span className={styles.typeSpace}>{text}</span>
      <span className={styles.typeInk}>
        {characters.slice(0, Math.floor(characters.length * progress)).join("")}
        <span className={styles.textCaret} />
      </span>
    </span>
  );
}

export function DemoPointer({ action = false }: { readonly action?: boolean }) {
  return (
    <span className={action ? styles.actionPointer : styles.pointer}>
      <svg viewBox="0 0 24 28" fill="none" aria-hidden="true" focusable="false">
        <path d="M4 2.8a.7.7 0 0 0-1.2.5v18.4a.7.7 0 0 0 1.2.5l4.3-4.1 3.7 7.2a.9.9 0 0 0 1.2.4l2.5-1.3a.9.9 0 0 0 .4-1.2l-3.7-7.1 5.9-1.1a.7.7 0 0 0 .3-1.2L4 2.8Z" />
      </svg>
    </span>
  );
}
