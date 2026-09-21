import type { RepoFileKind } from "@skillcdn/core";
import { and, eq, ne, not, or, type SQL, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { indexEntries, type SkillFrontMatter } from "../schema.js";
import { SEARCH_CONFIG, type SnapshotScope } from "./snapshots.js";

export interface EntryRecord {
  readonly path: string;
  readonly kind: RepoFileKind;
  readonly size: number;
  readonly blobSha: string;
  readonly skillDir: string | null;
  readonly name: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly frontMatter: SkillFrontMatter | null;
}

const entryColumns = {
  path: indexEntries.path,
  kind: indexEntries.kind,
  size: indexEntries.size,
  blobSha: indexEntries.blobSha,
  skillDir: indexEntries.skillDir,
  name: indexEntries.name,
  title: indexEntries.title,
  description: indexEntries.description,
  frontMatter: indexEntries.frontMatter,
};

function inSnapshot(scope: SnapshotScope): SQL | undefined {
  return and(
    eq(indexEntries.snapshotId, scope.snapshotId),
    eq(indexEntries.accountId, scope.accountId),
  );
}

/** Restricts to the mounted directory. `starts_with` takes the prefix literally: no wildcards. */
function underPath(column: typeof indexEntries.path, mountPath: string): SQL | undefined {
  return mountPath.length === 0 ? undefined : sql`starts_with(${column}, ${`${mountPath}/`})`;
}

/** Byte order, so that results come back in the same order whatever the database's collation. */
const BY_PATH = sql`${indexEntries.path} collate "C"`;

/** Documents and skills that are searchable: everything `find` can return. */
const FINDABLE = sql`${indexEntries.search} is not null`;

/**
 * Full-text search inside a mount. A query matches when any of its words match; rank decides
 * the order, and skills outrank plain documents. Returns nothing for a query without usable
 * words (only stop words, only punctuation): the caller decides what to show instead.
 */
export async function searchEntries(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
  query: string,
  limit: number,
): Promise<EntryRecord[]> {
  // plainto_tsquery normalizes the words and joins them with "&"; any-word matching wants "|".
  // Lexemes never contain spaces, so replacing " & " only ever touches operators.
  // A scalar subquery without table references is evaluated once per statement, not per row.
  const tsquery = sql`(select replace(plainto_tsquery(${SEARCH_CONFIG}::regconfig, ${query})::text, ' & ', ' | ')::tsquery)`;
  const rank = sql<number>`ts_rank('{0.05, 0.2, 0.6, 1.0}', ${indexEntries.search}, ${tsquery}, 1) * case when ${indexEntries.kind} = 'skill' then 1.5 else 1 end`;
  return drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(
      and(
        inSnapshot(scope),
        underPath(indexEntries.path, mountPath),
        sql`numnode(${tsquery}) > 0`,
        sql`${indexEntries.search} @@ ${tsquery}`,
      ),
    )
    .orderBy(sql`${rank} desc`, BY_PATH)
    .limit(limit);
}

const IS_SKILL = eq(indexEntries.kind, "skill");

/**
 * What a mount offers when nobody asked for anything in particular: skills first, then documents.
 * `only` narrows it to one of the two.
 */
export async function listEntries(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
  limit: number,
  only?: "skills" | "documents",
): Promise<EntryRecord[]> {
  const kind = only === undefined ? undefined : only === "skills" ? IS_SKILL : not(IS_SKILL);
  return drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(and(inSnapshot(scope), underPath(indexEntries.path, mountPath), FINDABLE, kind))
    .orderBy(sql`case when ${indexEntries.kind} = 'skill' then 0 else 1 end`, BY_PATH)
    .limit(limit);
}

/** How many skills and how many documents `listEntries` would return without a limit. */
export async function countEntries(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
): Promise<{ readonly skills: number; readonly documents: number }> {
  const [row] = await drizzleOf(database)
    .select({
      skills: sql<number>`count(*) filter (where ${IS_SKILL})::integer`,
      documents: sql<number>`count(*) filter (where not ${IS_SKILL})::integer`,
    })
    .from(indexEntries)
    .where(and(inSnapshot(scope), underPath(indexEntries.path, mountPath), FINDABLE));
  return { skills: row?.skills ?? 0, documents: row?.documents ?? 0 };
}

/**
 * Skills inside a mount that answer to `name` or live in `directory`. Exact matches come first;
 * a name that only differs in case still matches, because models are careless with case.
 */
export async function findSkills(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
  wanted: { readonly name: string; readonly directory: string | undefined },
  limit: number,
): Promise<EntryRecord[]> {
  const matches = [
    eq(indexEntries.name, wanted.name),
    sql`lower(${indexEntries.name}) = lower(${wanted.name})`,
  ];
  if (wanted.directory !== undefined) {
    matches.push(eq(indexEntries.skillDir, wanted.directory));
  }
  return drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(
      and(
        inSnapshot(scope),
        eq(indexEntries.kind, "skill"),
        underPath(indexEntries.path, mountPath),
        or(...matches),
      ),
    )
    .orderBy(sql`case when ${indexEntries.name} = ${wanted.name} then 0 else 1 end`, BY_PATH)
    .limit(limit);
}

/** Files that belong to a skill directory, the manifest itself excluded. */
export async function listSkillFiles(
  database: Database,
  scope: SnapshotScope,
  skillDir: string,
  limit: number,
): Promise<string[]> {
  const rows = await drizzleOf(database)
    .select({ path: indexEntries.path })
    .from(indexEntries)
    .where(
      and(inSnapshot(scope), eq(indexEntries.skillDir, skillDir), ne(indexEntries.kind, "skill")),
    )
    .orderBy(BY_PATH)
    .limit(limit);
  return rows.map((row) => row.path);
}

export async function getEntry(
  database: Database,
  scope: SnapshotScope,
  path: string,
): Promise<EntryRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(and(inSnapshot(scope), eq(indexEntries.path, path)))
    .limit(1);
  return row;
}
