import { createHmac, randomBytes } from "node:crypto";
import type { Clock } from "@skillcdn/core";
import {
  addServiceUsage,
  addServiceUsageClients,
  addUsage,
  addUsageClients,
  type Database,
  foldServiceUsageClients,
  foldUsageClients,
  type ServiceUsageClient,
  type ServiceUsageIncrement,
  type UsageClient,
  type UsageDay,
  type UsageIncrement,
  usageDayOf,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import type { Mount } from "../mounts/mount-service.js";

/** What is counted as it happens; distinct clients are derived when the day is folded. */
export type CountedMetric = "connection" | "tool_call" | "skill_load" | "file_read";

/** Counts what agents do with repositories. Counting never fails or delays a request. */
export interface UsageStats {
  /**
   * Something happened to the repository of a mount: a connection, a call of the tool `subject`,
   * a load of the skill at the directory `subject`, a read of the file at the path `subject`.
   */
  count(mount: Mount, metric: CountedMetric, subject?: string): void;
  /**
   * A client at this network address used the repository, through the app that calls itself
   * `app` when it said so. Unknown addresses are not counted.
   */
  client(mount: Mount, address: string | undefined, app?: string | undefined): void;
}

export const noUsageStats: UsageStats = { count: () => {}, client: () => {} };

export interface UsageRecorderOptions {
  readonly database: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * What client hashes are keyed from (ADR-0027). Left out, the process makes one for itself
   * and keeps it in memory: counts then hold within the process, not across replicas or restarts.
   */
  readonly secret?: string | undefined;
  /** How many distinct counters or clients are held before they are written early. */
  readonly maxBuffered?: number;
}

const DEFAULT_MAX_BUFFERED = 10_000;
/** A subject comes from a repository: a tool name is short, a directory or a path may not be. */
const MAX_SUBJECT_LENGTH = 1024;
/** Client hashes remembered as already written, so a busy client is not reported every flush. */
const MAX_REMEMBERED_CLIENTS = 200_000;
const SECRET_BYTES = 32;
/** Half of an HMAC-SHA256: nothing is looked up by the other half. */
const CLIENT_HASH_LENGTH = 32;
/** The name of a client app is its own word, written down as one short line. */
const MAX_APP_LENGTH = 64;
/** How many different app names a process writes down on one day; the rest are `OTHER_APP`. */
const MAX_APPS_PER_DAY = 200;
/** What an app is counted as once a day has seen as many names as are written down. */
export const OTHER_APP = "other";

/**
 * How a client is written down: the address hashed under the key of its day, which is derived
 * from the secret and the day and stored nowhere (ADR-0027). The database alone matches nothing.
 */
export function clientHash(secret: string, day: UsageDay, address: string): string {
  const dayKey = createHmac("sha256", secret).update(day).digest();
  return createHmac("sha256", dayKey).update(address).digest("hex").slice(0, CLIENT_HASH_LENGTH);
}

/**
 * The name a client app gave itself, as it is counted: one line of visible text, in lower case
 * so that a name spelled two ways is one app, bounded, and empty for anything that is not a
 * name. The name is the client's own word, taken for a statistic and for nothing else.
 */
export function normalizeClientApp(name: unknown): string {
  if (typeof name !== "string") {
    return "";
  }
  const cleaned = name
    .replace(/[\p{C}\s]+/gu, " ")
    .trim()
    .toLowerCase();
  return cleaned.length > MAX_APP_LENGTH ? cleaned.slice(0, MAX_APP_LENGTH).trimEnd() : cleaned;
}

/**
 * Adds up counts in memory and writes them as daily totals: per public repository, how many
 * connections, tool calls, skill loads and file reads, and nothing about who made them; and for
 * the deployment as a whole, the same counts over every repository, public or not, which name no
 * repository. Totals are additive in the database, so every process reports on its own, and a
 * lost report loses a few seconds of counts, no more.
 *
 * Distinct clients are counted without keeping addresses: a client is written as a keyed hash of
 * its address under the key of its day (UTC), per public repository and once for the deployment,
 * where the name of its app goes with it, and the rows are folded into counts and deleted when
 * the day is over. Until then the hashes of one day can be matched by whoever holds the secret,
 * so that a client is one client however often it comes back; after that they are noise.
 */
export class UsageRecorder implements UsageStats {
  readonly #options: UsageRecorderOptions;
  readonly #secret: string;
  #buffer = new Map<string, UsageIncrement>();
  #serviceBuffer = new Map<string, ServiceUsageIncrement>();
  #writing: Promise<void> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;

  #clients = new Map<string, UsageClient>();
  #serviceClients = new Map<string, ServiceUsageClient>();
  /** Hashed clients written or about to be, so that the same client costs one row a day. */
  #remembered = new Set<string>();
  /** The same for the deployment's rows, with whether the app was known when it was written. */
  #serviceRemembered = new Map<string, boolean>();
  #rememberedDay: UsageDay | undefined;
  /** The app names written down today; past the bound, an app is `OTHER_APP`. */
  #apps = new Set<string>();
  #foldedBefore: UsageDay | undefined;

  constructor(options: UsageRecorderOptions) {
    this.#options = options;
    this.#secret = options.secret ?? randomBytes(SECRET_BYTES).toString("hex");
  }

  count(mount: Mount, metric: CountedMetric, subject = ""): void {
    if (subject.length > MAX_SUBJECT_LENGTH) {
      return;
    }
    const day = usageDayOf(this.#options.clock.now());
    // The deployment's totals name no repository, so they take every repository; what they say
    // about one is the tool that was called, never a path of it.
    const serviceSubject = metric === "tool_call" ? subject : "";
    const serviceKey = JSON.stringify([day, metric, serviceSubject]);
    const serviceExisting = this.#serviceBuffer.get(serviceKey);
    this.#serviceBuffer.set(serviceKey, {
      day,
      metric,
      subject: serviceSubject,
      count: (serviceExisting?.count ?? 0) + 1,
    });
    // Fail closed: whatever is not known to be public is not counted for the public.
    if (mount.repo.repository.visibility === "public") {
      const key = JSON.stringify([mount.repo.id, day, metric, subject]);
      const existing = this.#buffer.get(key);
      this.#buffer.set(key, {
        scope: { accountId: mount.repo.accountId, repoId: mount.repo.id },
        day,
        metric,
        subject,
        count: (existing?.count ?? 0) + 1,
      });
    }
    if (this.#buffer.size + this.#serviceBuffer.size >= this.#maxBuffered()) {
      void this.flush();
    }
  }

  client(mount: Mount, address: string | undefined, app?: string | undefined): void {
    if (address === undefined || address === "") {
      return;
    }
    const day = usageDayOf(this.#options.clock.now());
    this.#forgetDaysBefore(day);
    const client = clientHash(this.#secret, day, address);
    this.#noteServiceClient({ day, client, app: this.#appOf(app) });
    if (mount.repo.repository.visibility === "public") {
      const scope = { accountId: mount.repo.accountId, repoId: mount.repo.id };
      this.#noteClient({ scope, day, client });
    }
    if (this.#clients.size + this.#serviceClients.size >= this.#maxBuffered()) {
      void this.flush();
    }
  }

  /** Writes what has been counted so far. Resolves when it is in the database, or given up on. */
  flush(): Promise<void> {
    const increments = [...this.#buffer.values()];
    this.#buffer = new Map();
    const serviceIncrements = [...this.#serviceBuffer.values()];
    this.#serviceBuffer = new Map();
    const clients = this.#clients;
    this.#clients = new Map();
    const serviceClients = this.#serviceClients;
    this.#serviceClients = new Map();
    const today = usageDayOf(this.#options.clock.now());
    // Days that are over are folded once per day by every process; a fold with nothing to move
    // costs one statement.
    const fold = this.#foldedBefore !== today;
    this.#foldedBefore = today;
    if (
      increments.length === 0 &&
      serviceIncrements.length === 0 &&
      clients.size === 0 &&
      serviceClients.size === 0 &&
      !fold
    ) {
      return this.#writing;
    }
    const { database, clock, logger } = this.#options;
    // One write at a time, in order; a failure is logged and the counts are dropped, because a
    // database that is down would otherwise make this buffer grow without bound.
    this.#writing = this.#writing.then(async () => {
      try {
        const now = clock.now();
        if (clients.size > 0) {
          await addUsageClients(database, [...clients.values()], now);
        }
        if (serviceClients.size > 0) {
          await addServiceUsageClients(database, [...serviceClients.values()], now);
        }
        if (increments.length > 0) {
          await addUsage(database, increments, now);
        }
        if (serviceIncrements.length > 0) {
          await addServiceUsage(database, serviceIncrements, now);
        }
        if (fold) {
          await foldUsageClients(database, today, now);
          await foldServiceUsageClients(database, today, now);
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
            counters: increments.length + serviceIncrements.length,
            clients: clients.size + serviceClients.size,
          },
          "usage counts were not written",
        );
      }
    });
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

  #maxBuffered(): number {
    return this.#options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
  }

  /** A new day: what was remembered is about a day that is over. */
  #forgetDaysBefore(day: UsageDay): void {
    if (this.#rememberedDay !== day) {
      this.#remembered = new Set();
      this.#serviceRemembered = new Map();
      this.#apps = new Set();
      this.#rememberedDay = day;
    }
  }

  /** The app as it is written down today: its name, or `OTHER_APP` once enough names are known. */
  #appOf(name: string | undefined): string {
    const app = normalizeClientApp(name);
    if (app === "" || this.#apps.has(app)) {
      return app;
    }
    if (this.#apps.size >= MAX_APPS_PER_DAY) {
      return OTHER_APP;
    }
    this.#apps.add(app);
    return app;
  }

  /** Puts a hashed client in line to be written, unless it was written today already. */
  #noteClient(seen: UsageClient): void {
    const key = JSON.stringify([seen.scope.repoId, seen.day, seen.client]);
    if (this.#remembered.has(key)) {
      return;
    }
    if (this.#remembered.size >= MAX_REMEMBERED_CLIENTS) {
      // Forgetting costs a few rows that the database ignores; remembering costs memory.
      this.#remembered = new Set();
    }
    this.#remembered.add(key);
    this.#clients.set(key, seen);
  }

  /**
   * The same for the deployment's row of the client, which is written again, once, when the app
   * becomes known after the row was written without it.
   */
  #noteServiceClient(seen: ServiceUsageClient): void {
    const key = JSON.stringify([seen.day, seen.client]);
    const knownWithApp = this.#serviceRemembered.get(key);
    if (knownWithApp === true || (knownWithApp === false && seen.app === "")) {
      return;
    }
    if (this.#serviceRemembered.size >= MAX_REMEMBERED_CLIENTS) {
      this.#serviceRemembered = new Map();
    }
    this.#serviceRemembered.set(key, seen.app !== "");
    this.#serviceClients.set(key, seen);
  }
}
