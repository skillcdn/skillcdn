import { createContext, type RefObject, useContext, useEffect, useRef, useState } from "react";
import styles from "./connect-preview.module.css";

const LOOP_MS = 6400;
const FRAME_MS = 80;

/**
 * What a scene does, which sets how long its loop is: one click on a control; two clicks, the
 * first opening a menu and the second choosing its entry; typing and sending, the whole
 * timeline; or filling a form, which has a timeline of its own.
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
 * A form that is filled, in the order a person fills it, with one pointer that travels: the
 * address is typed; the pointer reaches the list and opens it; seeks the entry and picks it;
 * aims at the button and submits; and the result holds. Each pair is the pointer arriving and
 * then pressing, so nothing is pressed by a pointer that is not yet there.
 */
const FILL_PHASES = [
  ["type", 2200],
  ["reach", 2900],
  ["open", 3200],
  ["seek", 3900],
  ["pick", 4200],
  ["aim", 4900],
  ["submit", 5300],
] as const;
/** The control the travelling pointer is on in each phase; none while typing. */
const FILL_TARGET: Readonly<Record<string, string>> = {
  reach: "select",
  open: "select",
  seek: "option",
  pick: "option",
  aim: "submit",
  submit: "submit",
  done: "submit",
};

/**
 * The clock the shared timeline is read on. A two-click scene has nothing to type, so its clock
 * jumps from the first click straight to the second pointer, which is what lets a menu open on
 * the first click and its entry take the second.
 */
export function previewClock(time: number, loop: PreviewLoop = "type"): number {
  return loop === "clicks" && time >= TYPE_START_MS && time < LOOP_MS ? time + TYPE_MS : time;
}

/** What typing reads: in a filled form it starts at once and is done when the pointer sets out. */
export function typingClock(time: number, loop: PreviewLoop): number {
  if (loop !== "fill" || time >= LOOP_MS) {
    return previewClock(time, loop);
  }
  return time < FILL_PHASES[0][1] ? time + TYPE_START_MS : TYPE_START_MS + TYPE_MS;
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

/**
 * The phase a scene is in. One timeline serves most scenes: the first pointer arrives, hovers
 * and clicks; typing runs; the second pointer arrives and clicks; and the result holds. A
 * filled form has its own (`FILL_PHASES`).
 */
export function previewPhase(time: number, loop: PreviewLoop = "type"): string {
  if (time >= LOOP_MS) return "still";
  if (loop === "fill") {
    return FILL_PHASES.find(([, until]) => time < until)?.[0] ?? "done";
  }
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

const POINTER_PATH =
  "M4 2.8a.7.7 0 0 0-1.2.5v18.4a.7.7 0 0 0 1.2.5l4.3-4.1 3.7 7.2a.9.9 0 0 0 1.2.4l2.5-1.3a.9.9 0 0 0 .4-1.2l-3.7-7.1 5.9-1.1a.7.7 0 0 0 .3-1.2L4 2.8Z";

export function DemoPointer({ action = false }: { readonly action?: boolean }) {
  return (
    <span className={action ? styles.actionPointer : styles.pointer}>
      <svg viewBox="0 0 24 28" fill="none" aria-hidden="true" focusable="false">
        <path d={POINTER_PATH} />
      </svg>
    </span>
  );
}

/**
 * The one pointer of a filled form. It belongs to the scene and not to a control, and goes from
 * control to control (`data-point`) as the phases say, so that it is seen to travel between a
 * list, its entry and the button instead of one pointer fading out here and another in there.
 * Where it stands is measured, because the controls are laid out by the text in them; it is set
 * on the element from an effect, so the server's markup carries no style.
 */
export function ScenePointer({
  scene,
  phase,
}: {
  readonly scene: RefObject<HTMLElement | null>;
  readonly phase: string;
}) {
  const pointer = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const within = scene.current;
    const element = pointer.current;
    const name = FILL_TARGET[phase];
    if (within === null || element === null || name === undefined) return;
    const target = within.querySelector<HTMLElement>(`[data-point="${name}"]`);
    if (target === null) return;
    const from = within.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (to.width === 0) return;
    const x = to.left - from.left + to.width / 2;
    const y = to.top - from.top + to.height / 2;
    element.style.transform = `translate(${x}px, ${y}px)`;
  }, [scene, phase]);
  return (
    <span ref={pointer} className={styles.scenePointer}>
      <svg viewBox="0 0 24 28" fill="none" aria-hidden="true" focusable="false">
        <path d={POINTER_PATH} />
      </svg>
    </span>
  );
}
