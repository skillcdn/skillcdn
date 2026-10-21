import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SECTIONING_VERSION } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { type CliIo, EXIT_CONFIG, runCli } from "./cli.js";
import {
  type CachedSections,
  createFileVectorCache,
  createMemoryVectorCache,
  keyDirectoryOf,
  parseSections,
  serializeSections,
  type VectorKey,
} from "./vectors.js";

// The search by meaning over a directory (ADR-0064): the command embeds the sections of the
// directory with the server the environment names, keeps the vectors by the hash of each body,
// and ranks by words and meaning; a server that does not answer leaves the words to answer.

async function repository(files: Record<string, string>): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "skillcdn-meaning-")), "acme");
  await mkdir(root, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const parts = name.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), contents);
  }
  return root;
}

const FILES = {
  "SKILLCDN.md": "---\nname: Acme docs\ndescription: The documents of Acme.\n---\nBe brief.\n",
  "docs/fees.md":
    "# Fees\n\n## Late fee\n\nA late fee is a fixed amount added when an invoice is paid after its due date.\n",
  "docs/guide.md": "# Guide\n\nHow to write ad copy that sells.\n",
  "docs/private/SKILLCDN.md":
    "---\nname: Private notes\ndescription: Kept to the words.\nsearch:\n  meaning: false\n---\n",
  "docs/private/notes.md": "# Notes\n\nThe secret recipe stays here.\n",
};

const DIMENSIONS = 64;
const MODEL = "pretend/words";
const INSTRUCTION = "Find the section that answers the question";
/** Words the pretend model holds to mean the same: its one piece of meaning. */
const SYNONYMS: Readonly<Record<string, string>> = {
  overdue: "late",
  penalty: "fee",
  charge: "fee",
};

/** A vector of the words of a text, one bucket per word, so that texts of the same words are near. */
function vectorOf(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const word = SYNONYMS[raw] ?? raw;
    let hash = 7;
    for (const char of word) {
      hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
    }
    const at = hash % DIMENSIONS;
    vector[at] = (vector[at] ?? 0) + 1;
  }
  return vector;
}

/** An embeddings server in the shape the adapter speaks, remembering what it was asked to embed. */
function pretendServer(options: { readonly down?: boolean } = {}) {
  const documents: string[] = [];
  const queries: string[] = [];
  const fetch: NonNullable<CliIo["fetch"]> = async (_input, init) => {
    if (options.down === true) {
      throw new TypeError("fetch failed");
    }
    const body = JSON.parse(String(init.body)) as { readonly input: readonly string[] };
    const data = body.input.map((text, index) => {
      const query = text.startsWith("Instruct:")
        ? text.slice(text.indexOf("Query:") + "Query:".length)
        : undefined;
      (query === undefined ? documents : queries).push(query ?? text);
      return { index, embedding: vectorOf(query ?? text) };
    });
    return new Response(JSON.stringify({ data, usage: { prompt_tokens: 3 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, documents, queries };
}

const ENVIRONMENT = {
  EMBEDDINGS_URL: "http://127.0.0.1:9/v1/embeddings",
  EMBEDDINGS_MODEL: MODEL,
  EMBEDDINGS_DIMENSIONS: String(DIMENSIONS),
  EMBEDDINGS_QUERY_INSTRUCTION: INSTRUCTION,
};

function harness(extra: Partial<CliIo> = {}) {
  let out = "";
  let err = "";
  const io: CliIo = {
    environment: {},
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    ...extra,
  };
  return { io, out: () => out, err: () => err };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("skillcdn find, by meaning", () => {
  it("embeds the directory once, keeps the vectors, and ranks by words and meaning", async () => {
    const root = await repository(FILES);
    const cacheDir = await mkdtemp(join(tmpdir(), "skillcdn-cache-"));
    const cache = createFileVectorCache(cacheDir, process.pid);
    const first = pretendServer();
    const h = harness({ environment: ENVIRONMENT, fetch: first.fetch, vectors: cache });
    expect(await runCli(["find", root, "overdue", "penalty"], h.io)).toBe(0);
    // The words know neither word; the meaning finds the late fee.
    expect(h.out()).toContain("docs/fees.md");
    expect(h.out()).toContain("Ranked by words and meaning.");
    expect(first.queries).toEqual(["overdue penalty"]);
    expect(first.documents.some((text) => text.includes("A late fee is a fixed amount"))).toBe(
      true,
    );
    // A manifest that keeps its documents to the words keeps their text from the server.
    expect(first.documents.some((text) => text.includes("secret recipe"))).toBe(false);
    expect(h.err()).toContain(`Embedding 2 documents with ${MODEL}`);
    expect(h.err()).toContain("Embedded 2 documents");
    // The vectors are kept by the hash of each body, under the model.
    const key: VectorKey = {
      model: MODEL,
      dimensions: DIMENSIONS,
      sectioningVersion: SECTIONING_VERSION,
    };
    const kept = await readdir(join(cacheDir, "vectors", keyDirectoryOf(key)));
    expect(kept.filter((name) => /^[0-9a-f]+\.json$/.test(name))).toHaveLength(2);
    // The next run embeds the query alone.
    const second = pretendServer();
    const again = harness({ environment: ENVIRONMENT, fetch: second.fetch, vectors: cache });
    expect(await runCli(["find", root, "overdue", "penalty"], again.io)).toBe(0);
    expect(again.out()).toContain("docs/fees.md");
    expect(second.documents).toEqual([]);
    expect(second.queries).toEqual(["overdue penalty"]);
    expect(again.err()).toBe("");
  });

  it("answers by words alone, and says so, when the server does not answer", async () => {
    const root = await repository(FILES);
    const server = pretendServer({ down: true });
    const h = harness({ environment: ENVIRONMENT, fetch: server.fetch });
    expect(await runCli(["find", root, "late", "fee"], h.io)).toBe(0);
    expect(h.out()).toContain("docs/fees.md");
    expect(h.out()).toContain("Ranked by words alone this time");
    expect(h.err()).toContain("The search by meaning is off for what is not embedded yet");
  });

  it("calls no server for a read without words", async () => {
    const root = await repository(FILES);
    const server = pretendServer();
    const h = harness({ environment: ENVIRONMENT, fetch: server.fetch });
    expect(await runCli(["skills", root], h.io)).toBe(0);
    expect(server.documents).toEqual([]);
    expect(server.queries).toEqual([]);
    expect(h.err()).toBe("");
  });

  it("reads the variables as a deployment does", async () => {
    const root = await repository(FILES);
    const stray = harness({ environment: { EMBEDDINGS_MODEL: MODEL } });
    expect(await runCli(["find", root, "fee"], stray.io)).toBe(EXIT_CONFIG);
    expect(stray.err()).toContain("EMBEDDINGS_MODEL: read only with EMBEDDINGS_URL");
    const unnamed = harness({
      environment: { EMBEDDINGS_URL: ENVIRONMENT.EMBEDDINGS_URL, EMBEDDINGS_DIMENSIONS: "ten" },
    });
    expect(await runCli(["find", root, "fee"], unnamed.io)).toBe(EXIT_CONFIG);
    expect(unnamed.err()).toContain("EMBEDDINGS_MODEL: required with EMBEDDINGS_URL");
    expect(unnamed.err()).toContain(
      "EMBEDDINGS_DIMENSIONS: must be an integer between 32 and 4096",
    );
    const reranker = harness({ environment: { ...ENVIRONMENT, RERANKER_URL: "ftp://x" } });
    expect(await runCli(["find", root, "fee"], reranker.io)).toBe(EXIT_CONFIG);
    expect(reranker.err()).toContain("RERANKER_URL: must be an http or https URL");
  });
});

describe("skillcdn serve, by meaning", () => {
  it("serves by words at once and by meaning as the vectors arrive", async () => {
    const root = await repository(FILES);
    const server = pretendServer();
    const address = `/local/${basename(dirname(root))}/${basename(root)}`;
    const seen = { paths: [] as string[], ranking: undefined as unknown };
    const h = harness({
      environment: ENVIRONMENT,
      fetch: server.fetch,
      hold: async () => {
        const url = /at (http:\/\/[^\s]+:\d+):/.exec(h.out())?.[1] ?? "";
        const deadline = Date.now() + 15_000;
        for (;;) {
          const found = (await (
            await fetch(`${url}/api/v1/find${address}?query=overdue+penalty`)
          ).json()) as {
            readonly items?: readonly { readonly path: string }[];
            readonly ranking?: unknown;
          };
          seen.paths = found.items?.map((item) => item.path) ?? [];
          seen.ranking = found.ranking;
          if (seen.paths.includes("docs/fees.md") || Date.now() > deadline) {
            break;
          }
          await sleep(50);
        }
      },
    });
    expect(await runCli(["serve", root, "--port", "0"], h.io)).toBe(0);
    expect(seen.paths).toContain("docs/fees.md");
    expect(seen.ranking).toEqual({ meaning: true, reranked: false });
    expect(h.err()).toContain(`Embedding 2 documents with ${MODEL}`);
  }, 30_000);
});

describe("the vector cache", () => {
  const key: VectorKey = { model: MODEL, dimensions: 4, sectioningVersion: 1 };
  const sections: CachedSections = [
    { heading: [], offset: 0, length: 10, section: 0, vector: Float32Array.from([1, 0, 0, 0]) },
    {
      heading: ["A", "B"],
      offset: 10,
      length: 20,
      section: 1,
      vector: Float32Array.from([0, 0.5, 0.5, 0]),
    },
  ];

  it("writes a body's sections as one file and reads them back", () => {
    expect(parseSections(JSON.parse(serializeSections(key, sections)), key)).toEqual(sections);
    expect(parseSections(JSON.parse(serializeSections(key, [])), key)).toEqual([]);
  });

  it("reads nothing from a file of another shape, another model's dimensions, or vectors that do not add up", () => {
    const file = JSON.parse(serializeSections(key, sections)) as Record<string, unknown>;
    expect(parseSections(null, key)).toBeUndefined();
    expect(parseSections({ ...file, version: 2 }, key)).toBeUndefined();
    expect(parseSections(file, { ...key, dimensions: 8 })).toBeUndefined();
    expect(parseSections({ ...file, vectors: String(file.vectors).slice(8) }, key)).toBeUndefined();
    expect(parseSections({ ...file, sections: [{ heading: "A" }] }, key)).toBeUndefined();
  });

  it("keeps files under the model's directory by the hash of the body, and nothing for a hash that is not one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skillcdn-vectors-"));
    const cache = createFileVectorCache(directory, process.pid);
    const sha = "a".repeat(40);
    expect(await cache.read(key, sha)).toBeUndefined();
    await cache.write(key, sha, sections);
    expect(await cache.read(key, sha)).toEqual(sections);
    expect(await readdir(join(directory, "vectors", keyDirectoryOf(key)))).toEqual([`${sha}.json`]);
    await cache.write(key, "../escape", sections);
    expect(await cache.read(key, "../escape")).toBeUndefined();
    const memory = createMemoryVectorCache();
    await memory.write(key, sha, sections);
    expect(await memory.read(key, sha)).toBe(sections);
  });

  it("names a key's directory after the model, safely", () => {
    expect(keyDirectoryOf(key)).toMatch(/^pretend_words-[0-9a-f]{8}-4-v1$/);
    expect(keyDirectoryOf({ ...key, model: "../x" })).toMatch(/^.._x-[0-9a-f]{8}-4-v1$/);
  });
});
