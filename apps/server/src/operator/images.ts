import {
  type Address,
  type Clock,
  formatAddress,
  IMAGE_CONTENT_TYPES,
  isImageUrl,
  MAX_IMAGE_URL_LENGTH,
  mediaUrl,
  parseAddress,
} from "@skillcdn/core";
import {
  type Database,
  listOperatorImages,
  listOperatorMedia,
  type OperatorImageRecord,
  putOperatorImage,
  removeOperatorImage,
} from "@skillcdn/db";
import * as z from "zod";
import { repositoryKey } from "../mounts/mount-service.js";
import { OperatorLists } from "./lists.js";

/** How long a process trusts what it read of the pictures; a change made elsewhere shows within it. */
const IMAGES_TTL_MS = 30_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type OperatorImageErrorCode =
  | "image.invalid"
  | "image.media_missing"
  | "image.media_wrong_kind";

export class OperatorImageError extends Error {
  readonly code: OperatorImageErrorCode;
  /** What is wrong, one line each, for the operator. */
  readonly problems: readonly string[];

  constructor(code: OperatorImageErrorCode, message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "OperatorImageError";
    this.code = code;
    this.problems = problems;
  }
}

/** What the admin API is sent: one of an upload by hash or an `https` URL. */
const imageInputSchema = z
  .object({
    media: z.string().regex(SHA256_PATTERN, "the SHA-256 of an upload, in hex").optional(),
    url: z
      .string()
      .max(MAX_IMAGE_URL_LENGTH)
      .refine(isImageUrl, "an https URL without spaces")
      .optional(),
  })
  .strict()
  .refine((body) => (body.media === undefined) !== (body.url === undefined), {
    message: "exactly one of media and url",
  });

/** The picture of an address as the admin API answers it. */
export interface OperatorImageView {
  readonly address: string;
  /** The hash of the upload, or `null` for a URL. */
  readonly media: string | null;
  /** Where the pages load the picture from: `/media/<sha>` for an upload, else the URL. */
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The pictures the operator gives addresses (ADR-0031), read from the database and kept for a
 * short while. Writes go through here too, so that this process sees them at once.
 */
export class OperatorImages {
  readonly #database: Database;
  readonly #clock: Clock;
  #loaded:
    | { readonly until: number; readonly records: Promise<readonly OperatorImageRecord[]> }
    | undefined;

  constructor(options: { readonly database: Database; readonly clock: Clock }) {
    this.#database = options.database;
    this.#clock = options.clock;
  }

  /** Every picture, oldest first. */
  async all(): Promise<OperatorImageView[]> {
    return (await this.#records()).map((record) => viewOf(record));
  }

  /**
   * Where the picture of an address is loaded from, when the operator gave one: the picture of
   * the address as written, else the one of its repository.
   */
  async imageFor(address: Address): Promise<string | undefined> {
    const records = await this.#records();
    const exact = formatAddress(address);
    const repository = repositoryKey(address);
    const found =
      records.find((record) => record.address === exact) ??
      records.find((record) => record.address === repository);
    return found === undefined ? undefined : urlOf(found);
  }

  /** Writes the picture of the address `text` names, replacing what was there. */
  async put(text: string, body: unknown): Promise<OperatorImageView> {
    const address = formatAddress(OperatorLists.addressOf("featured", text));
    const parsed = imageInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new OperatorImageError(
        "image.invalid",
        "The picture is not valid.",
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
      );
    }
    const { media, url } = parsed.data;
    if (media !== undefined) {
      const upload = (await listOperatorMedia(this.#database)).find((item) => item.sha === media);
      if (upload === undefined) {
        throw new OperatorImageError("image.media_missing", "No such upload.", [media]);
      }
      if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(upload.contentType)) {
        throw new OperatorImageError("image.media_wrong_kind", "The upload is not a picture.", [
          `${media}: ${upload.contentType}`,
        ]);
      }
    }
    const result = await putOperatorImage(
      this.#database,
      media === undefined ? { address, url: url ?? "" } : { address, mediaSha: media },
    );
    if (result.outcome === "media_missing") {
      throw new OperatorImageError("image.media_missing", "No such upload.", [media ?? ""]);
    }
    this.#loaded = undefined;
    const written = (await this.#records()).find((record) => record.address === address);
    if (written === undefined) {
      throw new Error("the picture was written but cannot be read back");
    }
    return viewOf(written);
  }

  /** Removes the picture of the address `text` names; `removed` says whether there was one. */
  async remove(text: string): Promise<{ readonly address: string; readonly removed: boolean }> {
    const address = formatAddress(OperatorLists.addressOf("featured", text));
    const removed = await removeOperatorImage(this.#database, address);
    this.#loaded = undefined;
    return { address, removed };
  }

  /** Forget what was read, so that the next question asks the database. */
  invalidate(): void {
    this.#loaded = undefined;
  }

  #records(): Promise<readonly OperatorImageRecord[]> {
    const now = this.#clock.now().getTime();
    if (this.#loaded === undefined || this.#loaded.until <= now) {
      const records = listOperatorImages(this.#database).then((found) =>
        // A row whose address no longer parses is the operator's to fix; it pictures nothing.
        found.filter((record) => parseAddress(record.address).ok),
      );
      this.#loaded = { until: now + IMAGES_TTL_MS, records };
      records.catch(() => {
        this.#loaded = undefined;
      });
    }
    return this.#loaded.records;
  }
}

function urlOf(record: OperatorImageRecord): string {
  return record.media === undefined ? (record.url ?? "") : mediaUrl(record.media.sha);
}

function viewOf(record: OperatorImageRecord): OperatorImageView {
  return {
    address: record.address,
    media: record.media?.sha ?? null,
    url: urlOf(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
