import {
  type Address,
  type BlobStore,
  type Clock,
  type FindItem,
  type FindRanking,
  type FindSection,
  fuseRanks,
  type HubItem,
  type HubResult,
  MAX_MATCHED_SECTIONS,
  matchSections,
  NO_LICENSE,
  parseAddress,
  parseRepoPath,
  queryLexemes,
  queryWeights,
  type RepoPath,
  SKILL_RANK_BOOST,
  sectionExcerpt,
  servesInFull,
} from "@skillcdn/core";
import {
  countHubLexemes,
  type Database,
  type HubEntryRecord,
  type HubSectionMatch,
  listSearchablePacks,
  type SearchablePack,
  searchHubEntries,
  searchHubSectionVectors,
} from "@skillcdn/db";
import type { Logger } from "../logger.js";
import { repositoryKey } from "../mounts/mount-service.js";
import type { MountMeaning } from "../mounts/reader.js";
import type { OperatorLists } from "../operator/lists.js";

// The search across every pack this deployment serves (ADR-0070): the words over the snapshots of
// every public pack at once, weighed by their rarity across them all (ADR-0069), the sections
// nearest in meaning where the deployment searches by it, fused and reranked as a search inside
// one mount is (ADR-0063, ADR-0064), each result named with the pack it is in. Nothing here waits
// for an index: a pack is searched as it is served.

export interface HubSearchOptions {
  readonly database: Database;
  readonly blobStore: BlobStore;
  /** The search by meaning, as the mounts have it; left out, the words answer alone. */
  readonly meaning: Omit<MountMeaning, "onSearched"> | undefined;
  /** The operator's lists: a blocked repository is not searched, and a verified one is served in full. */
  readonly lists: Pick<OperatorLists, "isBlocked" | "isVerified">;
  /** How long each statement over every pack may take. */
  readonly timeoutMs: number;
  /** How many entries each of the words and the meaning bring to the fusion. */
  readonly candidates: number;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface HubSearch {
  /** The results for a query, at most `limit` of them. Throws when the database refused or ran out of time. */
  search(query: string, limit: number): Promise<HubResult>;
  /** How many packs a search covers right now. */
  packs(): Promise<number>;
}

/** How long the set of searchable packs is kept before it is read again. */
const PACKS_TTL_MS = 15_000;
/** How many sections of a document the words rank before the meaning's are fused in. */
const SECTION_CANDIDATES = 4;
/** How much of a result the reranker is given to score it by. */
const RERANK_CANDIDATE_CHARS = 1200;

interface Candidate {
  readonly key: string;
  readonly row: HubEntryRecord;
  readonly pack: SearchablePack;
}

interface Scored {
  readonly item: HubItem;
  readonly candidate: string;
}

export function createHubSearch(options: HubSearchOptions): HubSearch {
  const { database, blobStore, meaning, lists, timeoutMs, candidates, clock, logger } = options;
  let cached:
    | { readonly until: number; readonly packs: Promise<readonly SearchablePack[]> }
    | undefined;

  /** The packs searched: every public one with an index, without those the operator blocked. */
  const packsOf = (): Promise<readonly SearchablePack[]> => {
    const now = clock.now().getTime();
    if (cached === undefined || cached.until <= now) {
      const packs = (async () => {
        const listed = await listSearchablePacks(database);
        const kept: SearchablePack[] = [];
        for (const pack of listed) {
          const address = addressOf(pack);
          if (address !== undefined && !(await lists.isBlocked(repositoryKey(address)))) {
            kept.push(pack);
          }
        }
        return kept;
      })();
      cached = { until: now + PACKS_TTL_MS, packs };
      packs.catch(() => {
        cached = undefined;
      });
    }
    return cached.packs;
  };

  const keyOf = (snapshotId: string, path: string): string => `${snapshotId} ${path}`;

  return {
    async packs() {
      return (await packsOf()).length;
    },
    async search(query, limit) {
      const packs = await packsOf();
      const byId = new Map(packs.map((pack) => [pack.snapshotId, pack]));
      const ids = packs.map((pack) => pack.snapshotId);
      if (ids.length === 0) {
        return { query, packs: 0, items: [] };
      }
      // The words of the query, read with the default rules: the packs differ in language, and
      // the words are weighed by their rarity across all of them (ADR-0069).
      const lexemes = queryLexemes(query);
      let weights: readonly number[] | undefined;
      let words: readonly HubEntryRecord[] = [];
      if (lexemes.length > 0) {
        const counted = await countHubLexemes(database, ids, lexemes, timeoutMs);
        weights = queryWeights(counted.total, counted.counts);
        words = await searchHubEntries(database, ids, lexemes, weights, candidates, timeoutMs);
      }
      // The sections nearest in meaning, where the deployment searches by it; an embedder or a
      // database that does not answer in time leaves the words to answer, which the result says.
      let ranking: FindRanking | undefined;
      let nearest: readonly HubSectionMatch[] | undefined;
      if (meaning?.key !== undefined) {
        try {
          const { vectors } = await meaning.embedder.embed([query], "query");
          const vector = vectors[0];
          nearest =
            vector === undefined
              ? undefined
              : await searchHubSectionVectors(
                  database,
                  ids,
                  meaning.key,
                  vector,
                  candidates,
                  timeoutMs,
                );
        } catch (error) {
          logger.debug({ err: error }, "the search by meaning across packs did not answer");
          nearest = undefined;
        }
        ranking = { meaning: nearest !== undefined, reranked: false };
      }
      // One order of the entries, by reciprocal rank fusion of the two, a skill boosted as inside
      // a mount, ties by pack and path.
      const records = new Map<string, Candidate>();
      const remember = (row: HubEntryRecord): string | undefined => {
        const key = keyOf(row.snapshotId, row.path);
        const pack = byId.get(row.snapshotId);
        if (pack === undefined) {
          return undefined;
        }
        if (!records.has(key)) {
          records.set(key, { key, row, pack });
        }
        return key;
      };
      const byWords = words.flatMap((row) => {
        const key = remember(row);
        return key === undefined ? [] : [key];
      });
      const byMeaning: string[] = [];
      for (const match of nearest ?? []) {
        const key = remember(match);
        if (key !== undefined && !byMeaning.includes(key)) {
          byMeaning.push(key);
        }
      }
      const fused = fuseRanks([byWords, byMeaning], {
        boost: (key) => (records.get(key)?.row.kind === "skill" ? SKILL_RANK_BOOST : 1),
        compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      });
      const reranker = meaning?.reranker;
      const rerankCount = reranker === undefined ? 0 : (meaning?.rerankCandidates ?? 10);
      const wanted = Math.max(limit, rerankCount);
      const scored: Scored[] = [];
      const verified = new Map<string, Promise<boolean>>();
      for (const key of fused.slice(0, wanted)) {
        const candidate = records.get(key);
        if (candidate === undefined) {
          continue;
        }
        const address = addressOf(candidate.pack);
        if (address === undefined) {
          continue;
        }
        let vouched = verified.get(candidate.pack.snapshotId);
        if (vouched === undefined) {
          vouched = lists.isVerified(repositoryKey(address));
          verified.set(candidate.pack.snapshotId, vouched);
        }
        const item = await itemOf(candidate, await vouched, {
          lexemes,
          weights,
          nearest: (nearest ?? []).filter((match) => keyOf(match.snapshotId, match.path) === key),
        });
        if (item === undefined) {
          continue;
        }
        scored.push({
          item: { address, repository: `${candidate.pack.owner}/${candidate.pack.name}`, item },
          candidate: candidateTextOf(item),
        });
      }
      if (reranker !== undefined && ranking !== undefined && scored.length > 1) {
        ranking = { ...ranking, reranked: await rerankFirst(reranker, query, scored, rerankCount) };
      }
      return {
        query,
        packs: packs.length,
        items: scored.slice(0, limit).map((entry) => entry.item),
        ...(ranking === undefined ? {} : { ranking }),
      };
    },
  };

  /**
   * One result from an entry: a skill by its name and description, a document by its title and
   * summary with the sections that matched, read from its body where the license lets the
   * deployment pass it on (ADR-0026). An entry whose paths are not ones is left out.
   */
  async function itemOf(
    candidate: Candidate,
    verified: boolean,
    context: {
      readonly lexemes: readonly string[];
      readonly weights: readonly number[] | undefined;
      readonly nearest: readonly HubSectionMatch[];
    },
  ): Promise<FindItem | undefined> {
    const { row, pack } = candidate;
    const path = pathOf(row.path);
    if (path === undefined) {
      return undefined;
    }
    if (row.kind === "skill") {
      const directory = row.skillDir === null ? undefined : pathOf(row.skillDir);
      if (directory === undefined || row.name === null) {
        return undefined;
      }
      const license = row.frontMatter?.licenseFact;
      return {
        kind: "skill",
        path,
        name: row.name,
        directory,
        description: row.description ?? "",
        files: [],
        moreFiles: 0,
        translations: {},
        ...(license === undefined
          ? {}
          : { license, ...(servesInFull(license, verified) ? {} : { describedOnly: true }) }),
      };
    }
    const skillDirectory = row.skillDir === null ? undefined : pathOf(row.skillDir);
    const plain: FindItem = {
      kind: "document",
      path,
      title: row.title ?? undefined,
      summary: row.description ?? undefined,
      skillDirectory,
    };
    if (row.kind !== "markdown" || !servesInFull(pack.license ?? NO_LICENSE, verified)) {
      return plain;
    }
    const text = await blobStore.read(row.blobSha);
    if (text === undefined) {
      return plain;
    }
    const byWords = matchSections(text, context.lexemes, {
      weights: context.weights,
      limit: SECTION_CANDIDATES,
    });
    const offsets = fuseRanks(
      [byWords.map((section) => section.offset), context.nearest.map((match) => match.offset)],
      { compare: (a, b) => a - b },
    );
    const sections = offsets.slice(0, MAX_MATCHED_SECTIONS).flatMap((offset): FindSection[] => {
      const matched = byWords.find((section) => section.offset === offset);
      if (matched !== undefined) {
        return [matched];
      }
      const near = context.nearest.find((match) => match.offset === offset);
      return near === undefined
        ? []
        : [
            {
              heading: [...near.heading],
              offset: near.offset,
              length: near.length,
              excerpt: sectionExcerpt(text, near, context.lexemes),
            },
          ];
    });
    return { ...plain, sections };
  }
}

/** The address of a pack, `/gh/<owner>/<repo>`; `undefined` for names the grammar does not take. */
function addressOf(pack: SearchablePack): Address | undefined {
  const parsed = parseAddress(`/${pack.host}/${pack.owner}/${pack.name}`);
  return parsed.ok ? parsed.value : undefined;
}

function pathOf(text: string): RepoPath | undefined {
  const parsed = parseRepoPath(text);
  return parsed.ok ? parsed.value : undefined;
}

/** What the reranker scores a result by: its name and description, or its title and best section. */
function candidateTextOf(item: FindItem): string {
  if (item.kind === "skill") {
    return `${item.name}: ${item.description}`.slice(0, RERANK_CANDIDATE_CHARS);
  }
  const best = item.sections?.[0];
  const about = best?.excerpt ?? item.summary ?? "";
  const heading = best === undefined ? "" : ` (${best.heading.join(" > ")})`;
  return `${item.title ?? item.path}${heading}: ${about}`.slice(0, RERANK_CANDIDATE_CHARS);
}

/**
 * Reorders the first `count` of `scored` by the reranker's scores, in place, highest first and
 * the fused order among equals. False, and nothing moved, when the reranker did not answer.
 */
async function rerankFirst(
  reranker: NonNullable<MountMeaning["reranker"]>,
  query: string,
  scored: Scored[],
  count: number,
): Promise<boolean> {
  const first = scored.slice(0, Math.min(count, reranker.maxCandidates));
  if (first.length < 2) {
    return false;
  }
  let scores: readonly number[];
  try {
    scores = await reranker.rerank(
      query,
      first.map((entry) => entry.candidate),
    );
  } catch {
    return false;
  }
  if (scores.length !== first.length) {
    return false;
  }
  first
    .map((entry, at) => ({ entry, score: scores[at] ?? 0, at }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .forEach((ranked, at) => {
      scored[at] = ranked.entry;
    });
  return true;
}
