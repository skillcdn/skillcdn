// The score of the agent accounts' scene on the front page: what every part of the stage does
// over one pass, in seconds, and when. It is pure: given where things stand on the stage it
// answers the keyframes of each part and the stretch of the pass it moves in, and the component
// hands them to the browser as one animation a part (`Element.animate`), opacity and transforms
// alone. A part is at rest outside its stretch, so that at any moment only the few that move cost
// anything, and the parts are begun together and can never drift apart.

/** One pass of the scene, in seconds and in milliseconds. */
export const PASS = 35;
export const PASS_MS = PASS * 1000;

/** The moment that stands still for whoever asked for less motion: the team at work. */
export const STILL_MS = 17_600;

/** The agents the scene has, the faces the form offers, and the cards of the board. */
export const AGENTS = [0, 1, 2] as const;
export const FACES = [0, 1, 2, 3] as const;
export const CARDS = [0, 1, 2, 3] as const;
/** The card of the second job, which is done the way the first one taught. */
export const AGAIN = 3;

const OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN = "cubic-bezier(0.55, 0, 0.9, 0.3)";
const BOTH = "cubic-bezier(0.65, 0, 0.2, 1)";
const BACK = "cubic-bezier(0.3, 1.7, 0.45, 1)";
const ROLL = "cubic-bezier(0.1, 0.75, 0.15, 1)";
const RISE = "cubic-bezier(0.2, 0.7, 0.5, 1)";
const FALL = "cubic-bezier(0.5, 0, 0.8, 0.35)";
const LINEAR = "linear";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where things stand on the stage, in pixels from its top left, nothing moved. */
export interface Geometry {
  /** One unit of the stage's own measure. */
  readonly unit: number;
  /** Where each agent stands at work, which is where the stylesheet puts it. */
  readonly homes: readonly Point[];
  /** Where each stands when it has just been made. */
  readonly lineup: readonly Point[];
  /** Where each stands while the work is told and split. */
  readonly brief: readonly Point[];
  /** Where they gather at the end of a pass, and how far from there each keeps. */
  readonly hub: Point;
  readonly reach: number;
  /** The faces the form offers, how far one rolls, and the form's button. */
  readonly faces: readonly Point[];
  readonly roll: number;
  readonly add: Point;
  /** Where the conversation is spoken from, and where the board is written to. */
  readonly chat: Point;
  readonly board: Point;
  /** The first place of each card, and how far the next column is. */
  readonly cards: readonly Point[];
  readonly column: number;
  /**
   * How far the window behind stands out over the one in front, where the conversation and the
   * board share one place; nothing where they stand side by side.
   */
  readonly deck: number;
  /** The decision: its middle, the two options and the button that answers. */
  readonly ask: Point;
  readonly options: readonly Point[];
  readonly answer: Point;
  /** How far up the conversation stands once each message is in, and the feed's one line. */
  readonly scrolls: readonly number[];
  readonly line: number;
  /** How many letters are typed into the form. */
  readonly names: readonly number[];
  readonly titles: readonly number[];
  /** Which line of what is being written each word is on, and how tall such a line is. */
  readonly order: readonly number[];
  readonly reply: readonly number[];
  readonly draft: number;
}

/** What a part is at a moment: its place from where it stands, in pixels, and the rest. */
export interface Frame {
  readonly opacity?: number;
  readonly move?: readonly [number, number];
  readonly scale?: number | readonly [number, number];
  readonly rotate?: number;
}

/** How long a part is at rest at either end of the stretch it moves in, in seconds. */
export const REST = 0.05;

type Property = "opacity" | "translate" | "scale" | "rotate";

interface Step {
  readonly from: number;
  readonly until: number;
  readonly value: string | number;
  readonly ease: string;
}

/** A frame as the properties of a keyframe. */
export function properties(frame: Frame): readonly (readonly [Property, string | number])[] {
  const out: (readonly [Property, string | number])[] = [];
  if (frame.opacity !== undefined) out.push(["opacity", frame.opacity]);
  if (frame.move !== undefined) out.push(["translate", `${frame.move[0]}px ${frame.move[1]}px`]);
  if (frame.scale !== undefined) {
    out.push([
      "scale",
      typeof frame.scale === "number" ? `${frame.scale}` : `${frame.scale[0]} ${frame.scale[1]}`,
    ]);
  }
  if (frame.rotate !== undefined) out.push(["rotate", `${frame.rotate}deg`]);
  return out;
}

/** What a part does: its keyframes over the stretch of the pass it moves in, in seconds. */
export interface Play {
  readonly from: number;
  readonly until: number;
  readonly keyframes: readonly Keyframe[];
}

/** One part of the stage over a pass: how it starts, and each move in turn. */
export class Part {
  private readonly start = new Map<Property, string | number>();
  private readonly steps = new Map<Property, Step[]>();
  readonly name: string;

  constructor(name: string, start: Frame) {
    this.name = name;
    for (const [property, value] of properties(start)) this.start.set(property, value);
  }

  /** Moves to `frame` from the moment `at`, over `seconds`. */
  to(at: number, seconds: number, frame: Frame, ease: string = OUT): this {
    for (const [property, value] of properties(frame)) {
      if (!this.start.has(property)) {
        throw new Error(`${this.name}: ${property} moves from nowhere`);
      }
      const steps = this.steps.get(property) ?? [];
      const last = steps.at(-1);
      // A hair's breadth, since moments are sums of decimals.
      if (last !== undefined && at < last.until - 1e-6) {
        throw new Error(`${this.name}: ${property} at ${at} before ${last.until}`);
      }
      if (at + seconds > PASS) throw new Error(`${this.name}: ${property} past the end`);
      steps.push({ from: at, until: at + seconds, value, ease });
      this.steps.set(property, steps);
    }
    return this;
  }

  /** Is `frame` from the moment `at` on, without a move. */
  jump(at: number, frame: Frame): this {
    return this.to(at, 0, frame, LINEAR);
  }

  /** The stretch it moves in, and the keyframes over it, each of one property, in order of time. */
  play(): Play {
    const steps = [...this.steps.values()].flat();
    // A moment early and a moment late. Outside its stretch a part is what the keyframe at that end
    // of it says, and of two there the wrong one can be taken: the last of the first moment, which
    // a part that begins with a jump must not be yet, and at the other end, by Firefox's
    // compositor, the one before a jump that ends it, which left what had been sent standing.
    const from = Math.max(0, Math.min(...steps.map((step) => step.from)) - REST);
    const until = Math.min(PASS, Math.max(...steps.map((step) => step.until)) + REST);
    const offset = (at: number): number => Math.min(1, (at - from) / (until - from));
    const frames: (Keyframe & { offset: number })[] = [];
    for (const [property, start] of this.start) {
      let value = start;
      frames.push({ offset: 0, [property]: value });
      for (const step of this.steps.get(property) ?? []) {
        frames.push({ offset: offset(step.from), [property]: value, easing: step.ease });
        value = step.value;
        frames.push({ offset: offset(step.until), [property]: value });
      }
      frames.push({ offset: 1, [property]: value });
    }
    return { from, until, keyframes: frames.sort((a, b) => a.offset - b.offset) };
  }
}

// The moments several parts share, in seconds.

/** Each agent made: its face picked, the button pressed, the planet away. */
const MADE = [
  { pick: 2, press: 3, join: 3.1 },
  { pick: 3.65, press: 4.45, join: 4.55 },
  { pick: 5, press: 5.75, join: 5.85 },
] as const;
/** When each agent leaves the line to hear of the work, and then for its place at it. */
const BRIEFED = [7.15, 7.25, 7.35] as const;
const HOME = [12.8, 12.84, 12.88] as const;
/** When each first hears of the work. */
const WOKEN = [10.45, 11.65, 11.65] as const;
/** When each message arrives in the conversation, and who says it; the first three are joinings. */
export const MESSAGES = [
  { at: 7.75, by: 0 },
  { at: 7.95, by: 1 },
  { at: 8.15, by: 2 },
  { at: 9.6, by: "me" },
  { at: 11, by: 0 },
  { at: 12, by: 1 },
  { at: 12.55, by: 2 },
  { at: 15.4, by: 1 },
  { at: 16.3, by: 2 },
  { at: 18.35, by: 1 },
  { at: 24.9, by: 0 },
  { at: 26.6, by: "me" },
  { at: 30.95, by: 0 },
] as const;
/** Which of them is the order, the report of the result and the answer to it. */
export const JOINED = 3;
export const ORDER = 3;
export const REPORT = 10;
export const REPLY = 11;
/** When an agent is seen typing. */
const TYPING = [
  { by: 0, from: 10.3, until: 10.95 },
  { by: 1, from: 11.6, until: 11.95 },
  { by: 2, from: 12.1, until: 12.5 },
  { by: 1, from: 14.7, until: 15.35 },
  { by: 2, from: 15.8, until: 16.25 },
  { by: 1, from: 17.8, until: 18.3 },
  { by: 0, from: 24.1, until: 24.85 },
  { by: 0, from: 30.4, until: 30.9 },
] as const;
/** When each card leaves its agent, is up for review, and is done. */
const TAKEN = [13.95, 14.2, 14.45] as const;
const REVIEW = [23.1, 23.35, 23.6] as const;
const DONE = [27, 27.15, 27.3] as const;
/** The same of the second job, which waits for nobody. */
const NEXT = { taken: 28.85, review: 29.75, done: 30.2 } as const;
/** When what the work taught comes to each agent, off its card. */
const LEARNT = [27.75, 27.85, 27.95] as const;
/**
 * When each agent gains a mark of what it learned: the designer from the answer, all of them from
 * the first job, the other two from the second.
 */
export const MARKS: readonly [readonly number[], readonly number[], readonly number[]] = [
  [28.5, 30.75],
  [22.45, 28.6],
  [28.7, 30.85],
];
/** When the lines of the feed arrive, the oldest first. */
export const FEED = [14.75, 16.2, 17.3, 18.5, 22.1, 23.95, 27.5, 28.65, 30.6] as const;
/** When the scene is put away, and when what stood on the stage is made ready for the next pass. */
const OUTRO = 31.6;
const CLEAR = OUTRO + 0.85;
/** What an agent is said to be doing, from when until when, and whether it waits for somebody. */
interface Doing {
  readonly from: number;
  readonly until: number;
  readonly waits?: boolean;
}
export const DOING: readonly [readonly Doing[], readonly Doing[], readonly Doing[]] = [
  [
    { from: 3.8, until: 4.45, waits: true },
    { from: 4.45, until: 10.45 },
    { from: 10.45, until: 13.95 },
    { from: 13.95, until: 15.3 },
    { from: 15.3, until: 17.5 },
    { from: 17.5, until: 23.9 },
    { from: 23.9, until: 27.1 },
    { from: 27.1, until: 28.45 },
    { from: 28.45, until: 29.4 },
    { from: 29.4, until: 30.65 },
    { from: 30.65, until: OUTRO + 0.05 },
  ],
  [
    { from: 5.25, until: 5.9, waits: true },
    { from: 5.9, until: 11.65 },
    { from: 11.65, until: 14.2 },
    { from: 14.2, until: 15.2 },
    { from: 15.2, until: 18.3 },
    { from: 18.3, until: 22.3, waits: true },
    { from: 22.3, until: 23.8 },
    { from: 23.8, until: 27.2 },
    { from: 27.2, until: 28.55 },
    { from: 28.55, until: 29.45 },
    { from: 29.45, until: 30.7 },
    { from: 30.7, until: OUTRO + 0.05 },
  ],
  [
    { from: 6.55, until: 7.1, waits: true },
    { from: 7.1, until: 11.65 },
    { from: 11.65, until: 14.45 },
    { from: 14.45, until: 15.5 },
    { from: 15.5, until: 16.6 },
    { from: 16.6, until: 22.7 },
    { from: 22.7, until: 24 },
    { from: 24, until: 27.3 },
    { from: 27.3, until: 28.65 },
    { from: 28.65, until: 29.5 },
    { from: 29.5, until: 30.75 },
    { from: 30.75, until: OUTRO + 0.05 },
  ],
];
/** The comets a pass has at once, and the squares thrown when the work is done. */
export const COMETS = [0, 1, 2] as const;
export const SQUARES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

/** A light that goes from one place to another, and the agent that takes it, if one does. */
interface Beam {
  readonly at: number;
  readonly from: Point;
  readonly to: Point;
  readonly takes?: number;
}
const BEAM = 0.6;

/** What every part of the stage does, by the part's name. */
export function agentsScore(g: Geometry): ReadonlyMap<string, Play> {
  const u = (n: number): number => n * g.unit;
  const parts = new Map<string, Part>();
  const part = (name: string, start: Frame): Part => {
    const made = new Part(name, start);
    parts.set(name, made);
    return made;
  };
  const place = (points: readonly Point[], index: number): Point => points[index] ?? { x: 0, y: 0 };

  // The hand: it picks the faces, presses the buttons and answers the decision.
  const hand = part("hand", { opacity: 0, move: [0, 0], scale: 1 });
  const ripple = part("ripple", { opacity: 0, scale: 0.3 });
  const go = (at: number, seconds: number, to: Point): void => {
    hand.to(at, seconds, { move: [to.x, to.y] }, BOTH);
  };
  const tap = (at: number): void => {
    hand.to(at - 0.07, 0.07, { scale: 0.88 }).to(at, 0.25, { scale: 1 }, BACK);
    ripple.jump(at, { opacity: 0.75, scale: 0.3 }).to(at, 0.55, { opacity: 0, scale: 1.8 });
  };
  const press = (name: string, moments: readonly number[]): void => {
    const button = part(name, { scale: 1 });
    for (const at of moments) {
      button.to(at - 0.05, 0.09, { scale: 0.93 }).to(at + 0.04, 0.3, { scale: 1 }, BACK);
    }
  };

  // 1. Made: the faces roll, one is picked, its name and its title are typed, and out it comes.
  part("hire", { opacity: 0, move: [0, u(30)], scale: 0.96 })
    .to(0.15, 0.75, { opacity: 1, move: [0, 0], scale: 1 })
    .to(6.75, 0.5, { opacity: 0, move: [u(-46), 0], scale: 0.97 }, IN);
  for (const face of FACES) {
    part(`strip-${face}`, { move: [0, -g.roll] })
      .to(0.35, 1 + face * 0.17, { move: [0, 0] }, ROLL)
      .jump(7.4, { move: [0, -g.roll] });
    part(`persona-${face}`, { opacity: 0, move: [0, u(5)] })
      .to(1.15 + face * 0.17, 0.35, { opacity: 1, move: [0, 0] })
      .jump(7.4, { opacity: 0, move: [0, u(5)] });
  }
  const first = place(g.faces, 0);
  const pick = part("pick", { opacity: 0, move: [0, 0], scale: 1.12 });
  hand.jump(1.4, { move: [first.x + u(150), first.y + u(190)] }).to(1.42, 0.25, { opacity: 1 });
  MADE.forEach((made, agent) => {
    const face = place(g.faces, agent);
    if (agent === 0) {
      go(1.45, 0.5, face);
      pick.to(made.pick, 0.25, { opacity: 1, scale: 1 });
    } else {
      go(made.pick - 0.42, 0.38, face);
      pick.to(made.pick, 0.25, { move: [face.x - first.x, face.y - first.y] });
    }
    tap(made.pick);
    go(made.press - 0.5, 0.44, g.add);
    tap(made.press);
    const cleared = MADE[agent + 1]?.pick ?? 7.4;
    const letters = (name: string, count: number, at: number, gap: number): void => {
      for (let letter = 0; letter < count; letter += 1) {
        part(`${name}-${agent}-${letter}`, { opacity: 0 })
          .jump(at + letter * gap, { opacity: 1 })
          .jump(cleared, { opacity: 0 });
      }
    };
    const names = g.names[agent] ?? 0;
    const titles = g.titles[agent] ?? 0;
    letters("name", names, made.pick + 0.12, 0.22 / Math.max(1, names));
    letters("title", titles, made.pick + 0.36, 0.28 / Math.max(1, titles));
  });
  hand.to(6.15, 0.3, { opacity: 0 });
  pick.jump(7.4, { opacity: 0, move: [0, 0], scale: 1.12 });
  press(
    "add",
    MADE.map((made) => made.press),
  );

  // The planets: out of the form into a line, home, about the hub at the end.
  const pulses: { readonly agent: number; readonly at: number }[] = [];
  const pulse = (agent: number, at: number): void => {
    pulses.push({ agent, at });
  };
  for (const agent of AGENTS) {
    const made = MADE[agent];
    const home = place(g.homes, agent);
    const line = place(g.lineup, agent);
    const face = place(g.faces, agent);
    const angle = ((-90 + agent * 120) * Math.PI) / 180;
    const about = {
      x: g.hub.x + g.reach * Math.cos(angle),
      y: g.hub.y + g.reach * Math.sin(angle),
    };
    const brief = place(g.brief, agent);
    const top = Math.max(Math.min(face.y, line.y) - u(64), u(22));
    part(`agent-${agent}-x`, { move: [face.x - home.x, 0] })
      .to(made.join, 0.8, { move: [line.x - home.x, 0] }, "cubic-bezier(0.35, 0.2, 0.4, 1)")
      .to(BRIEFED[agent], 1, { move: [brief.x - home.x, 0] }, BOTH)
      .to(HOME[agent], 1, { move: [0, 0] }, BOTH)
      .to(OUTRO + 0.4 + agent * 0.08, 0.9, { move: [about.x - home.x, 0] }, BOTH)
      .to(OUTRO + 2.4, 0.5, { move: [g.hub.x - home.x, 0] }, IN)
      .jump(OUTRO + 2.95, { move: [face.x - home.x, 0] });
    part(`agent-${agent}-y`, { move: [0, face.y - home.y] })
      .to(made.join, 0.36, { move: [0, top - home.y] }, RISE)
      .to(made.join + 0.36, 0.44, { move: [0, line.y - home.y] }, FALL)
      .to(BRIEFED[agent], 1, { move: [0, brief.y - home.y] }, "cubic-bezier(0.5, -0.25, 0.3, 1)")
      .to(HOME[agent], 1, { move: [0, 0] }, "cubic-bezier(0.5, -0.25, 0.3, 1)")
      .to(DONE[agent] + 0.05, 0.22, { move: [0, u(-24)] }, RISE)
      .to(DONE[agent] + 0.27, 0.24, { move: [0, 0] }, FALL)
      .to(DONE[agent] + 0.51, 0.16, { move: [0, u(-9)] }, RISE)
      .to(DONE[agent] + 0.67, 0.16, { move: [0, 0] }, FALL)
      .to(OUTRO + 0.4 + agent * 0.08, 0.9, { move: [0, about.y - home.y] }, BOTH)
      .to(OUTRO + 2.4, 0.5, { move: [0, g.hub.y - home.y] }, IN)
      .jump(OUTRO + 2.95, { move: [0, face.y - home.y] });
    const body = part(`agent-${agent}`, { opacity: 0, scale: 0.3 })
      .to(made.join, 0.12, { opacity: 1 })
      .to(made.join + 0.05, 0.75, { scale: 1.18 }, BACK)
      .to(WOKEN[agent], 0.16, { scale: 1.36 }, RISE)
      .to(WOKEN[agent] + 0.16, 0.45, { scale: 1.18 }, BACK)
      .to(HOME[agent], 0.9, { scale: 1 }, BOTH);
    // What it learns shows on it: a mark beside its name, and a body a little larger.
    MARKS[agent].forEach((at, index) => {
      const grown = 1 + (index + 1) * 0.06;
      body
        .to(at - 0.1, 0.16, { scale: grown + 0.18 }, RISE)
        .to(at + 0.06, 0.45, { scale: grown }, BACK);
      pulse(agent, at - 0.1);
      part(`mark-${agent}-${index}`, { opacity: 0, scale: 0, rotate: -90 })
        .to(at, 0.5, { opacity: 1, scale: 1, rotate: 0 }, BACK)
        .jump(OUTRO + 0.4, { opacity: 0, scale: 0, rotate: -90 });
    });
    body
      .to(OUTRO + 0.45, 0.8, { scale: 0.9 }, BOTH)
      .to(OUTRO + 2.4, 0.5, { scale: 0 }, IN)
      .jump(OUTRO + 2.95, { opacity: 0, scale: 0.3 });
    pulse(agent, made.join + 0.72);
    part(`seat-${agent}`, { opacity: 0, scale: 0.7 })
      .to(0.6 + agent * 0.14, 0.6, { opacity: 1, scale: 1 })
      .to(made.join + 0.6, 0.3, { opacity: 0, scale: 1.3 });
    part(`tag-${agent}`, { opacity: 0, move: [0, u(8)] })
      .to(made.join + 0.6, 0.4, { opacity: 1, move: [0, 0] })
      .to(OUTRO + 0.05, 0.3, { opacity: 0 }, IN)
      .jump(OUTRO + 2.95, { move: [0, u(8)] });
    part(`moon-${agent}`, { scale: 0 })
      .to(WOKEN[agent] + 0.1, 0.5, { scale: 1 }, BACK)
      .to(OUTRO + 0.05, 0.3, { scale: 0 }, IN);
    DOING[agent].forEach((doing, index) => {
      part(`doing-${agent}-${index}`, { opacity: 0, move: [0, u(7)] })
        .to(doing.from, 0.25, { opacity: 1, move: [0, 0] })
        .to(doing.until - 0.12, 0.12, { opacity: 0, move: [0, u(-6)] }, IN)
        .jump(doing.until + 0.05, { move: [0, u(7)] });
    });
  }
  part("fleet", { rotate: 0 })
    .to(OUTRO + 0.45, 2.4, { rotate: 250 }, BOTH)
    .jump(OUTRO + 3.05, { rotate: 0 });

  // 2. Told: the conversation comes in, an order is typed and sent, and the team answers.
  const aside: Frame = { opacity: 0, move: [u(g.deck > 0 ? 64 : -64), 0], scale: 1 };
  const front: Frame = { opacity: 1, move: [0, 0], scale: 1 };
  const behind: Frame = { opacity: 0.5, move: [0, -g.deck], scale: 0.92 };
  const chat = part("chat", aside).to(7.15, 0.9, front);
  if (g.deck > 0) {
    chat.to(13.4, 0.75, behind).to(24.25, 0.65, front).to(26.72, 0.6, behind);
    chat.to(OUTRO - 0.05, 0.5, { opacity: 0 }, IN).jump(OUTRO + 0.6, aside);
  } else {
    chat.to(OUTRO - 0.05, 0.5, aside, IN);
  }
  part("empty", { opacity: 1 })
    .jump(8.35, { opacity: 0 })
    .jump(9.6, { opacity: 1 })
    .jump(26.05, { opacity: 0 })
    .jump(26.6, { opacity: 1 });
  // The box one writes in is a line tall, grows as the words run into the next, and is a line tall
  // again once they are sent; what is above it makes way.
  const grow = part("grow", { move: [0, 0] });
  const lists: { readonly at: number; readonly seconds: number; readonly y: number }[] = [];
  const typed = (
    name: string,
    lines: readonly number[],
    from: number,
    until: number,
    message: number,
  ): void => {
    const sent = MESSAGES[message]?.at ?? until;
    const draft = part(`draft-${name}`, { move: [0, 0] });
    let grown = 0;
    lines.forEach((line, word) => {
      const at = from + ((until - from) * word) / lines.length;
      part(`${name}-${word}`, { opacity: 0 }).jump(at, { opacity: 1 }).jump(sent, { opacity: 0 });
      if (line <= grown) return;
      grown = line;
      const up = -line * g.draft;
      grow.to(at, 0.16, { move: [0, up] });
      draft.to(at, 0.16, { move: [0, up] });
      lists.push({ at, seconds: 0.16, y: up - (g.scrolls[message - 1] ?? 0) });
    });
    draft.jump(sent, { move: [0, 0] });
    grow.to(sent, 0.2, { move: [0, 0] });
  };
  typed("order", g.order, 8.35, 9.3, ORDER);
  typed("reply", g.reply, 26.05, 26.4, REPLY);
  part("ready", { opacity: 0 })
    .to(8.4, 0.15, { opacity: 1 })
    .to(9.65, 0.2, { opacity: 0 })
    .to(26.1, 0.15, { opacity: 1 })
    .to(26.62, 0.2, { opacity: 0 });
  press("send", [9.52, 26.52]);
  // The newest message stands at the foot of the list, as a messenger has it.
  const list = part("messages", { move: [0, -(g.scrolls[0] ?? 0)] });
  MESSAGES.forEach((message, index) => {
    part(`message-${index}`, { opacity: 0, move: [0, u(14)] })
      .to(message.at, 0.4, { opacity: 1, move: [0, 0] })
      .jump(CLEAR, { opacity: 0 });
    const scroll = g.scrolls[index] ?? 0;
    // Joinings come quicker than the list has time for.
    const soon = index < JOINED ? 0.18 : 0.38;
    if (index > 0) lists.push({ at: message.at - 0.02, seconds: soon, y: -scroll });
  });
  for (const { at, seconds, y } of lists.sort((a, b) => a.at - b.at)) {
    list.to(at, seconds, { move: [0, y] });
  }
  list.jump(CLEAR, { move: [0, -(g.scrolls[0] ?? 0)] });
  part("seen", { opacity: 0, scale: 0.4 })
    .to(10.2, 0.35, { opacity: 1, scale: 1 }, BACK)
    .jump(CLEAR, { opacity: 0, scale: 0.4 });
  for (const agent of AGENTS) {
    const typing = part(`typing-${agent}`, { opacity: 0 });
    for (const moment of TYPING) {
      if (moment.by !== agent) continue;
      typing.to(moment.from, 0.15, { opacity: 1 }).to(moment.until - 0.1, 0.1, { opacity: 0 });
    }
  }

  // 3. Together: the team writes its own tasks and works them side by side.
  if (g.deck > 0) {
    // Over the conversation: solid at once, so that the two are never seen through one another.
    const below: Frame = { move: [0, u(84)] };
    const board = part("board", { opacity: 0, ...below });
    for (const [from, until] of [
      [13.4, 24.2],
      [26.7, OUTRO],
    ] as const) {
      board
        .to(from, 0.1, { opacity: 1 }, LINEAR)
        .to(from, 0.7, { move: [0, 0] })
        .to(until, 0.42, below, IN)
        .to(until + 0.3, 0.12, { opacity: 0 }, LINEAR);
    }
  } else {
    part("board", { opacity: 0, move: [u(64), 0] })
      .to(13.4, 0.75, { opacity: 1, move: [0, 0] })
      .to(OUTRO, 0.5, { opacity: 0, move: [u(64), 0] }, IN);
  }
  const row = place(g.cards, 1).y - place(g.cards, 0).y;
  for (const agent of AGENTS) {
    const home = place(g.homes, agent);
    const card = place(g.cards, agent);
    const at = TAKEN[agent];
    const top = Math.min(home.y, card.y) - u(46);
    part(`card-${agent}-x`, { move: [home.x - card.x, 0] })
      .to(at, 0.8, { move: [0, 0] }, "cubic-bezier(0.4, 0.1, 0.3, 1)")
      .to(REVIEW[agent], 0.6, { move: [g.column, 0] }, BOTH)
      .to(DONE[agent], 0.5, { move: [2 * g.column, 0] }, BOTH)
      .jump(CLEAR, { move: [home.x - card.x, 0] });
    part(`card-${agent}-y`, { move: [0, home.y - card.y] })
      .to(at, 0.36, { move: [0, top - card.y] }, RISE)
      .to(at + 0.36, 0.44, { move: [0, 0] }, FALL)
      // Done, the three lie on one another under the place the next one comes to.
      .to(NEXT.done - 0.1, 0.5, { move: [0, (1 - agent) * row + u(agent * 5)] }, BOTH)
      .jump(CLEAR, { move: [0, home.y - card.y] });
    part(`card-${agent}`, { opacity: 0, scale: 0.15, rotate: -9 })
      .to(at, 0.15, { opacity: 1 })
      .to(at + 0.02, 0.78, { scale: 1, rotate: 0 }, "cubic-bezier(0.3, 0.6, 0.3, 1)")
      .to(REVIEW[agent], 0.2, { scale: 1.05, rotate: 1.6 })
      .to(REVIEW[agent] + 0.35, 0.3, { scale: 1, rotate: 0 })
      .to(DONE[agent], 0.18, { scale: 1.05, rotate: 1.6 })
      .to(DONE[agent] + 0.28, 0.3, { scale: 1, rotate: 0 })
      .jump(CLEAR, { opacity: 0, scale: 0.15, rotate: -9 });
    part(`worker-${agent}`, { scale: 0 })
      .to(at + 0.85, 0.35, { scale: 1 }, BACK)
      .jump(CLEAR, { scale: 0 });
    const bar = part(`bar-${agent}`, { scale: [0, 1] });
    const worked = [
      [15.05 + agent * 0.15, 0.8, 0.22 + agent * 0.05],
      [16 + agent * 0.2, 1.2, 0.5 + agent * 0.06],
      [17.4 + agent * 0.15, 0.7, agent === 1 ? 0.62 : 0.7 + agent * 0.03],
    ] as const;
    for (const [from, seconds, much] of worked) {
      bar.to(from, seconds, { scale: [much, 1] }, BOTH);
    }
    bar.to(22.35 + agent * 0.12, 0.65, { scale: [1, 1] }, BOTH).jump(CLEAR, { scale: [0, 1] });
    const check = part(`check-${agent}`, { opacity: 0, scale: 0.2 }).to(
      DONE[agent] + 0.4,
      0.4,
      { opacity: 1, scale: 1 },
      BACK,
    );
    // Of the three on one another, the last is seen.
    if (agent < 2) check.to(NEXT.done - 0.1, 0.2, { opacity: 0 });
    check.jump(CLEAR, { opacity: 0, scale: 0.2 });
  }
  // What the work taught comes off each done card into its agent.
  for (const agent of AGENTS) {
    const home = place(g.homes, agent);
    const card = place(g.cards, agent);
    const at = LEARNT[agent];
    const from = { x: card.x + 2 * g.column, y: card.y };
    const top = Math.max(Math.min(home.y, from.y) - u(60), u(14));
    part(`spark-${agent}-x`, { move: [from.x, 0] })
      .to(at, 0.7, { move: [home.x, 0] }, "cubic-bezier(0.4, 0.1, 0.5, 1)")
      .jump(CLEAR, { move: [from.x, 0] });
    part(`spark-${agent}-y`, { move: [0, from.y] })
      .to(at, 0.32, { move: [0, top] }, RISE)
      .to(at + 0.32, 0.38, { move: [0, home.y] }, FALL)
      .jump(CLEAR, { move: [0, from.y] });
    part(`spark-${agent}`, { opacity: 0, scale: 0.2, rotate: 0 })
      .to(at, 0.12, { opacity: 1 }, LINEAR)
      .to(at, 0.3, { scale: 1 }, BACK)
      .to(at, 0.7, { rotate: 220 }, LINEAR)
      .to(at + 0.45, 0.25, { scale: 0.4 }, IN)
      .to(at + 0.64, 0.08, { opacity: 0 }, LINEAR)
      .jump(CLEAR, { scale: 0.2, rotate: 0 });
  }

  // The second job: thrown by the first, worked by all three, and across the board at once.
  {
    const home = place(g.homes, 0);
    const card = place(g.cards, AGAIN);
    const at = NEXT.taken;
    const top = Math.min(home.y, card.y) - u(46);
    part(`card-${AGAIN}-x`, { move: [home.x - card.x, 0] })
      .to(at, 0.7, { move: [0, 0] }, "cubic-bezier(0.4, 0.1, 0.3, 1)")
      .to(NEXT.review, 0.36, { move: [g.column, 0] }, BOTH)
      .to(NEXT.done, 0.36, { move: [2 * g.column, 0] }, BOTH)
      .jump(CLEAR, { move: [home.x - card.x, 0] });
    part(`card-${AGAIN}-y`, { move: [0, home.y - card.y] })
      .to(at, 0.32, { move: [0, top - card.y] }, RISE)
      .to(at + 0.32, 0.38, { move: [0, 0] }, FALL)
      .jump(CLEAR, { move: [0, home.y - card.y] });
    part(`card-${AGAIN}`, { opacity: 0, scale: 0.15, rotate: -9 })
      .to(at, 0.15, { opacity: 1 })
      .to(at + 0.02, 0.68, { scale: 1, rotate: 0 }, "cubic-bezier(0.3, 0.6, 0.3, 1)")
      .to(NEXT.review, 0.15, { scale: 1.06, rotate: 2.4 })
      .to(NEXT.done + 0.2, 0.25, { scale: 1, rotate: 0 })
      .jump(CLEAR, { opacity: 0, scale: 0.15, rotate: -9 });
    part(`worker-${AGAIN}`, { scale: 0 })
      .to(at + 0.6, 0.3, { scale: 1 }, BACK)
      .jump(CLEAR, { scale: 0 });
    part(`bar-${AGAIN}`, { scale: [0, 1] })
      .to(at + 0.62, 0.8, { scale: [1, 1] }, BOTH)
      .jump(CLEAR, { scale: [0, 1] });
    part(`check-${AGAIN}`, { opacity: 0, scale: 0.2 })
      .to(NEXT.done + 0.36, 0.4, { opacity: 1, scale: 1 }, BACK)
      .jump(CLEAR, { opacity: 0, scale: 0.2 });
  }
  const counted = (
    name: string,
    most: number,
    moments: readonly (readonly [number, number])[],
  ): void => {
    for (let digit = 0; digit <= most; digit += 1) {
      const shown = part(`${name}-${digit}`, { opacity: digit === 0 ? 1 : 0 });
      for (const [at, value] of moments) shown.jump(at, { opacity: value === digit ? 1 : 0 });
    }
  };
  const taken = TAKEN.map((at) => at + 0.7);
  const moved = REVIEW.map((at) => at + 0.35);
  const closed = DONE.map((at) => at + 0.3);
  const at = (moments: readonly number[], index: number): number => moments[index] ?? 0;
  counted("count-doing", AGENTS.length, [
    [at(taken, 0), 1],
    [at(taken, 1), 2],
    [at(taken, 2), 3],
    [at(moved, 0), 2],
    [at(moved, 1), 1],
    [at(moved, 2), 0],
    [NEXT.taken + 0.6, 1],
    [NEXT.review + 0.2, 0],
  ]);
  counted("count-review", AGENTS.length, [
    [at(moved, 0), 1],
    [at(moved, 1), 2],
    [at(moved, 2), 3],
    [at(closed, 0), 2],
    [at(closed, 1), 1],
    [at(closed, 2), 0],
    [NEXT.review + 0.2, 1],
    [NEXT.done + 0.2, 0],
  ]);
  counted("count-done", CARDS.length, [
    [at(closed, 0), 1],
    [at(closed, 1), 2],
    [at(closed, 2), 3],
    [NEXT.done + 0.2, 4],
    [CLEAR, 0],
  ]);
  // The feed: the newest line on top, so the list starts drawn up by all its lines.
  const feed = part("feed", { move: [0, -FEED.length * g.line] });
  FEED.forEach((moment, index) => {
    feed.to(moment, 0.45, { move: [0, -(FEED.length - 1 - index) * g.line] });
    part(`line-${index}`, { opacity: 0 })
      .to(moment, 0.4, { opacity: 1 })
      .jump(CLEAR, { opacity: 0 });
  });
  feed.jump(CLEAR, { move: [0, -FEED.length * g.line] });

  // 4. Decided: one question comes out of the work to a person, and the work waits for it.
  const designer = place(g.homes, 1);
  const need = part("need", { opacity: 0, scale: 1 }).to(18.3, 0.3, { opacity: 1 });
  for (const beat of [18.4, 19.3, 20.2, 21.1]) {
    need.to(beat, 0.45, { scale: 1.14 }, BOTH).to(beat + 0.45, 0.45, { scale: 1 }, BOTH);
  }
  need.to(22.2, 0.3, { opacity: 0 });
  part("flag", { opacity: 0, scale: 0.4 })
    .to(18.5, 0.35, { opacity: 1, scale: 1 }, BACK)
    .to(22.2, 0.2, { opacity: 0, scale: 0.4 });
  part("waiting", { opacity: 0, scale: 0.3 })
    .to(18.5, 0.35, { opacity: 1, scale: 1 }, BACK)
    .to(22.1, 0.2, { opacity: 0, scale: 0.3 });
  part("veil", { opacity: 0 }).to(18.75, 0.6, { opacity: 1 }).to(21.95, 0.5, { opacity: 0 });
  part("ask", { opacity: 0, move: [designer.x - g.ask.x, designer.y - g.ask.y], scale: 0.08 })
    .to(18.75, 0.2, { opacity: 1 })
    .to(18.75, 0.85, { move: [0, 0], scale: 1 })
    .to(21.95, 0.5, { move: [designer.x - g.ask.x, designer.y - g.ask.y], scale: 0.08 }, IN)
    .to(22.3, 0.15, { opacity: 0 });
  const [one, two] = [place(g.options, 0), place(g.options, 1)];
  hand
    .jump(19.35, { move: [g.answer.x + u(150), g.answer.y + u(120)] })
    .to(19.4, 0.25, { opacity: 1 });
  go(19.45, 0.6, one);
  go(20.35, 0.4, two);
  tap(20.85);
  go(21, 0.4, g.answer);
  tap(21.5);
  hand.to(21.75, 0.25, { opacity: 0 });
  part("over-0", { opacity: 0 }).to(19.9, 0.2, { opacity: 1 }).to(20.45, 0.2, { opacity: 0 });
  part("chosen", { opacity: 0 }).to(20.87, 0.18, { opacity: 1 }).jump(22.6, { opacity: 0 });
  part("answerable", { opacity: 0 }).to(20.92, 0.2, { opacity: 1 }).jump(22.6, { opacity: 0 });
  press("answer", [21.5]);
  part("answered", { opacity: 0, scale: 0.6 })
    .to(21.6, 0.3, { opacity: 1, scale: 1 }, BACK)
    .jump(22.6, { opacity: 0, scale: 0.6 });

  // 5. Reported: the cards cross the board, the result comes back to the conversation; and what
  // was learned is there for the next order, which is done without a question.
  const thrown = 27.35;
  for (const square of SQUARES) {
    const turn = (square / SQUARES.length) * Math.PI * 2 + (square % 3) * 0.35;
    const far = u(70 + (square % 4) * 34);
    const out: readonly [number, number] = [
      Math.cos(turn) * far,
      Math.sin(turn) * far * 0.8 - u(46),
    ];
    part(`square-${square}`, { opacity: 0, move: [0, 0], scale: 0.4, rotate: 0 })
      .jump(thrown, { opacity: 1 })
      .to(thrown, 0.6, { move: out, scale: 1, rotate: 120 }, OUT)
      .to(
        thrown + 0.6,
        0.75,
        { move: [out[0] * 1.15, out[1] + u(96)], scale: 0.5, rotate: 300 },
        IN,
      )
      .to(thrown + 0.85, 0.5, { opacity: 0 }, LINEAR)
      .jump(CLEAR, { move: [0, 0], scale: 0.4, rotate: 0 });
  }

  // The lights between them: an order on its way, the team telling one another, a report.
  const planet = (agent: number): Point => place(g.homes, agent);
  const briefed = (agent: number): Point => place(g.brief, agent);
  for (const agent of [1, 2]) {
    const [from, to] = [briefed(0), briefed(agent)];
    const [dx, dy] = [to.x - from.x, to.y - from.y];
    const length = Math.hypot(dx, dy) / u(100);
    part(`link-${agent}`, {
      opacity: 0,
      move: [from.x, from.y],
      scale: [0, 1],
      rotate: (Math.atan2(dy, dx) * 180) / Math.PI,
    })
      .to(10.9, 0.2, { opacity: 1 })
      .to(10.9, 0.7, { scale: [length, 1] }, BOTH)
      .to(12.8, 0.3, { opacity: 0 })
      .jump(13.2, { scale: [0, 1] });
  }
  const beams: Beam[] = [
    { at: 9.85, from: g.chat, to: briefed(0), takes: 0 },
    { at: 11.05, from: briefed(0), to: briefed(1), takes: 1 },
    { at: 11.05, from: briefed(0), to: briefed(2), takes: 2 },
    { at: 15.45, from: planet(1), to: planet(2), takes: 2 },
    { at: 16, from: planet(0), to: g.board },
    { at: 17.1, from: planet(2), to: g.board },
    { at: 24.35, from: planet(0), to: g.chat },
    { at: 26.65, from: g.chat, to: planet(0), takes: 0 },
    { at: 26.7, from: g.chat, to: planet(1), takes: 1 },
    { at: 26.75, from: g.chat, to: planet(2), takes: 2 },
    { at: 29, from: planet(1), to: place(g.cards, AGAIN) },
    { at: 29.1, from: planet(2), to: place(g.cards, AGAIN) },
    { at: 30.4, from: planet(0), to: g.chat },
  ];
  for (const message of MESSAGES) {
    if (message.by !== "me" && message.at > 9 && message.at < 24) {
      const from = message.at < HOME[0] ? briefed(message.by) : planet(message.by);
      beams.push({ at: message.at - 0.5, from, to: g.chat });
    }
  }
  beams.sort((a, b) => a.at - b.at);
  const comets = COMETS.map((comet) =>
    part(`comet-${comet}`, { opacity: 0, move: [0, 0], scale: [0.1, 1], rotate: 0 }),
  );
  const free = COMETS.map(() => 0);
  for (const beam of beams) {
    const index = free.findIndex((until) => until <= beam.at);
    const comet = comets[index];
    if (comet === undefined) throw new Error(`no comet is free at ${beam.at}`);
    free[index] = beam.at + BEAM;
    const [dx, dy] = [beam.to.x - beam.from.x, beam.to.y - beam.from.y];
    comet
      .jump(beam.at, {
        opacity: 0,
        move: [beam.from.x, beam.from.y],
        scale: [0.1, 1],
        rotate: (Math.atan2(dy, dx) * 180) / Math.PI,
      })
      .to(beam.at, 0.12, { opacity: 1 }, LINEAR)
      .to(beam.at, BEAM, { move: [beam.to.x, beam.to.y] }, BOTH)
      .to(beam.at, 0.3, { scale: [1, 1] }, RISE)
      .to(beam.at + 0.3, 0.3, { scale: [0.1, 1] }, FALL)
      .to(beam.at + 0.48, 0.12, { opacity: 0 }, LINEAR);
    if (beam.takes !== undefined) {
      pulse(beam.takes, beam.at + BEAM - 0.1);
    }
  }
  for (const agent of AGENTS) {
    const halo = part(`halo-${agent}`, { opacity: 0, scale: 0.5 });
    for (const { at } of pulses.filter((p) => p.agent === agent).sort((a, b) => a.at - b.at)) {
      halo.jump(at, { opacity: 0.9, scale: 0.5 }).to(at, 0.8, { opacity: 0, scale: 2.2 });
    }
  }

  // The end: the team about its mark, and round again.
  part("hub", { opacity: 0, scale: 0.4 })
    .to(OUTRO + 0.7, 0.8, { opacity: 1, scale: 1 })
    .to(OUTRO + 2.45, 0.35, { scale: 1.16 }, BOTH)
    .to(OUTRO + 2.85, 0.4, { opacity: 0, scale: 0.7 }, IN)
    .jump(OUTRO + 3.3, { scale: 0.4 });

  return new Map([...parts].map(([name, made]) => [name, made.play()]));
}
