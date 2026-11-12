import {
  type Address,
  accountAvatarUrl,
  type BlobStore,
  type Clock,
  type FindItem,
  type FindRanking,
  type FindSection,
  fuseRanks,
  type HubItem,
  type HubPack,
  type HubResult,
  isGitHostKey,
  isHeadedBy,
  MAX_MATCHED_SECTIONS,
  matchSections,
  NO_LICENSE,
  parseAddress,
  parseRepoPath,
  queryIdentifiers,
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
  isStatementTimeout,
  listSearchablePacks,
  type SearchablePack,
  searchHubEntries,
  searchHubSectionVectors,
} from "@skillcdn/db";
import { HEADED_CANDIDATES } from "@skillcdn/reader";
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
  /**
   * The results for a query, at most `limit` of them. Where the words ran out of their time and
   * the meaning answered, the answer is the meaning's alone, and says so (`standsInForFailure`).
   * Throws when the database refused, or when nothing answered in time.
   */
  search(query: string, limit: number): Promise<HubResult>;
  /** How many packs a search covers right now. */
  packs(): Promise<number>;
}

/**
 * Whether an answer is what was left of a search whose words ran out of their time (ADR-0091):
 * given to whoever asked instead of a failure, and, like a failure, kept by no cache, so that the
 * next who asks is answered in full.
 */
export function standsInForFailure(result: HubResult): boolean {
  return result.ranking?.words === false;
}

/** How long the set of searchable packs is kept before it is read again. */
const PACKS_TTL_MS = 15_000;
/**
 * How long the search by meaning is left unasked once its statement ran out of its time
 * (ADR-0091). The comparison reads every section vector of the packs, so one that did not end in
 * time is not the one to ask again by the next search: it would wait as long for as little, and
 * take from the words what the database has to read with.
 */
const MEANING_REST_MS = 60_000;
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
  /** Until when the search by meaning rests, on the deployment's clock; 0 while it is asked. */
  let meaningRestsUntil = 0;

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
      const started = clock.now().getTime();
      /** How long each part of this search took, in milliseconds, for the log of a slow one. */
      const took: Record<string, number> = {};
      const part = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        const from = clock.now().getTime();
        try {
          return await work();
        } finally {
          took[name] = (took[name] ?? 0) + (clock.now().getTime() - from);
        }
      };
      const packs = await part("packs", packsOf);
      const byId = new Map(packs.map((pack) => [pack.snapshotId, pack]));
      const ids = packs.map((pack) => pack.snapshotId);
      if (ids.length === 0) {
        return { query, packs: 0, items: [] };
      }
      // The words of the query, read with the default rules: the packs differ in language, and
      // the words are weighed by their rarity across all of them (ADR-0069).
      const lexemes = queryLexemes(query);
      /** A statement over every pack, which says so in the log when it runs out of its time. */
      const timed = <T>(statement: string, work: () => Promise<T>): Promise<T> =>
        part(statement, async () => {
          try {
            return await work();
          } catch (error) {
            if (isStatementTimeout(error)) {
              logger.warn(
                { statement, timeoutMs, packs: ids.length, lexemes: lexemes.length },
                "a statement of the search across packs ran out of its time",
              );
            }
            throw error;
          }
        });
      let weights: readonly number[] | undefined;
      /** Why the words did not answer, where they ran out of their time. */
      let wordsRanOut: unknown;
      // What the words find; `undefined` where they ran out of their time, which the meaning
      // may still answer for (ADR-0091). Any other failure is the search's own.
      const byWordsOf = async (): Promise<readonly HubEntryRecord[] | undefined> => {
        if (lexemes.length === 0) {
          return [];
        }
        try {
          const counted = await timed("count", () =>
            countHubLexemes(database, ids, lexemes, timeoutMs),
          );
          weights = queryWeights(counted.total, counted.counts);
          return await timed("words", () =>
            searchHubEntries(database, ids, lexemes, weights, candidates, timeoutMs),
          );
        } catch (error) {
          if (!isStatementTimeout(error)) {
            throw error;
          }
          wordsRanOut = error;
          return undefined;
        }
      };
      // The sections nearest in meaning, where the deployment searches by it; an embedder or a
      // database that does not answer in time leaves the words to answer, which the result says.
      // A comparison that ran out of its time is not asked again for a while (ADR-0091).
      const key = meaning?.key;
      const meaningRests = (): boolean => clock.now().getTime() < meaningRestsUntil;
      /** The query as its vector; `undefined`, and never a rejection, where there is none to have. */
      const embedded = async (): Promise<Float32Array | undefined> => {
        if (meaning === undefined || key === undefined || meaningRests()) {
          return undefined;
        }
        try {
          const { vectors } = await part("embed", () => meaning.embedder.embed([query], "query"));
          return vectors[0];
        } catch (error) {
          logger.debug({ err: error }, "the query of a search across packs was not embedded");
          return undefined;
        }
      };
      const nearestTo = async (
        vector: Float32Array | undefined,
      ): Promise<readonly HubSectionMatch[] | undefined> => {
        if (key === undefined || vector === undefined || meaningRests()) {
          return undefined;
        }
        try {
          return await timed("meaning", () =>
            searchHubSectionVectors(database, ids, key, vector, candidates, timeoutMs),
          );
        } catch (error) {
          if (isStatementTimeout(error)) {
            meaningRestsUntil = clock.now().getTime() + MEANING_REST_MS;
          }
          logger.debug({ err: error }, "the search by meaning across packs did not answer");
          return undefined;
        }
      };
      // The query is embedded while the words are looked up, and the comparison waits for the
      // words (ADR-0091): it reads every section vector of the packs, and run beside the words
      // it takes from them what the database has to read with. A query that is identifiers alone
      // is ranked by its words, as inside a mount (ADR-0079), so its meaning is asked for only
      // once the words have found nothing, or did not answer.
      const identifiers = queryIdentifiers(query);
      const vector = identifiers.only ? undefined : embedded();
      const found = await byWordsOf();
      let ranking: FindRanking | undefined;
      let nearest: readonly HubSectionMatch[] | undefined;
      if (!identifiers.only || found === undefined || found.length === 0) {
        nearest = await nearestTo(await (vector ?? embedded()));
      }
      if (found === undefined && nearest === undefined) {
        // Nothing answered in time: there is nothing to show but that.
        throw wordsRanOut;
      }
      const words = found ?? [];
      const wordsAlone = identifiers.only && words.length > 0;
      if (key !== undefined) {
        ranking = wordsAlone
          ? { meaning: false, reranked: false, identifiers: true }
          : {
              meaning: nearest !== undefined,
              reranked: false,
              ...(found === undefined ? { words: false } : {}),
            };
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
      const verified = new Map<string, Promise<boolean>>();
      const vouchedFor = (pack: SearchablePack, address: Address): Promise<boolean> => {
        let vouched = verified.get(pack.snapshotId);
        if (vouched === undefined) {
          vouched = lists.isVerified(repositoryKey(address));
          verified.set(pack.snapshotId, vouched);
        }
        return vouched;
      };
      const legsEnded = clock.now().getTime();
      // The documents one of whose headings names the identifier the query begins with
      // stand first, in the words' order (ADR-0079); a document the deployment only describes is
      // not read for it.
      const headed: string[] = [];
      const leading = identifiers.leading;
      if (leading !== undefined) {
        const first = words.filter((row) => row.kind === "markdown").slice(0, HEADED_CANDIDATES);
        const found = await Promise.all(
          first.map(async (row) => {
            const pack = byId.get(row.snapshotId);
            const address = pack === undefined ? undefined : addressOf(pack);
            if (pack === undefined || address === undefined) {
              return false;
            }
            if (!servesInFull(pack.license ?? NO_LICENSE, await vouchedFor(pack, address))) {
              return false;
            }
            const text = await blobStore.read(row.blobSha);
            return text !== undefined && isHeadedBy(text, leading);
          }),
        );
        first.forEach((row, at) => {
          if (found[at] === true) {
            headed.push(keyOf(row.snapshotId, row.path));
          }
        });
      }
      const ordered =
        headed.length === 0 ? fused : [...headed, ...fused.filter((key) => !headed.includes(key))];
      const reranker = wordsAlone ? undefined : meaning?.reranker;
      const rerankCount = reranker === undefined ? 0 : (meaning?.rerankCandidates ?? 10);
      const wanted = Math.max(limit, headed.length + rerankCount);
      const scored: Scored[] = [];
      /** How many of the scored stand first for their heading, and are not the reranker's to move. */
      let fixed = 0;
      for (const key of ordered.slice(0, wanted)) {
        const candidate = records.get(key);
        if (candidate === undefined) {
          continue;
        }
        const address = addressOf(candidate.pack);
        if (address === undefined) {
          continue;
        }
        const isVerified = await vouchedFor(candidate.pack, address);
        const item = await itemOf(candidate, isVerified, {
          lexemes,
          weights,
          nearest: (nearest ?? []).filter((match) => keyOf(match.snapshotId, match.path) === key),
        });
        if (item === undefined) {
          continue;
        }
        scored.push({
          item: {
            address,
            repository: `${candidate.pack.owner}/${candidate.pack.name}`,
            pack: packFactsOf(candidate.pack, isVerified),
            item,
          },
          candidate: candidateTextOf(item),
        });
        if (headed.includes(key)) {
          fixed = scored.length;
        }
      }
      took.items = clock.now().getTime() - legsEnded;
      if (reranker !== undefined && ranking !== undefined && scored.length - fixed > 1) {
        // The reranker orders what follows the results that stand first for their heading.
        const rest = scored.slice(fixed);
        const reranked = await part("rerank", () =>
          rerankFirst(reranker, query, rest, rerankCount),
        );
        ranking = { ...ranking, reranked };
        scored.splice(fixed, rest.length, ...rest);
      }
      const ms = clock.now().getTime() - started;
      if (ms > timeoutMs) {
        // An answer that took longer than one of its statements may: the log says where the time
        // went, since the limit of a statement is not the limit of the search.
        logger.info(
          {
            ms,
            took,
            packs: ids.length,
            lexemes: lexemes.length,
            ...(ranking === undefined ? {} : { meaning: ranking.meaning }),
          },
          "a search across packs answered slowly",
        );
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
      ...(row.frontMatter?.derived === undefined ? {} : { derived: true }),
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

/**
 * What a pack is, for a result to say beside the pack's name: a pack of skills where the
 * manifest and skills are, a pack of documents where the manifest is and no skill, and a
 * repository read without a manifest otherwise.
 */
function packFactsOf(pack: SearchablePack, verified: boolean): HubPack {
  return {
    kind: pack.hasManifest ? (pack.skillCount > 0 ? "skills" : "documents") : "repository",
    verified,
    skills: pack.skillCount,
    // A pack served from a directory of the deployment has no owner at a git host (ADR-0071).
    avatar: isGitHostKey(pack.host)
      ? accountAvatarUrl(pack.host, pack.hostAccountId, AVATAR_SIZE)
      : "",
  };
}

/** The size the owner's picture is asked for: what a result's line shows, twice over for a dense screen. */
const AVATAR_SIZE = 64;

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
