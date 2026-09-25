import { and, between, desc, eq, gte, sql } from "drizzle-orm";
import { type Database, drizzleOf } from "../client.js";
import { accounts, repos, usageClients, usageDaily } from "../schema.js";
import type { RepoScope } from "./repos.js";

/** `client` is how many distinct clients used the repository that day; it appears once the day is folded. */
export type UsageMetric = "connection" | "tool_call" | "skill_load" | "client";

/** A day in UTC, as `YYYY-MM-DD`. */
export type UsageDay = string;

export interface UsageIncrement {
  readonly scope: RepoScope;
  readonly day: UsageDay;
  readonly metric: UsageMetric;
  /** What the metric is about: the tool name, the skill directory, or empty. */
  readonly subject: string;
  readonly count: number;
}

const BATCH_SIZE = 500;

/** The UTC day an instant falls on. */
export function usageDayOf(instant: Date): UsageDay {
  return instant.toISOString().slice(0, 10);
}

/**
 * Adds to the counters, creating them as needed. Additions commute, so any number of processes
 * can report at once and none has to know what the others counted.
 */
export async function addUsage(
  database: Database,
  increments: readonly UsageIncrement[],
  now: Date,
): Promise<void> {
  // One statement may not touch a row twice, so increments for the same counter are merged first.
  const merged = new Map<string, UsageIncrement>();
  for (const increment of increments) {
    if (increment.count <= 0) {
      continue;
    }
    const key = JSON.stringify([
      increment.scope.repoId,
      increment.day,
      increment.metric,
      increment.subject,
    ]);
    const existing = merged.get(key);
    merged.set(
      key,
      existing === undefined ? increment : { ...existing, count: existing.count + increment.count },
    );
  }
  const rows = [...merged.values()];
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await drizzleOf(database)
      .insert(usageDaily)
      .values(
        rows.slice(start, start + BATCH_SIZE).map((row) => ({
          accountId: row.scope.accountId,
          repoId: row.scope.repoId,
          day: row.day,
          metric: row.metric,
          subject: row.subject,
          count: row.count,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [usageDaily.repoId, usageDaily.day, usageDaily.metric, usageDaily.subject],
        set: { count: sql`${usageDaily.count} + excluded.count`, updatedAt: now },
      });
  }
}

export interface UsageClient {
  readonly scope: RepoScope;
  readonly day: UsageDay;
  /** The keyed hash of the client, as hex. */
  readonly client: string;
}

/** Notes that these clients were seen. A client seen before on that day is not a new row. */
export async function addUsageClients(
  database: Database,
  clients: readonly UsageClient[],
  now: Date,
): Promise<void> {
  const distinct = new Map<string, UsageClient>();
  for (const seen of clients) {
    distinct.set(JSON.stringify([seen.scope.repoId, seen.day, seen.client]), seen);
  }
  const rows = [...distinct.values()];
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await drizzleOf(database)
      .insert(usageClients)
      .values(
        rows.slice(start, start + BATCH_SIZE).map((row) => ({
          accountId: row.scope.accountId,
          repoId: row.scope.repoId,
          day: row.day,
          client: row.client,
          createdAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [usageClients.repoId, usageClients.day, usageClients.client],
      });
  }
}

/**
 * Turns the clients of every day before `before` into `client` counts in `usage_daily`, and
 * deletes the rows of those days. The move is one statement, so processes that fold
 * at the same time each move their own share and the totals still add up.
 */
export async function foldUsageClients(
  database: Database,
  before: UsageDay,
  now: Date,
): Promise<void> {
  const handle = drizzleOf(database);
  await handle.execute(sql`
    with moved as (
      delete from ${usageClients}
      where ${usageClients.day} < ${before}
      returning ${usageClients.accountId} as account_id, ${usageClients.repoId} as repo_id, ${usageClients.day} as day
    )
    insert into ${usageDaily} (account_id, repo_id, day, metric, subject, count, created_at, updated_at)
    select account_id, repo_id, day, 'client', '', count(*), ${now}, ${now}
    from moved
    group by account_id, repo_id, day
    on conflict (repo_id, day, metric, subject)
    do update set count = ${usageDaily}.count + excluded.count, updated_at = excluded.updated_at
  `);
}

export interface UsageTotal {
  readonly metric: UsageMetric;
  readonly subject: string;
  readonly count: number;
}

/** What was counted for one repository between two days, both included. */
export async function getRepoUsage(
  database: Database,
  scope: RepoScope,
  range: { readonly from: UsageDay; readonly to: UsageDay },
): Promise<UsageTotal[]> {
  const total = sql<number>`sum(${usageDaily.count})::bigint`.mapWith(Number);
  return drizzleOf(database)
    .select({ metric: usageDaily.metric, subject: usageDaily.subject, count: total })
    .from(usageDaily)
    .where(
      and(
        eq(usageDaily.repoId, scope.repoId),
        eq(usageDaily.accountId, scope.accountId),
        between(usageDaily.day, range.from, range.to),
      ),
    )
    .groupBy(usageDaily.metric, usageDaily.subject)
    .orderBy(usageDaily.metric, sql`${usageDaily.subject} collate "C"`);
}

export interface RepositoryUsage {
  readonly host: string;
  /** As the host spells them. */
  readonly owner: string;
  readonly name: string;
  readonly count: number;
}

/**
 * The repositories with the highest total of one metric between two days. Deliberately not
 * scoped to an account: it is what a public ranking is made of. It only ever reads repositories
 * that are public right now, so a repository that went private drops out with all its history.
 */
export async function listTopRepositories(
  database: Database,
  options: {
    readonly metric: UsageMetric;
    readonly from: UsageDay;
    readonly to: UsageDay;
    readonly limit: number;
    /** Leave out repositories whose total is below this. */
    readonly minimum?: number;
  },
): Promise<RepositoryUsage[]> {
  const total = sql<number>`sum(${usageDaily.count})::bigint`.mapWith(Number);
  return drizzleOf(database)
    .select({ host: repos.host, owner: accounts.login, name: repos.name, count: total })
    .from(usageDaily)
    .innerJoin(repos, eq(repos.id, usageDaily.repoId))
    .innerJoin(accounts, eq(accounts.id, repos.accountId))
    .where(
      and(
        eq(usageDaily.metric, options.metric),
        between(usageDaily.day, options.from, options.to),
        eq(repos.visibility, "public"),
      ),
    )
    .groupBy(repos.id, repos.host, accounts.login, repos.name)
    .having(options.minimum === undefined ? undefined : gte(total, options.minimum))
    .orderBy(desc(total), sql`${repos.name} collate "C"`)
    .limit(options.limit);
}
