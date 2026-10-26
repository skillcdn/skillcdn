import { describe, expect, it } from "vitest";
import { SLICE_MS } from "./embed-snapshot.js";
import { DESIGNATED_PRIORITY, EMBED_QUEUE, embedPriority, QUEUE_SETTINGS } from "./queues.js";

// The order the embedding queue takes its jobs in (ADR-0072): what was asked for by hand first,
// then by the repository's rank, then by the reason within a rank.

describe("the priority of an embedding job", () => {
  it("puts a request first, then the ranks, then the reasons within a rank, and the rest last", () => {
    const order = [
      embedPriority("designated", "other"),
      embedPriority("backfill", "listed"),
      embedPriority("searched", "declared"),
      embedPriority("indexed", "declared"),
      embedPriority("backfill", "declared"),
      embedPriority("searched", "skills"),
      embedPriority("searched", "other"),
      embedPriority("backfill", "other"),
    ];
    expect(order[0]).toBe(DESIGNATED_PRIORITY);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("ranks a job queued without a rank, by an older build, with the rest", () => {
    expect(embedPriority("backfill", undefined)).toBe(embedPriority("backfill", "other"));
    expect(embedPriority("designated", undefined)).toBe(DESIGNATED_PRIORITY);
  });
});

describe("the settings of the embedding queue", () => {
  it("hear from a running slice within minutes, and give an attempt far more time than a slice takes", () => {
    const settings = QUEUE_SETTINGS[EMBED_QUEUE];
    expect(settings.heartbeatSeconds).toBeGreaterThanOrEqual(10);
    expect(settings.heartbeatSeconds).toBeLessThanOrEqual(120);
    expect(settings.expireInSeconds * 1000).toBeGreaterThanOrEqual(10 * SLICE_MS);
  });
});
