import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAddress } from "@skillcdn/core";
import {
  announceRepoRefs,
  createJobQueue,
  ensureSnapshot,
  findRepoByAlias,
  findSnapshotOfCommit,
  type JobQueue,
  listMovingRefs,
  type SendOptions,
} from "@skillcdn/db";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "@skillcdn/db/testing";
import { INDEX_VERSION } from "@skillcdn/indexer";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listDirectoryPacks } from "./directory/directory-host.js";
import { HostEvents } from "./events/host-events.js";
import { type AheadScope, createIndexAhead, HOST_PAUSE_MS } from "./jobs/index-ahead.js";
import {
  AHEAD_QUEUE,
  EMBED_QUEUE,
  ensureJobQueues,
  INDEX_QUEUE,
  type IndexJob,
  LOOK_QUEUE,
  PRUNE_QUEUE,
  type QUEUE_SETTINGS,
  SWEEP_QUEUE,
  sendAheadJob,
} from "./jobs/queues.js";
import { createWorker, type Worker } from "./jobs/worker.js";
import { MountError } from "./mounts/mount-service.js";
import { createFixtureHost, type FixtureHost, fixtureRepoId } from "./testing/fixture-host.js";
import { makeSnapshot } from "./testing/made-snapshot.js";

// The worker indexing ahead of requests (ADR-0085), against the fixture git host and a clock the
// tests move: a push the host announced is looked at first and indexed without a request; a ref
// is looked at again when its time is up, for the repositories the scope names; a commit sent
// back for a rebuild is the worker's to rebuild; a repository that is no pack, and a ref nobody
// asked for, are left to requests; a ref the host no longer has is forgotten; the packs of the
// deployment's directory are found on disk; and a host that gives no answer is left alone.

const INTERVAL_MS = 15 * 60_000;
const LIMITS = {
  maxTreeEntries: 1000,
  maxIndexedFiles: 100,
  maxIndexedFileBytes: 262_144,
  maxIndexedTotalBytes: 1_048_576,
  maxReadableFileBytes: 262_144,
  maxArchiveBytes: 10_000_000,
};
const logger = pino({ level: "silent" });

interface Sent {
  readonly name: string;
  readonly job: IndexJob;
  readonly options: SendOptions | undefined;
}

/** A queue that only writes down what it is sent: the looks are run by the test, one by one. */
function recordingQueue(): { readonly jobs: JobQueue; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const jobs: JobQueue = {
    ensureQueue: async () => {},
    send: async (name, data, options) => {
      sent.push({ name, job: data as IndexJob, options });
      return "sent";
    },
    work: async () => {},
    schedule: async () => {},
    unschedule: async () => {},
    waiting: async () => [],
    reorder: async () => false,
    counts: async () => [],
    failures: async () => [],
    stop: async () => {},
  };
  return { jobs, sent };
}

let testDatabase: TestDatabase;
const closing: Worker[] = [];

beforeAll(async () => {
  testDatabase = await createTestDatabase(DEV_DATABASE_URL);
});
afterAll(async () => {
  for (const worker of closing) {
    await worker.close(1000);
  }
  await testDatabase?.drop();
});

/**
 * A worker's mounts and indexing over a fixture host of its own, on a clock the test moves, with
 * what looks ahead wired as the role wires it and a queue that only records.
 */
function setup(options: {
  readonly variant: string;
  readonly scope?: AheadScope;
  readonly listed?: readonly string[];
  readonly packsRoot?: string;
}) {
  let now = Date.parse("2026-05-01T00:00:00Z");
  const clock = { now: () => new Date(now) };
  const host: FixtureHost = createFixtureHost(options.variant);
  const { jobs, sent } = recordingQueue();
  const packsRoot = options.packsRoot;
  const worker = createWorker(
    {
      mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
      indexing: {
        waitMs: 10_000,
        concurrency: 2,
        leaseMs: 60_000,
        ahead: { scope: options.scope ?? "listed", intervalMs: INTERVAL_MS, limit: 50 },
        retentionMs: 0,
        limits: LIMITS,
      },
      embedConcurrency: 1,
      scope: "none",
      ...(packsRoot === undefined ? {} : { packs: { root: packsRoot, access: "public" } }),
    },
    { database: testDatabase.database, jobs, gitHost: host, embedder: undefined, clock, logger },
  );
  closing.push(worker);
  const embedded: string[] = [];
  const ahead = createIndexAhead({
    database: testDatabase.database,
    jobs,
    mounts: worker.mounts,
    snapshots: worker.snapshots,
    lists: { listedKeys: async () => options.listed ?? [] },
    config: { scope: options.scope ?? "listed", intervalMs: INTERVAL_MS, limit: 50 },
    directoryPacks:
      packsRoot === undefined ? undefined : (limit) => listDirectoryPacks(packsRoot, limit),
    onIndexed: async (_mount, snapshot) => {
      embedded.push(snapshot.commitSha);
    },
    clock,
    logger,
  });
  /** Resolves and indexes an address as a request does, and answers the repository's row. */
  const open = async (text: string) => {
    const address = parseAddress(text);
    if (!address.ok) throw new Error(`not an address: ${text}`);
    const mount = await worker.mounts.resolve(address.value);
    const outcome = await worker.snapshots.ready(mount, 10_000);
    expect(outcome.status).toBe("ready");
    return { accountId: mount.repo.accountId, repoId: mount.repo.id, commit: mount.commit };
  };
  /** The jobs a pass queued for the repositories of this setup, by address. */
  const looked = async (): Promise<Sent[]> => {
    sent.length = 0;
    await ahead.look();
    return [...sent];
  };
  return {
    host,
    worker,
    ahead,
    clock,
    embedded,
    open,
    looked,
    later(ms: number) {
      now += ms;
    },
  };
}

const addressesOf = (sent: readonly Sent[]): string[] => sent.map(({ job }) => job.address);

describe("the worker indexing ahead of requests", () => {
  it("looks first at a push the host announced, and indexes the new commit without a request", async () => {
    const s = setup({ variant: "ahead-push" });
    const repo = await s.open("/gh/acme/with-manifest");
    // Nothing is due for a ref the host was just asked about.
    expect(addressesOf(await s.looked())).not.toContain("/gh/acme/with-manifest");

    const pushed = s.host.push();
    const events = new HostEvents({
      database: testDatabase.database,
      clock: s.clock,
      host: "gh",
      repoTtlMs: 60_000,
      refTtlMs: 60_000,
    });
    expect(
      await events.apply({ kind: "refs_changed", hostRepoId: fixtureRepoId("with-manifest") }),
    ).toBe(1);

    const [job] = (await s.looked()).filter(({ job }) => job.address === "/gh/acme/with-manifest");
    expect(job).toMatchObject({
      name: AHEAD_QUEUE,
      job: { accountId: repo.accountId, repoId: repo.repoId },
      // One look per repository waits, and an announced push comes before a ref whose time is up.
      options: { singletonKey: repo.repoId, priority: 10 },
    });
    // The event said where to look, and nothing more: the commit is the one the host answers.
    expect(await findSnapshotOfCommit(testDatabase.database, repo, pushed)).toBeUndefined();
    if (job === undefined) throw new Error("no look was queued");
    expect(await s.ahead.run(job.job)).toEqual({
      refs: 1,
      indexed: 1,
      failed: 0,
      gone: 0,
      unanswered: false,
    });
    expect(await findSnapshotOfCommit(testDatabase.database, repo, pushed)).toMatchObject({
      status: "ready",
      indexVersion: INDEX_VERSION,
    });
    // What the worker found without an index goes on to be embedded, once.
    expect(s.embedded).toEqual([pushed]);

    // The host was asked, so the announcement is answered: nothing is due, and a second look
    // at the same commit indexes and embeds nothing.
    expect(addressesOf(await s.looked())).not.toContain("/gh/acme/with-manifest");
    expect(await s.ahead.run(job.job)).toMatchObject({ refs: 1, indexed: 0 });
    expect(s.embedded).toEqual([pushed]);
  });

  it("looks at a ref whose time is up: the listed repositories, or every pack", async () => {
    const listed = setup({ variant: "ahead-due", listed: ["/gh/acme/single-skill"] });
    const packs = setup({ variant: "ahead-due", scope: "packs" });
    await listed.open("/gh/acme/single-skill");
    await listed.open("/gh/acme/multi-skill");
    const mine = (sent: readonly Sent[]) =>
      addressesOf(sent).filter((address) =>
        ["/gh/acme/single-skill", "/gh/acme/multi-skill"].includes(address),
      );
    expect(mine(await listed.looked())).toEqual([]);
    expect(mine(await packs.looked())).toEqual([]);

    listed.later(INTERVAL_MS + 1000);
    packs.later(INTERVAL_MS + 1000);
    // The operator's list decides under `listed`; under `packs`, that the repository is a pack.
    expect(mine(await listed.looked())).toEqual(["/gh/acme/single-skill"]);
    expect(mine(await packs.looked()).sort()).toEqual([
      "/gh/acme/multi-skill",
      "/gh/acme/single-skill",
    ]);

    // The look asks the host, as a request would: the ref is then not due until its time is up.
    const [job] = (await listed.looked()).filter(
      ({ job }) => job.address === "/gh/acme/single-skill",
    );
    if (job === undefined) throw new Error("no look was queued");
    const asked = listed.host.calls.resolveRef;
    expect(await listed.ahead.run(job.job)).toMatchObject({ refs: 1, indexed: 0 });
    expect(listed.host.calls.resolveRef).toBe(asked + 1);
    expect(mine(await listed.looked())).toEqual([]);
  });

  it("rebuilds a commit sent back by a change of the reading rules", async () => {
    const s = setup({ variant: "ahead-rebuild", scope: "packs" });
    const repo = await s.open("/gh/acme/licensed");
    const mine = async () =>
      (await s.looked()).filter(({ job }) => job.address === "/gh/acme/licensed");
    expect(await mine()).toHaveLength(0);
    // What a newer version of the rules does to a ready index when it is next asked for.
    const sent = await ensureSnapshot(
      testDatabase.database,
      repo,
      repo.commit,
      INDEX_VERSION + 1,
      new Date(),
    );
    expect(sent.status).toBe("pending");
    const [job] = await mine();
    if (job === undefined) throw new Error("no look was queued");
    expect(await s.ahead.run(job.job)).toMatchObject({ indexed: 1, failed: 0 });
    expect(await findSnapshotOfCommit(testDatabase.database, repo, repo.commit)).toMatchObject({
      status: "ready",
    });
  });

  it("leaves a repository that is no pack, and a pinned commit, to requests", async () => {
    const s = setup({ variant: "ahead-other", scope: "packs" });
    // A repository of documents alone, with neither a manifest nor a skill, served right now.
    const plain = await makeSnapshot(testDatabase.database, {
      visibility: "public",
      served: true,
      files: [{ path: "README.md", text: "# Notes\n\nNothing an agent is told to do.\n" }],
    });
    await announceRepoRefs(testDatabase.database, plain.repo, new Date());
    s.later(INTERVAL_MS + 1000);
    const plainAddress = `/gh/${plain.repository.owner.login}/${plain.repository.name}`;
    expect(addressesOf(await s.looked())).not.toContain(plainAddress);

    // A pinned commit never moves: it is no ref to look at, however old its confirmation.
    const pinned = await s.open("/gh/acme/hostile");
    await s.open(`/gh/acme/hostile@${pinned.commit}`);
    expect(await listMovingRefs(testDatabase.database, pinned, 10)).toMatchObject([{ ref: "" }]);
  });

  it("forgets a ref the host no longer has", async () => {
    const s = setup({ variant: "ahead-gone", scope: "packs" });
    const repo = await s.open("/gh/acme/document-pack");
    await s.open("/gh/acme/document-pack@release/1.2:");
    expect(
      (await listMovingRefs(testDatabase.database, repo, 10)).map(({ ref }) => ref).sort(),
    ).toEqual(["", "release/1.2"]);
    // The owner made it private, or deleted it: the host answers the deployment with nothing.
    s.host.hide("document-pack");
    s.later(INTERVAL_MS + 1000);
    const [job] = (await s.looked()).filter(({ job }) => job.address === "/gh/acme/document-pack");
    if (job === undefined) throw new Error("no look was queued");
    expect(await s.ahead.run(job.job)).toMatchObject({ refs: 2, gone: 2, indexed: 0 });
    expect(await listMovingRefs(testDatabase.database, repo, 10)).toEqual([]);
    expect(addressesOf(await s.looked())).not.toContain("/gh/acme/document-pack");
  });

  it("finds the packs of the deployment's directory on disk, and reads a changed one again", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillcdn-ahead-"));
    try {
      mkdirSync(join(root, "harbour", "handbook"), { recursive: true });
      mkdirSync(join(root, ".hidden", "pack"), { recursive: true });
      writeFileSync(join(root, "harbour", "handbook", "README.md"), "# Handbook\n\nTides.\n");
      const s = setup({ variant: "ahead-local", packsRoot: root });
      // Nobody asked for it: the pass finds the directory, and names it as an address does.
      const found = (await s.looked()).filter(({ job }) => job.address.startsWith("/local/"));
      expect(found).toMatchObject([
        { job: { address: "/local/harbour/handbook" }, options: { priority: 0 } },
      ]);
      const [first] = found;
      if (first === undefined) throw new Error("no look was queued");
      expect(first.job.repoId).toBeUndefined();
      expect(await s.ahead.run(first.job)).toMatchObject({ refs: 1, indexed: 1 });
      const known = await findRepoByAlias(testDatabase.database, {
        host: "local",
        owner: "harbour",
        repo: "handbook",
      });
      expect(known).toBeDefined();
      // Known now, and just read: not found again, and not due.
      expect(
        (await s.looked()).filter(({ job }) => job.address.startsWith("/local/")),
      ).toHaveLength(0);

      // A file changes. Nothing announces it: the pack is read again when its time is up.
      writeFileSync(join(root, "harbour", "handbook", "README.md"), "# Handbook\n\nCurrents.\n");
      s.later(INTERVAL_MS + 1000);
      const [again] = (await s.looked()).filter(({ job }) =>
        job.address.startsWith("/local/harbour/"),
      );
      expect(again?.job.repoId).toBe(known?.id);
      if (again === undefined) throw new Error("no look was queued");
      expect(await s.ahead.run(again.job)).toMatchObject({ refs: 1, indexed: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves a host alone that gives no answer, and asks again later", async () => {
    const s = setup({ variant: "ahead-outage", scope: "packs" });
    // A repository no other test of this file looks at: their clocks are not this one's.
    await s.open("/gh/acme/specification-pack");
    s.later(INTERVAL_MS + 1000);
    const [job] = (await s.looked()).filter(
      ({ job }) => job.address === "/gh/acme/specification-pack",
    );
    if (job === undefined) throw new Error("no look was queued");
    s.host.fail("resolveRef");
    // The last answer is too old to stand in: the look fails, and the queue tries it again.
    await expect(s.ahead.run(job.job)).rejects.toBeInstanceOf(MountError);
    // Until the host is asked again, nothing of it is queued, and a job that waited is refused.
    expect(addressesOf(await s.looked()).filter((a) => a.startsWith("/gh/"))).toEqual([]);
    await expect(s.ahead.run(job.job)).rejects.toThrow(/left alone/);
    s.later(HOST_PAUSE_MS + 1000);
    expect(addressesOf(await s.looked())).toContain("/gh/acme/specification-pack");
  });

  it("indexes nothing from an answer that stands in for the host's, and leaves the host alone", async () => {
    const s = setup({ variant: "ahead-borrowed", scope: "packs" });
    const repo = await s.open("/gh/acme/multilingual-pack");
    // A push is announced, and the host stops answering before anyone has asked it.
    await announceRepoRefs(testDatabase.database, repo, s.clock.now());
    s.later(2 * 60_000);
    const [job] = (await s.looked()).filter(
      ({ job }) => job.address === "/gh/acme/multilingual-pack",
    );
    if (job === undefined) throw new Error("no look was queued");
    s.host.fail("resolveRef");
    // The answer of two minutes ago still stands in for a request; the look takes nothing from it.
    expect(await s.ahead.run(job.job)).toEqual({
      refs: 1,
      indexed: 0,
      failed: 0,
      gone: 0,
      unanswered: true,
    });
    expect(addressesOf(await s.looked()).filter((a) => a.startsWith("/gh/"))).toEqual([]);
  });
});

describe("the worker role, with the indexing ahead of requests on", () => {
  const SETTINGS = {
    [EMBED_QUEUE]: { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 },
    [INDEX_QUEUE]: { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 },
    [SWEEP_QUEUE]: { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 },
    [AHEAD_QUEUE]: { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 },
    [LOOK_QUEUE]: { retryLimit: 0, retryDelaySeconds: 1, expireInSeconds: 60 },
    [PRUNE_QUEUE]: { retryLimit: 0, retryDelaySeconds: 1, expireInSeconds: 60 },
  } satisfies typeof QUEUE_SETTINGS;
  let own: TestDatabase;
  let jobs: JobQueue;
  let worker: Worker;
  const host = createFixtureHost("ahead-role");
  const errors: Error[] = [];

  beforeAll(async () => {
    own = await createTestDatabase(DEV_DATABASE_URL);
    jobs = await createJobQueue(own.database, {
      role: "worker",
      onError: (error) => errors.push(error),
    });
    worker = createWorker(
      {
        mounts: { repoTtlMs: 60_000, refTtlMs: 60_000 },
        indexing: {
          waitMs: 10_000,
          concurrency: 2,
          leaseMs: 60_000,
          ahead: { scope: "listed", intervalMs: INTERVAL_MS, limit: 50 },
          retentionMs: 30 * 86_400_000,
          limits: LIMITS,
        },
        embedConcurrency: 1,
        scope: "none",
      },
      {
        database: own.database,
        jobs,
        gitHost: host,
        embedder: undefined,
        clock: { now: () => new Date() },
        logger,
        pollSeconds: 0.5,
      },
    );
    // The designated indexing always; the looks ahead and the hourly removal of the indexes
    // nothing keeps, as this deployment configures them; no embedding without an embedder.
    expect((await worker.start()).queues).toEqual([
      INDEX_QUEUE,
      AHEAD_QUEUE,
      LOOK_QUEUE,
      PRUNE_QUEUE,
    ]);
    await ensureJobQueues(jobs, SETTINGS);
  });
  afterAll(async () => {
    await worker?.close(5000);
    await own?.drop();
  });

  it("runs a look from the queue: a pushed commit is indexed with nobody asking", async () => {
    const address = parseAddress("/gh/acme/with-manifest");
    if (!address.ok) throw new Error("not an address");
    const mount = await worker.mounts.resolve(address.value);
    expect((await worker.snapshots.ready(mount, 10_000)).status).toBe("ready");
    const repo = { accountId: mount.repo.accountId, repoId: mount.repo.id };
    const pushed = host.push();
    // What the event of the push does, and then what the pass does when it finds the note.
    await new HostEvents({
      database: own.database,
      clock: { now: () => new Date() },
      host: "gh",
      repoTtlMs: 60_000,
      refTtlMs: 60_000,
    }).apply({ kind: "refs_changed", hostRepoId: fixtureRepoId("with-manifest") });
    expect(await sendAheadJob(jobs, { address: "/gh/acme/with-manifest", ...repo }, true)).toBe(
      true,
    );
    await vi.waitFor(
      async () => {
        expect(await findSnapshotOfCommit(own.database, repo, pushed)).toMatchObject({
          status: "ready",
        });
      },
      { timeout: 20_000, interval: 250 },
    );
    expect(errors).toEqual([]);
  });
});
