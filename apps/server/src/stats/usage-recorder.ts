import type { Clock } from "@skillcdn/core";
import {
  addUsage,
  type Database,
  type UsageIncrement,
  type UsageMetric,
  usageDayOf,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";

/** Counts what agents do with public repositories. Counting never fails or delays a request. */
export interface UsageStats {
  count(mount: Mount, metric: UsageMetric, subject?: string): void;
}

export const noUsageStats: UsageStats = { count: () => {} };

export interface UsageRecorderOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How many distinct counters are held before they are written early. */
  readonly maxBuffered?: number;
}

const DEFAULT_MAX_BUFFERED = 10_000;
/** A subject comes from a repository: a tool name is short, a directory may not be. */
const MAX_SUBJECT_LENGTH = 1024;

/**
 * Adds up counts in memory and writes them as daily totals per repository: how many connections,
 * tool calls and skill loads, and nothing about who made them. Only public repositories are
 * counted, because these numbers are meant to be shown. Totals are additive in the database, so
 * every process reports on its own, and a lost report loses a few seconds of counts, no more.
 */
export class UsageRecorder implements UsageStats {
  readonly #options: UsageRecorderOptions;
  #buffer = new Map<string, UsageIncrement>();
  #writing: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: UsageRecorderOptions) {
    this.#options = options;
  }

  count(mount: Mount, metric: UsageMetric, subject = ""): void {
    // Fail closed: whatever is not known to be public is not counted for the public.
    if (mount.repo.repository.visibility !== "public" || subject.length > MAX_SUBJECT_LENGTH) {
      return;
    }
    const day = usageDayOf(this.#options.clock.now());
    const key = JSON.stringify([mount.repo.id, day, metric, subject]);
    const existing = this.#buffer.get(key);
    this.#buffer.set(key, {
      scope: { accountId: mount.repo.accountId, repoId: mount.repo.id },
      day,
      metric,
      subject,
      count: (existing?.count ?? 0) + 1,
    });
    if (this.#buffer.size >= (this.#options.maxBuffered ?? DEFAULT_MAX_BUFFERED)) {
      void this.flush();
    }
  }

  /** Writes what has been counted so far. Resolves when it is in the database, or given up on. */
  flush(): Promise<void> {
    const increments = [...this.#buffer.values()];
    this.#buffer = new Map();
    if (increments.length === 0) {
      return this.#writing;
    }
    const { database, clock, logger } = this.#options;
    // One write at a time, in order; a failure is logged and the counts are dropped, because a
    // database that is down would otherwise make this buffer grow without bound.
    this.#writing = this.#writing.then(() =>
      addUsage(database, increments, clock.now()).catch((error: unknown) => {
        logger.warn({ err: error, counters: increments.length }, "usage counts were not written");
      }),
    );
    return this.#writing;
  }

  start(intervalMs: number): void {
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => void this.flush(), intervalMs);
      this.#timer.unref();
    }
  }

  /** Stops the timer and writes what is left. */
  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.flush();
  }
}
