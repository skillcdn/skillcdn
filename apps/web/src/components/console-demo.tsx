import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n/index.js";
import type { DemoMoment, DemoTask, DemoTaskState } from "../i18n/messages/landing-en.js";
import { BrandSymbol } from "./brand.js";
import styles from "./console-demo.module.css";
import { cx } from "./ui.js";
import { useInView } from "./use-in-view.js";

// The console on the front page: the board of the reference console (skillcdn/console,
// ADR-0047), drawn here as the pages draw the illustrated client windows, with its own light
// ground and its own tokens. It is alive in two ways: as it comes into view the board plays a
// few moments of a working day, a card taken by an agent, a task arriving, a card moved to
// review, each with its line in the feed; and a card can be dragged to another column, the way
// the console's cards are. Nothing here talks to a console: it is an illustration, hidden from
// assistive technology, with one paragraph that says what it shows.

/** The columns the board shows open; the last one is folded, as the console folds it. */
const OPEN_STATES: readonly DemoTaskState[] = ["idea", "ready", "in_progress", "in_review"];
/** How far a mouse travels before a pressed card comes loose. */
const DRAG_SLACK = 4;
/** How long a finger rests on a card before it comes loose, and how far it may wander meanwhile. */
const HOLD_MS = 300;
const HOLD_SLACK = 8;
/** When the first moment plays once the board is in view, and the ones after it. */
const FIRST_MOMENT_MS = 900;
const MOMENT_MS = 1700;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** A card on its way to another column. */
interface Drag {
  readonly task: DemoTask;
  readonly from: Point;
  readonly x: number;
  readonly y: number;
  /** Where on the card it was taken hold of, so that the card moves whole under the pointer. */
  readonly grip: Point;
  readonly width: number;
  /** Whether the card has come loose: the mouse has travelled, or the finger has rested. */
  readonly moving: boolean;
  /** Whether the press is a finger's, which must rest before the card comes loose. */
  readonly hold: boolean;
  readonly over: DemoTaskState | undefined;
}

function stateOf(value: string | null | undefined): DemoTaskState | undefined {
  return (["idea", "ready", "in_progress", "in_review", "done"] as const).find(
    (state) => state === value,
  );
}

/** What the board is after a moment: the task moved, or the task added. */
export function afterMoment(tasks: readonly DemoTask[], moment: DemoMoment): readonly DemoTask[] {
  if (moment.kind === "add") {
    return tasks.some((task) => task.number === moment.task.number)
      ? tasks
      : [moment.task, ...tasks];
  }
  return tasks.map((task) =>
    task.number === moment.task
      ? {
          ...task,
          state: moment.to,
          working: moment.to === "in_progress" || moment.to === "in_review" ? true : task.working,
        }
      : task,
  );
}

/** The moments in the order they play, each after its delay, as the board schedules them. */
export function momentDelay(index: number): number {
  return index === 0 ? FIRST_MOMENT_MS : MOMENT_MS;
}

type Words = ReturnType<typeof useI18n>["t"]["landing"]["console"]["window"];

function Card(props: {
  readonly task: DemoTask;
  readonly words: Words;
  readonly onPress?: ((task: DemoTask, event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  readonly lifted?: boolean;
  /** The card has just arrived where it stands, and says so with a small rise. */
  readonly arrived?: boolean;
}) {
  const { task, words } = props;
  return (
    <article
      className={cx(
        styles.card,
        props.lifted === true && styles.lifted,
        props.arrived === true && styles.arrived,
      )}
      onPointerDown={
        props.onPress === undefined ? undefined : (event) => props.onPress?.(task, event)
      }
    >
      <span className={styles.cardTitle}>
        <span className={styles.number}>#{task.number}</span>
        {task.title}
      </span>
      <span className={styles.meta}>
        <span className={cx(styles.badge, styles[`category-${task.category}`])}>
          {words.categories[task.category]}
        </span>
        <span className={cx(styles.badge, styles[`priority-${task.priority}`])}>
          {words.priorities[task.priority]}
        </span>
        {task.due !== undefined && (
          <span
            className={cx(
              styles.badge,
              task.priority === "urgent" ? styles.badgePoint : styles.badgeWarning,
            )}
          >
            {task.due}
          </span>
        )}
        {task.decisions !== undefined && task.decisions > 0 && (
          <span className={cx(styles.badge, styles.badgeWarning)}>
            {words.decisions(task.decisions)}
          </span>
        )}
        <span className={styles.spacer} />
        {task.working === true && <span className={styles.avatar}>{words.worker}</span>}
      </span>
    </article>
  );
}

export function ConsoleDemo() {
  const { t } = useI18n();
  const words = t.landing.console.window;
  const [tasks, setTasks] = useState<readonly DemoTask[]>(words.tasks);
  const [feed, setFeed] = useState(words.feed.items);
  const [arrived, setArrived] = useState<number | null>(null);
  const [played, setPlayed] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { ref: root, inView } = useInView<HTMLDivElement>(0.4);
  const board = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const current = useRef<Drag | null>(null);
  current.current = drag;
  const loose = useRef(false);

  // The moments of a working day, once the board is in view and motion is welcome: each adds
  // its line to the feed. Played once; the cards then stay where they are for the hand.
  useEffect(() => {
    const moment = words.play[played];
    if (!inView || moment === undefined) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setTimeout(() => {
      setTasks((before) => afterMoment(before, moment));
      setArrived(moment.kind === "add" ? moment.task.number : moment.task);
      setFeed((before) => [{ when: words.feed.now, text: moment.feed }, ...before].slice(0, 5));
      setPlayed(played + 1);
    }, momentDelay(played));
    return () => window.clearTimeout(timer);
  }, [inView, played, words]);

  const press = (task: DemoTask, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const hold = event.pointerType !== "mouse";
    if (!hold) {
      // The press is the drag's beginning and nothing else: no text is selected on the way.
      event.preventDefault();
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    setDrag({
      task,
      from,
      x: from.x,
      y: from.y,
      grip: { x: from.x - rect.left, y: from.y - rect.top },
      width: rect.width,
      moving: false,
      hold,
      over: undefined,
    });
  };

  // While a card is held, the pointer is followed over the whole document: the column under it
  // is marked, and the release moves the task. A finger's hold is timed here, and once the card
  // has come loose the page no longer scrolls under the finger.
  const held = drag !== null;
  useEffect(() => {
    if (!held) {
      return;
    }
    const columnUnder = (x: number, y: number) =>
      stateOf(
        document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]")?.dataset.column,
      );
    const follow = (event: PointerEvent) => {
      const { clientX: x, clientY: y } = event;
      setDrag((before) => {
        if (before === null) {
          return before;
        }
        const travelled = Math.hypot(x - before.from.x, y - before.from.y);
        if (!before.moving) {
          // A finger that wanders before it has rested is scrolling, and lets the card go; a
          // mouse that has barely moved is still only pressing.
          if (before.hold) {
            return travelled > HOLD_SLACK ? null : { ...before, x, y };
          }
          if (travelled <= DRAG_SLACK) {
            return { ...before, x, y };
          }
          loose.current = true;
        }
        return { ...before, x, y, moving: true, over: columnUnder(x, y) };
      });
    };
    const loosen = () => {
      setDrag((before) => {
        if (before === null || before.moving) {
          return before;
        }
        loose.current = true;
        return { ...before, moving: true, over: columnUnder(before.x, before.y) };
      });
    };
    const release = (event: PointerEvent) => {
      const last = current.current;
      if (last?.moving === true && event.type === "pointerup") {
        const over = columnUnder(event.clientX, event.clientY);
        if (over !== undefined && over !== "done" && over !== last.task.state) {
          setTasks((before) =>
            before.map((task) =>
              task.number === last.task.number ? { ...task, state: over } : task,
            ),
          );
          setArrived(last.task.number);
        }
      }
      loose.current = false;
      setDrag(null);
    };
    const block = (event: TouchEvent) => {
      if (loose.current) {
        event.preventDefault();
      }
    };
    const quiet = (event: Event) => event.preventDefault();
    const timer = current.current?.hold === true ? window.setTimeout(loosen, HOLD_MS) : undefined;
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("contextmenu", quiet);
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      document.removeEventListener("touchmove", block);
      document.removeEventListener("contextmenu", quiet);
      loose.current = false;
    };
  }, [held]);

  /** The drag under way, once the card has come loose; nothing while a card is merely pressed. */
  const dragging = drag?.moving === true ? drag : null;
  // The card in hand follows the pointer by its transform, set on the element itself: the
  // pages carry no inline styles, and a transform costs no layout.
  useLayoutEffect(() => {
    const node = ghost.current;
    if (node === null || dragging === null) {
      return;
    }
    node.style.width = `${dragging.width}px`;
    node.style.transform = `translate(${dragging.x - dragging.grip.x}px, ${dragging.y - dragging.grip.y}px)`;
  }, [dragging]);

  return (
    <div ref={root} className={styles.root}>
      <div
        className={cx(styles.window, dragging !== null && styles.windowDragging)}
        aria-hidden="true"
      >
        <div className={styles.chrome}>
          <BrandSymbol className={styles.symbol} />
          <span className={styles.name}>{words.name}</span>
          <div className={styles.tabs}>
            {words.tabs.map((tab, index) => (
              <span key={tab} className={cx(styles.tab, index === 0 && styles.tabOn)}>
                {tab}
              </span>
            ))}
          </div>
          <span className={styles.live}>
            <i />
            {words.live}
          </span>
        </div>
        <div className={styles.field}>
          <div ref={board} className={styles.board}>
            {OPEN_STATES.map((state) => {
              const inColumn = tasks.filter((task) => task.state === state);
              return (
                <section
                  key={state}
                  className={cx(
                    styles.column,
                    styles[`column-${state}`],
                    dragging?.over === state && styles.over,
                  )}
                  data-column={state}
                >
                  <header className={styles.columnHead}>
                    <span className={styles.columnTitle}>{words.columns[state]}</span>
                    <span className={styles.count}>{inColumn.length}</span>
                  </header>
                  <div className={styles.cards}>
                    {inColumn.map((task) => (
                      <Card
                        key={task.number}
                        task={task}
                        words={words}
                        onPress={press}
                        lifted={dragging?.task.number === task.number}
                        arrived={arrived === task.number}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            <section
              className={cx(styles.column, styles.folded, dragging?.over === "done" && styles.over)}
              data-column="done"
            >
              <header className={styles.columnHead}>
                <span className={cx(styles.columnTitle, styles.columnDone)}>
                  {words.columns.done}
                </span>
                <span className={styles.count}>{words.done}</span>
              </header>
            </section>
          </div>
          <div className={styles.side}>
            <div className={styles.pane}>
              <span className={styles.paneTitle}>{words.decision.title}</span>
              <p className={styles.question}>{words.decision.question}</p>
              <div className={styles.options}>
                {words.decision.options.map((option, index) => (
                  <span key={option} className={cx(styles.option, index === 0 && styles.picked)}>
                    {option}
                  </span>
                ))}
              </div>
              <span className={styles.answer}>{words.decision.answer}</span>
            </div>
            <div className={styles.pane}>
              <span className={styles.paneTitle}>{words.feed.title}</span>
              <ul className={styles.feed}>
                {feed.map((item, index) => (
                  <li
                    key={`${item.when} ${item.text}`}
                    className={cx(styles.feedItem, index === 0 && played > 0 && styles.arrived)}
                  >
                    <span className={styles.when}>{item.when}</span>
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {dragging !== null && (
        // The card in hand: the whole of it, as wide as where it stands, under the pointer where
        // it was taken hold of.
        <div ref={ghost} className={styles.ghost} aria-hidden="true">
          <Card task={dragging.task} words={words} />
        </div>
      )}
      <p className="visually-hidden">{words.description}</p>
    </div>
  );
}
