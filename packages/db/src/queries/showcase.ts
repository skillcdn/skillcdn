import type { ShowcaseMediaSlot, ShowcaseTexts } from "@skillcdn/core";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { operatorMedia, showcaseEntries, showcaseMedia } from "../schema.js";

// The landing showcase and the media it is made of (ADR-0028). Operator data, not tenant data.

export interface ShowcaseEntryRecord {
  /** The entry's name in the admin API and in the pages. */
  readonly slug: string;
  readonly position: number;
  /** Canonical, as the address grammar prints it. */
  readonly address: string;
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
    for (const upload of uploads) {
      if (upload.entryId === row.id) {
        media[upload.slot] = { sha: upload.sha, contentType: upload.contentType };
      }
    }
    return {
      slug: row.slug,
      position: row.position,
      address: row.address,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      published: row.published,
      texts: row.texts,
      media,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export interface ShowcaseEntryInput {
  readonly slug: string;
  readonly position: number;
  readonly address: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number | null;
  readonly published: string | null;
  readonly texts: Record<string, ShowcaseTexts>;
  /** The SHA-256 of the upload in each slot that has one. */
  readonly media: Partial<Record<ShowcaseMediaSlot, string>>;
}

export type PutShowcaseResult =
  | { readonly outcome: "created" | "updated" }
  /** Nothing was written: these uploads do not exist. */
  | { readonly outcome: "media_missing"; readonly missing: readonly string[] };

/**
 * Writes an entry as a whole: the row by its name, then the upload in each of its slots. An
 * entry that is already there is replaced, slots included, in one transaction.
 */
export async function putShowcaseEntry(
  database: Database,
  input: ShowcaseEntryInput,
): Promise<PutShowcaseResult> {
  const db = drizzleOf(database);
  const slots = Object.entries(input.media).filter(
    (pair): pair is [ShowcaseMediaSlot, string] => typeof pair[1] === "string",
  );
  return db.transaction(async (tx) => {
    const wanted = [...new Set(slots.map(([, sha]) => sha))];
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
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
      published: input.published,
      texts: input.texts,
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
        .values(slots.map(([slot, sha]) => ({ entryId: id, slot, sha })));
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
  /** The names of the entries that use the upload, in any slot. */
  readonly usedBy: readonly string[];
}

/** Every upload without its bytes, oldest first, and which entries use each. */
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
    .select({ sha: showcaseMedia.sha, slug: showcaseEntries.slug })
    .from(showcaseMedia)
    .innerJoin(showcaseEntries, eq(showcaseMedia.entryId, showcaseEntries.id));
  return rows.map((row) => ({
    ...row,
    usedBy: [...new Set(uses.filter((use) => use.sha === row.sha).map((use) => use.slug))].sort(),
  }));
}

/** `in_use` leaves the upload where it is: an entry still shows it. */
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
    if (use !== undefined) {
      return "in_use";
    }
    const rows = await tx
      .delete(operatorMedia)
      .where(eq(operatorMedia.sha, sha))
      .returning({ sha: operatorMedia.sha });
    return rows.length > 0 ? "removed" : "missing";
  });
}
