import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/index.js";
import { LANGUAGES } from "../i18n/languages.js";
import type { DemoTask } from "../i18n/messages/landing-en.js";
import { afterMoment, momentDelay } from "./console-demo.js";

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
          const moved = tasks.find((task) => task.number === moment.task);
          expect(moved?.state, `${language}: #${moment.task}`).toBe(moment.to);
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
});
