import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
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
// ground and its own tokens. It is alive in two ways: as it comes into view a hand plays a few
// moments of a working day on the board, taking a card and carrying it to another column, a
// task arriving, each with its line in the feed; and a card can be dragged to another column,
// the way the console's cards are. A press anywhere on the window ends the play, since the hand
// is then the visitor's. Nothing here talks to a console: it is an illustration, hidden from
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

/** The hand that plays a move: how long each part of it takes. */
export const HAND = {
  /** From where the hand appears to the card. */
  approach: 650,
  /** Holding the card before it moves. */
  hold: 260,
  /** Carrying the card to its column. */
  carry: 900,
  /** After the drop, before the hand goes. */
  leave: 420,
} as const;
/** How far into the carry the column under the card lights up. */
const NEAR = 0.55;
/** Where on a card the hand takes hold of it, as a share of its size. */
const GRIP = { x: 0.38, y: 0.6 };
/** Where the hand comes from: right of the card and below it, in shares of the card's size. */
const FROM = { x: 0.9, y: 2.2 };
/** Where the hand goes once it has let go, from where the card landed. */
const AWAY = { x: 14, y: 18 };
const EASE = "cubic-bezier(0.3, 0.7, 0.2, 1)";
/** How far a column is brought into view when the board has to scroll to it. */
const SCROLL_MARGIN = 12;

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

type Move = Extract<DemoMoment, { kind: "move" }>;

/** The hand at work on a moment: the card it moves, where to, and what it is doing. */
interface Hand {
  readonly moment: Move;
  readonly task: DemoTask;
  readonly phase: "approach" | "hold" | "carry" | "leave";
  /** Carrying, and near enough to the column for it to light up. */
  readonly near: boolean;
}

function stateOf(value: string | null | undefined): DemoTaskState | undefined {
  return (["idea", "ready", "in_progress", "in_review", "done"] as const).find(
    (state) => state === value,
  );
}

/**
 * The board with a task moved to a column: it goes to the top of it, where a card dropped on
 * a column lands, so it comes first among the tasks.
 */
export function moved(
  tasks: readonly DemoTask[],
  number: number,
  to: DemoTaskState,
  change: (task: DemoTask) => DemoTask = (task) => task,
): readonly DemoTask[] {
  const task = tasks.find((candidate) => candidate.number === number);
  if (task === undefined) return tasks;
  return [change({ ...task, state: to }), ...tasks.filter((other) => other !== task)];
}

/** What the board is after a moment: the task moved, or the task added. */
export function afterMoment(tasks: readonly DemoTask[], moment: DemoMoment): readonly DemoTask[] {
  if (moment.kind === "add") {
    return tasks.some((task) => task.number === moment.task.number)
      ? tasks
      : [moment.task, ...tasks];
  }
  return moved(tasks, moment.task, moment.to, (task) => ({
    ...task,
    working: moment.to === "in_progress" || moment.to === "in_review" ? true : task.working,
  }));
}

/** The moments in the order they play, each after its delay, as the board schedules them. */
export function momentDelay(index: number): number {
  return index === 0 ? FIRST_MOMENT_MS : MOMENT_MS;
}

/**
 * Where a card lands in a column: at the top of it, where the card then stands and the ones
 * there make room, in whatever coordinates the box is given in. A board about to scroll by
 * `scroll` to show the column lands it that much further over.
 */
export function landing(
  cards: { readonly left: number; readonly top: number },
  padding: number,
  scroll = 0,
): Point {
  return { x: cards.left + padding - scroll, y: cards.top + padding };
}

const translate = (point: Point) => `translate(${point.x}px, ${point.y}px)`;

/**
 * What the hand plays with: the animations the browser runs on its own, by which the hand and
 * the card it carries move, each holding where it ended, and the timers of the parts, all
 * cancelled together when the hand goes.
 */
function stage() {
  const animations: Animation[] = [];
  const timers: number[] = [];
  return {
    run(node: Element | null, keyframes: Keyframe[], duration: number): void {
      if (node === null) return;
      animations.push(node.animate(keyframes, { duration, easing: EASE, fill: "forwards" }));
    },
    later(ms: number, run: () => void): void {
      timers.push(window.setTimeout(run, ms));
    },
    clear(): void {
      for (const animation of animations.splice(0)) animation.cancel();
      for (const timer of timers.splice(0)) window.clearTimeout(timer);
    },
  };
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
      data-task={task.number}
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

/** The hand: open on its way to a card and away from it, closed while it holds one. */
function Pointer(props: { readonly grabbing: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="var(--console-hand-stroke)"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.grabbing ? (
        <path d="M7.4 13.2V11.3C7.4 9.9 9.6 9.9 9.6 11.3V10.6C9.6 9.1 12 9.1 12 10.6V10.9C12 9.4 14.4 9.4 14.4 10.9V11.7C14.4 10.3 16.8 10.3 16.8 11.7V16.4C16.8 19.6 14.5 22 11.4 22H10.5C8.4 22 6.7 21 5.7 19.4L3.5 16.1C2.8 15 3.7 13.6 5 13.9C5.4 14 5.7 14.2 6 14.6L7.4 16.3Z" />
      ) : (
        <path d="M4.6 14.2V8.2C4.6 6.6 7 6.6 7 8.2V12.8H7.6V5.2C7.6 3.6 10 3.6 10 5.2V12.8H10.6V4C10.6 2.4 13 2.4 13 4V12.8H13.6V5.4C13.6 3.8 16 3.8 16 5.4V16.8C16 19.8 13.8 22 10.9 22H9.8C7.8 22 6.2 21 5.2 19.5L1.3 14.8C0.4 13.7 1.4 12 2.8 12.3C3.5 12.45 4.1 13.1 4.6 13.9Z" />
      )}
    </svg>
  );
}

export function ConsoleDemo() {
  const { t } = useI18n();
  const words = t.landing.console.window;
  const [tasks, setTasks] = useState<readonly DemoTask[]>(words.tasks);
  const [feed, setFeed] = useState(words.feed.items);
  const [arrived, setArrived] = useState<number | null>(null);
  const [played, setPlayed] = useState(0);
  /** The visitor has taken the board, by a press anywhere on the window: the play is over. */
  const [stopped, setStopped] = useState(false);
  const [hand, setHand] = useState<Hand | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { ref: root, inView } = useInView<HTMLDivElement>(0.4);
  const board = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const carried = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const current = useRef<Drag | null>(null);
  current.current = drag;
  const latest = useRef<Hand | null>(null);
  latest.current = hand;
  const onBoard = useRef(tasks);
  onBoard.current = tasks;
  const loose = useRef(false);
  const [play] = useState(stage);

  /** The board after a moment, and its line in the feed. */
  const apply = useCallback(
    (moment: DemoMoment) => {
      setTasks((before) => afterMoment(before, moment));
      setArrived(moment.kind === "add" ? moment.task.number : moment.task);
      setFeed((before) => [{ when: words.feed.now, text: moment.feed }, ...before].slice(0, 5));
      setPlayed((before) => before + 1);
    },
    [words],
  );

  // The moments of a working day, once the board is in view and motion is welcome, and until
  // the visitor takes the board: a task arrives by itself; a hand plays a move.
  useEffect(() => {
    const moment = words.play[played];
    if (!inView || stopped || moment === undefined) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setTimeout(() => {
      const task =
        moment.kind === "move"
          ? onBoard.current.find((candidate) => candidate.number === moment.task)
          : undefined;
      if (moment.kind === "add" || task === undefined) {
        apply(moment);
        return;
      }
      setHand({ moment, task, phase: "approach", near: false });
    }, momentDelay(played));
    return () => window.clearTimeout(timer);
  }, [inView, played, stopped, words, apply]);

  // Out of view, the hand goes with whatever it was doing; the moment plays again from the start
  // when the board is back.
  useEffect(() => {
    if (!inView) {
      play.clear();
      setHand(null);
    }
  }, [inView, play]);
  useEffect(() => () => play.clear(), [play]);

  // Each part of the hand's work, as the board stands after the render that began it: the
  // positions are measured then, the animations started, and the next part timed.
  const phase = hand?.phase;
  useLayoutEffect(() => {
    const now = latest.current;
    if (phase === undefined || now === null) {
      play.clear();
      return;
    }
    const { run, later } = play;
    const boardNode = board.current;
    const pointerNode = pointer.current;
    // The hand stands in the root, which is its parent: positions are measured from there.
    const rootNode = pointerNode?.parentElement ?? null;
    const origin = boardNode?.querySelector(`[data-task="${now.task.number}"]`) ?? null;
    if (
      rootNode === null ||
      boardNode === null ||
      pointerNode === null ||
      origin === null ||
      typeof pointerNode.animate !== "function"
    ) {
      // Nothing to play it with: the moment happens, as it does under reduced motion.
      if (phase !== "leave") apply(now.moment);
      setHand(null);
      return;
    }
    const rootRect = rootNode.getBoundingClientRect();
    const cardRect = origin.getBoundingClientRect();
    const at = { x: cardRect.left - rootRect.left, y: cardRect.top - rootRect.top };
    const grip = { x: cardRect.width * GRIP.x, y: cardRect.height * GRIP.y };
    const held = { x: at.x + grip.x, y: at.y + grip.y };
    switch (phase) {
      case "approach": {
        const from = { x: at.x + cardRect.width * FROM.x, y: at.y + cardRect.height * FROM.y };
        run(
          pointerNode,
          [
            { transform: translate(from), opacity: 0 },
            { transform: translate(held), opacity: 1 },
          ],
          HAND.approach,
        );
        later(HAND.approach, () => setHand({ ...now, phase: "hold" }));
        return;
      }
      case "hold": {
        // The card in hand, over the one it was: as wide as that one and where it stands.
        const node = carried.current;
        if (node !== null) {
          node.style.width = `${cardRect.width}px`;
          node.style.transform = translate(at);
        }
        later(HAND.hold, () => setHand({ ...now, phase: "carry" }));
        return;
      }
      case "carry": {
        const cards = boardNode.querySelector(`[data-column="${now.moment.to}"] [data-cards]`);
        if (cards === null) {
          apply(now.moment);
          setHand(null);
          return;
        }
        // A column the board has to scroll to comes into view as the card heads there, and the
        // card lands where the column will be.
        const boardRect = boardNode.getBoundingClientRect();
        const columnRect = (cards.parentElement ?? cards).getBoundingClientRect();
        let scroll = 0;
        if (columnRect.right > boardRect.right) {
          scroll = Math.min(
            columnRect.right - boardRect.right + SCROLL_MARGIN,
            boardNode.scrollWidth - boardNode.clientWidth - boardNode.scrollLeft,
          );
        } else if (columnRect.left < boardRect.left) {
          scroll = Math.max(
            columnRect.left - boardRect.left - SCROLL_MARGIN,
            -boardNode.scrollLeft,
          );
        }
        if (scroll !== 0) boardNode.scrollBy({ left: scroll, behavior: "smooth" });
        const style = getComputedStyle(cards);
        const cardsRect = cards.getBoundingClientRect();
        const to = landing(
          { left: cardsRect.left - rootRect.left, top: cardsRect.top - rootRect.top },
          Number.parseFloat(style.paddingTop) || 0,
          scroll,
        );
        run(
          carried.current,
          [{ transform: translate(at) }, { transform: translate(to) }],
          HAND.carry,
        );
        run(
          pointerNode,
          [
            { transform: translate(held) },
            { transform: translate({ x: to.x + grip.x, y: to.y + grip.y }) },
          ],
          HAND.carry,
        );
        later(HAND.carry * NEAR, () => setHand({ ...now, near: true }));
        later(HAND.carry, () => {
          apply(now.moment);
          setHand({ ...now, phase: "leave", near: false });
        });
        return;
      }
      case "leave": {
        // The card is in its column; the hand lets go and goes.
        run(
          pointerNode,
          [
            { transform: translate(held), opacity: 1 },
            { transform: translate({ x: held.x + AWAY.x, y: held.y + AWAY.y }), opacity: 0 },
          ],
          HAND.leave,
        );
        later(HAND.leave, () => setHand(null));
        return;
      }
    }
  }, [phase, apply, play]);

  /** A press anywhere on the window: the board is the visitor's now, and the hand goes. */
  const stop = () => {
    if (stopped && latest.current === null) return;
    play.clear();
    setHand(null);
    setStopped(true);
  };

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
          setTasks((before) => moved(before, last.task.number, over));
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

  /** The card the hand has, while it holds or carries it. */
  const inHand = hand !== null && (hand.phase === "hold" || hand.phase === "carry") ? hand : null;

  return (
    <div ref={root} className={styles.root}>
      <div
        className={cx(styles.window, dragging !== null && styles.windowDragging)}
        aria-hidden="true"
        onPointerDownCapture={stop}
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
              const over =
                dragging?.over === state ||
                (hand?.near === true && hand.moment.to === state && hand.phase === "carry");
              return (
                <section
                  key={state}
                  className={cx(styles.column, styles[`column-${state}`], over && styles.over)}
                  data-column={state}
                >
                  <header className={styles.columnHead}>
                    <span className={styles.columnTitle}>{words.columns[state]}</span>
                    <span className={styles.count}>{inColumn.length}</span>
                  </header>
                  <div className={styles.cards} data-cards="">
                    {inColumn.map((task) => (
                      <Card
                        key={task.number}
                        task={task}
                        words={words}
                        onPress={press}
                        lifted={
                          dragging?.task.number === task.number ||
                          inHand?.task.number === task.number
                        }
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
      {inHand !== null && (
        // The card the hand carries: the whole of it, as wide as where it was, over the window.
        <div ref={carried} className={styles.carried} aria-hidden="true">
          <Card task={inHand.task} words={words} />
        </div>
      )}
      {hand !== null && (
        <div ref={pointer} className={styles.pointer} aria-hidden="true">
          <Pointer grabbing={inHand !== null} />
        </div>
      )}
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
