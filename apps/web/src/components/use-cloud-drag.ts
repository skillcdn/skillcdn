import { type RefObject, useEffect, useRef } from "react";

// A pill of the cloud of packs can be taken hold of and pulled about: it follows the pointer on
// a tether, the others move out of its way, and everything drifts back once it is let go. The
// list stays a list of links: a press that does not travel is a click, and a drag ends with no
// click. The pills move by two custom properties written on each one as the pointer moves, at
// most once a frame, which the stylesheet adds to each pill's place; the way back is a
// transition the stylesheet runs on its own.

/** How far a mouse travels before a pressed pill comes loose. */
const DRAG_SLACK = 4;
/** How long a finger rests on a pill before it comes loose, and how far it may wander meanwhile. */
const HOLD_MS = 300;
const HOLD_SLACK = 8;
/**
 * How far a pill follows the pointer at the most. It is on a tether that gives less the farther
 * it is pulled, so there is no edge to hit.
 */
const REACH = 120;
/** The room a pill keeps around itself, which another pill is pushed out of. */
const GAP = 14;
/** How far a pushed pill moves from where it stands, at the most. */
const PUSH_LIMIT = 96;
/** How many times the pills are moved out of each other's way in a frame: one pushed into another moves it too. */
const PASSES = 3;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where a pill stands at rest, by its centre, and its size. */
interface Spot extends Point {
  readonly w: number;
  readonly h: number;
}

interface Drag {
  readonly items: readonly HTMLElement[];
  readonly spots: readonly Spot[];
  /** Which of them is held. */
  readonly index: number;
  readonly from: Point;
  at: Point;
  /** Whether the press is a finger's, which must rest before the pill comes loose. */
  readonly hold: boolean;
  /** Whether the pill has come loose: the mouse has travelled, or the finger has rested. */
  moving: boolean;
  timer: number | undefined;
  frame: number | undefined;
}

function spotOf(item: HTMLElement): Spot {
  const rect = (item.firstElementChild ?? item).getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    w: rect.width,
    h: rect.height,
  };
}

function place(item: HTMLElement, offset: Point): void {
  item.style.setProperty("--dx", `${offset.x}px`);
  item.style.setProperty("--dy", `${offset.y}px`);
}

/**
 * Where every pill goes for the pointer at `at`: the held one on its tether, and the rest out
 * of its way and out of each other's. Each pair that overlaps, with the room a pill keeps
 * counted in, is moved apart along the line between their centres until it no longer does; the
 * held one never gives way, and two free ones give half each.
 */
export function offsetsFor(spots: readonly Spot[], index: number, from: Point, at: Point): Point[] {
  const offsets = spots.map((): { x: number; y: number } => ({ x: 0, y: 0 }));
  const pull = { x: at.x - from.x, y: at.y - from.y };
  const length = Math.hypot(pull.x, pull.y);
  const give = length === 0 ? 0 : (REACH * Math.tanh(length / REACH)) / length;
  offsets[index] = { x: pull.x * give, y: pull.y * give };
  for (let pass = 0; pass < PASSES; pass++) {
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const sa = spots[a];
        const sb = spots[b];
        const oa = offsets[a];
        const ob = offsets[b];
        if (sa === undefined || sb === undefined || oa === undefined || ob === undefined) continue;
        const dx = sb.x + ob.x - (sa.x + oa.x);
        const dy = sb.y + ob.y - (sa.y + oa.y);
        // The room between two centres is an ellipse of their sizes: as wide as the two half
        // widths and as tall as the two half heights, with the gap on top.
        const rx = (sa.w + sb.w) / 2 + GAP;
        const ry = (sa.h + sb.h) / 2 + GAP;
        let u = dx / rx;
        let v = dy / ry;
        let d = Math.hypot(u, v);
        if (d >= 1) continue;
        if (d < 0.001) {
          // One on top of the other: it goes aside, to the right.
          u = 0.001;
          v = 0;
          d = 0.001;
        }
        // Scaling the line between them by 1 / d puts the second on the edge of the room.
        const apart = { x: u * rx * (1 / d - 1), y: v * ry * (1 / d - 1) };
        const shareA = a === index ? 0 : b === index ? 1 : 0.5;
        const shareB = 1 - shareA;
        oa.x -= apart.x * shareA;
        oa.y -= apart.y * shareA;
        ob.x += apart.x * shareB;
        ob.y += apart.y * shareB;
      }
    }
  }
  return offsets.map((offset, i) => {
    if (i === index) return offset;
    const length = Math.hypot(offset.x, offset.y);
    if (length <= PUSH_LIMIT) return offset;
    return { x: (offset.x * PUSH_LIMIT) / length, y: (offset.y * PUSH_LIMIT) / length };
  });
}

/**
 * Makes the list the ref is put on a cloud whose pills can be pulled about with the pointer.
 * A mouse takes a pill once it has travelled a few pixels; a finger has to rest on one first,
 * so that a swipe still scrolls the page.
 */
export function useCloudDrag<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const list = ref.current;
    if (list === null) return;
    let drag: Drag | null = null;
    /** A drag has just ended: the click the browser sends after it is not one. */
    let dragged = false;

    const settle = (items: readonly HTMLElement[]) => {
      for (const item of items) place(item, { x: 0, y: 0 });
    };

    const frame = () => {
      if (drag === null) return;
      drag.frame = undefined;
      const offsets = offsetsFor(drag.spots, drag.index, drag.from, drag.at);
      drag.items.forEach((item, i) => {
        const offset = offsets[i];
        if (offset !== undefined) place(item, offset);
      });
    };
    const schedule = () => {
      if (drag === null || drag.frame !== undefined) return;
      drag.frame = window.requestAnimationFrame(frame);
    };

    /** The pill comes loose and follows from here. */
    const loosen = () => {
      if (drag === null || drag.moving) return;
      drag.moving = true;
      dragged = true;
      list.dataset.dragging = "";
      const held = drag.items[drag.index];
      if (held !== undefined) held.dataset.held = "";
      if (!drag.hold) document.body.style.cursor = "grabbing";
      schedule();
    };

    const end = () => {
      if (drag === null) return;
      const { items, index, moving, timer, frame: pending } = drag;
      if (timer !== undefined) window.clearTimeout(timer);
      if (pending !== undefined) window.cancelAnimationFrame(pending);
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.removeEventListener("touchmove", block);
      document.removeEventListener("contextmenu", quiet);
      if (moving) {
        delete list.dataset.dragging;
        delete items[index]?.dataset.held;
        document.body.style.cursor = "";
        settle(items);
        // The click that follows a mouse's release comes at once; a finger's never comes.
        window.setTimeout(() => {
          dragged = false;
        }, 0);
      }
      drag = null;
    };

    const follow = (event: PointerEvent) => {
      if (drag === null) return;
      drag.at = { x: event.clientX, y: event.clientY };
      if (!drag.moving) {
        const travelled = Math.hypot(drag.at.x - drag.from.x, drag.at.y - drag.from.y);
        if (drag.hold) {
          // A finger that wanders before it has rested is scrolling, and lets the pill go.
          if (travelled > HOLD_SLACK) end();
          return;
        }
        if (travelled <= DRAG_SLACK) return;
        loosen();
        return;
      }
      schedule();
    };

    /** Once the pill has come loose, the page no longer scrolls under the finger. */
    const block = (event: TouchEvent) => {
      if (drag?.moving === true) event.preventDefault();
    };
    const quiet = (event: Event) => event.preventDefault();

    const press = (event: PointerEvent) => {
      if (event.button !== 0 || drag !== null || !(event.target instanceof Element)) return;
      const item = event.target.closest("li");
      if (item === null || item.parentElement !== list) return;
      const items = [...list.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const hold = event.pointerType !== "mouse";
      // A mouse's press is the drag's beginning and nothing else: no text is selected on the
      // way, and the click still comes if it turns out to be one.
      if (!hold) event.preventDefault();
      const from = { x: event.clientX, y: event.clientY };
      drag = {
        items,
        spots: items.map(spotOf),
        index: items.indexOf(item),
        from,
        at: from,
        hold,
        moving: false,
        timer: hold ? window.setTimeout(loosen, HOLD_MS) : undefined,
        frame: undefined,
      };
      window.addEventListener("pointermove", follow);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      document.addEventListener("touchmove", block, { passive: false });
      document.addEventListener("contextmenu", quiet);
    };

    /** A link is not followed at the end of a drag, and a pill is never dragged as a link. */
    const click = (event: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const noDrag = (event: Event) => event.preventDefault();

    list.addEventListener("pointerdown", press);
    list.addEventListener("click", click, true);
    list.addEventListener("dragstart", noDrag);
    return () => {
      end();
      list.removeEventListener("pointerdown", press);
      list.removeEventListener("click", click, true);
      list.removeEventListener("dragstart", noDrag);
    };
  }, []);
  return ref;
}
