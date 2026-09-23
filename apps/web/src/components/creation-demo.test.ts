import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/index.js";
import { LANGUAGES } from "../i18n/languages.js";
import { FEATURED_VIDEO } from "../site.js";
import { demoSchedule } from "./creation-demo.js";

describe("the timing of the example conversation", () => {
  it("lets every line finish before the next thing happens, in every language", () => {
    for (const language of LANGUAGES) {
      const s = demoSchedule(messagesFor(language).landing.demo, FEATURED_VIDEO.durationMs);
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
      const s = demoSchedule(messagesFor(language).landing.demo, FEATURED_VIDEO.durationMs);
      expect(s.cycle - s.finished).toBe(FEATURED_VIDEO.durationMs);
      // Visitors watched a slower version wait for it; the words stay short enough to read along.
      expect(s.finished, language).toBeLessThan(17_000);
    }
  });
});
