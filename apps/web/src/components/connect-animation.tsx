import { createContext, type RefObject, useContext, useEffect, useRef, useState } from "react";
import styles from "./connect-preview.module.css";

const LOOP_MS = 6400;
const FRAME_MS = 80;

/**
 * What a scene does, which sets how long its loop is: one click on a control; two clicks, the
 * first opening a menu and the second choosing its entry; or typing and sending, the whole
 * timeline.
 */
export type PreviewLoop = "click" | "clicks" | "type" | "fill";
const LOOP_LENGTH: Record<PreviewLoop, number> = {
  click: 3000,
  clicks: 4000,
  type: LOOP_MS,
  fill: LOOP_MS,
};
/** Where the typing phase starts and how long it lasts; the first click ends where it starts. */
const TYPE_START_MS = 1520;
const TYPE_MS = 2400;

/**
 * The clock a scene reads, from the one that ticks. One timeline serves every scene: the first
 * pointer arrives, hovers and clicks; typing runs; the second pointer arrives and clicks; and
 * the result holds. Two kinds of scene take it in another order. A two-click scene has nothing
 * to type, so its clock jumps from the first click straight to the second pointer, which is what
 * lets a menu open on the first click and its entry take the second. A form that is filled
 * types first and then takes a choice with the first pointer before the second submits it, so
 * that what the person does in the app happens in the order they do it.
 */
export function previewClock(time: number, loop: PreviewLoop = "type"): number {
  if (time >= LOOP_MS) return time;
  if (loop === "clicks" && time >= TYPE_START_MS) return time + TYPE_MS;
  if (loop === "fill") {
    if (time < TYPE_MS) return time + TYPE_START_MS;
    if (time < TYPE_START_MS + TYPE_MS) return time - TYPE_MS;
  }
  return time;
}

/** What typing reads in a filled form: done, once the clock has moved on to the choice. */
export function typingClock(time: number, loop: PreviewLoop): number {
  const clock = previewClock(time, loop);
  return loop === "fill" && clock < TYPE_START_MS ? TYPE_START_MS + TYPE_MS : clock;
}

export const PreviewTime = createContext(LOOP_MS);

/** A single clock keeps typing, the pointer and clicks together; nothing advances the step. */
export function usePreviewLoop(loop: PreviewLoop): {
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
      const duration = LOOP_LENGTH[loop];
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
  }, [loop]);
  return { root, time };
}

/** The phase a scene is in, on the clock `previewClock` gives its kind. */
export function previewPhase(time: number, loop: PreviewLoop = "type"): string {
  if (time >= LOOP_MS) return "still";
  const at = previewClock(time, loop);
  if (at < 720) return "approach";
  if (at < 1120) return "hover";
  if (at < TYPE_START_MS) return "click";
  if (at < TYPE_START_MS + TYPE_MS) return "type";
  if (at < 4560) return "action";
  if (at < 4960) return "submit";
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
