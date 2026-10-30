import { createHash } from "node:crypto";
import {
  type Clock,
  completeShowcaseTexts,
  formatAddress,
  MEDIA_CONTENT_TYPES,
  mediaFitsSlot,
  mediaShaOfLink,
  mediaUrl,
  type RestShowcase,
  type RestShowcaseEntry,
  type RestShowcaseOrganization,
  restShowcaseEntrySchema,
  restShowcaseOrganizationSchema,
  SHOWCASE_CUT_SLOTS,
  SHOWCASE_ID_PATTERN,
  SHOWCASE_MEDIA_SLOTS,
  type ShowcaseCutSlot,
  type ShowcaseMediaSlot,
  type ShowcaseTexts,
  showcaseInputSchema,
  showcaseOrganizationInputSchema,
} from "@skillcdn/core";
import {
  type Database,
  getOperatorMedia,
  listOperatorMedia,
  listShowcaseEntries,
  listShowcaseOrganizations,
  type OperatorMediaRecord,
  putOperatorMedia,
  putShowcaseEntry,
  putShowcaseOrganization,
  removeOperatorMedia,
  removeShowcaseEntry,
  removeShowcaseOrganization,
  type ShowcaseEntryRecord,
  type ShowcaseOrganizationRecord,
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
  | "organization.invalid_id"
  | "organization.invalid"
  | "organization.media_missing"
  | "organization.media_wrong_kind"
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

/** What a process read of the showcase lately: its entries and its organizations. */
interface Loaded {
  readonly until: number;
  readonly entries: Promise<readonly ShowcaseEntryRecord[]>;
  readonly organizations: Promise<readonly ShowcaseOrganizationRecord[]>;
  readonly uploads: Promise<readonly OperatorMediaRecord[]>;
}

/**
 * The landing showcase (ADR-0028): the entries the front page leads with, the organizations
 * named beside them, and the uploads they are made of, read from the database and kept for a
 * short while. Writes go through here too, so that this process sees them at once. The uploads
 * it serves are kept in memory, bounded.
 */
export class Showcase {
  readonly #database: Database;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #loaded: Loaded | undefined;
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

  /**
   * The entries and the organizations as the pages read them, each in order. What does not
   * parse is left out.
   */
  async list(): Promise<RestShowcase> {
    const items: RestShowcaseEntry[] = [];
    const types = await this.#types();
    for (const entry of await this.#entries()) {
      const rest = this.#toRest(entry, types);
      if (rest !== undefined) {
        items.push(rest);
      }
    }
    const organizations: RestShowcaseOrganization[] = [];
    for (const organization of await this.#organizations()) {
      const rest = this.#organizationToRest(organization);
      if (rest !== undefined) {
        organizations.push(rest);
      }
    }
    return { items, organizations };
  }

  /**
   * Writes an entry under `slug`, replacing what was there. The body is what the admin API was
   * sent; every upload it names, the entry's own and each cut's, must exist and be a video or
   * a picture as its slot needs.
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
    /** Every upload the entry names, with the slot it takes, as the problems name it. */
    const named: {
      readonly label: string;
      readonly slot: ShowcaseMediaSlot;
      readonly sha: string;
    }[] = [];
    for (const slot of SLOTS) {
      const sha = input.media[slot];
      if (typeof sha === "string") {
        media[slot] = sha;
        named.push({ label: slot, slot, sha });
      }
    }
    const cuts: Record<
      string,
      { link: string | null; media: Partial<Record<ShowcaseCutSlot, string>> }
    > = {};
    for (const [language, cut] of Object.entries(input.cuts ?? {})) {
      const files: Partial<Record<ShowcaseCutSlot, string>> = {};
      for (const slot of SHOWCASE_CUT_SLOTS) {
        const sha = cut.media?.[slot];
        if (typeof sha === "string") {
          files[slot] = sha;
          named.push({ label: `cuts.${language}.${slot}`, slot, sha });
        }
      }
      cuts[language] = { link: cut.link ?? null, media: files };
    }
    const known = new Map((await listOperatorMedia(this.#database)).map((m) => [m.sha, m]));
    const missing = [...new Set(named.map(({ sha }) => sha))].filter((sha) => !known.has(sha));
    if (missing.length > 0) {
      throw new ShowcaseError(
        "showcase.media_missing",
        "The entry names uploads that do not exist.",
        missing,
      );
    }
    const wrong = named.flatMap(({ label, slot, sha }) => {
      const type = known.get(sha)?.contentType ?? "";
      return mediaFitsSlot(slot, type) ? [] : [`${label}: ${type}`];
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
      link: input.link ?? null,
      origin: input.origin ?? "pack",
      width: input.width,
      height: input.height,
      durationMs: input.durationMs ?? null,
      published: input.published ?? null,
      texts,
      media,
      cuts,
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
    const rest = written === undefined ? undefined : this.#toRest(written, await this.#types());
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

  /**
   * Writes an organization under `slug`, replacing what was there: its name, its site and the
   * upload that is its mark, which must exist and be a picture.
   */
  async putOrganization(slug: string, body: unknown): Promise<RestShowcaseOrganization> {
    if (!SHOWCASE_ID_PATTERN.test(slug)) {
      throw new ShowcaseError(
        "organization.invalid_id",
        "An organization is named by a lowercase slug of letters, digits and hyphens.",
      );
    }
    const parsed = showcaseOrganizationInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ShowcaseError(
        "organization.invalid",
        "The organization is not valid.",
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`),
      );
    }
    const input = parsed.data;
    const known = (await listOperatorMedia(this.#database)).find((m) => m.sha === input.logo);
    if (known === undefined) {
      throw new ShowcaseError(
        "organization.media_missing",
        "The organization names an upload that does not exist.",
        [input.logo],
      );
    }
    if (!mediaFitsSlot("poster", known.contentType)) {
      throw new ShowcaseError(
        "organization.media_wrong_kind",
        "The mark of an organization is a picture.",
        [`logo: ${known.contentType}`],
      );
    }
    const result = await putShowcaseOrganization(this.#database, {
      slug,
      name: input.name,
      url: input.url,
      logo: input.logo,
      position: input.position ?? 0,
    });
    if (result.outcome === "media_missing") {
      throw new ShowcaseError(
        "organization.media_missing",
        "The organization names an upload that does not exist.",
        result.missing,
      );
    }
    this.#loaded = undefined;
    const written = (await this.#organizations()).find((found) => found.slug === slug);
    const rest = written === undefined ? undefined : this.#organizationToRest(written);
    if (rest === undefined) {
      throw new Error("the organization was written but cannot be read back");
    }
    return rest;
  }

  /** True when the organization was there. */
  async removeOrganization(slug: string): Promise<boolean> {
    const removed = await removeShowcaseOrganization(this.#database, slug);
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

  /**
   * The wire shape of an entry, parsed once more: what is in the database is input too. A link
   * to an upload of the deployment says what the upload is, from `types`, by hash.
   */
  #toRest(
    entry: ShowcaseEntryRecord,
    types: ReadonlyMap<string, string>,
  ): RestShowcaseEntry | undefined {
    const file = (upload: { readonly sha: string; readonly contentType: string } | undefined) =>
      upload === undefined ? null : { url: mediaUrl(upload.sha), type: upload.contentType };
    const slot = (name: ShowcaseMediaSlot) => file(entry.media[name]);
    const poster = slot("poster");
    const cuts = Object.fromEntries(
      Object.entries(entry.cuts).map(([language, cut]) => [
        language,
        {
          link: cut.link,
          media: {
            clip: file(cut.media.clip),
            animation: file(cut.media.animation),
            poster: file(cut.media.poster),
            social: file(cut.media.social),
          },
        },
      ]),
    );
    const parsed = restShowcaseEntrySchema.safeParse({
      id: entry.slug,
      address: entry.address,
      link: entry.link,
      linkType: entry.link === null ? null : (types.get(mediaShaOfLink(entry.link) ?? "") ?? null),
      origin: entry.origin,
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
      cuts,
    });
    if (!parsed.success) {
      this.#logger.warn({ entry: entry.slug }, "showcase entry is not valid and is not shown");
      return undefined;
    }
    return parsed.data;
  }

  #organizationToRest(
    organization: ShowcaseOrganizationRecord,
  ): RestShowcaseOrganization | undefined {
    const parsed = restShowcaseOrganizationSchema.safeParse({
      id: organization.slug,
      name: organization.name,
      url: organization.url,
      logo: { url: mediaUrl(organization.logo.sha), type: organization.logo.contentType },
      position: organization.position,
    });
    if (!parsed.success) {
      this.#logger.warn(
        { organization: organization.slug },
        "organization is not valid and is not shown",
      );
      return undefined;
    }
    return parsed.data;
  }

  #entries(): Promise<readonly ShowcaseEntryRecord[]> {
    return this.#load().entries;
  }

  #organizations(): Promise<readonly ShowcaseOrganizationRecord[]> {
    return this.#load().organizations;
  }

  /** The content type of every upload, by hash: what a link to one of them is. */
  async #types(): Promise<ReadonlyMap<string, string>> {
    return new Map((await this.#load().uploads).map((upload) => [upload.sha, upload.contentType]));
  }

  #load(): Loaded {
    const now = this.#clock.now().getTime();
    if (this.#loaded === undefined || this.#loaded.until <= now) {
      const entries = listShowcaseEntries(this.#database);
      const organizations = listShowcaseOrganizations(this.#database);
      const uploads = listOperatorMedia(this.#database);
      this.#loaded = { until: now + SHOWCASE_TTL_MS, entries, organizations, uploads };
      const forget = (): void => {
        this.#loaded = undefined;
      };
      entries.catch(forget);
      organizations.catch(forget);
      uploads.catch(forget);
    }
    return this.#loaded;
  }
}
