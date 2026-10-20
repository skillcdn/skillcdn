import {
  ENGLISH_STOP_WORDS,
  parseSearchVector,
  queryLexemes,
  rankSearchVector,
  type SearchField,
  searchVectorOf,
  serializeSearchQuery,
  serializeSearchVector,
  stemEnglish,
} from "@skillcdn/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, drizzleOf } from "./client.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

// The search vectors of @skillcdn/core are what this server stores and ranks (ADR-0063): the
// indexer builds them, the server keeps them as tsvectors and answers a query with `ts_rank`,
// and the command ranks the same vectors in memory with `rankSearchVector`. This file holds the
// two sides against each other on the server itself: the text form of a vector is read back as
// the vector it was written from, a query is a tsquery the server accepts, a stored vector
// matches and ranks as the memory index matches and ranks it, and the English stemmer and stop
// words are those of the server's own dictionary, which validates the algorithm written here.

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

const TEXTS = [
  "Foo_bar skill-cdn top-10 SKILL.md v1.2.0 https://example.com/x/y 2026 abc123 don't marketing/ads e-mail",
  "10-top a1-b2 -foo foo--bar docs/ wait... e.g. /usr/local user@example.com https://example.com x_y-z 3.14 1e10 한국어 테스트 AI-driven self-hosted C++ R&D foo'bar self-hosted-thing top-10-list beta-1 -5 5- a-",
  'See docs/guide.md, then (skills/ads/SKILL.md) and "quoted" [bracket] {brace} path/with/dots.v2 ver.1.2 a.b.c-d',
  "Mr. Smith's don't O'Reilly rock'n'roll x's back\\slash",
  "Running runners ran easily fairly hopping generalization relational conditional ties cries agreed plastered motoring sized hissing happy sky skies news",
  "# Release notes\n\nWrite the notes for a release from the merged pull requests: group them by area, name the breaking changes first, and link every change to its pull request.\n\n- `pnpm check` must pass\n- Run `skillcdn check .` before pushing\n",
  "---\nname: ad-copy\ndescription: Writes ad copy for a product page in the brand's voice; A/B variants, 30 to 90 characters each.\n---\n",
  "Configuration: PUBLIC_URL, DATABASE_URL and GITHUB_TOKEN are read from .env; see deploy/README.md#environment-contract and https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md.",
  "Organizations, organizational charts, organizing committees: the organization's analyses were analyzed by analysts (analysis), and the conclusions were conclusive.",
  "Les skills en français: déploiement, configuration, référence; und auf Deutsch: Übersetzung, Veröffentlichung.",
  "Version 2.0.1-beta.3 of the 3D-viewer (x86_64, arm64) renders 1,024 frames at 60fps; 50% faster than v1.",
  "IPv6 addresses like 2001:db8::1 and ports like 127.0.0.1:11188 or localhost:5432 appear in logs.",
  // A placeholder URL, as documentation writes one: no host, so no word, and never an empty lexeme.
  '"value":"https://...","is_secret":false; see https://.../path and http://. too',
  // The longest word the server takes, 2046 bytes, and one it ignores.
  `A number of 2046 digits is a word ${"7".repeat(2046)} and one of 2047 is none ${"7".repeat(2047)}`,
  // Long enough to hold more than 256 positions of one word, and to reach the last position.
  `release ${"word ".repeat(300)} release`,
  `${"word ".repeat(16_400)} release release notes`,
];

const DOCUMENTS: readonly (readonly SearchField[])[] = [
  [
    { weight: "A", text: "release notes" },
    { weight: "B", text: "Writes the notes of a release." },
    { weight: "C", text: "skills release notes SKILL md" },
    {
      weight: "D",
      text: "Group the merged changes by area and link each to its pull request.",
    },
  ],
  [
    { weight: "A", text: "ad copy" },
    { weight: "B", text: "Writes ad copy; mentions the release where it matters." },
    { weight: "C", text: "marketing ads SKILL md" },
    {
      weight: "D",
      text: "A release is a reason to write: the notes, the copy, the pictures. Release, release.",
    },
  ],
  [
    { weight: "A", text: "" },
    { weight: "B", text: "" },
    { weight: "C", text: "docs guide md" },
    { weight: "D", text: "How to write a guide. Notes on style." },
  ],
  [
    { weight: "A", text: "한국어 안내" },
    { weight: "B", text: "" },
    { weight: "C", text: "docs ko guide md" },
    { weight: "D", text: `${"word ".repeat(300)} 한국어 안내서를 읽는다. 안내` },
  ],
];

const QUERIES = ["release notes", "notes", "copy pictures", "guide", "한국어 안내", "self-hosted"];

/** What the server reads back of a vector written in its text form. */
async function storedVector(text: string): Promise<string> {
  const result = await drizzleOf(database).execute<{ vector: string }>(
    sql`select ${text}::tsvector::text as vector`,
  );
  return result.rows[0]?.vector ?? "";
}

describe("the search vectors of core against the server", () => {
  it.each(TEXTS)("stores the vector built here as it is, and reads it back: %s", async (text) => {
    const vector = searchVectorOf([{ weight: "D", text }]);
    const stored = await storedVector(serializeSearchVector(vector));
    expect(parseSearchVector(stored)).toEqual(vector);
    // Weighted the same way, with the weights kept.
    const weighted = searchVectorOf([
      { weight: "A", text: text.slice(0, 40) },
      { weight: "B", text: text.slice(0, 80) },
      { weight: "C", text: text.slice(0, 20) },
      { weight: "D", text },
    ]);
    expect(parseSearchVector(await storedVector(serializeSearchVector(weighted)))).toEqual(
      weighted,
    );
  });

  it.each(QUERIES)("writes the query %s as a tsquery the server reads", async (query) => {
    const lexemes = queryLexemes(query);
    const result = await drizzleOf(database).execute<{ text: string; nodes: number }>(
      sql`select ${serializeSearchQuery(lexemes)}::tsquery::text as text, numnode(${serializeSearchQuery(lexemes)}::tsquery) as nodes`,
    );
    const row = result.rows[0];
    expect(row?.nodes).toBe(lexemes.length * 2 - 1);
    for (const lexeme of lexemes) {
      expect(row?.text).toContain(`'${lexeme.replaceAll("'", "''")}'`);
    }
  });

  it("matches and ranks a stored vector as the memory index does", async () => {
    for (const query of QUERIES) {
      const lexemes = queryLexemes(query);
      const own = DOCUMENTS.map((fields) => rankSearchVector(searchVectorOf(fields), lexemes));
      const server = await Promise.all(
        DOCUMENTS.map(async (fields) => {
          const vector = serializeSearchVector(searchVectorOf(fields));
          const result = await drizzleOf(database).execute<{ rank: number; matches: boolean }>(
            sql`select
              ts_rank('{0.05, 0.2, 0.6, 1.0}', ${vector}::tsvector, ${serializeSearchQuery(lexemes)}::tsquery, 1)::float8 as rank,
              ${vector}::tsvector @@ ${serializeSearchQuery(lexemes)}::tsquery as matches`,
          );
          return result.rows[0] ?? { rank: -1, matches: false };
        }),
      );
      own.forEach((rank, index) => {
        expect(Number(server[index]?.rank), `${query} in document ${index}`).toBeCloseTo(rank, 5);
        expect(server[index]?.matches, `${query} in document ${index}`).toBe(rank > 0);
      });
    }
  });

  it("drops the words the server's dictionary drops, and only those", async () => {
    const words = [
      ...ENGLISH_STOP_WORDS,
      "skill",
      "agent",
      "however",
      "whose",
      "having",
      "own",
      "very",
      "cannot",
      "would",
      "could",
      "might",
      "must",
      "shall",
      "may",
      "also",
      "etc",
      "thus",
      "upon",
      "within",
      "without",
    ];
    const result = await drizzleOf(database).execute<{ word: string; stop: boolean }>(
      sql`select w as word, ts_lexize('english_stem', w) = '{}' as stop from jsonb_array_elements_text(${JSON.stringify(words)}::jsonb) as w`,
    );
    expect(result.rows.length).toBe(words.length);
    for (const row of result.rows) {
      expect(ENGLISH_STOP_WORDS.has(row.word), row.word).toBe(row.stop);
    }
  });

  it("stems every word of the texts as the server's english_stem dictionary does", async () => {
    const words = [
      ...new Set(
        TEXTS.flatMap((text) => text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
          (word) => !ENGLISH_STOP_WORDS.has(word),
        ),
      ),
    ];
    const result = await drizzleOf(database).execute<{ word: string; stem: string | null }>(
      sql`select w as word, (ts_lexize('english_stem', w))[1] as stem from jsonb_array_elements_text(${JSON.stringify(words)}::jsonb) as w`,
    );
    expect(result.rows.length).toBe(words.length);
    for (const row of result.rows) {
      expect(stemEnglish(row.word), row.word).toBe(row.stem ?? row.word);
    }
  });
});
