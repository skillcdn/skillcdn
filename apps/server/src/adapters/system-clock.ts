import type { Clock } from "@skillcdn/core";

export const systemClock: Clock = {
  now: () => new Date(),
};
