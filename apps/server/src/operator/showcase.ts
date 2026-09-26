import { createHash } from "node:crypto";
import {
  type Clock,
  completeShowcaseTexts,
  formatAddress,
  MEDIA_CONTENT_TYPES,
  mediaFitsSlot,
  mediaUrl,
  type RestShowcase,
  type RestShowcaseEntry,
  restShowcaseEntrySchema,
  SHOWCASE_ID_PATTERN,
  SHOWCASE_MEDIA_SLOTS,
  type ShowcaseMediaSlot,
  type ShowcaseTexts,
  showcaseInputSchema,
} from "@skillcdn/core";
import {
  type Database,
  getOperatorMedia,
  listOperatorMedia,
  listShowcaseEntries,
  type OperatorMediaRecord,
  putOperatorMedia,
  putShowcaseEntry,
  removeOperatorMedia,
  removeShowcaseEntry,
  type ShowcaseEntryRecord,
  type StoredOperatorMedia,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { OperatorLists } from "./lists.js";

/** How long a process trusts what it read of the showcase; a change made elsewhere shows within it. */
const SHOWCASE_TTL_MS = 30_000;
/** How much uploaded media a process keeps in memory for serving, oldest out first. */
const MEDIA_CACHE_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type ShowcaseErrorCode =
  | "showcase.invalid_id"
  | "showcase.invalid"
  | "showcase.media_missing"
  | "showcase.media_wrong_kind"
  | "media.empty"
  | "media.unsupported_type";

export class ShowcaseError extends Error {
  readonly code: ShowcaseErrorCode;
  /** What is wrong, one line each, for the operator. */
  readonly problems: readonly string[];

  constructor(code: ShowcaseErrorCode, message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "ShowcaseError";
    this.code = code;
    this.problems = problems;
  }
}

export interface UploadedMedia {
  readonly sha: string;
  readonly contentType: string;
  readonly size: number;
  readonly url: string;
}

const SLOTS = Object.keys(SHOWCASE_MEDIA_SLOTS) as readonly ShowcaseMediaSlot[];

/**
 * The landing showcase (ADR-0028): the entries the front page leads with and the uploads they
 * are made of, read from the database and kept for a short while. Writes go through here too,
 * so that this process sees them at once. The uploads it serves are kept in memory, bounded.
 */
export class Showcase {
  readonly #database: Database;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #loaded:
    | { readonly until: number; readonly entries: Promise<readonly ShowcaseEntryRecord[]> }
    | undefined;
  readonly #media = new Map<string, StoredOperatorMedia>();
  #mediaBytes = 0;

  constructor(options: {
    readonly database: Database;
    readonly clock: Clock;
    readonly logger: Logger;
  }) {
    this.#database = options.database;
    this.#clock = options.clock;
    this.#logger = options.logger;
  }

  /** The entries as the pages read them, in order. An entry that does not parse is left out. */
  async list(): Promise<RestShowcase> {
    const items: RestShowcaseEntry[] = [];
    for (const entry of await this.#entries()) {
      const rest = this.#toRest(entry);
      if (rest !== undefined) {
        items.push(rest);
      }
    }
    return { items };
  }

  /**
   * Writes an entry under `slug`, replacing what was there. The body is what the admin API was
   * sent; every upload it names must exist and be a video or a picture as its slot needs.
   */
  async put(slug: string, body: unknown): Promise<RestShowcaseEntry> {
    if (!SHOWCASE_ID_PATTERN.test(slug)) {
      throw new ShowcaseError(
        "showcase.invalid_id",
        "An entry is named by a lowercase slug of letters, digits and hyphens.",
      );
    }
    const parsed = showcaseInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ShowcaseError(
        "showcase.invalid",
        "The entry is not valid.",
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
      );
    }
    const input = parsed.data;
    const address = formatAddress(OperatorLists.addressOf("featured", input.address));
    const media: Partial<Record<ShowcaseMediaSlot, string>> = {};
    for (const slot of SLOTS) {
      const sha = input.media[slot];
      if (typeof sha === "string") {
        media[slot] = sha;
      }
    }
    const known = new Map((await listOperatorMedia(this.#database)).map((m) => [m.sha, m]));
    const missing = [...new Set(Object.values(media))].filter((sha) => !known.has(sha));
    if (missing.length > 0) {
      throw new ShowcaseError(
        "showcase.media_missing",
        "The entry names uploads that do not exist.",
        missing,
      );
    }
    const wrong = Object.entries(media).flatMap(([slot, sha]) => {
      const type = known.get(sha)?.contentType ?? "";
      return mediaFitsSlot(slot as ShowcaseMediaSlot, type) ? [] : [`${slot}: ${type}`];
    });
    if (wrong.length > 0) {
      throw new ShowcaseError(
        "showcase.media_wrong_kind",
        "An upload is not the kind of media its slot needs.",
        wrong,
      );
    }
    const texts: Record<string, ShowcaseTexts> = {};
    for (const [language, words] of Object.entries(input.texts)) {
      texts[language] = completeShowcaseTexts(words);
    }
    const result = await putShowcaseEntry(this.#database, {
      slug,
      position: input.position ?? 0,
      address,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs ?? null,
      published: input.published ?? null,
      texts,
      media,
    });
    if (result.outcome === "media_missing") {
      throw new ShowcaseError(
        "showcase.media_missing",
        "The entry names uploads that do not exist.",
        result.missing,
      );
    }
    this.#loaded = undefined;
    const written = (await this.#entries()).find((entry) => entry.slug === slug);
    const rest = written === undefined ? undefined : this.#toRest(written);
    if (rest === undefined) {
      throw new Error("the showcase entry was written but cannot be read back");
    }
    return rest;
  }

  /** True when the entry was there. */
  async remove(slug: string): Promise<boolean> {
    const removed = await removeShowcaseEntry(this.#database, slug);
    this.#loaded = undefined;
    return removed;
  }

  /** Stores an upload under the hash of its bytes. The same bytes twice are one upload. */
  async addMedia(bytes: Uint8Array, contentType: string): Promise<UploadedMedia> {
    const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    if (!MEDIA_CONTENT_TYPES.includes(type)) {
      throw new ShowcaseError(
        "media.unsupported_type",
        `An upload is one of ${MEDIA_CONTENT_TYPES.join(", ")}.`,
      );
    }
    if (bytes.byteLength === 0) {
      throw new ShowcaseError("media.empty", "An upload has bytes.");
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    // What is stored is what is answered: the same bytes keep the type they were first sent as.
    const stored = await putOperatorMedia(this.#database, { sha, contentType: type, bytes });
    return { sha, contentType: stored.contentType, size: stored.size, url: mediaUrl(sha) };
  }

  async listMedia(): Promise<readonly (OperatorMediaRecord & { readonly url: string })[]> {
    return (await listOperatorMedia(this.#database)).map((record) => ({
      ...record,
      url: mediaUrl(record.sha),
    }));
  }

  /** `in_use` leaves the upload where it is: an entry still shows it. */
  async removeMedia(sha: string): Promise<"removed" | "missing" | "in_use"> {
    if (!SHA256_PATTERN.test(sha)) {
      return "missing";
    }
    const outcome = await removeOperatorMedia(this.#database, sha);
    if (outcome === "removed") {
      this.#forget(sha);
    }
    return outcome;
  }

  /** An upload to serve, from memory when it was served lately. */
  async media(sha: string): Promise<StoredOperatorMedia | undefined> {
    if (!SHA256_PATTERN.test(sha)) {
      return undefined;
    }
    const cached = this.#media.get(sha);
    if (cached !== undefined) {
      return cached;
    }
    const found = await getOperatorMedia(this.#database, sha);
    if (found !== undefined && found.size <= MEDIA_CACHE_BYTES) {
      this.#remember(sha, found);
    }
    return found;
  }

  /** Forget what was read, so that the next question asks the database. */
  invalidate(): void {
    this.#loaded = undefined;
  }

  #remember(sha: string, media: StoredOperatorMedia): void {
    // Oldest out first: the map keeps insertion order.
    for (const [oldest, old] of this.#media) {
      if (this.#mediaBytes + media.size <= MEDIA_CACHE_BYTES) {
        break;
      }
      this.#media.delete(oldest);
      this.#mediaBytes -= old.size;
    }
    this.#media.set(sha, media);
    this.#mediaBytes += media.size;
  }

  #forget(sha: string): void {
    const found = this.#media.get(sha);
    if (found !== undefined) {
      this.#media.delete(sha);
      this.#mediaBytes -= found.size;
    }
  }

  /** The wire shape of an entry, parsed once more: what is in the database is input too. */
  #toRest(entry: ShowcaseEntryRecord): RestShowcaseEntry | undefined {
    const slot = (name: ShowcaseMediaSlot) => {
      const upload = entry.media[name];
      return upload === undefined ? null : { url: mediaUrl(upload.sha), type: upload.contentType };
    };
    const poster = slot("poster");
    const parsed = restShowcaseEntrySchema.safeParse({
      id: entry.slug,
      address: entry.address,
      position: entry.position,
      width: entry.width,
      height: entry.height,
      durationMs: entry.durationMs,
      published: entry.published,
      media: {
        clip: slot("clip"),
        animation: slot("animation"),
        poster,
        reference: slot("reference"),
        picture: slot("picture"),
        social: slot("social"),
      },
      texts: entry.texts,
    });
    if (!parsed.success) {
      this.#logger.warn({ entry: entry.slug }, "showcase entry is not valid and is not shown");
      return undefined;
    }
    return parsed.data;
  }

  #entries(): Promise<readonly ShowcaseEntryRecord[]> {
    const now = this.#clock.now().getTime();
    if (this.#loaded === undefined || this.#loaded.until <= now) {
      const entries = listShowcaseEntries(this.#database);
      this.#loaded = { until: now + SHOWCASE_TTL_MS, entries };
      entries.catch(() => {
        this.#loaded = undefined;
      });
    }
    return this.#loaded.entries;
  }
}
