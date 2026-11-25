import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/index.js";
import {
  AGAIN,
  AGENTS,
  agentsScore,
  CARDS,
  DOING,
  FEED,
  type Geometry,
  MESSAGES,
  ORDER,
  PASS,
  Part,
  type Play,
  type Point,
  properties,
  REST,
  STILL_MS,
} from "./agents-score.js";

const at = (x: number, y: number): Point => ({ x, y });

/** A stage as the wide layout lays one out, in round numbers. */
const GEOMETRY: Geometry = {
  unit: 1,
  homes: [at(552, 106), at(536, 300), at(552, 494)],
  lineup: [at(650, 286), at(855, 286), at(1060, 286)],
  brief: [at(600, 300), at(960, 168), at(960, 432)],
  hub: at(600, 320),
  reach: 132,
  faces: [at(112, 240), at(222, 240), at(332, 240), at(442, 240)],
  roll: 280,
  add: at(150, 420),
  chat: at(384, 320),
  board: at(712, 320),
  cards: [at(790, 190), at(790, 290), at(790, 390), at(790, 190)],
  column: 160,
  deck: 0,
  ask: at(600, 320),
  options: [at(500, 320), at(690, 320)],
  answer: at(450, 450),
  scrolls: MESSAGES.map((_, index) => index * 40 - 300),
  line: 26,
  names: [2, 2, 3],
  titles: [3, 3, 2],
  order: [0, 0, 0, 0, 0, 1, 1, 1],
  reply: [0, 0, 0],
  draft: 19,
};

/** The value a part has for a property at a moment it is at rest. */
function held(play: Play | undefined, property: string, seconds: number): unknown {
  if (play === undefined) return undefined;
  const offset = (seconds - play.from) / (play.until - play.from);
  return play.keyframes
    .filter((frame, index) => property in frame && (index === 0 || (frame.offset ?? 0) <= offset))
    .at(-1)?.[property];
}

describe("a part of the stage", () => {
  it("says a frame as the properties of a keyframe", () => {
    expect(properties({ opacity: 0.5, move: [1, -2], scale: [0.2, 1], rotate: 9 })).toEqual([
      ["opacity", 0.5],
      ["translate", "1px -2px"],
      ["scale", "0.2 1"],
      ["rotate", "9deg"],
    ]);
    expect(properties({ scale: 2 })).toEqual([["scale", "2"]]);
    expect(properties({})).toEqual([]);
  });

  it("plays over the stretch it moves in, holding each value until the next move", () => {
    const { from, until, keyframes } = new Part("card", { opacity: 0 })
      .to(4, 4, { opacity: 1 }, "ease-in")
      .jump(12, { opacity: 0.2 })
      .play();
    expect(from).toBeCloseTo(4 - REST);
    expect(until).toBeCloseTo(12 + REST);
    expect(keyframes.map(({ offset, ...frame }) => frame)).toEqual([
      { opacity: 0 },
      { opacity: 0, easing: "ease-in" },
      { opacity: 1 },
      { opacity: 1, easing: "linear" },
      { opacity: 0.2 },
      { opacity: 0.2 },
    ]);
    const offsets = [0, REST, REST + 4, REST + 8, REST + 8, REST + 8 + REST];
    keyframes.forEach((frame, index) => {
      expect(frame.offset).toBeCloseTo((offsets[index] ?? -1) / (8 + 2 * REST));
    });
  });

  it("is as it starts until a jump that comes first, and as it ends after one that comes last", () => {
    const { keyframes } = new Part("letter", { opacity: 0 })
      .jump(4, { opacity: 1 })
      .jump(6, { opacity: 0 })
      .play();
    expect(keyframes.filter((frame) => frame.offset === 0)).toEqual([{ offset: 0, opacity: 0 }]);
    expect(keyframes.filter((frame) => frame.offset === 1)).toEqual([{ offset: 1, opacity: 0 }]);
  });

  it("keeps the moves of one property apart from another's, in the order of time", () => {
    const { keyframes } = new Part("card", { opacity: 0, move: [0, 0] })
      .to(8, 16, { move: [4, 4] })
      .to(8, 4, { opacity: 1 })
      .play();
    const offsets = keyframes.map((frame) => frame.offset ?? 0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    for (const frame of keyframes) {
      expect("opacity" in frame).not.toBe("translate" in frame);
    }
  });

  it("refuses a move that begins before the last one ended, past the end, or from nowhere", () => {
    expect(() =>
      new Part("card", { opacity: 0 }).to(1, 2, { opacity: 1 }).to(2, 1, { opacity: 0 }),
    ).toThrow("card: opacity at 2 before 3");
    expect(() => new Part("card", { opacity: 0 }).to(PASS, 1, { opacity: 1 })).toThrow("past");
    expect(() => new Part("card", { opacity: 0 }).to(1, 1, { scale: 2 })).toThrow("nowhere");
  });
});

describe.each([
  ["side by side", GEOMETRY],
  ["in one place", { ...GEOMETRY, deck: 26 }],
])("the score of the agent accounts, the windows %s", (_, geometry) => {
  const score = agentsScore(geometry);

  it("is whole: every part within the pass, in order, with numbers that are numbers", () => {
    expect(score.size).toBeGreaterThan(100);
    for (const [name, play] of score) {
      expect(play.from, name).toBeGreaterThanOrEqual(0);
      expect(play.until, name).toBeGreaterThan(play.from);
      expect(play.until, name).toBeLessThanOrEqual(PASS);
      expect(play.keyframes[0]?.offset, name).toBe(0);
      expect(play.keyframes.at(-1)?.offset, name).toBe(1);
      let last = 0;
      for (const frame of play.keyframes) {
        expect(frame.offset ?? -1, name).toBeGreaterThanOrEqual(last);
        last = frame.offset ?? 0;
        for (const value of Object.values(frame)) expect(String(value), name).not.toContain("NaN");
      }
    }
  });

  it("has every part at rest at both ends of its stretch", () => {
    // Outside its stretch a part is what the keyframe at that end says. Of two there, one engine's
    // compositor paints the one before the jump: what was sent stood on under the next line.
    for (const [name, play] of score) {
      for (const property of ["opacity", "translate", "scale", "rotate"]) {
        const of = play.keyframes.filter((frame) => property in frame);
        if (of.length === 0) continue;
        for (const end of [0, 1]) {
          const there = of.filter((frame) => frame.offset === end);
          expect(there, `${name}: ${property} at ${end}`).toHaveLength(1);
        }
      }
    }
  });

  it("ends where it begins, so that a pass runs into the next unseen", () => {
    for (const [name, play] of score) {
      for (const property of ["opacity", "translate", "scale", "rotate"]) {
        const values = play.keyframes.filter((frame) => property in frame).map((f) => f[property]);
        if (values.length === 0) continue;
        // A part nobody sees at the end may stand anywhere.
        if (property !== "opacity" && held(play, "opacity", PASS) === 0) continue;
        expect(values.at(-1), `${name}: ${property}`).toBe(values[0]);
      }
    }
  });

  it("stands still, where less motion was asked for, with the team at work", () => {
    const still = STILL_MS / 1000;
    expect(held(score.get("board"), "opacity", still)).toBe(1);
    expect(held(score.get("chat"), "opacity", still)).toBe(geometry.deck > 0 ? 0.5 : 1);
    for (const agent of AGENTS) {
      expect(held(score.get(`agent-${agent}`), "opacity", still)).toBe(1);
      expect(held(score.get(`card-${agent}`), "opacity", still)).toBe(1);
    }
    for (const part of ["hire", "ask", "veil", "hub", "hand"]) {
      expect(held(score.get(part), "opacity", still), part).toBe(0);
    }
  });

  it("writes in a box that grows as the words run on, and is a line tall once they are sent", () => {
    const sent = MESSAGES[ORDER]?.at ?? 0;
    const grow = score.get("grow");
    expect(held(grow, "translate", sent - 0.1)).toBe("0px -19px");
    expect(held(grow, "translate", sent + 0.3)).toBe("0px 0px");
    expect(held(score.get("order-7"), "opacity", sent - 0.1)).toBe(1);
    expect(held(score.get("order-7"), "opacity", sent + 0.1)).toBe(0);
    expect(held(score.get("empty"), "opacity", sent + 0.1)).toBe(1);
  });

  it("does the second job without a question, and faster than the first", () => {
    const crossed = (card: number): number => {
      const play = score.get(`check-${card}`);
      return (play?.from ?? 0) - (score.get(`card-${card}`)?.from ?? 0);
    };
    for (const agent of AGENTS) expect(crossed(AGAIN)).toBeLessThan(crossed(agent) / 5);
    // Nothing asks for anybody while it is on the board.
    const begun = score.get(`card-${AGAIN}`)?.from ?? 0;
    for (const part of ["ask", "need", "waiting", "flag"]) {
      expect(score.get(part)?.until, part).toBeLessThan(begun);
    }
  });

  it("has words for every moment, in every language", () => {
    for (const language of ["en", "ko"] as const) {
      const { scene } = messagesFor(language).landing.agents;
      expect(scene.chat.messages, language).toHaveLength(MESSAGES.length);
      expect(scene.board.lines, language).toHaveLength(FEED.length);
      expect(scene.board.cards, language).toHaveLength(CARDS.length);
      expect(scene.agents, language).toHaveLength(AGENTS.length);
      for (const agent of AGENTS) {
        expect(scene.agents[agent]?.doing, `${language} ${agent}`).toHaveLength(
          DOING[agent].length,
        );
      }
    }
  });
});
