import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/index.js";
import { LANGUAGES } from "../i18n/languages.js";
import type { DemoTask } from "../i18n/messages/landing-en.js";
import { afterMoment, edgeScroll, landing, momentDelay, moved } from "./console-demo.js";

// The console on the front page plays a few moments of a working day as it comes into view;
// each is a change of the board that a language pack describes.

describe("the moments of the console on the front page", () => {
  it("move a task the board has, or add one it does not, in every language", () => {
    for (const language of LANGUAGES) {
      const words = messagesFor(language).landing.console.window;
      let tasks: readonly DemoTask[] = words.tasks;
      for (const moment of words.play) {
        const before = tasks.length;
        tasks = afterMoment(tasks, moment);
        if (moment.kind === "move") {
          // A moved task comes first, at the top of its column, where a dropped card lands.
          expect(tasks[0]?.number, `${language}: #${moment.task}`).toBe(moment.task);
          expect(tasks[0]?.state).toBe(moment.to);
          expect(tasks).toHaveLength(before);
        } else {
          expect(tasks).toHaveLength(before + 1);
          expect(tasks[0]).toEqual(moment.task);
        }
        expect(moment.feed.length).toBeGreaterThan(0);
      }
      // Every task on the board has a column to stand in.
      for (const task of tasks) {
        expect(words.columns[task.state]).toBeTruthy();
      }
    }
  });

  it("add a task once, whatever is played twice", () => {
    const words = messagesFor("en").landing.console.window;
    const add = words.play.find((moment) => moment.kind === "add");
    if (add === undefined) {
      throw new Error("no moment adds a task");
    }
    const once = afterMoment(words.tasks, add);
    expect(afterMoment(once, add)).toEqual(once);
  });

  it("play the first moment soon after the board is in view, and the rest at a reading pace", () => {
    expect(momentDelay(0)).toBeLessThan(momentDelay(1));
    expect(momentDelay(1)).toBe(momentDelay(2));
  });

  it("land a carried card at the top of its column, and where the column will be once the board has scrolled to it", () => {
    const cards = { left: 100, top: 40 };
    expect(landing(cards, 8)).toEqual({ x: 108, y: 48 });
    expect(landing(cards, 8, 60)).toEqual({ x: 48, y: 48 });
  });

  it("put a dropped card first in its column, and leave a board without the card as it was", () => {
    const words = messagesFor("en").landing.console.window;
    const dropped = moved(words.tasks, 20, "idea");
    expect(dropped[0]).toMatchObject({ number: 20, state: "idea" });
    expect(dropped).toHaveLength(words.tasks.length);
    expect(moved(words.tasks, 999, "idea")).toBe(words.tasks);
  });

  it("scroll the board under a held card near its edges, faster towards the edge, and not in the middle", () => {
    // A board from 100 to 500 on the screen, with a zone of 48 at each end.
    expect(edgeScroll(300, 100, 500)).toBe(0);
    expect(edgeScroll(148, 100, 500)).toBe(0);
    expect(edgeScroll(452, 100, 500)).toBe(0);
    // Halfway into a zone the board goes at half speed, at the edge and past it at full speed.
    expect(edgeScroll(124, 100, 500)).toBeCloseTo(-7);
    expect(edgeScroll(100, 100, 500)).toBe(-14);
    expect(edgeScroll(40, 100, 500)).toBe(-14);
    expect(edgeScroll(476, 100, 500)).toBeCloseTo(7);
    expect(edgeScroll(500, 100, 500)).toBe(14);
    expect(edgeScroll(560, 100, 500)).toBe(14);
    // The zone and the speed are the caller's to set.
    expect(edgeScroll(10, 0, 100, 20, 10)).toBe(-5);
  });
});
