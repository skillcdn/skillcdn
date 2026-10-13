import { type Clock, formatAddress, parseAddress } from "@skillcdn/core";
import {
  type Database,
  findRepoByAlias,
  getRepoUsage,
  getServiceUsage,
  listTopRepositories,
  listTopSubjects,
  type RepositoryUsage,
  type ServiceUsageTotal,
  type SubjectUsage,
  type UsageDay,
  type UsageMetric,
  type UsageTotal,
  usageDayOf,
} from "@skillcdn/db";
import { OperatorLists } from "../operator/lists.js";

/** Two days, both included, as `YYYY-MM-DD` in UTC. */
export interface UsageRange {
  readonly from: UsageDay;
  readonly to: UsageDay;
}

/** The metrics a subject ranking exists for: a subject is a tool, a skill or a file. */
export type SubjectMetric = Exclude<UsageMetric, "connection" | "client">;

/** How many days a read spans when it does not say: the last thirty, today included. */
export const DEFAULT_RANGE_DAYS = 30;
/** The most days one read spans. */
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A day as the statistics write it, or `undefined` for text that is not one. */
export function parseUsageDay(text: string): UsageDay | undefined {
  if (!DAY_PATTERN.test(text)) {
    return undefined;
  }
  const instant = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(instant.getTime()) || usageDayOf(instant) !== text ? undefined : text;
}

/** The number of days between two days, both included; negative when `to` comes first. */
export function daysInRange(range: UsageRange): number {
  const from = new Date(`${range.from}T00:00:00Z`).getTime();
  const to = new Date(`${range.to}T00:00:00Z`).getTime();
  return Math.round((to - from) / DAY_MS) + 1;
}

/** A repository of a ranking as an address of this deployment, as the operator writes one. */
function addressOf(row: RepositoryUsage): string {
  const parsed = parseAddress(`/${row.host}/${row.owner}/${row.name}`);
  return parsed.ok ? formatAddress(parsed.value) : `/${row.host}/${row.owner}/${row.name}`;
}

/**
 * What the operator reads of the usage statistics, through the admin API; a worker that ranks
 * or recommends reads the same. Every read is bounded in days and rows, and a repository is
 * named only while it is public: the rule is in the queries.
 */
export class UsageReads {
  readonly #database: Database;
  readonly #clock: Clock;

  constructor(dependencies: { readonly database: Database; readonly clock: Clock }) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  /** The last `DEFAULT_RANGE_DAYS` days, today (UTC) included. */
  defaultRange(): UsageRange {
    const now = this.#clock.now();
    return {
      from: usageDayOf(new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS)),
      to: usageDayOf(now),
    };
  }

  /** The deployment's totals per day. */
  service(range: UsageRange): Promise<ServiceUsageTotal[]> {
    return getServiceUsage(this.#database, range);
  }

  /** The public repositories with the highest total of one metric. */
  async repositories(options: {
    readonly metric: UsageMetric;
    readonly range: UsageRange;
    readonly limit: number;
  }): Promise<(RepositoryUsage & { readonly address: string })[]> {
    const rows = await listTopRepositories(this.#database, {
      metric: options.metric,
      from: options.range.from,
      to: options.range.to,
      limit: options.limit,
    });
    return rows.map((row) => ({ ...row, address: addressOf(row) }));
  }

  /** The subjects of one metric with the highest totals across public repositories. */
  async subjects(options: {
    readonly metric: SubjectMetric;
    readonly range: UsageRange;
    readonly limit: number;
  }): Promise<(SubjectUsage & { readonly address: string })[]> {
    const rows = await listTopSubjects(this.#database, {
      metric: options.metric,
      from: options.range.from,
      to: options.range.to,
      limit: options.limit,
    });
    return rows.map((row) => ({ ...row, address: addressOf(row) }));
  }

  /**
   * What was counted for one repository, named as the operator names one (`/gh/owner/repo`);
   * `undefined` for a repository that is unknown or not public, which read the same.
   */
  async repository(
    written: string,
    range: UsageRange,
  ): Promise<{ readonly address: string; readonly items: UsageTotal[] } | undefined> {
    const address = OperatorLists.addressOf("blocked", written);
    const repo = await findRepoByAlias(this.#database, {
      host: address.host,
      owner: address.owner,
      repo: address.repo,
    });
    if (repo === undefined || repo.repository.visibility !== "public") {
      return undefined;
    }
    const items = await getRepoUsage(
      this.#database,
      { accountId: repo.accountId, repoId: repo.id },
      range,
    );
    return { address: formatAddress(address), items };
  }
}
