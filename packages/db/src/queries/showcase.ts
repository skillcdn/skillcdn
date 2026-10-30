import type {
  ShowcaseCutSlot,
  ShowcaseMediaSlot,
  ShowcaseOrigin,
  ShowcaseTexts,
} from "@skillcdn/core";
import { asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import {
  operatorImages,
  operatorMedia,
  showcaseEntries,
  showcaseMedia,
  showcaseOrganizations,
} from "../schema.js";

// The landing showcase and the media it is made of (ADR-0028). Operator data, not tenant data.

export interface ShowcaseEntryRecord {
  /** The entry's name in the admin API and in the pages. */
  readonly slug: string;
  readonly position: number;
  /** Canonical, as the address grammar prints it. */
  readonly address: string;
  /** Where the result itself is, or `null`. */
  readonly link: string | null;
  /** Whose work the entry shows. */
  readonly origin: ShowcaseOrigin;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number | null;
  /** `YYYY-MM-DD`, or `null`. */
  readonly published: string | null;
  /** By language tag, as written through the admin API. */
  readonly texts: Record<string, ShowcaseTexts>;
  /** The upload in each slot that has one, with the type it was uploaded as. */
  readonly media: Partial<
    Record<ShowcaseMediaSlot, { readonly sha: string; readonly contentType: string }>
  >;
  /** By language tag, the result cut in that language: its link and its own uploads. */
  readonly cuts: Record<string, ShowcaseCutRecord>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ShowcaseCutRecord {
  /** The cut's own link to the result, or `null` for the entry's. */
  readonly link: string | null;
  readonly media: Partial<
    Record<ShowcaseCutSlot, { readonly sha: string; readonly contentType: string }>
  >;
}

/** Every entry, in the order the page shows them: by position, then by name. */
export async function listShowcaseEntries(database: Database): Promise<ShowcaseEntryRecord[]> {
  const db = drizzleOf(database);
  const rows = await db
    .select()
    .from(showcaseEntries)
    .orderBy(asc(showcaseEntries.position), asc(showcaseEntries.slug));
  if (rows.length === 0) {
    return [];
  }
  const uploads = await db
    .select({
      entryId: showcaseMedia.entryId,
      language: showcaseMedia.language,
      slot: showcaseMedia.slot,
      sha: showcaseMedia.sha,
      contentType: operatorMedia.contentType,
    })
    .from(showcaseMedia)
    .innerJoin(operatorMedia, eq(showcaseMedia.sha, operatorMedia.sha))
    .where(
      inArray(
        showcaseMedia.entryId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map((row) => {
    const media: Record<string, { sha: string; contentType: string }> = {};
    const cuts: Record<
      string,
      { link: string | null; media: Record<string, { sha: string; contentType: string }> }
    > = {};
    for (const [language, cut] of Object.entries(row.cuts)) {
      cuts[language] = { link: cut.link, media: {} };
    }
    for (const upload of uploads) {
      if (upload.entryId !== row.id) continue;
      const file = { sha: upload.sha, contentType: upload.contentType };
      if (upload.language === "") {
        media[upload.slot] = file;
      } else {
        let cut = cuts[upload.language];
        if (cut === undefined) {
          cut = { link: null, media: {} };
          cuts[upload.language] = cut;
        }
        cut.media[upload.slot] = file;
      }
    }
    return {
      slug: row.slug,
      position: row.position,
      address: row.address,
      link: row.link,
      origin: row.origin,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      published: row.published,
      texts: row.texts,
      media,
      cuts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export interface ShowcaseEntryInput {
  readonly slug: string;
  readonly position: number;
  readonly address: string;
  readonly link: string | null;
  readonly origin: ShowcaseOrigin;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number | null;
  readonly published: string | null;
  readonly texts: Record<string, ShowcaseTexts>;
  /** The SHA-256 of the upload in each slot that has one. */
  readonly media: Partial<Record<ShowcaseMediaSlot, string>>;
  /** By language tag, the result cut in that language: its link and the uploads of its own. */
  readonly cuts: Record<
    string,
    { readonly link: string | null; readonly media: Partial<Record<ShowcaseCutSlot, string>> }
  >;
}

export type PutShowcaseResult =
  | { readonly outcome: "created" | "updated" }
  /** Nothing was written: these uploads do not exist. */
  | { readonly outcome: "media_missing"; readonly missing: readonly string[] };

/**
 * Writes an entry as a whole: the row by its name, then the upload in each of its slots, the
 * entry's own and each cut's. An entry that is already there is replaced, slots included, in
 * one transaction.
 */
export async function putShowcaseEntry(
  database: Database,
  input: ShowcaseEntryInput,
): Promise<PutShowcaseResult> {
  const db = drizzleOf(database);
  const slots: { language: string; slot: ShowcaseMediaSlot; sha: string }[] = [];
  for (const [slot, sha] of Object.entries(input.media)) {
    if (typeof sha === "string") slots.push({ language: "", slot: slot as ShowcaseMediaSlot, sha });
  }
  const cutLinks: Record<string, { link: string | null }> = {};
  for (const [language, cut] of Object.entries(input.cuts)) {
    cutLinks[language] = { link: cut.link };
    for (const [slot, sha] of Object.entries(cut.media)) {
      if (typeof sha === "string") slots.push({ language, slot: slot as ShowcaseCutSlot, sha });
    }
  }
  return db.transaction(async (tx) => {
    const wanted = [...new Set(slots.map(({ sha }) => sha))];
    const known =
      wanted.length === 0
        ? []
        : await tx
            .select({ sha: operatorMedia.sha })
            .from(operatorMedia)
            .where(inArray(operatorMedia.sha, wanted));
    const found = new Set(known.map((row) => row.sha));
    const missing = wanted.filter((sha) => !found.has(sha));
    if (missing.length > 0) {
      return { outcome: "media_missing", missing };
    }
    const [existing] = await tx
      .select({ id: showcaseEntries.id })
      .from(showcaseEntries)
      .where(eq(showcaseEntries.slug, input.slug))
      .limit(1);
    const values = {
      position: input.position,
      address: input.address,
      link: input.link,
      origin: input.origin,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
      published: input.published,
      texts: input.texts,
      cuts: cutLinks,
    };
    let id: string;
    if (existing === undefined) {
      const [inserted] = await tx
        .insert(showcaseEntries)
        .values({ slug: input.slug, ...values })
        .returning({ id: showcaseEntries.id });
      if (inserted === undefined) {
        throw new Error("the showcase entry was not inserted");
      }
      id = inserted.id;
    } else {
      id = existing.id;
      await tx
        .update(showcaseEntries)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(showcaseEntries.id, id));
      await tx.delete(showcaseMedia).where(eq(showcaseMedia.entryId, id));
    }
    if (slots.length > 0) {
      await tx
        .insert(showcaseMedia)
        .values(slots.map(({ language, slot, sha }) => ({ entryId: id, language, slot, sha })));
    }
    return { outcome: existing === undefined ? "created" : "updated" };
  });
}

/** True when the entry was there. Its slots go with it; the uploads stay. */
export async function removeShowcaseEntry(database: Database, slug: string): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(showcaseEntries)
    .where(eq(showcaseEntries.slug, slug))
    .returning({ id: showcaseEntries.id });
  return rows.length > 0;
}

/** An organization named beside the showcase, with the upload that is its mark. */
export interface ShowcaseOrganizationRecord {
  readonly slug: string;
  readonly name: string;
  readonly url: string;
  readonly logo: { readonly sha: string; readonly contentType: string };
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Every organization, in the order the page shows them: by position, then by name. */
export async function listShowcaseOrganizations(
  database: Database,
): Promise<ShowcaseOrganizationRecord[]> {
  const rows = await drizzleOf(database)
    .select({
      slug: showcaseOrganizations.slug,
      name: showcaseOrganizations.name,
      url: showcaseOrganizations.url,
      sha: showcaseOrganizations.logoSha,
      contentType: operatorMedia.contentType,
      position: showcaseOrganizations.position,
      createdAt: showcaseOrganizations.createdAt,
      updatedAt: showcaseOrganizations.updatedAt,
    })
    .from(showcaseOrganizations)
    .innerJoin(operatorMedia, eq(showcaseOrganizations.logoSha, operatorMedia.sha))
    .orderBy(asc(showcaseOrganizations.position), asc(showcaseOrganizations.slug));
  return rows.map(({ sha, contentType, ...row }) => ({ ...row, logo: { sha, contentType } }));
}

export interface ShowcaseOrganizationInput {
  readonly slug: string;
  readonly name: string;
  readonly url: string;
  /** The SHA-256 of the upload that is its mark. */
  readonly logo: string;
  readonly position: number;
}

/**
 * Writes an organization under its name, replacing what was there. `media_missing` when the
 * upload named as its mark does not exist; nothing is written then.
 */
export async function putShowcaseOrganization(
  database: Database,
  input: ShowcaseOrganizationInput,
): Promise<PutShowcaseResult> {
  const db = drizzleOf(database);
  return db.transaction(async (tx) => {
    const [known] = await tx
      .select({ sha: operatorMedia.sha })
      .from(operatorMedia)
      .where(eq(operatorMedia.sha, input.logo))
      .limit(1);
    if (known === undefined) {
      return { outcome: "media_missing", missing: [input.logo] };
    }
    const values = {
      name: input.name,
      url: input.url,
      logoSha: input.logo,
      position: input.position,
    };
    const [existing] = await tx
      .select({ id: showcaseOrganizations.id })
      .from(showcaseOrganizations)
      .where(eq(showcaseOrganizations.slug, input.slug))
      .limit(1);
    if (existing === undefined) {
      await tx.insert(showcaseOrganizations).values({ slug: input.slug, ...values });
      return { outcome: "created" };
    }
    await tx
      .update(showcaseOrganizations)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(showcaseOrganizations.id, existing.id));
    return { outcome: "updated" };
  });
}

/** True when the organization was there. Its upload stays. */
export async function removeShowcaseOrganization(
  database: Database,
  slug: string,
): Promise<boolean> {
  const rows = await drizzleOf(database)
    .delete(showcaseOrganizations)
    .where(eq(showcaseOrganizations.slug, slug))
    .returning({ id: showcaseOrganizations.id });
  return rows.length > 0;
}

export interface NewOperatorMedia {
  /** SHA-256 of the bytes, in hex: the name the upload is served under. */
  readonly sha: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * Idempotent: the same bytes are the same upload, and keep the type they were first sent as.
 * Answers with what is stored under the hash.
 */
export async function putOperatorMedia(
  database: Database,
  media: NewOperatorMedia,
): Promise<{ readonly contentType: string; readonly size: number }> {
  const db = drizzleOf(database);
  const [inserted] = await db
    .insert(operatorMedia)
    .values({
      sha: media.sha,
      contentType: media.contentType,
      size: media.bytes.byteLength,
      bytes: media.bytes,
    })
    .onConflictDoNothing({ target: operatorMedia.sha })
    .returning({ contentType: operatorMedia.contentType, size: operatorMedia.size });
  if (inserted !== undefined) {
    return inserted;
  }
  const [existing] = await db
    .select({ contentType: operatorMedia.contentType, size: operatorMedia.size })
    .from(operatorMedia)
    .where(eq(operatorMedia.sha, media.sha))
    .limit(1);
  if (existing === undefined) {
    throw new Error("the upload was neither stored nor found");
  }
  return existing;
}

export interface StoredOperatorMedia {
  readonly contentType: string;
  readonly size: number;
  readonly bytes: Uint8Array;
}

export async function getOperatorMedia(
  database: Database,
  sha: string,
): Promise<StoredOperatorMedia | undefined> {
  const [found] = await drizzleOf(database)
    .select({
      contentType: operatorMedia.contentType,
      size: operatorMedia.size,
      bytes: operatorMedia.bytes,
    })
    .from(operatorMedia)
    .where(eq(operatorMedia.sha, sha))
    .limit(1);
  return found;
}

export interface OperatorMediaRecord {
  readonly sha: string;
  readonly contentType: string;
  readonly size: number;
  readonly createdAt: Date;
  /**
   * What uses the upload: the names of the showcase entries that show it in any slot, the
   * organizations whose mark it is, and the addresses whose picture it is (ADR-0031).
   */
  readonly usedBy: readonly string[];
}

/** Every upload without its bytes, oldest first, and what uses each. */
export async function listOperatorMedia(database: Database): Promise<OperatorMediaRecord[]> {
  const db = drizzleOf(database);
  const rows = await db
    .select({
      sha: operatorMedia.sha,
      contentType: operatorMedia.contentType,
      size: operatorMedia.size,
      createdAt: operatorMedia.createdAt,
    })
    .from(operatorMedia)
    .orderBy(asc(operatorMedia.createdAt), asc(operatorMedia.sha));
  const uses = await db
    .select({ sha: showcaseMedia.sha, name: showcaseEntries.slug })
    .from(showcaseMedia)
    .innerJoin(showcaseEntries, eq(showcaseMedia.entryId, showcaseEntries.id));
  const marks = await db
    .select({ sha: showcaseOrganizations.logoSha, name: showcaseOrganizations.slug })
    .from(showcaseOrganizations);
  const pictures = await db
    .select({ sha: operatorImages.mediaSha, name: operatorImages.address })
    .from(operatorImages)
    .where(isNotNull(operatorImages.mediaSha));
  return rows.map((row) => ({
    ...row,
    usedBy: [
      ...new Set(
        [...uses, ...marks, ...pictures]
          .filter((use) => use.sha === row.sha)
          .map((use) => use.name),
      ),
    ].sort(),
  }));
}

/**
 * `in_use` leaves the upload where it is: an entry still shows it, an organization is marked by
 * it, or an address is pictured by it.
 */
export async function removeOperatorMedia(
  database: Database,
  sha: string,
): Promise<"removed" | "missing" | "in_use"> {
  const db = drizzleOf(database);
  return db.transaction(async (tx) => {
    const [use] = await tx
      .select({ entryId: showcaseMedia.entryId })
      .from(showcaseMedia)
      .where(eq(showcaseMedia.sha, sha))
      .limit(1);
    const [mark] = await tx
      .select({ id: showcaseOrganizations.id })
      .from(showcaseOrganizations)
      .where(eq(showcaseOrganizations.logoSha, sha))
      .limit(1);
    const [picture] = await tx
      .select({ id: operatorImages.id })
      .from(operatorImages)
      .where(eq(operatorImages.mediaSha, sha))
      .limit(1);
    if (use !== undefined || mark !== undefined || picture !== undefined) {
      return "in_use";
    }
    const rows = await tx
      .delete(operatorMedia)
      .where(eq(operatorMedia.sha, sha))
      .returning({ sha: operatorMedia.sha });
    return rows.length > 0 ? "removed" : "missing";
  });
}
