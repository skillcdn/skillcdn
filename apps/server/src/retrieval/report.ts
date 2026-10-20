import { resolve } from "node:path";
import {
  evaluateRetrieval,
  formatRetrievalReport,
  loadRetrievalSet,
  memorySearch,
} from "./evaluate.js";

// `pnpm --filter @skillcdn/server run eval:search [directory] [questions.json]`: the numbers of
// the retrieval evaluation set over a directory read as the command reads it, for a person who
// changed the word rules, the ranking or the set, and wants to see what moved.

const [directory, questions] = process.argv.slice(2);
const set = loadRetrievalSet(questions === undefined ? undefined : resolve(questions));
const find = await memorySearch(directory === undefined ? undefined : resolve(directory));
const score = await evaluateRetrieval(set, (question) => find(question.query));
process.stdout.write(formatRetrievalReport(score));
