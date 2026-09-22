import { createHmac, randomBytes } from "node:crypto";
import type { Clock } from "@skillcdn/core";
import {
  addUsage,
  addUsageClients,
  type Database,
  foldUsageClients,
  getUsageClientKey,
  type UsageClient,
  type UsageDay,
  type UsageIncrement,
  type UsageMetric,
  usageDayOf,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";

/** Counts what agents do with public repositories. Counting never fails or delays a request. */
export interface UsageStats {
  count(mount: Mount, metric: UsageMetric, subject?: string): void;
  /** A client at this network address used the repository. Unknown addresses are not counted. */
  client(mount: Mount, address: string | undefined): void;
}

export const noUsageStats: UsageStats = { count: () => {}, client: () => {} };

export interface UsageRecorderOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How many distinct counters or clients are held before they are written early. */
  readonly maxBuffered?: number;
}

const DEFAULT_MAX_BUFFERED = 10_000;
/** A subject comes from a repository: a tool name is short, a directory may not be. */
const MAX_SUBJECT_LENGTH = 1024;
/** Client hashes remembered as already written, so a busy client is not reported every flush. */
const MAX_REMEMBERED_CLIENTS = 200_000;
const KEY_BYTES = 32;
/** Half of an HMAC-SHA256: nothing is looked up by the other half. */
const CLIENT_HASH_LENGTH = 32;

interface UnhashedClient {
  readonly scope: UsageClient["scope"];
  readonly day: UsageDay;
  readonly address: string;
}

/**
 * Adds up counts in memory and writes them as daily totals per repository: how many connections,
 * tool calls and skill loads, and nothing about who made them. Only public repositories are
 * counted, because these numbers are meant to be shown. Totals are additive in the database, so
 * every process reports on its own, and a lost report loses a few seconds of counts, no more.
 *
 * Distinct clients are counted without keeping addresses: a client is written as a keyed hash of
 * its address under a key that exists for one day (UTC) and is deleted with it. Until then the
 * hashes of one day can be matched, so that a client is one client however often it comes back;
 * after that they are noise, and only the count per day remains.
 */
export class UsageRecorder implements UsageStats {
  readonly #options: UsageRecorderOptions;
  #buffer = new Map<string, UsageIncrement>();
  #writing: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;

  /** Keys by day, once fetched, and the fetches underway. */
  readonly #keys = new Map<UsageDay, string>();
  readonly #keyFetches = new Map<UsageDay, Promise<string | undefined>>();
  /** Clients whose day has a key here already, hashed at once; the rest wait for the key. */
  #clients = new Map<string, UsageClient>();
  #unhashed: UnhashedClient[] = [];
  /** Hashed clients written or about to be, so that the same client costs one row a day. */
  #remembered = new Set<string>();
  #rememberedDay: UsageDay | undefined;
  #foldedBefore: UsageDay | undefined;

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
    if (this.#buffer.size >= this.#maxBuffered()) {
      void this.flush();
    }
  }

  client(mount: Mount, address: string | undefined): void {
    if (mount.repo.repository.visibility !== "public" || address === undefined || address === "") {
      return;
    }
    const day = usageDayOf(this.#options.clock.now());
    const scope = { accountId: mount.repo.accountId, repoId: mount.repo.id };
    const key = this.#keys.get(day);
    if (key === undefined) {
      // The key is fetched once per day; until it is here, the address waits in memory.
      void this.#keyFor(day);
      if (this.#unhashed.length < this.#maxBuffered()) {
        this.#unhashed.push({ scope, day, address });
      }
      return;
    }
    this.#noteClient({ scope, day, client: hashClient(key, address) });
    if (this.#clients.size >= this.#maxBuffered()) {
      void this.flush();
    }
  }

  /** Writes what has been counted so far. Resolves when it is in the database, or given up on. */
  flush(): Promise<void> {
    const increments = [...this.#buffer.values()];
    this.#buffer = new Map();
    const unhashed = this.#unhashed;
    this.#unhashed = [];
    const clients = this.#clients;
    this.#clients = new Map();
    const today = usageDayOf(this.#options.clock.now());
    // Days that are over are folded once per day by every process; a fold with nothing to move
    // costs one statement.
    const fold = this.#foldedBefore !== today;
    this.#foldedBefore = today;
    if (increments.length === 0 && unhashed.length === 0 && clients.size === 0 && !fold) {
      return this.#writing;
    }
    const { database, clock, logger } = this.#options;
    // One write at a time, in order; a failure is logged and the counts are dropped, because a
    // database that is down would otherwise make this buffer grow without bound.
    this.#writing = this.#writing.then(async () => {
      try {
        for (const waiting of unhashed) {
          const key = await this.#keyFor(waiting.day);
          if (key !== undefined) {
            const seen = {
              scope: waiting.scope,
              day: waiting.day,
              client: hashClient(key, waiting.address),
            };
            if (this.#remember(seen)) {
              clients.set(clientKey(seen), seen);
            }
          }
        }
        const now = clock.now();
        if (clients.size > 0) {
          await addUsageClients(database, [...clients.values()], now);
        }
        if (increments.length > 0) {
          await addUsage(database, increments, now);
        }
        if (fold) {
          await foldUsageClients(database, today, now);
        }
      } catch (error) {
        logger.warn(
          { err: error, counters: increments.length, clients: clients.size + unhashed.length },
          "usage counts were not written",
        );
      }
    });
    return this.#writing;
  }

  start(intervalMs: number): void {
    if (this.#timer === undefined) {
      void this.#keyFor(usageDayOf(this.#options.clock.now()));
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

  #maxBuffered(): number {
    return this.#options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
  }

  /** Puts a hashed client in line to be written, unless it was written today already. */
  #noteClient(seen: UsageClient): void {
    if (this.#remember(seen)) {
      this.#clients.set(clientKey(seen), seen);
    }
  }

  /** True the first time a client is seen on its day. */
  #remember(seen: UsageClient): boolean {
    if (this.#rememberedDay !== seen.day) {
      // A new day: what was remembered is about a day that is over.
      this.#remembered = new Set();
      this.#rememberedDay = seen.day;
    }
    const key = clientKey(seen);
    if (this.#remembered.has(key)) {
      return false;
    }
    if (this.#remembered.size >= MAX_REMEMBERED_CLIENTS) {
      // Forgetting costs a few rows that the database ignores; remembering costs memory.
      this.#remembered = new Set();
    }
    this.#remembered.add(key);
    return true;
  }

  /** The key of a day, fetched once and shared by everyone asking at the same time. */
  #keyFor(day: UsageDay): Promise<string | undefined> {
    const known = this.#keys.get(day);
    if (known !== undefined) {
      return Promise.resolve(known);
    }
    let fetching = this.#keyFetches.get(day);
    if (fetching === undefined) {
      const { database, clock, logger } = this.#options;
      fetching = getUsageClientKey(
        database,
        day,
        () => randomBytes(KEY_BYTES).toString("hex"),
        clock.now(),
      ).then(
        (key) => {
          this.#keys.set(day, key);
          this.#keyFetches.delete(day);
          return key;
        },
        (error: unknown) => {
          // Clients seen meanwhile are lost with this fetch; the next one tries again.
          logger.warn({ err: error, day }, "usage client key could not be fetched");
          this.#keyFetches.delete(day);
          return undefined;
        },
      );
      this.#keyFetches.set(day, fetching);
    }
    return fetching;
  }
}

const clientKey = (seen: UsageClient): string =>
  JSON.stringify([seen.scope.repoId, seen.day, seen.client]);

function hashClient(key: string, address: string): string {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(address)
    .digest("hex")
    .slice(0, CLIENT_HASH_LENGTH);
}
