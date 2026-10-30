import { type RefObject, useEffect, useRef } from "react";

// A pill of the cloud of packs can be taken hold of and pulled about. It follows the pointer
// within the room the section gives the cloud, never over the words beside it: at the room's
// edge it gives, as on a band, less and less the farther. The other pills keep away from it
// as from something that repels them, the nearer the harder, and one pushed into another
// moves it too. Let go, it is thrown: it carries on with the speed it had, pushing and knocking
// the pills in its path along, bounces off the edge where it meets one, and comes to rest
// where it stops, the others where they were driven to. Nothing goes back to where it was: the
// cloud keeps the arrangement until the page is loaded again, and at rest no two pills overlap.
// The list stays a list of links: a press that does not travel is a click, and a drag ends
// with no click.
//
// One set of rules governs all of it, held or thrown: a field of repulsion between the pills,
// contact that moves them apart and knocks them, a band at the edges, and drag that slows
// everything down. It runs as a simulation, a frame at a time, from the first press on a pill
// until every pill is still, and not before: a visitor who never touches the cloud costs
// nothing a frame. Everything is reckoned in the space of the cloud's own positioned ancestor,
// from the layout positions of the pills: a space no scroll, no scroll-driven reveal of the
// section and no drift of a pill can move. The pointer is mapped into that space as it moves.

/** How far a mouse travels before a pressed pill comes loose. */
const DRAG_SLACK = 4;
/** How long a finger rests on a pill before it comes loose, and how far it may wander meanwhile. */
const HOLD_MS = 300;
const HOLD_SLACK = 8;
/** The room a pill keeps around itself, in CSS pixels, which another is pushed out of: enough for the drift of two pills towards each other. */
const GAP = 22;
/** How far beyond that room the repulsion reaches, as a share of the room, and how hard it pushes at the room's edge, in pixels a second each second. */
const FIELD = 1.5;
const FIELD_FORCE = 1800;
/** How much heavier the pill in hand, or just thrown, is than the ones it knocks, so that it carries them along. */
const THROWN_WEIGHT = 2.5;
/** How much of its speed a pill keeps off an edge, and when two pills knock together. */
const WALL_BOUNCE = 0.45;
const KNOCK = 0.6;
/** How much of the way out of each other's room two pills go in one frame: the rest the next, so that a hit is no jump. */
const APART = 0.5;
/** The band that pulls a pill back in from past the edge: its stiffness and its damping. */
const BAND = 300;
const BAND_DAMPING = 35;
/** How readily a held pill stretches past an edge: it goes on as far as it is pulled, ever more slowly, on this scale. */
const STRETCH = 40;
/** How quickly a moving pill loses its speed, in seconds, the fastest a pill goes, the most speed one knock gives, and the speed below which it is still. */
const DRAG_S = 0.28;
const MAX_SPEED = 1000;
const MAX_KNOCK = 800;
const STILL = 4;
/** The longest a frame is reckoned as, so that a pause does not throw the pills about. */
const MAX_STEP_S = 0.034;
/** How far in from the area's edge a pill stops, and how far it stays from the words. */
const AREA_MARGIN = 8;
const AVOID_MARGIN = 16;
/** How far above and below the cloud's own box the pills may go: into the section's margins. */
const AREA_SLACK = 40;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a pill stands with no offset, by its centre, and its size. */
interface Home extends Point {
  readonly w: number;
  readonly h: number;
}

/** A pill: its home, the offset it has, and the speed it is going at. */
interface Pill {
  home: Home;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The cloud as the simulation has it, kept from the first press on. */
interface World {
  readonly space: HTMLElement;
  items: HTMLElement[];
  pills: Pill[];
  area: Box;
  /** Which pill is held, if one is; and which was last, which is the heavy one while it moves. */
  held: number;
  thrown: number;
  /** Where the pointer is, in the window, and where on the held pill it took hold. */
  at: Point;
  grip: Point;
}

interface Press {
  readonly item: HTMLElement;
  readonly from: Point;
  /** Whether the press is a finger's, which must rest before the pill comes loose. */
  readonly hold: boolean;
  /** Whether the pill has come loose: the mouse has travelled, or the finger has rested. */
  moving: boolean;
  timer: number | undefined;
}

function offsetOf(item: HTMLElement): Point {
  return {
    x: Number.parseFloat(item.style.getPropertyValue("--dx")) || 0,
    y: Number.parseFloat(item.style.getPropertyValue("--dy")) || 0,
  };
}

function place(item: HTMLElement, pill: Point): void {
  item.style.setProperty("--dx", `${pill.x.toFixed(2)}px`);
  item.style.setProperty("--dy", `${pill.y.toFixed(2)}px`);
}

/** The space the pills are placed in: the positioned ancestor they share. */
function spaceOf(list: HTMLElement): HTMLElement {
  const parent = list.offsetParent;
  return parent instanceof HTMLElement ? parent : list;
}

/** A point of the window in the space, as the space stands at this moment. */
function toLocal(space: HTMLElement, point: Point): Point {
  const rect = space.getBoundingClientRect();
  return { x: point.x - rect.left, y: point.y - rect.top };
}

function toLocalBox(space: HTMLElement, rect: DOMRect): Box {
  const origin = space.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
  };
}

/** Where an element is laid out in the space: its offsets up the chain, which no transform moves. */
function layoutOf(element: HTMLElement, space: HTMLElement): Point {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node !== null && node !== space) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
  }
  return { x, y };
}

/** The scatter the stylesheet gives a row: registered lengths, so that they read in pixels. */
function scatterOf(item: HTMLElement): Point {
  const style = getComputedStyle(item);
  return {
    x: Number.parseFloat(style.getPropertyValue("--shift")) || 0,
    y: Number.parseFloat(style.getPropertyValue("--lift")) || 0,
  };
}

/**
 * Where each pill stands with no offset: where its link is laid out, moved by the scatter the
 * stylesheet gives its row, at its laid-out size.
 */
function homesOf(items: readonly HTMLElement[], space: HTMLElement): Home[] {
  return items.map((item) => {
    const pill = item.querySelector<HTMLElement>("a") ?? item;
    const at = layoutOf(pill, space);
    const scatter = scatterOf(item);
    return {
      x: at.x + pill.offsetWidth / 2 + scatter.x,
      y: at.y + pill.offsetHeight / 2 + scatter.y,
      w: pill.offsetWidth,
      h: pill.offsetHeight,
    };
  });
}

/**
 * The room the pills have, in the space: the box the list's area element gives them, a little
 * past it above and below, less the words that share the section, which lie beside the cloud
 * on a wide screen and above it on a narrow one.
 */
function areaOf(list: HTMLElement, space: HTMLElement): Box {
  const area = list.closest<HTMLElement>("[data-cloud-area]") ?? list;
  const rect = toLocalBox(space, area.getBoundingClientRect());
  const box: Box = {
    left: rect.left + AREA_MARGIN,
    top: rect.top - AREA_SLACK,
    right: rect.right - AREA_MARGIN,
    bottom: rect.bottom + AREA_SLACK,
  };
  const own = toLocalBox(space, list.getBoundingClientRect());
  for (const avoid of area.querySelectorAll<HTMLElement>("[data-cloud-avoid]")) {
    const words = toLocalBox(space, avoid.getBoundingClientRect());
    if (words.right <= own.left + 1) box.left = Math.max(box.left, words.right + AVOID_MARGIN);
    else if (words.left >= own.right - 1)
      box.right = Math.min(box.right, words.left - AVOID_MARGIN);
    else if (words.bottom <= own.top + 1) box.top = Math.max(box.top, words.bottom + AVOID_MARGIN);
    else if (words.top >= own.bottom - 1)
      box.bottom = Math.min(box.bottom, words.top - AVOID_MARGIN);
  }
  return box;
}

type Range = readonly [number, number];

/** The offsets that keep a pill inside the box, on each axis; a pill larger than the box is centred. */
function rangeOf(pill: Pill, box: Box): { readonly x: Range; readonly y: Range } {
  const axis = (low: number, high: number): Range =>
    low > high ? [(low + high) / 2, (low + high) / 2] : [low, high];
  return {
    x: axis(
      box.left - (pill.home.x - pill.home.w / 2),
      box.right - (pill.home.x + pill.home.w / 2),
    ),
    y: axis(
      box.top - (pill.home.y - pill.home.h / 2),
      box.bottom - (pill.home.y + pill.home.h / 2),
    ),
  };
}

/** Keeps the pill inside the box. */
function confine(pill: Pill, box: Box): void {
  const range = rangeOf(pill, box);
  pill.x = Math.min(Math.max(pill.x, range.x[0]), range.x[1]);
  pill.y = Math.min(Math.max(pill.y, range.y[0]), range.y[1]);
}

/**
 * Lets the pill past the box as on a band: it keeps following the pull, but gives less and
 * less the farther it is from the edge, and never stops dead.
 */
function stretch(pill: Pill, box: Box): void {
  const range = rangeOf(pill, box);
  const give = (value: number, [low, high]: Range) =>
    value > high
      ? high + STRETCH * Math.log1p((value - high) / STRETCH)
      : value < low
        ? low - STRETCH * Math.log1p((low - value) / STRETCH)
        : value;
  pill.x = give(pill.x, range.x);
  pill.y = give(pill.y, range.y);
}

/**
 * How two pills stand to each other: the line between their centres, scaled to the room they
 * keep (an ellipse of their sizes, the two half widths across and the two half heights down,
 * with the gap on top), so that `d` below 1 means they are in each other's room; and the line
 * itself, from the first to the second, in pixels.
 */
function between(pa: Pill, pb: Pill) {
  const dx = pb.home.x + pb.x - (pa.home.x + pa.x);
  const dy = pb.home.y + pb.y - (pa.home.y + pa.y);
  const rx = (pa.home.w + pb.home.w) / 2 + GAP;
  const ry = (pa.home.h + pb.home.h) / 2 + GAP;
  let u = dx / rx;
  let v = dy / ry;
  let d = Math.hypot(u, v);
  if (d < 0.001) {
    // One on top of the other: it goes aside, to the right.
    u = 0.001;
    v = 0;
    d = 0.001;
  }
  const nx = u * rx;
  const ny = v * ry;
  const n = Math.hypot(nx, ny) || 1;
  return { u, v, d, rx, ry, nx: nx / n, ny: ny / n };
}

/**
 * One step of the simulation, over `dt` seconds. The held pill, if any, is placed by the
 * pointer; every other pill is pushed by the field of the rest, slowed by drag, held by the
 * band past an edge and bounced at one, and moved; then any two in each other's room are moved
 * apart and knock each other along the line between them. Answers whether anything still
 * moves.
 */
export function step(world: World, dt: number): boolean {
  const { pills, area, held } = world;
  const slow = Math.exp(-dt / DRAG_S);
  let moving = false;
  pills.forEach((pill, i) => {
    if (i === held) return;
    let ax = 0;
    let ay = 0;
    pills.forEach((other, j) => {
      if (j === i) return;
      const { d, nx, ny } = between(other, pill);
      if (d >= FIELD) return;
      const force = FIELD_FORCE * ((FIELD - d) / (FIELD - 1)) ** 2;
      ax += force * nx;
      ay += force * ny;
    });
    pill.vx = (pill.vx + ax * dt) * slow;
    pill.vy = (pill.vy + ay * dt) * slow;
    const range = rangeOf(pill, area);
    const axis = (value: number, speed: number, [low, high]: Range) => {
      let p = value;
      let s = speed;
      if (p > high || p < low) {
        const over = p > high ? p - high : p - low;
        s += (-BAND * over - BAND_DAMPING * s) * dt;
      }
      p += s * dt;
      if (p > high && s > 0 && value <= high) {
        p = high;
        s = -s * WALL_BOUNCE;
      } else if (p < low && s < 0 && value >= low) {
        p = low;
        s = -s * WALL_BOUNCE;
      }
      return [p, s] as const;
    };
    [pill.x, pill.vx] = axis(pill.x, pill.vx, range.x);
    [pill.y, pill.vy] = axis(pill.y, pill.vy, range.y);
    const speed = Math.hypot(pill.vx, pill.vy);
    if (speed > MAX_SPEED) {
      pill.vx *= MAX_SPEED / speed;
      pill.vy *= MAX_SPEED / speed;
    }
    if (speed > STILL) moving = true;
  });
  // Contact: apart, and the knock, shared by weight. The held pill gives no way and takes no
  // knock; the one in hand or just thrown is the heavy one while it goes.
  const weight = (i: number) =>
    i === held
      ? Number.POSITIVE_INFINITY
      : i === world.thrown && Math.hypot(pills[i]?.vx ?? 0, pills[i]?.vy ?? 0) > 40
        ? THROWN_WEIGHT
        : 1;
  for (let a = 0; a < pills.length; a++) {
    for (let b = a + 1; b < pills.length; b++) {
      const pa = pills[a];
      const pb = pills[b];
      if (pa === undefined || pb === undefined) continue;
      const { d, rx, ry, u, v, nx, ny } = between(pa, pb);
      if (d >= 1) continue;
      const wa = weight(a);
      const wb = weight(b);
      const shareA =
        wa === Number.POSITIVE_INFINITY ? 0 : wb === Number.POSITIVE_INFINITY ? 1 : wb / (wa + wb);
      const shareB = 1 - shareA;
      const apart = { x: u * rx * (1 / d - 1) * APART, y: v * ry * (1 / d - 1) * APART };
      pa.x -= apart.x * shareA;
      pa.y -= apart.y * shareA;
      pb.x += apart.x * shareB;
      pb.y += apart.y * shareB;
      if (a !== held) confine(pa, area);
      if (b !== held) confine(pb, area);
      const along = (pb.vx - pa.vx) * nx + (pb.vy - pa.vy) * ny;
      if (along >= 0) continue;
      const knock = Math.min(-(1 + KNOCK) * along, MAX_KNOCK);
      pa.vx -= knock * shareA * nx;
      pa.vy -= knock * shareA * ny;
      pb.vx += knock * shareB * nx;
      pb.vy += knock * shareB * ny;
      moving = true;
    }
  }
  return moving;
}

/**
 * Makes the list the ref is put on a cloud whose pills can be pulled about with the pointer.
 * A mouse takes a pill once it has travelled a few pixels; a finger has to rest on one first,
 * so that a swipe still scrolls the page. The list's room is the nearest `[data-cloud-area]`,
 * less any `[data-cloud-avoid]` in it.
 */
export function useCloudDrag<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const list = ref.current;
    if (list === null) return;
    let world: World | null = null;
    let press: Press | null = null;
    /** A drag has just ended: the click the browser sends after it is not one. */
    let dragged = false;
    let frame: number | undefined;
    let lastTime = 0;
    /** How many frames in a row everything has been near enough still. */
    let quiet = 0;

    /** The cloud as the page has it now: the pills in the list, where each stands, its room. */
    const measure = (): World => {
      const space = spaceOf(list);
      const items = [...list.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const homes = homesOf(items, space);
      const pills = homes.map((home, i): Pill => {
        const kept = world !== null && world.items[i] === items[i] ? world.pills[i] : undefined;
        const item = items[i];
        const offset = item === undefined ? { x: 0, y: 0 } : offsetOf(item);
        return { home, x: offset.x, y: offset.y, vx: kept?.vx ?? 0, vy: kept?.vy ?? 0 };
      });
      return {
        space,
        items,
        pills,
        area: areaOf(list, space),
        held: -1,
        thrown: world?.thrown ?? -1,
        at: world?.at ?? { x: 0, y: 0 },
        grip: { x: 0, y: 0 },
      };
    };

    /** A frame: the held pill under the pointer, everything else by the rules, and written. */
    const tick = (now: number) => {
      frame = undefined;
      if (world === null) return;
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0.001), MAX_STEP_S);
      lastTime = now;
      const held = world.pills[world.held];
      if (held !== undefined) {
        const at = toLocal(world.space, world.at);
        const was = { x: held.x, y: held.y };
        held.x = at.x - world.grip.x - held.home.x;
        held.y = at.y - world.grip.y - held.home.y;
        stretch(held, world.area);
        // Its speed, for the knocks it gives and for the throw, read from where it went,
        // smoothed over the last frames.
        held.vx = held.vx * 0.5 + ((held.x - was.x) / dt) * 0.5;
        held.vy = held.vy * 0.5 + ((held.y - was.y) / dt) * 0.5;
      }
      const moving = step(world, dt);
      world.items.forEach((item, i) => {
        const pill = world?.pills[i];
        if (pill !== undefined) place(item, pill);
      });
      const fastest = Math.max(...world.pills.map((pill) => Math.hypot(pill.vx, pill.vy)));
      quiet = fastest < STILL * 4 && world.held < 0 ? quiet + 1 : 0;
      if (world.held >= 0 || (moving && quiet < 45)) {
        frame = window.requestAnimationFrame(tick);
      } else {
        for (const pill of world.pills) {
          pill.vx = 0;
          pill.vy = 0;
        }
      }
    };
    const run = () => {
      if (frame === undefined) {
        lastTime = performance.now();
        frame = window.requestAnimationFrame(tick);
      }
    };

    /** The pill comes loose and follows from here. */
    const loosen = () => {
      if (press === null || press.moving || world === null) return;
      press.moving = true;
      dragged = true;
      list.dataset.dragging = "";
      press.item.dataset.held = "";
      if (!press.hold) document.body.style.cursor = "grabbing";
      run();
    };

    /** The pill is let go, with the speed it had: the rules carry on from here. */
    const end = () => {
      if (press === null) return;
      const { item, timer, moving } = press;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.removeEventListener("touchmove", block);
      document.removeEventListener("contextmenu", quietly);
      if (world !== null) {
        const held = world.pills[world.held];
        if (held !== undefined) {
          const speed = Math.hypot(held.vx, held.vy);
          if (speed > MAX_SPEED) {
            held.vx *= MAX_SPEED / speed;
            held.vy *= MAX_SPEED / speed;
          }
        }
        world.thrown = world.held;
        world.held = -1;
      }
      if (moving) {
        delete list.dataset.dragging;
        delete item.dataset.held;
        document.body.style.cursor = "";
        quiet = 0;
        run();
        // The click that follows a mouse's release comes at once; a finger's never comes.
        window.setTimeout(() => {
          dragged = false;
        }, 0);
      }
      press = null;
    };

    const follow = (event: PointerEvent) => {
      if (press === null || world === null) return;
      world.at = { x: event.clientX, y: event.clientY };
      if (!press.moving) {
        const travelled = Math.hypot(world.at.x - press.from.x, world.at.y - press.from.y);
        if (press.hold) {
          // A finger that wanders before it has rested is scrolling, and lets the pill go.
          if (travelled > HOLD_SLACK) end();
          return;
        }
        if (travelled > DRAG_SLACK) loosen();
      }
    };

    /** Once the pill has come loose, the page no longer scrolls under the finger. */
    const block = (event: TouchEvent) => {
      if (press?.moving === true) event.preventDefault();
    };
    const quietly = (event: Event) => event.preventDefault();

    const start = (event: PointerEvent) => {
      if (event.button !== 0 || press !== null || !(event.target instanceof Element)) return;
      const item = event.target.closest("li");
      if (item === null || item.parentElement !== list) return;
      world = measure();
      const index = world.items.indexOf(item);
      const held = world.pills[index];
      if (held === undefined) return;
      const hold = event.pointerType !== "mouse";
      // A mouse's press is the drag's beginning and nothing else: no text is selected on the
      // way, and the click still comes if it turns out to be one.
      if (!hold) event.preventDefault();
      const from = { x: event.clientX, y: event.clientY };
      const local = toLocal(world.space, from);
      world.held = index;
      world.at = from;
      world.grip = { x: local.x - (held.home.x + held.x), y: local.y - (held.home.y + held.y) };
      held.vx = 0;
      held.vy = 0;
      press = {
        item,
        from,
        hold,
        moving: false,
        timer: hold ? window.setTimeout(loosen, HOLD_MS) : undefined,
      };
      window.addEventListener("pointermove", follow);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      document.addEventListener("touchmove", block, { passive: false });
      document.addEventListener("contextmenu", quietly);
    };

    /** A link is not followed at the end of a drag, and a pill is never dragged as a link. */
    const click = (event: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const noDrag = (event: Event) => event.preventDefault();

    list.addEventListener("pointerdown", start);
    list.addEventListener("click", click, true);
    list.addEventListener("dragstart", noDrag);
    return () => {
      end();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      list.removeEventListener("pointerdown", start);
      list.removeEventListener("click", click, true);
      list.removeEventListener("dragstart", noDrag);
    };
  }, []);
  return ref;
}
