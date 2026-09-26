import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../i18n/languages.js";
import { defaultShowcase, showcaseTexts } from "../showcase.js";
import { demoSchedule } from "./creation-demo.js";

const entry = defaultShowcase();
const clipMs = entry.durationMs ?? 0;
const demoOf = (language: (typeof LANGUAGES)[number]) => {
  const demo = showcaseTexts(entry, language).demo;
  if (demo === null) {
    throw new Error(`the build's own showcase has no example conversation in ${language}`);
  }
  return demo;
};

describe("the timing of the example conversation", () => {
  it("lets every line finish before the next thing happens, in every language", () => {
    for (const language of LANGUAGES) {
      const s = demoSchedule(demoOf(language), clipMs);
      const moments = [
        s.prompt.from,
        s.prompt.until,
        s.thinking,
        s.question.from,
        s.question.until,
        s.details,
        s.answer.from,
        s.answer.until,
        s.planning,
        s.plan.from,
        s.plan.until,
        s.creation,
        s.consent.from,
        s.consent.until,
        s.result,
        s.finished,
        s.cycle,
      ];
      for (let index = 1; index < moments.length; index += 1) {
        expect(moments[index], `${language}: moment ${index}`).toBeGreaterThan(
          moments[index - 1] ?? Number.NaN,
        );
      }
    }
  });

  it("plays the result once through, after a conversation that stays brisk", () => {
    for (const language of LANGUAGES) {
      const s = demoSchedule(demoOf(language), clipMs);
      expect(s.cycle - s.finished).toBe(clipMs);
      expect(clipMs).toBeGreaterThan(0);
      // Visitors watched a slower version wait for it; the words stay short enough to read along.
      expect(s.finished, language).toBeLessThan(17_000);
    }
  });
});
