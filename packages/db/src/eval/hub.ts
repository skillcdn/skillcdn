import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type IndexEntry,
  NO_LICENSE,
  queryWeights,
  SECTIONING_VERSION,
  searchFieldsOf,
  searchVectorOf,
  serializeSearchVector,
} from "@skillcdn/core";
import { sql } from "drizzle-orm";
import { createDatabase, type Database, drizzleOf } from "../client.js";
import { migrateDatabase } from "../migrate.js";
import {
  countHubLexemes,
  type HubStatementReading,
  listSearchablePacks,
  readHubStatements,
  searchHubEntries,
  searchHubSectionVectors,
} from "../queries/hub.js";
import { saveCachedRef, saveRepository } from "../queries/repos.js";
import { claimSnapshot, ensureSnapshot, writeSnapshotIndex } from "../queries/snapshots.js";
import { fillPartVectors, supportsSectionVectors, type VectorKey } from "../queries/vectors.js";

// `pnpm --filter @skillcdn/db run eval:hub fill --database-url <url> --documents <directory> ...`
// and `... eval:hub measure --database-url <url>`: a database filled to the shape of a deployment
// that serves many repositories, and what each statement of the search across packs (ADR-0070)
// reads in it. For a person who changed those statements or the indexes under them: a search
// must cost what is searchable, not what a deployment holds beside it (ADR-0090), and a small
// test database cannot show the difference. The database is one made for this and thrown away.
//
// `fill` migrates the database and adds repositories to it, each indexed at the commit of its
// default branch: most are repositories of files with next to nothing to search, a tenth are
// packs that hold nearly all of it, each pack with an older commit beside the one served, as a
// deployment keeps one. The searchable entries take their words from the Markdown files of the
// directories given, so that the vectors are as large as a pack's; every section of a pack's
// entries gets a vector of random numbers, which costs a comparison what a real one does, and
// the vectors of the parts, and the sections at half precision, are made from them as the
// worker's sweep makes them (ADR-0092, ADR-0103). A
// second `fill` under another `--series` adds as much again.
//
// `measure` asks five questions of the three statements, without a time limit, and prints for
// each how long it ran, how many rows of `index_entries` and how many pages it read and through
// which indexes. The meaning is measured both ways: `meaning`, the `--parts` parts nearest the
// query picked and their sections compared, and `every`, every section compared, as it was
// before the parts and is with `HUB_SEARCH_PARTS=0`. Random vectors have no neighbours, so what
// the two find differs here; what they read is what is measured. The rows and the pages are the numbers to hold on to: a disk on the machine of
// whoever runs this hides in milliseconds what the storage of a deployment shows.
//
// The milliseconds mean something once the database is held to what a small deployment has: a
// container with its processors and memory limited, the reads of its disk as well, and nothing
// in memory when the first question is asked. That is how the order of the statements in a
// search was measured, with the server itself asked over such a database (ADR-0091).

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    "database-url": { type: "string" },
    documents: { type: "string", multiple: true },
    series: { type: "string", default: "a" },
    repositories: { type: "string", default: "700" },
    entries: { type: "string", default: "600000" },
    findable: { type: "string", default: "20000" },
    sections: { type: "string", default: "10" },
    model: { type: "string", default: "eval" },
    dimensions: { type: "string", default: "1024" },
    candidates: { type: "string", default: "50" },
    parts: { type: "string", default: "200" },
  },
});

const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

/** Numbers that are the same on every run: the data of a measurement is not left to chance. */
function numbersFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A word of letters alone for a number, so that the word rules keep it as one lexeme. */
function wordOf(prefix: string, value: number): string {
  let rest = value;
  let word = "";
  do {
    word = String.fromCodePoint(97 + (rest % 26)) + word;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return `${prefix}${word}`;
}

interface Body {
  readonly title: string;
  readonly text: string;
}

const MAX_BODY_BYTES = 256 * 1024;

/** The Markdown files under the directories, each as a body to take words from. */
function bodiesOf(directories: readonly string[]): Body[] {
  const found: Body[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name.startsWith(".") || name === "node_modules" || name === "dist") {
        continue;
      }
      const path = join(directory, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
      } else if (name.endsWith(".md") && stat.size <= MAX_BODY_BYTES) {
        const text = readFileSync(path, "utf8");
        const heading = /^#\s+(.+)$/mu.exec(text)?.[1];
        found.push({ title: heading ?? name, text });
      }
    }
  };
  for (const directory of directories) {
    walk(directory);
  }
  return found;
}

interface FillOptions {
  readonly series: string;
  readonly repositories: number;
  readonly entries: number;
  readonly findable: number;
  readonly sections: number;
  readonly key: VectorKey;
  readonly bodies: readonly Body[];
}

const NOW = new Date("2026-01-01T00:00:00Z");
const REPOSITORIES_PER_OWNER = 50;
/** The share of the repositories that are packs, and of the searchable entries they hold. */
const PACK_SHARE = 0.1;
const PACK_FINDABLE_SHARE = 0.95;

async function fill(database: Database, options: FillOptions): Promise<void> {
  const { series, repositories, bodies, key } = options;
  const next = numbersFrom(
    [...series].reduce((sum, letter) => sum * 31 + (letter.codePointAt(0) ?? 0), 7),
  );
  const hash = (): string =>
    Array.from({ length: 5 }, () =>
      Math.floor(next() * 4_294_967_296)
        .toString(16)
        .padStart(8, "0"),
    ).join("");
  const packs = Math.max(1, Math.round(repositories * PACK_SHARE));
  const findableOfPack = (options.findable * PACK_FINDABLE_SHARE) / packs;
  const findableOfOther = (options.findable * (1 - PACK_FINDABLE_SHARE)) / (repositories - packs);
  // A repository's files: few in most, thousands in some, and the packs a third of the rest.
  const weights = Array.from({ length: repositories }, (_, at) => {
    const spread = 0.2 + 3 * next() ** 2;
    return at < packs ? spread / 3 : spread;
  });
  const weight = weights.reduce((sum, value) => sum + value, 0);
  const files = options.entries - options.findable;
  const vectors = key.dimensions > 0 && (await supportsSectionVectors(database));
  let planted = 0;
  let written = 0;

  const searchable = (isPack: boolean, at: number): IndexEntry => {
    const body = bodies[planted % bodies.length] as Body;
    // Two words of its own in the title: one no other entry has, one a handful share.
    const title = `${body.title} ${wordOf(`q${series}`, planted)} ${wordOf(`w${series}`, Math.floor(planted / 20))}`;
    planted += 1;
    const description = body.text.replaceAll(/\s+/gu, " ").slice(0, 200);
    const isSkill = isPack && at % 6 === 0;
    const path = isSkill ? `skills/s${at}/SKILL.md` : `docs/d${at}.md`;
    const fields = { path, title, description, name: isSkill ? `s${at}` : undefined };
    return {
      path,
      kind: isSkill ? "skill" : "markdown",
      size: body.text.length,
      blobSha: hash(),
      skillDir: isSkill ? `skills/s${at}` : undefined,
      name: fields.name,
      title,
      description,
      frontMatter: undefined,
      searchable: true,
      search: serializeSearchVector(searchVectorOf(searchFieldsOf(fields, body.text))),
      visible: true,
      listed: isSkill,
    };
  };
  const file = (isPack: boolean, at: number): IndexEntry => ({
    path: `src/m${Math.floor(at / 40)}/f${at}.ts`,
    kind: "other",
    size: 100 + Math.floor(next() * 20_000),
    blobSha: hash(),
    skillDir: undefined,
    name: undefined,
    title: undefined,
    description: undefined,
    frontMatter: undefined,
    searchable: false,
    // Outside a pack's skills and documents a file is known and served by nothing.
    visible: isPack,
  });
  const index = async (
    scope: { readonly accountId: string; readonly repoId: string },
    commit: string,
    entries: readonly IndexEntry[],
  ): Promise<void> => {
    const snapshot = await ensureSnapshot(database, scope, commit, 1, NOW);
    const at = { accountId: scope.accountId, snapshotId: snapshot.id };
    await claimSnapshot(database, at, "eval", NOW, 600_000);
    await writeSnapshotIndex(
      database,
      at,
      "eval",
      {
        entries,
        truncated: false,
        indexedBytes: 0,
        diagnostics: [],
        license: NO_LICENSE,
        version: 1,
      },
      NOW,
    );
    written += entries.length;
  };

  for (let at = 0; at < repositories; at += 1) {
    const isPack = at < packs;
    const owner = `eval-${series}-${Math.floor(at / REPOSITORIES_PER_OWNER)}`;
    const name = `r${at}`;
    const repository = await saveRepository(
      database,
      { host: "gh", owner, repo: name },
      {
        hostRepoId: `eval-${series}-${at}`,
        name,
        defaultBranch: "main",
        description: undefined,
        visibility: "public",
        owner: {
          hostAccountId: `eval-${series}-${Math.floor(at / REPOSITORIES_PER_OWNER)}`,
          login: owner,
          kind: "organization",
        },
      },
      NOW,
    );
    const scope = { accountId: repository.accountId, repoId: repository.id };
    const findable = isPack
      ? Math.round(findableOfPack * (0.5 + next()))
      : Math.floor(findableOfOther * 2 * next() + 0.5);
    const entries = [
      ...Array.from({ length: findable }, (_, entry) => searchable(isPack, entry)),
      ...Array.from({ length: Math.round((files * (weights[at] ?? 0)) / weight) }, (_, entry) =>
        file(isPack, entry),
      ),
    ];
    const commit = hash();
    await saveCachedRef(database, scope, "", commit, NOW);
    await index(scope, commit, entries);
    if (isPack) {
      // The commit before, kept beside the one served and searched by nothing.
      await index(scope, hash(), entries);
      if (vectors) {
        const blobs = entries.filter((entry) => entry.searchable).map((entry) => entry.blobSha);
        // The numbers are drawn in the database, a row at a time: the reference to the row inside
        // the subquery is what makes it draw again for each.
        await drizzleOf(database).execute(sql`
          insert into section_vectors
            (blob_sha, model, dimensions, sectioning_version, section, heading, "offset", length, vector)
          select body.blob_sha, ${key.model}, ${key.dimensions}::integer, ${key.sectioningVersion}::integer,
            part.section, '["Section"]'::jsonb, part.section * 1000, 1000,
            (select array_agg(random() - 0.5)::real[]::vector
               from generate_series(1, ${key.dimensions}::integer)
              where body.blob_sha is not null and part.section is not null)
          from unnest(${sql.param(blobs)}::text[]) as body (blob_sha)
          cross join generate_series(0, ${options.sections}::integer - 1) as part (section)
          on conflict do nothing`);
      }
    }
    if ((at + 1) % 50 === 0 || at + 1 === repositories) {
      write(`${at + 1} of ${repositories} repositories, ${written} entries written`);
    }
  }
  // What the planner knows of the tables is what autovacuum would have told it by now.
  await drizzleOf(database).execute(sql`vacuum (analyze) index_entries`);
  if (vectors) {
    await drizzleOf(database).execute(sql`vacuum (analyze) section_vectors`);
    let made = 0;
    for (let filled = await fillPartVectors(database, key, 500); filled > 0; ) {
      made += filled;
      filled = await fillPartVectors(database, key, 500);
    }
    await drizzleOf(database).execute(sql`vacuum (analyze) part_vectors`);
    await drizzleOf(database).execute(sql`vacuum (analyze) section_halves`);
    write(`the part vectors and half sections of ${made} bodies made`);
  }
  write(
    vectors
      ? `${planted} searchable entries, ${options.sections} section vectors for each of a pack's`
      : `${planted} searchable entries, and no section vectors: the database has no vector extension`,
  );
}

const milliseconds = (value: number): string => `${value.toFixed(0)} ms`;

async function measure(
  database: Database,
  key: VectorKey,
  candidates: number,
  parts: number,
): Promise<void> {
  const db = drizzleOf(database);
  const ids = (await listSearchablePacks(database)).map((pack) => pack.snapshotId);
  const vectors = key.dimensions > 0 && (await supportsSectionVectors(database));
  const sizes = await db.execute<{ entries: number; searched: number; findable: number }>(sql`
    select count(*)::int as entries,
      (count(*) filter (where snapshot_id = any(${sql.param(ids)}::uuid[])))::int as searched,
      (count(*) filter (where snapshot_id = any(${sql.param(ids)}::uuid[]) and visible and search is not null))::int as findable
    from index_entries`);
  const size = sizes.rows[0];
  write(
    `${ids.length} packs searched: ${size?.findable ?? 0} searchable entries among ${size?.searched ?? 0} of theirs, ${size?.entries ?? 0} entries in the database`,
  );
  // The words to ask for are the data's own: the ones most entries hold, and one a single entry holds.
  const words = await db.execute<{ word: string; ndoc: number }>(sql`
    select word, ndoc from ts_stat('select search from index_entries where visible and search is not null')
    order by ndoc desc, word limit 4`);
  const rare = await db.execute<{ word: string }>(sql`
    select word from ts_stat('select search from index_entries where visible and search is not null')
    order by ndoc, word limit 1`);
  const common = words.rows.map((row) => row.word);
  const questions: readonly (readonly [string, readonly string[]])[] = [
    ["the commonest word", common.slice(0, 1)],
    ["a rare word", rare.rows.map((row) => row.word)],
    ["a word nowhere", ["zzqxv"]],
    ["four common words", common],
    ["no word", []],
  ];
  const next = numbersFrom(1);
  const query = Float32Array.from({ length: key.dimensions }, () => next() - 0.5);
  const timed = async <T>(work: () => Promise<T>): Promise<readonly [T, number]> => {
    const started = performance.now();
    const result = await work();
    return [result, performance.now() - started];
  };
  const line = (statement: string, took: number, reading: HubStatementReading): string =>
    `  ${statement.padEnd(8)}${milliseconds(took).padStart(9)}  ${String(reading.entries).padStart(8)} entries  ${String(reading.pages).padStart(8)} pages  ${String(reading.pagesFromDisk).padStart(8)} from disk  ${reading.indexes.join(", ")}`;
  const unbounded = 600_000;
  for (const [name, lexemes] of questions) {
    write(`${name}${lexemes.length === 0 ? "" : `: ${lexemes.join(" ")}`}`);
    const [counted, countMs] = await timed(() =>
      countHubLexemes(database, ids, lexemes, unbounded),
    );
    const weights = queryWeights(counted.total, counted.counts);
    const [found, wordsMs] = await timed(() =>
      searchHubEntries(database, ids, lexemes, weights, candidates, unbounded),
    );
    const meaningMs = vectors
      ? (
          await timed(() =>
            searchHubSectionVectors(database, ids, key, query, candidates, unbounded, parts),
          )
        )[1]
      : undefined;
    const reading = await readHubStatements(database, {
      snapshotIds: ids,
      lexemes,
      weights,
      limit: candidates,
      meaning: vectors ? { key, query, parts } : undefined,
    });
    write(line("count", countMs, reading.count));
    if (reading.words !== undefined) {
      write(line("words", wordsMs, reading.words));
    }
    if (reading.meaning !== undefined && meaningMs !== undefined) {
      write(line("meaning", meaningMs, reading.meaning));
    }
    if (vectors && lexemes.length === 0) {
      // Every section compared, once: the same whatever the words, and the costly one.
      const [, everyMs] = await timed(() =>
        searchHubSectionVectors(database, ids, key, query, candidates, unbounded, 0),
      );
      const every = await readHubStatements(database, {
        snapshotIds: ids,
        lexemes: [],
        limit: candidates,
        meaning: { key, query, parts: 0 },
      });
      if (every.meaning !== undefined) {
        write(line("every", everyMs, every.meaning));
      }
    }
    write(
      `  ${counted.total} entries counted, ${counted.counts.join(" ")} holding the words, ${found.length} found`,
    );
  }
}

const [command] = positionals;
const connectionString = values["database-url"];
if (connectionString === undefined || (command !== "fill" && command !== "measure")) {
  throw new Error(
    "usage: eval:hub fill|measure --database-url <url> [--documents <directory> ...]",
  );
}
const key: VectorKey = {
  model: values.model,
  dimensions: Number(values.dimensions),
  sectioningVersion: SECTIONING_VERSION,
};
if (command === "fill") {
  const bodies = bodiesOf(values.documents ?? []);
  if (bodies.length === 0) {
    throw new Error("fill needs --documents <directory> with Markdown files to take words from");
  }
  await migrateDatabase(connectionString);
}
const database = createDatabase({
  connectionString,
  applicationName: "skillcdn-eval",
  statementTimeoutMs: 0,
});
try {
  if (command === "fill") {
    await fill(database, {
      series: values.series,
      repositories: Number(values.repositories),
      entries: Number(values.entries),
      findable: Number(values.findable),
      sections: Number(values.sections),
      key,
      bodies: bodiesOf(values.documents ?? []),
    });
  } else {
    await measure(database, key, Number(values.candidates), Number(values.parts));
  }
} finally {
  await database.close();
}
