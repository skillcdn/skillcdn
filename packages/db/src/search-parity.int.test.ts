import {
  ENGLISH_STOP_WORDS,
  queryLexemes,
  rankSearchVector,
  type SearchField,
  searchLexemes,
  searchVectorOf,
  stemEnglish,
} from "@skillcdn/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, drizzleOf } from "./client.js";
import { SEARCH_CONFIG } from "./queries/snapshots.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

// The word rules of @skillcdn/core are written to match this server's `english` configuration,
// so that a pack indexed in memory is searched as a deployment searches it (ADR-0053). This file
// holds them against the server itself: the same texts, the same words at the same positions,
// the same query, and a rank close enough that the same documents come out in the same order
// where the weights differ.

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

/** `'lexeme':1,2 'other':3`, as the server prints a tsvector without weights. */
function parseVector(text: string): Map<string, number[]> {
  const vector = new Map<string, number[]>();
  for (const match of text.matchAll(/'((?:[^']|'')*)':([0-9,]+)/g)) {
    const lexeme = (match[1] ?? "").replaceAll("''", "'");
    const positions = (match[2] ?? "").split(",").map(Number);
    vector.set(lexeme, positions);
  }
  return vector;
}

function ownVector(text: string): Map<string, number[]> {
  const vector = new Map<string, number[]>();
  for (const { lexeme, position } of searchLexemes(text)) {
    vector.set(lexeme, [...(vector.get(lexeme) ?? []), position]);
  }
  return vector;
}

async function serverVector(text: string): Promise<Map<string, number[]>> {
  const result = await drizzleOf(database).execute<{ vector: string }>(
    sql`select to_tsvector(${SEARCH_CONFIG}::regconfig, ${text})::text as vector`,
  );
  return parseVector(result.rows[0]?.vector ?? "");
}

async function serverQuery(query: string): Promise<string[]> {
  const result = await drizzleOf(database).execute<{ query: string }>(
    sql`select plainto_tsquery(${SEARCH_CONFIG}::regconfig, ${query})::text as query`,
  );
  const text = result.rows[0]?.query ?? "";
  return [
    ...new Set(
      [...text.matchAll(/'((?:[^']|'')*)'/g)].map((match) =>
        (match[1] ?? "").replaceAll("''", "'"),
      ),
    ),
  ];
}

const TEXTS = [
  "Foo_bar skill-cdn top-10 SKILL.md v1.2.0 https://example.com/x/y 2026 abc123 don't marketing/ads e-mail",
  "10-top a1-b2 -foo foo--bar docs/ wait... e.g. /usr/local user@example.com https://example.com x_y-z 3.14 1e10 한국어 테스트 AI-driven self-hosted C++ R&D foo'bar self-hosted-thing top-10-list beta-1 -5 5- a-",
  'See docs/guide.md, then (skills/ads/SKILL.md) and "quoted" [bracket] {brace} path/with/dots.v2 ver.1.2 a.b.c-d',
  "Mr. Smith's don't O'Reilly rock'n'roll x's",
  "Running runners ran easily fairly hopping generalization relational conditional ties cries agreed plastered motoring sized hissing happy sky skies news",
  "# Release notes\n\nWrite the notes for a release from the merged pull requests: group them by area, name the breaking changes first, and link every change to its pull request.\n\n- `pnpm check` must pass\n- Run `skillcdn check .` before pushing\n",
  "---\nname: ad-copy\ndescription: Writes ad copy for a product page in the brand's voice; A/B variants, 30 to 90 characters each.\n---\n",
  "Configuration: PUBLIC_URL, DATABASE_URL and GITHUB_TOKEN are read from .env; see deploy/README.md#environment-contract and https://github.com/skillcdn/skillcdn/blob/main/deploy/README.md.",
  "Organizations, organizational charts, organizing committees: the organization's analyses were analyzed by analysts (analysis), and the conclusions were conclusive.",
  "Les skills en français: déploiement, configuration, référence; und auf Deutsch: Übersetzung, Veröffentlichung.",
  "Version 2.0.1-beta.3 of the 3D-viewer (x86_64, arm64) renders 1,024 frames at 60fps; 50% faster than v1.",
  "IPv6 addresses like 2001:db8::1 and ports like 127.0.0.1:11188 or localhost:5432 appear in logs.",
];

describe("the word rules of core against the server", () => {
  it.each(TEXTS)("cuts and stems %s as to_tsvector does", async (text) => {
    expect(ownVector(text)).toEqual(await serverVector(text));
  });

  it("drops the words the server drops, and only those", async () => {
    for (const word of ENGLISH_STOP_WORDS) {
      expect(await serverVector(word)).toEqual(new Map());
    }
    const result = await drizzleOf(database).execute<{ word: string; stop: boolean }>(
      sql`select w as word, ts_lexize('english_stem', w) = '{}' as stop from unnest(array['skill','agent','however','whose','having','own','very','cannot','would','could','might','must','shall','may','also','etc','thus','upon','within','without']) as w`,
    );
    for (const row of result.rows) {
      expect(ENGLISH_STOP_WORDS.has(row.word), row.word).toBe(row.stop);
    }
  });

  it("stems every word of the texts as english_stem does", async () => {
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

  it.each([
    "the quick brown foxes",
    "Skills skill SKILLS",
    "self-hosted deployment",
    "release notes",
    "docs/guide.md",
    "한국어 검색",
    "the of and",
    "...",
  ])("reads the query %s as plainto_tsquery does", async (query) => {
    expect(queryLexemes(query)).toEqual(await serverQuery(query));
  });

  it("ranks weighted documents as ts_rank with normalization 1 does", async () => {
    const documents: readonly (readonly SearchField[])[] = [
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
    ];
    for (const query of ["release notes", "notes", "copy pictures", "guide"]) {
      const own = documents.map((fields) =>
        rankSearchVector(searchVectorOf(fields), queryLexemes(query)),
      );
      const server = await Promise.all(
        documents.map(async (fields) => {
          const [a, b, c, d] = fields.map((field) => field.text);
          const result = await drizzleOf(database).execute<{ rank: number }>(
            sql`select ts_rank('{0.05, 0.2, 0.6, 1.0}',
              setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, ${a}), 'A') ||
              setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, ${b}), 'B') ||
              setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, ${c}), 'C') ||
              setweight(to_tsvector(${SEARCH_CONFIG}::regconfig, ${d}), 'D'),
              (select replace(plainto_tsquery(${SEARCH_CONFIG}::regconfig, ${query})::text, ' & ', ' | ')::tsquery),
              1)::float8 as rank`,
          );
          return Number(result.rows[0]?.rank ?? 0);
        }),
      );
      own.forEach((rank, index) => {
        expect(rank, `${query} in document ${index}`).toBeCloseTo(server[index] ?? -1, 5);
      });
    }
  });
});
