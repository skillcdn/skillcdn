import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type FindResult,
  type IndexLimits,
  parseAddress,
  type RepoPath,
  ROOT_PATH,
} from "@skillcdn/core";
import { INDEX_LIMIT_DEFAULTS, readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, type MountContext, Reader } from "@skillcdn/reader";
import * as z from "zod";

// The retrieval evaluation set (ADR-0063): questions with the sections that answer them, asked
// of the document-pack fixture, and the numbers a search is held to. A change to the word rules,
// to the ranking or, later, to a model is measured here, by the same reads an agent makes.

export const RETRIEVAL_SET_PATH = fileURLToPath(
  new URL("../../fixtures/retrieval/questions.json", import.meta.url),
);
export const DOCUMENT_PACK_PATH = fileURLToPath(
  new URL("../../fixtures/.repositories/document-pack/", import.meta.url),
);

const answerSchema = z.object({
  path: z.string().min(1),
  heading: z.array(z.string()),
});
const questionSchema = z.object({
  id: z.string().min(1),
  language: z.enum(["en", "ko"]),
  query: z.string().min(1),
  answers: z.array(answerSchema).min(1),
});
const retrievalSetSchema = z.object({
  pack: z.string(),
  questions: z.array(questionSchema).min(1),
});

export type RetrievalQuestion = z.infer<typeof questionSchema>;
export type RetrievalSet = z.infer<typeof retrievalSetSchema>;

/** The questions and their answers, as the fixture file states them. */
export function loadRetrievalSet(path = RETRIEVAL_SET_PATH): RetrievalSet {
  return retrievalSetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** How many results a question is given: the first page an agent sees over MCP. */
export const RETRIEVAL_PAGE = 5;

/** What one search answered, as the numbers are taken from it. */
export interface RetrievalOutcome {
  readonly id: string;
  readonly language: "en" | "ko";
  /** The answering document is the first result. */
  readonly fileAt1: boolean;
  /** An answering document is on the page. */
  readonly fileAt5: boolean;
  /** The answering document's first named section answers. */
  readonly sectionAt1: boolean;
  /** The answering section is among the first two named. */
  readonly sectionAt2: boolean;
}

/** The numbers over a set of questions, each as a share from 0 to 1. */
export interface RetrievalScore {
  readonly questions: number;
  readonly fileAt1: number;
  readonly fileAt5: number;
  readonly sectionAt1: number;
  readonly sectionAt2: number;
  /** The questions whose answering document was not on the page. */
  readonly missed: readonly string[];
  readonly outcomes: readonly RetrievalOutcome[];
}

const sameHeading = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((text, index) => text === b[index]);

/** The numbers of one question from the page a search answered. */
export function scoreQuestion(question: RetrievalQuestion, result: FindResult): RetrievalOutcome {
  const items = result.items.slice(0, RETRIEVAL_PAGE);
  const pathOf = (item: FindResult["items"][number]): string =>
    item.kind === "skill" ? (item.path ?? `${item.directory}/SKILL.md`) : item.path;
  const answering = items.findIndex((item) =>
    question.answers.some((answer) => answer.path === pathOf(item)),
  );
  const found = answering >= 0 ? items[answering] : undefined;
  const sections =
    found?.kind === "document" ? (found.sections ?? []).map((section) => section.heading) : [];
  const answers = question.answers.filter(
    (answer) => found !== undefined && answer.path === pathOf(found),
  );
  const sectionAt = (depth: number): boolean =>
    sections
      .slice(0, depth)
      .some((heading) => answers.some((answer) => sameHeading(answer.heading, heading)));
  return {
    id: question.id,
    language: question.language,
    fileAt1: answering === 0,
    fileAt5: answering >= 0,
    sectionAt1: sectionAt(1),
    sectionAt2: sectionAt(2),
  };
}

/** The numbers over the whole set, for a search that answers a query with its first page. */
export async function evaluateRetrieval(
  set: RetrievalSet,
  find: (question: RetrievalQuestion) => Promise<FindResult>,
): Promise<RetrievalScore> {
  const outcomes: RetrievalOutcome[] = [];
  for (const question of set.questions) {
    outcomes.push(scoreQuestion(question, await find(question)));
  }
  const share = (pick: (outcome: RetrievalOutcome) => boolean): number =>
    outcomes.length === 0 ? 0 : outcomes.filter(pick).length / outcomes.length;
  return {
    questions: outcomes.length,
    fileAt1: share((outcome) => outcome.fileAt1),
    fileAt5: share((outcome) => outcome.fileAt5),
    sectionAt1: share((outcome) => outcome.sectionAt1),
    sectionAt2: share((outcome) => outcome.sectionAt2),
    missed: outcomes.filter((outcome) => !outcome.fileAt5).map((outcome) => outcome.id),
    outcomes,
  };
}

/** The score of the questions in one language, from a score over every language. */
export function scoreOfLanguage(score: RetrievalScore, language: "en" | "ko"): RetrievalScore {
  const outcomes = score.outcomes.filter((outcome) => outcome.language === language);
  const share = (pick: (outcome: RetrievalOutcome) => boolean): number =>
    outcomes.length === 0 ? 0 : outcomes.filter(pick).length / outcomes.length;
  return {
    questions: outcomes.length,
    fileAt1: share((outcome) => outcome.fileAt1),
    fileAt5: share((outcome) => outcome.fileAt5),
    sectionAt1: share((outcome) => outcome.sectionAt1),
    sectionAt2: share((outcome) => outcome.sectionAt2),
    missed: outcomes.filter((outcome) => !outcome.fileAt5).map((outcome) => outcome.id),
    outcomes,
  };
}

/** The numbers as a table for a person, one row per language and one for all. */
export function formatRetrievalReport(score: RetrievalScore): string {
  const percent = (value: number): string => `${Math.round(value * 100)}%`;
  const row = (label: string, part: RetrievalScore): string =>
    `${label.padEnd(8)} ${String(part.questions).padStart(3)}  ${percent(part.fileAt1).padStart(7)} ${percent(part.fileAt5).padStart(7)} ${percent(part.sectionAt1).padStart(10)} ${percent(part.sectionAt2).padStart(10)}`;
  const lines = [
    `${"".padEnd(8)}   n   file@1  file@5  section@1  section@2`,
    row("en", scoreOfLanguage(score, "en")),
    row("ko", scoreOfLanguage(score, "ko")),
    row("all", score),
  ];
  if (score.missed.length > 0) {
    lines.push(`missed on the page: ${score.missed.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A search over a directory as the command searches it: the directory read into an index in
 * memory, and the reader's `find` over it, one page at a time.
 */
export async function memorySearch(
  directory = DOCUMENT_PACK_PATH,
  limits: IndexLimits = INDEX_LIMIT_DEFAULTS,
): Promise<(query: string, path?: string) => Promise<FindResult>> {
  const read = await readDirectory({
    directory,
    limits,
    repository: { owner: "acme", name: "document-pack" },
  });
  const parsed = parseAddress("/gh/acme/document-pack");
  if (!parsed.ok) {
    throw new Error("the fixture address does not parse");
  }
  const mount: MountContext = {
    address: { ...parsed.value, path: ROOT_PATH },
    commit: read.commit,
    verified: true,
    limits: {},
    repository: "acme/document-pack",
    description: undefined,
    sourceUrl: (path: RepoPath) => `file:///${path}`,
    rawUrl: (path: RepoPath) => `file:///${path}`,
  };
  const index = createMemoryIndex({ index: read.index, blobs: read.blobs });
  const reader = new Reader<MountContext>({
    limits,
    index: async () => ({ status: "ready", index }),
  });
  return async (query, path) => {
    const answer = await reader.find(
      mount,
      { query, limit: RETRIEVAL_PAGE, ...(path === undefined ? {} : { path }) },
      0,
    );
    if (answer.status !== "ready") {
      throw new Error("the index of a directory is always ready");
    }
    return answer.result;
  };
}
