import type { RepoFileKind } from "@skillcdn/core";
import { and, eq, inArray, ne, not, or, type SQL, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { indexEntries, type SkillFrontMatter } from "../schema.js";
import { SEARCH_CONFIG, type SnapshotScope } from "./snapshots.js";

export interface EntryRecord {
  readonly searchable: boolean;
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
  searchable: sql<boolean>`${indexEntries.search} is not null`,
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

/** Files a repository manifest leaves out are known to the index and served by nothing. */
const VISIBLE = eq(indexEntries.visible, true);

/** Documents and skills that are searchable: everything `find` can return. */
const FINDABLE = and(VISIBLE, sql`${indexEntries.search} is not null`);

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
  limit?: number,
): Promise<EntryRecord[]> {
  // plainto_tsquery normalizes the words and joins them with "&"; any-word matching wants "|".
  // Lexemes never contain spaces, so replacing " & " only ever touches operators.
  // A scalar subquery without table references is evaluated once per statement, not per row.
  const tsquery = sql`(select replace(plainto_tsquery(${SEARCH_CONFIG}::regconfig, ${query})::text, ' & ', ' | ')::tsquery)`;
  const rank = sql<number>`ts_rank('{0.05, 0.2, 0.6, 1.0}', ${indexEntries.search}, ${tsquery}, 1) * case when ${indexEntries.kind} = 'skill' then 1.5 else 1 end`;
  const queryRows = drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(
      and(
        inSnapshot(scope),
        underPath(indexEntries.path, mountPath),
        VISIBLE,
        sql`numnode(${tsquery}) > 0`,
        sql`${indexEntries.search} @@ ${tsquery}`,
      ),
    )
    .orderBy(sql`${rank} desc`, BY_PATH);
  return limit === undefined ? queryRows : queryRows.limit(limit);
}

/** The bounded index's served tree, shared by browsing, reference resolution and rule ancestry. */
export async function servedEntries(
  database: Database,
  scope: SnapshotScope,
): Promise<EntryRecord[]> {
  return drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(and(inSnapshot(scope), VISIBLE))
    .orderBy(BY_PATH);
}

const IS_SKILL = eq(indexEntries.kind, "skill");

/** Files that belong to a skill inside the mount: they are listed with the skill, not on their own. */
function ownedBySkillIn(mountPath: string): SQL {
  const inMount =
    mountPath.length === 0
      ? sql`true`
      : sql`(${indexEntries.skillDir} = ${mountPath} or starts_with(${indexEntries.skillDir}, ${`${mountPath}/`}))`;
  return sql`(${indexEntries.skillDir} is not null and ${inMount})`;
}

/**
 * What to list: skills, every document, or only the documents that do not belong to a skill
 * inside the mount.
 */
export type EntryListing = "skills" | "documents" | "documents_outside_skills";

/**
 * What a mount offers when nobody asked for anything in particular: skills first, then documents.
 * `only` narrows it.
 */
export async function listEntries(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
  limit: number,
  only?: EntryListing,
): Promise<EntryRecord[]> {
  const kind =
    only === undefined
      ? undefined
      : only === "skills"
        ? IS_SKILL
        : only === "documents"
          ? not(IS_SKILL)
          : and(not(IS_SKILL), not(ownedBySkillIn(mountPath)));
  return drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(and(inSnapshot(scope), underPath(indexEntries.path, mountPath), FINDABLE, kind))
    .orderBy(sql`case when ${indexEntries.kind} = 'skill' then 0 else 1 end`, BY_PATH)
    .limit(limit);
}

/**
 * How many skills, and how many documents outside the skills, `listEntries` would return without
 * a limit.
 */
export async function countEntries(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
): Promise<{ readonly skills: number; readonly documents: number }> {
  const [row] = await drizzleOf(database)
    .select({
      skills: sql<number>`count(*) filter (where ${IS_SKILL})::integer`,
      documents: sql<number>`count(*) filter (where not ${IS_SKILL} and not ${ownedBySkillIn(mountPath)})::integer`,
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
        VISIBLE,
        underPath(indexEntries.path, mountPath),
        or(...matches),
      ),
    )
    .orderBy(sql`case when ${indexEntries.name} = ${wanted.name} then 0 else 1 end`, BY_PATH)
    .limit(limit);
}

/**
 * The skills that live in exactly these directories, for a search that turned up their files:
 * the skill is what gets listed, with the files under it.
 */
export async function getSkillsAt(
  database: Database,
  scope: SnapshotScope,
  directories: readonly string[],
): Promise<EntryRecord[]> {
  if (directories.length === 0) {
    return [];
  }
  return drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(
      and(
        inSnapshot(scope),
        eq(indexEntries.kind, "skill"),
        VISIBLE,
        inArray(indexEntries.skillDir, [...directories]),
      ),
    )
    .orderBy(BY_PATH);
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
      and(
        inSnapshot(scope),
        eq(indexEntries.skillDir, skillDir),
        ne(indexEntries.kind, "skill"),
        VISIBLE,
      ),
    )
    .orderBy(BY_PATH)
    .limit(limit);
  return rows.map((row) => row.path);
}

export interface DirectoryListing {
  readonly path: string;
  readonly kind: "file" | "directory";
  /** Bytes, for a file. */
  readonly size: number | null;
}

/**
 * The immediate entries of one directory of a snapshot: every file the tree had, searchable or
 * not, and the subdirectories, which come first. `directory` is empty for the root.
 */
export async function listDirectory(
  database: Database,
  scope: SnapshotScope,
  directory: string,
  limit: number,
): Promise<DirectoryListing[]> {
  const prefix = directory.length === 0 ? "" : `${directory}/`;
  const rest =
    prefix.length === 0
      ? sql`${indexEntries.path}`
      : sql`substr(${indexEntries.path}, ${prefix.length + 1})`;
  // The first segment below the directory names the child; a subquery makes it a column, so the
  // grouping and the ordering can name it rather than repeat the expression.
  const children = drizzleOf(database)
    .select({
      name: sql<string>`split_part(${rest}, '/', 1)`.as("name"),
      isFile: sql<boolean>`position('/' in ${rest}) = 0`.as("is_file"),
      size: indexEntries.size,
    })
    .from(indexEntries)
    .where(
      and(
        inSnapshot(scope),
        VISIBLE,
        prefix.length === 0 ? undefined : sql`starts_with(${indexEntries.path}, ${prefix})`,
      ),
    )
    .as("children");
  const rows = await drizzleOf(database)
    .select({
      name: children.name,
      isFile: sql<boolean>`bool_or(${children.isFile})`,
      size: sql<number | null>`max(${children.size}) filter (where ${children.isFile})`,
    })
    .from(children)
    .groupBy(children.name)
    .orderBy(sql`bool_or(${children.isFile})`, sql`${children.name} collate "C"`)
    .limit(limit);
  return rows.map((row) => ({
    path: `${prefix}${row.name}`,
    kind: row.isFile ? "file" : "directory",
    size: row.isFile ? row.size : null,
  }));
}

export async function getEntry(
  database: Database,
  scope: SnapshotScope,
  path: string,
): Promise<EntryRecord | undefined> {
  const [row] = await drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(and(inSnapshot(scope), VISIBLE, eq(indexEntries.path, path)))
    .limit(1);
  return row;
}

/**
 * The repository manifest that governs a mount: the one in the mounted directory, else the
 * nearest one above it, up to the root of the repository. `undefined` when there is none.
 */
export async function getManifest(
  database: Database,
  scope: SnapshotScope,
  mountPath: string,
): Promise<EntryRecord | undefined> {
  // Every directory from the mount up to the root, so the candidates are a bounded list.
  const candidates: string[] = [];
  let directory = mountPath;
  while (true) {
    candidates.push(directory.length === 0 ? "SKILLCDN.md" : `${directory}/SKILLCDN.md`);
    const slash = directory.lastIndexOf("/");
    if (directory.length === 0) {
      break;
    }
    directory = slash < 0 ? "" : directory.slice(0, slash);
  }
  const [row] = await drizzleOf(database)
    .select(entryColumns)
    .from(indexEntries)
    .where(
      and(
        inSnapshot(scope),
        eq(indexEntries.kind, "manifest"),
        inArray(indexEntries.path, candidates),
      ),
    )
    .orderBy(sql`length(${indexEntries.path}) desc`)
    .limit(1);
  return row;
}
