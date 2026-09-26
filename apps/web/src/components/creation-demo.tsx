import type { RestShowcaseEntry, ShowcaseDemo } from "@skillcdn/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { BrandSymbol } from "./brand.js";
import { ClipAnimation, isRefusal } from "./clip-animation.js";
import styles from "./creation-demo.module.css";
import { useInView } from "./use-in-view.js";

/** The lines whose length paces the conversation. */
export type DemoLines = Pick<ShowcaseDemo, "prompt" | "question" | "answer" | "plan" | "consent">;

const TICK_MS = 80;

/** Milliseconds per character: a person types, the assistant answers. */
const PACE = { user: 26, assistant: 12 } as const;

/**
 * Pauses, in milliseconds: before the assistant answers, to read a scene before the next one
 * opens, before the first line of a scene, and while the result is being made (as long as the
 * progress bar takes to fill).
 */
const BEAT = { think: 450, read: 1_300, enter: 300, work: 1_300 } as const;

/** When a line is typed, in milliseconds into the cycle. */
export interface DemoLine {
  readonly from: number;
  readonly until: number;
}

/** When each thing happens, in milliseconds into the cycle. */
export interface DemoSchedule {
  readonly prompt: DemoLine;
  readonly thinking: number;
  readonly question: DemoLine;
  readonly details: number;
  readonly answer: DemoLine;
  readonly planning: number;
  readonly plan: DemoLine;
  readonly creation: number;
  readonly consent: DemoLine;
  readonly result: number;
  readonly finished: number;
  readonly cycle: number;
}

/**
 * The timing of the conversation, from the length of its lines in this language: each line
 * starts once the one before it is typed and read, whatever a translation makes of it. The cycle
 * ends when the result has played once through.
 */
export function demoSchedule(copy: DemoLines, clipMs: number): DemoSchedule {
  let at = 0;
  const line = (text: string, pace: number): DemoLine => {
    const from = at;
    at += text.length * pace;
    return { from, until: at };
  };
  const pause = (ms: number): number => {
    at += ms;
    return at;
  };
  const prompt = line(copy.prompt, PACE.user);
  const thinking = pause(BEAT.think);
  pause(BEAT.think);
  const question = line(copy.question, PACE.assistant);
  const details = pause(BEAT.read);
  pause(BEAT.enter);
  const answer = line(copy.answer, PACE.user);
  const planning = pause(BEAT.think);
  pause(BEAT.think);
  const plan = line(copy.plan, PACE.assistant);
  const creation = pause(BEAT.read);
  pause(BEAT.enter);
  const consent = line(copy.consent, PACE.user);
  const result = pause(BEAT.think);
  const finished = pause(BEAT.work);
  return {
    prompt,
    thinking,
    question,
    details,
    answer,
    planning,
    plan,
    creation,
    consent,
    result,
    finished,
    cycle: finished + clipMs,
  };
}

/** As much of a line as has been typed by this time. */
function typed(text: string, line: DemoLine, time: number): string {
  if (time >= line.until) return text;
  if (time <= line.from) return "";
  return text.slice(0, Math.floor(((time - line.from) / (line.until - line.from)) * text.length));
}

function Thinking() {
  return (
    <span className={styles.thinking}>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * The result, playing: the concept clip itself, from its first frame once the result is done,
 * and paused while the conversation is off screen. Where the browser will not start it by
 * itself, and for an entry without a clip, the same clip as an animated image takes its place.
 */
function ResultClip(props: { readonly entry: RestShowcaseEntry; readonly playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const { media, width, height } = props.entry;
  useEffect(() => {
    const node = video.current;
    if (node === null) return;
    if (!props.playing) {
      node.pause();
      return;
    }
    // A browser lets a video start by itself only when it is muted; the property is what it
    // checks, and a client-rendered element does not always have it from the markup alone.
    node.muted = true;
    node.play().catch((error: unknown) => {
      if (isRefusal(error)) setFailed(true);
    });
  }, [props.playing]);
  if (failed || media.clip === null) {
    return <ClipAnimation entry={props.entry} alt="" />;
  }
  return (
    <video
      ref={video}
      src={media.clip.url}
      poster={media.poster.url}
      width={width}
      height={height}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The example conversation of a showcase entry, with its words and its media (ADR-0028): the
 * person brings a character and a few words, the assistant suggests the story and asks what it
 * needs, and the result plays. Runs only on screen, respects a live motion preference, and holds
 * while the pointer or the focus is on it. Without motion, and before any script runs, it shows
 * the last scene with the poster of the result, so that nothing plays or loads that nobody asked
 * for. The animation is hidden from assistive technology; the conversation is read from the
 * list after it.
 */
export function CreationDemo(props: {
  readonly entry: RestShowcaseEntry;
  readonly demo: ShowcaseDemo;
}) {
  const { t } = useI18n();
  const labels = t.landing.demo;
  const { entry, demo: copy } = props;
  const clipMs = entry.durationMs ?? 0;
  const schedule = useMemo(() => demoSchedule(copy, clipMs), [copy, clipMs]);
  const { ref: root, inView } = useInView<HTMLDivElement>(0.2);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const { cycle } = schedule;

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
        () => setElapsed((time) => (time === null ? 0 : (time + TICK_MS) % cycle)),
        TICK_MS,
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
  }, [inView, held, cycle]);

  const time = elapsed ?? cycle - 1;
  const phase = time < schedule.details ? 0 : time < schedule.creation ? 1 : 2;
  const prompt = typed(copy.prompt, schedule.prompt, time);
  const question = typed(copy.question, schedule.question, time);
  const answer = typed(copy.answer, schedule.answer, time);
  const plan = typed(copy.plan, schedule.plan, time);
  const consent = typed(copy.consent, schedule.consent, time);
  const finished = time >= schedule.finished;
  const caret = (shown: string, whole: string) =>
    shown.length < whole.length ? styles.caret : undefined;
  // What the person attaches: the entry's pictures, captioned by its words. The character comes
  // first, since it is what the conversation starts from.
  const attachments = [
    ...(entry.media.picture === null
      ? []
      : [{ url: entry.media.picture.url, label: copy.picture }]),
    ...(entry.media.reference === null
      ? []
      : [{ url: entry.media.reference.url, label: copy.reference }]),
  ];

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
        <div className={styles.conversation}>
          {phase === 0 && (
            <div className={styles.scene}>
              <div className={styles.user}>
                <small>{labels.user}</small>
                {attachments.length > 0 && (
                  <div className={styles.attachments}>
                    {attachments.map((attachment) => (
                      <span key={attachment.url}>
                        <img src={attachment.url} alt="" />
                        {attachment.label}
                      </span>
                    ))}
                  </div>
                )}
                <p>
                  {prompt}
                  <span className={caret(prompt, copy.prompt)} />
                </p>
              </div>
              {time >= schedule.thinking && (
                <div className={styles.assistant}>
                  <BrandSymbol />
                  <div>
                    <small>{labels.assistant}</small>
                    {question.length > 0 ? <p>{question}</p> : <Thinking />}
                  </div>
                </div>
              )}
            </div>
          )}
          {phase === 1 && (
            <div className={styles.scene}>
              <div className={styles.user}>
                <small>{labels.user}</small>
                <p>
                  {answer}
                  <span className={caret(answer, copy.answer)} />
                </p>
              </div>
              {time >= schedule.planning && (
                <div className={styles.assistant}>
                  <BrandSymbol />
                  <div>
                    <small>{labels.assistant}</small>
                    {plan.length > 0 ? <p>{plan}</p> : <Thinking />}
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
                <small>{labels.user}</small>
                <p>
                  {consent}
                  <span className={caret(consent, copy.consent)} />
                </p>
              </div>
              {time >= schedule.result && (
                <div className={styles.result} data-finished={finished}>
                  {elapsed === null ? (
                    <img src={entry.media.poster.url} alt="" />
                  ) : (
                    <ResultClip entry={entry} playing={finished && inView} />
                  )}
                  {/* While the result is being made, and nothing over it once it plays. */}
                  {!finished && (
                    <>
                      <span className={styles.working}>{copy.working}</span>
                      <span className={styles.progress} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ol className="visually-hidden" aria-label={labels.label}>
        <li>
          {attachments.length > 0
            ? `${labels.user}: ${copy.prompt} (${attachments.map((attachment) => attachment.label).join(", ")})`
            : `${labels.user}: ${copy.prompt}`}
        </li>
        <li>{`${labels.assistant}: ${copy.question}`}</li>
        <li>{`${labels.user}: ${copy.answer}`}</li>
        <li>{`${labels.assistant}: ${copy.plan}`}</li>
        <li>{copy.approval}</li>
        <li>{`${labels.user}: ${copy.consent}`}</li>
        <li>{copy.result}</li>
      </ol>
    </div>
  );
}
