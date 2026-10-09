import { type HostRepository, type IndexEntry, NO_LICENSE } from "@skillcdn/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimSnapshot,
  countUnusedOAuthClients,
  createOAuthGrant,
  createRepoToken,
  createSession,
  type Database,
  deleteExpiredOAuth,
  deleteExpiredRepoTokens,
  deleteExpiredSessions,
  deleteOAuthGrant,
  deleteRepoPermissionsOf,
  deleteRepoToken,
  deleteSession,
  deleteStaleRepoPermissions,
  deleteUnusedOAuthClients,
  deleteUserCredentials,
  ensureSnapshot,
  findOAuthAccess,
  findOAuthClient,
  findRepoByAlias,
  findRepoPermission,
  findRepoTokenAccess,
  findSession,
  findUser,
  findUserByHostAccount,
  forgetUserAccess,
  getUserCredentials,
  listIndexedRepositories,
  listOAuthGrants,
  listRepoTokens,
  markRepositoryNotPublic,
  type OAuthTokenPair,
  revokeOAuthToken,
  rotateOAuthRefresh,
  saveCachedRef,
  saveLogin,
  saveOAuthClient,
  saveOAuthCode,
  saveRepoPermission,
  saveRepository,
  saveUserCredentials,
  takeOAuthCode,
  touchOAuthGrant,
  touchRepoToken,
  touchSession,
  writeSnapshotIndex,
} from "./index.js";
import { createTestDatabase, DEV_DATABASE_URL, type TestDatabase } from "./testing.js";

let testDatabase: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDatabase = await createTestDatabase(process.env.TEST_DATABASE_URL ?? DEV_DATABASE_URL);
  database = testDatabase.database;
});

afterAll(async () => {
  await testDatabase?.drop();
});

const T0 = new Date("2026-10-01T00:00:00Z");
const minutes = (count: number) => new Date(T0.getTime() + count * 60_000);

let nextId = 5000;
const unique = () => {
  nextId += 1;
  return nextId;
};

function signedIn(login = `person-${unique()}`) {
  return saveLogin(database, {
    host: "gh",
    user: { hostAccountId: String(unique()), login, name: "A Person" },
    now: T0,
  });
}

function registered(redirectUris = ["https://client.example/callback"]) {
  return saveOAuthClient(
    database,
    {
      clientId: `scdn_client_${unique()}`,
      source: "registration",
      name: "A client",
      uri: undefined,
      redirectUris,
      authMethod: "none",
      secretHash: undefined,
      freshUntil: undefined,
    },
    T0,
  );
}

const pair = (expiresInMinutes = 60): OAuthTokenPair => {
  const id = unique();
  return {
    accessHash: `access-${id}`,
    accessExpiresAt: minutes(expiresInMinutes),
    refreshHash: `refresh-${id}`,
    refreshExpiresAt: minutes(expiresInMinutes * 24),
  };
};

async function granted(tokens = pair()) {
  const user = await signedIn();
  const client = await registered();
  const grantId = await createOAuthGrant(
    database,
    {
      userId: user.id,
      oauthClientId: client.id,
      address: "/gh/acme/skills",
      resource: "https://skills.example/gh/acme/skills",
      scope: "read",
    },
    tokens,
    { grantsPerUser: 100 },
  );
  return { user, client, grantId, tokens };
}

describe("people", () => {
  it("are one user per account of the git host, whatever they are called today", async () => {
    const hostAccountId = String(unique());
    const first = await saveLogin(database, {
      host: "gh",
      user: { hostAccountId, login: "old-name", name: undefined },
      now: T0,
    });
    const renamed = await saveLogin(database, {
      host: "gh",
      user: { hostAccountId, login: "new-name", name: "Their Name" },
      now: minutes(5),
    });
    expect(renamed.id).toBe(first.id);
    expect(await findUser(database, first.id)).toEqual({
      id: first.id,
      accountId: first.accountId,
      host: "gh",
      hostAccountId,
      login: "new-name",
      name: "Their Name",
    });
    expect(await findUser(database, "00000000-0000-7000-8000-000000000000")).toBeUndefined();
  });

  it("is the account a repository of theirs already hangs off", async () => {
    const hostAccountId = String(unique());
    const repository: HostRepository = {
      hostRepoId: String(unique()),
      name: "notes",
      defaultBranch: "main",
      description: undefined,
      visibility: "public",
      owner: { hostAccountId, login: "writer", kind: "user" },
    };
    const repo = await saveRepository(
      database,
      { host: "gh", owner: "writer", repo: "notes" },
      repository,
      T0,
    );
    const user = await saveLogin(database, {
      host: "gh",
      user: { hostAccountId, login: "writer", name: undefined },
      now: T0,
    });
    expect(user.accountId).toBe(repo.accountId);
  });

  it("have one credential of the git host at a time, replaced as a whole", async () => {
    const user = await signedIn();
    expect(await getUserCredentials(database, user.id)).toBeUndefined();
    await saveUserCredentials(
      database,
      user.id,
      {
        accessToken: "sealed-access-1",
        accessExpiresAt: minutes(480),
        refreshToken: "sealed-refresh-1",
        refreshExpiresAt: minutes(100_000),
      },
      T0,
    );
    await saveUserCredentials(
      database,
      user.id,
      {
        accessToken: "sealed-access-2",
        accessExpiresAt: undefined,
        refreshToken: undefined,
        refreshExpiresAt: undefined,
      },
      minutes(1),
    );
    expect(await getUserCredentials(database, user.id)).toEqual({
      accessToken: "sealed-access-2",
      accessExpiresAt: undefined,
      refreshToken: undefined,
      refreshExpiresAt: undefined,
    });
    // Forgotten only while it is still the one that was found unusable.
    expect(await deleteUserCredentials(database, user.id, { accessToken: "sealed-access-1" })).toBe(
      false,
    );
    expect(await getUserCredentials(database, user.id)).toBeDefined();
    expect(await deleteUserCredentials(database, user.id, { accessToken: "sealed-access-2" })).toBe(
      true,
    );
    expect(await getUserCredentials(database, user.id)).toBeUndefined();
  });
});

describe("sessions", () => {
  it("name their user until they expire or are ended", async () => {
    const user = await signedIn("session-person");
    await createSession(database, {
      userId: user.id,
      tokenHash: "session-hash-1",
      expiresAt: minutes(60),
      now: T0,
    });
    const found = await findSession(database, "session-hash-1", minutes(59));
    expect(found).toMatchObject({ user: { id: user.id, login: "session-person" } });
    expect(found?.lastSeenAt).toEqual(T0);
    expect(await findSession(database, "session-hash-1", minutes(60))).toBeUndefined();
    expect(await findSession(database, "another-hash", T0)).toBeUndefined();

    // Used again, it lives on.
    await touchSession(database, found?.id ?? "", { now: minutes(30), expiresAt: minutes(90) });
    expect((await findSession(database, "session-hash-1", minutes(61)))?.lastSeenAt).toEqual(
      minutes(30),
    );
    expect(await deleteSession(database, "session-hash-1")).toBe(true);
    expect(await deleteSession(database, "session-hash-1")).toBe(false);
    expect(await findSession(database, "session-hash-1", T0)).toBeUndefined();
  });

  it("are removed once they have expired, and only then", async () => {
    const user = await signedIn();
    await createSession(database, {
      userId: user.id,
      tokenHash: "expiring-1",
      expiresAt: minutes(10),
      now: T0,
    });
    await createSession(database, {
      userId: user.id,
      tokenHash: "expiring-2",
      expiresAt: minutes(20),
      now: T0,
    });
    expect(await deleteExpiredSessions(database, minutes(10))).toBeGreaterThanOrEqual(1);
    expect(await findSession(database, "expiring-2", minutes(15))).toBeDefined();
  });
});

describe("clients", () => {
  it("are stored under their identifier, and a document's copy is replaced in place", async () => {
    const id = `https://client.example/${unique()}/client.json`;
    const first = await saveOAuthClient(
      database,
      {
        clientId: id,
        source: "document",
        name: "Before",
        uri: "https://client.example/",
        redirectUris: ["https://client.example/a"],
        authMethod: "none",
        secretHash: undefined,
        freshUntil: minutes(60),
      },
      T0,
    );
    const second = await saveOAuthClient(
      database,
      {
        clientId: id,
        source: "document",
        name: "After",
        uri: undefined,
        redirectUris: ["https://client.example/b"],
        authMethod: "none",
        secretHash: undefined,
        freshUntil: minutes(120),
      },
      minutes(61),
    );
    // The row keeps its id, so what was granted before the document changed still names it.
    expect(second.id).toBe(first.id);
    expect(await findOAuthClient(database, id)).toEqual({
      id: first.id,
      clientId: id,
      source: "document",
      name: "After",
      uri: undefined,
      redirectUris: ["https://client.example/b"],
      authMethod: "none",
      secretHash: undefined,
      freshUntil: minutes(120),
    });
    expect(await findOAuthClient(database, "scdn_client_nobody")).toBeUndefined();
  });

  it("are removed when nobody ever allowed them anything, and kept when somebody did", async () => {
    const unused = await registered();
    const { client: used } = await granted();
    const pending = await registered();
    const user = await signedIn();
    await saveOAuthCode(database, {
      codeHash: `code-${unique()}`,
      oauthClientId: pending.id,
      userId: user.id,
      redirectUri: "https://client.example/callback",
      codeChallenge: "challenge",
      scope: "read",
      resource: "https://skills.example/gh/acme/skills",
      address: "/gh/acme/skills",
      expiresAt: minutes(1),
    });
    // Too young to be given up on.
    await deleteUnusedOAuthClients(database, new Date(T0.getTime() - 1));
    expect(await findOAuthClient(database, unused.clientId)).toBeDefined();
    expect(await deleteUnusedOAuthClients(database, minutes(1))).toBeGreaterThanOrEqual(1);
    expect(await findOAuthClient(database, unused.clientId)).toBeUndefined();
    expect(await findOAuthClient(database, used.clientId)).toBeDefined();
    expect(await findOAuthClient(database, pending.clientId)).toBeDefined();
  });

  it("are counted while nobody has allowed them anything", async () => {
    const before = await countUnusedOAuthClients(database);
    await registered();
    await registered();
    await granted();
    // Two that only registered; the one somebody allowed something is not one of them.
    expect(await countUnusedOAuthClients(database)).toBe(before + 2);
  });
});

describe("authorization codes", () => {
  it("are taken once, and not at all once expired", async () => {
    const user = await signedIn();
    const client = await registered();
    const code = {
      oauthClientId: client.id,
      userId: user.id,
      redirectUri: "https://client.example/callback",
      codeChallenge: "challenge",
      scope: "read",
      resource: "https://skills.example/gh/acme/skills",
      address: "/gh/acme/skills",
    };
    await saveOAuthCode(database, { ...code, codeHash: "code-once", expiresAt: minutes(1) });
    expect(await takeOAuthCode(database, "code-once", T0)).toEqual(code);
    expect(await takeOAuthCode(database, "code-once", T0)).toBeUndefined();

    await saveOAuthCode(database, { ...code, codeHash: "code-late", expiresAt: minutes(1) });
    expect(await takeOAuthCode(database, "code-late", minutes(1))).toBeUndefined();
    // Presenting it spent it, late as it was.
    expect(await takeOAuthCode(database, "code-late", T0)).toBeUndefined();
    expect(await takeOAuthCode(database, "code-never", T0)).toBeUndefined();
  });

  it("go two ways at once to exactly one of them", async () => {
    const user = await signedIn();
    const client = await registered();
    await saveOAuthCode(database, {
      codeHash: "code-raced",
      oauthClientId: client.id,
      userId: user.id,
      redirectUri: "https://client.example/callback",
      codeChallenge: "challenge",
      scope: "read",
      resource: "https://skills.example/gh/acme/skills",
      address: "/gh/acme/skills",
      expiresAt: minutes(1),
    });
    const taken = await Promise.all(
      Array.from({ length: 5 }, () => takeOAuthCode(database, "code-raced", T0)),
    );
    expect(taken.filter((result) => result !== undefined)).toHaveLength(1);
  });
});

describe("grants and their tokens", () => {
  it("answer for their access token while it lasts, at the address they are for", async () => {
    const { user, grantId, tokens } = await granted(pair(60));
    expect(await findOAuthAccess(database, tokens.accessHash, minutes(59))).toEqual({
      grantId,
      user,
      address: "/gh/acme/skills",
      scope: "read",
      expiresAt: tokens.accessExpiresAt,
      lastUsedAt: undefined,
    });
    expect(await findOAuthAccess(database, tokens.accessHash, minutes(60))).toBeUndefined();
    expect(await findOAuthAccess(database, tokens.refreshHash, T0)).toBeUndefined();
    await touchOAuthGrant(database, grantId, minutes(3));
    expect((await findOAuthAccess(database, tokens.accessHash, T0))?.lastUsedAt).toEqual(
      minutes(3),
    );
  });

  it("give the next pair for a refresh token, once, to the client it was issued to", async () => {
    const { client, grantId, tokens } = await granted();
    const stranger = await registered();
    const next = pair();
    const rotate = (refreshHash: string, clientId: string, at: Date, with_ = pair()) =>
      rotateOAuthRefresh(database, {
        refreshHash,
        oauthClientId: clientId,
        next: with_,
        now: at,
        reuseGraceMs: 60_000,
        keepPairs: 8,
      });

    expect(await rotate(tokens.refreshHash, stranger.id, T0)).toEqual({ status: "invalid" });
    expect(await rotate("refresh-never", client.id, T0)).toEqual({ status: "invalid" });
    expect(await rotate(tokens.refreshHash, client.id, minutes(1), next)).toEqual({
      status: "rotated",
      grant: { id: grantId, resource: "https://skills.example/gh/acme/skills", scope: "read" },
    });
    expect(await findOAuthAccess(database, next.accessHash, minutes(1))).toBeDefined();
    // The pair that came before keeps its access token until it runs out.
    expect(await findOAuthAccess(database, tokens.accessHash, minutes(1))).toBeDefined();

    // Again within the grace: a retry, which gets a pair of its own.
    const retried = pair();
    expect((await rotate(tokens.refreshHash, client.id, minutes(1.5), retried)).status).toBe(
      "rotated",
    );
    // Again after it: somebody else has the token, and the whole grant goes.
    expect(await rotate(tokens.refreshHash, client.id, minutes(3))).toEqual({ status: "reused" });
    for (const hash of [tokens.accessHash, next.accessHash, retried.accessHash]) {
      expect(await findOAuthAccess(database, hash, minutes(3))).toBeUndefined();
    }
    expect(await rotate(next.refreshHash, client.id, minutes(3))).toEqual({ status: "invalid" });
  });

  it("refuse a refresh token that has expired", async () => {
    const { client, tokens } = await granted(pair(1));
    expect(
      await rotateOAuthRefresh(database, {
        refreshHash: tokens.refreshHash,
        oauthClientId: client.id,
        next: pair(),
        now: minutes(24),
        reuseGraceMs: 60_000,
        keepPairs: 8,
      }),
    ).toEqual({ status: "invalid" });
  });

  it("hand one token to two exchanges at once without losing either", async () => {
    const { client, tokens } = await granted();
    const outcomes = await Promise.all(
      [pair(), pair(), pair()].map((next) =>
        rotateOAuthRefresh(database, {
          refreshHash: tokens.refreshHash,
          oauthClientId: client.id,
          next,
          now: minutes(1),
          reuseGraceMs: 60_000,
          keepPairs: 8,
        }),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rotated", "rotated", "rotated"]);
  });

  it("keep a handful of pairs each, however often a token is presented again", async () => {
    const { client, tokens } = await granted();
    const present = (refreshHash: string, next: OAuthTokenPair, at: Date) =>
      rotateOAuthRefresh(database, {
        refreshHash,
        oauthClientId: client.id,
        next,
        now: at,
        reuseGraceMs: 60_000,
        keepPairs: 4,
      });
    // The same refresh token again and again within the grace: a pair of its own each time,
    // until the grant holds four pairs and the token presented is no longer one of them.
    const issued: OAuthTokenPair[] = [];
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const next = pair();
      issued.push(next);
      outcomes.push((await present(tokens.refreshHash, next, minutes(1))).status);
    }
    expect(outcomes).toEqual([
      ...Array.from({ length: 4 }, () => "rotated"),
      ...Array.from({ length: 8 }, () => "invalid"),
    ]);
    const alive: boolean[] = [];
    for (const one of [tokens, ...issued]) {
      alive.push((await findOAuthAccess(database, one.accessHash, minutes(1))) !== undefined);
    }
    // Thirteen pairs were asked for. The four issued last are all there is.
    expect(alive).toEqual([
      false,
      true,
      true,
      true,
      true,
      ...Array.from({ length: 8 }, () => false),
    ]);
    // The newest still renews, and the oldest makes room for what it gets.
    expect((await present(issued[3]?.refreshHash ?? "", pair(), minutes(2))).status).toBe(
      "rotated",
    );
    expect(
      await findOAuthAccess(database, issued[0]?.accessHash ?? "", minutes(2)),
    ).toBeUndefined();
    expect(await findOAuthAccess(database, issued[3]?.accessHash ?? "", minutes(2))).toBeDefined();
  });

  it("are bounded per user: allowing one more ends the one used longest ago", async () => {
    const user = await signedIn();
    const client = await registered();
    const grant = (address: string, tokens: OAuthTokenPair) =>
      createOAuthGrant(
        database,
        {
          userId: user.id,
          oauthClientId: client.id,
          address,
          resource: `https://skills.example${address}`,
          scope: "read",
        },
        tokens,
        { grantsPerUser: 3 },
      );
    const first = pair();
    const firstId = await grant("/gh/acme/one", first);
    const second = pair();
    await grant("/gh/acme/two", second);
    await grant("/gh/acme/three", pair());
    // The oldest is the one in use, so it is not the one that goes.
    await touchOAuthGrant(database, firstId, new Date(Date.now() + 60_000));
    await grant("/gh/acme/four", pair());

    const addresses = (await listOAuthGrants(database, user.id, T0)).map((entry) => entry.address);
    expect(addresses.sort()).toEqual(["/gh/acme/four", "/gh/acme/one", "/gh/acme/three"]);
    expect(await findOAuthAccess(database, first.accessHash, T0)).toBeDefined();
    expect(await findOAuthAccess(database, second.accessHash, T0)).toBeUndefined();
    // Somebody else's grants are their own.
    const { tokens: others } = await granted();
    await grant("/gh/acme/five", pair());
    expect(await findOAuthAccess(database, others.accessHash, T0)).toBeDefined();
  });

  it("are listed for their user, newest first, and taken back by nobody else", async () => {
    const { user, client, grantId, tokens } = await granted();
    const other = await signedIn();
    expect(await listOAuthGrants(database, other.id, T0)).toEqual([]);
    const listed = await listOAuthGrants(database, user.id, T0);
    expect(listed).toEqual([
      {
        id: grantId,
        client: { name: "A client", uri: undefined },
        address: "/gh/acme/skills",
        createdAt: expect.any(Date),
        lastUsedAt: undefined,
      },
    ]);
    // Past the end of its refresh token there is nothing left to list.
    expect(await listOAuthGrants(database, user.id, tokens.refreshExpiresAt)).toEqual([]);

    expect(await deleteOAuthGrant(database, { userId: other.id, grantId })).toBe(false);
    expect(
      await revokeOAuthToken(database, {
        tokenHash: tokens.accessHash,
        oauthClientId: "00000000-0000-7000-8000-000000000000",
      }),
    ).toBe(false);
    expect(await findOAuthAccess(database, tokens.accessHash, T0)).toBeDefined();
    expect(await deleteOAuthGrant(database, { userId: user.id, grantId })).toBe(true);
    expect(await findOAuthAccess(database, tokens.accessHash, T0)).toBeUndefined();
    expect(await findOAuthClient(database, client.clientId)).toBeDefined();
  });

  it("are revoked by either of their tokens, by the client that holds them", async () => {
    for (const which of ["accessHash", "refreshHash"] as const) {
      const { client, tokens } = await granted();
      expect(
        await revokeOAuthToken(database, { tokenHash: tokens[which], oauthClientId: client.id }),
      ).toBe(true);
      expect(await findOAuthAccess(database, tokens.accessHash, T0)).toBeUndefined();
      expect(
        await revokeOAuthToken(database, { tokenHash: tokens[which], oauthClientId: client.id }),
      ).toBe(false);
    }
  });

  it("go with everything else a user had when the git host stops vouching for them", async () => {
    const { user, tokens } = await granted();
    await createSession(database, {
      userId: user.id,
      tokenHash: `session-${unique()}`,
      expiresAt: minutes(60),
      now: T0,
    });
    await forgetUserAccess(database, user.id);
    expect(await findOAuthAccess(database, tokens.accessHash, T0)).toBeUndefined();
    expect(await listOAuthGrants(database, user.id, T0)).toEqual([]);
    // The user is still who they are, for the next time they sign in.
    expect(await findUser(database, user.id)).toBeDefined();
  });

  it("are removed once nothing can renew them", async () => {
    const { tokens } = await granted(pair(1));
    const removed = await deleteExpiredOAuth(database, minutes(25));
    expect(removed.grants).toBeGreaterThanOrEqual(1);
    expect(await findOAuthAccess(database, tokens.accessHash, T0)).toBeUndefined();
  });
});

describe("the permission cache", () => {
  it("keeps the host's last answer for a user and a repository, with when it was given", async () => {
    const user = await signedIn();
    const repo = await saveRepository(
      database,
      { host: "gh", owner: "acme", repo: `private-${unique()}` },
      {
        hostRepoId: String(unique()),
        name: "private",
        defaultBranch: "main",
        description: undefined,
        visibility: "private",
        owner: { hostAccountId: "9001", login: "Acme", kind: "organization" },
      },
      T0,
    );
    const scope = { userId: user.id, repoId: repo.id };
    expect(await findRepoPermission(database, scope)).toBeUndefined();
    await saveRepoPermission(database, scope, true, T0);
    expect(await findRepoPermission(database, scope)).toEqual({ allowed: true, checkedAt: T0 });
    await saveRepoPermission(database, scope, false, minutes(2));
    expect(await findRepoPermission(database, scope)).toEqual({
      allowed: false,
      checkedAt: minutes(2),
    });
    // Another user's answer is not this one's.
    const other = await signedIn();
    expect(await findRepoPermission(database, { ...scope, userId: other.id })).toBeUndefined();

    expect(await deleteStaleRepoPermissions(database, minutes(2))).toBe(0);
    expect(await deleteStaleRepoPermissions(database, minutes(3))).toBeGreaterThanOrEqual(1);
    expect(await findRepoPermission(database, scope)).toBeUndefined();
  });
});

describe("repository tokens", () => {
  const privateRepo = () =>
    saveRepository(
      database,
      { host: "gh", owner: "acme", repo: `tokens-${unique()}` },
      {
        hostRepoId: String(unique()),
        name: "tokens",
        defaultBranch: "main",
        description: undefined,
        visibility: "private",
        owner: { hostAccountId: "9001", login: "Acme", kind: "organization" },
      },
      T0,
    );
  const input = (userId: string, repoId: string, patch: { expiresAt?: Date; now?: Date } = {}) => ({
    userId,
    repoId,
    address: "/gh/acme/tokens",
    label: "The nightly job",
    tokenHash: `hash-${unique()}`,
    expiresAt: patch.expiresAt ?? minutes(60),
    now: patch.now ?? T0,
  });

  it("answer for their hash while they last, with who made them and where they are good", async () => {
    const user = await signedIn();
    const repo = await privateRepo();
    const made = input(user.id, repo.id);
    const record = await createRepoToken(database, made, 10);
    expect(record).toEqual({
      id: expect.any(String),
      repoId: repo.id,
      address: "/gh/acme/tokens",
      label: "The nightly job",
      createdAt: T0,
      expiresAt: minutes(60),
      lastUsedAt: undefined,
    });
    expect(await findRepoTokenAccess(database, made.tokenHash, minutes(59))).toEqual({
      tokenId: record?.id,
      user,
      repoId: repo.id,
      address: "/gh/acme/tokens",
      lastUsedAt: undefined,
    });
    expect(await findRepoTokenAccess(database, made.tokenHash, minutes(60))).toBeUndefined();
    expect(await findRepoTokenAccess(database, "another-hash", T0)).toBeUndefined();

    await touchRepoToken(database, record?.id ?? "", minutes(5));
    expect((await findRepoTokenAccess(database, made.tokenHash, minutes(6)))?.lastUsedAt).toEqual(
      minutes(5),
    );
    expect((await listRepoTokens(database, user.id, minutes(6)))[0]?.lastUsedAt).toEqual(
      minutes(5),
    );
  });

  it("are listed for their maker, newest first, and taken back by nobody else", async () => {
    const [user, other] = [await signedIn(), await signedIn()];
    const repo = await privateRepo();
    const first = await createRepoToken(database, input(user.id, repo.id), 10);
    const second = await createRepoToken(
      database,
      input(user.id, repo.id, { now: minutes(1), expiresAt: minutes(30) }),
      10,
    );
    expect((await listRepoTokens(database, user.id, minutes(2))).map((token) => token.id)).toEqual([
      second?.id,
      first?.id,
    ]);
    // One that has expired is on no list.
    expect((await listRepoTokens(database, user.id, minutes(30))).map((token) => token.id)).toEqual(
      [first?.id],
    );
    expect(await listRepoTokens(database, other.id, minutes(2))).toEqual([]);

    const tokenId = first?.id ?? "";
    expect(await deleteRepoToken(database, { userId: other.id, tokenId })).toBe(false);
    expect(await deleteRepoToken(database, { userId: user.id, tokenId })).toBe(true);
    expect(await deleteRepoToken(database, { userId: user.id, tokenId })).toBe(false);
    expect((await listRepoTokens(database, user.id, minutes(2))).map((token) => token.id)).toEqual([
      second?.id,
    ]);
  });

  it("are bounded per user: one more than the limit is not stored, and none is ended for it", async () => {
    const user = await signedIn();
    const repo = await privateRepo();
    const short = input(user.id, repo.id, { expiresAt: minutes(10) });
    expect(await createRepoToken(database, short, 2)).toBeDefined();
    expect(await createRepoToken(database, input(user.id, repo.id), 2)).toBeDefined();
    expect(await createRepoToken(database, input(user.id, repo.id), 2)).toBeUndefined();
    expect(await listRepoTokens(database, user.id, minutes(1))).toHaveLength(2);
    expect(await findRepoTokenAccess(database, short.tokenHash, minutes(1))).toBeDefined();
    // One that has expired does not count against its maker, and another user's never does.
    expect(
      await createRepoToken(database, input(user.id, repo.id, { now: minutes(10) }), 2),
    ).toBeDefined();
    const other = await signedIn();
    expect(await createRepoToken(database, input(other.id, repo.id), 1)).toBeDefined();
  });

  it("are removed once they have expired, and go with everything else their maker had", async () => {
    const user = await signedIn();
    const repo = await privateRepo();
    const brief = input(user.id, repo.id, { expiresAt: minutes(5) });
    const lasting = input(user.id, repo.id);
    await createRepoToken(database, brief, 10);
    await createRepoToken(database, lasting, 10);
    expect(await deleteExpiredRepoTokens(database, minutes(4))).toBe(0);
    expect(await deleteExpiredRepoTokens(database, minutes(5))).toBeGreaterThanOrEqual(1);
    expect(await findRepoTokenAccess(database, lasting.tokenHash, minutes(6))).toBeDefined();

    await forgetUserAccess(database, user.id);
    expect(await findRepoTokenAccess(database, lasting.tokenHash, minutes(6))).toBeUndefined();
    expect(await listRepoTokens(database, user.id, minutes(6))).toEqual([]);
  });
});

describe("what an event of the git host ends", () => {
  it("every answer about a repository, for everyone, and nothing about any other", async () => {
    const [alice, bob] = [await signedIn(), await signedIn()];
    const repoOf = (name: string) =>
      saveRepository(
        database,
        { host: "gh", owner: "acme", repo: `${name}-${unique()}` },
        {
          hostRepoId: String(unique()),
          name,
          defaultBranch: "main",
          description: undefined,
          visibility: "private",
          owner: { hostAccountId: "9001", login: "Acme", kind: "organization" },
        },
        T0,
      );
    const [first, second, third] = [await repoOf("a"), await repoOf("b"), await repoOf("c")];
    for (const user of [alice, bob]) {
      for (const repo of [first, second, third]) {
        await saveRepoPermission(database, { userId: user.id, repoId: repo.id }, true, T0);
      }
    }
    expect(await deleteRepoPermissionsOf(database, [])).toBe(0);
    expect(await deleteRepoPermissionsOf(database, [first.id, second.id])).toBe(4);
    for (const user of [alice, bob]) {
      const answer = (repo: { id: string }) =>
        findRepoPermission(database, { userId: user.id, repoId: repo.id });
      expect(await answer(first)).toBeUndefined();
      expect(await answer(second)).toBeUndefined();
      expect(await answer(third)).toMatchObject({ allowed: true });
    }
  });

  it("finds the person an account of the host is here, when it ever signed in", async () => {
    const user = await signedIn();
    expect(
      await findUserByHostAccount(database, { host: "gh", hostAccountId: user.hostAccountId }),
    ).toEqual(user);
    expect(
      await findUserByHostAccount(database, { host: "gh", hostAccountId: "no-such-account" }),
    ).toBeUndefined();
    // An account that owns repositories and never signed in is nobody here.
    expect(
      await findUserByHostAccount(database, { host: "gh", hostAccountId: "9001" }),
    ).toBeUndefined();
  });
});

describe("the indexed repositories of an account", () => {
  const entry = (path: string, patch: Partial<IndexEntry> = {}): IndexEntry => ({
    path,
    kind: "markdown",
    size: 10,
    blobSha: "0".repeat(40),
    skillDir: undefined,
    name: undefined,
    title: undefined,
    description: undefined,
    frontMatter: undefined,
    searchable: true,
    searchBody: "words",
    visible: true,
    ...patch,
  });
  const skill = (directory: string, name: string, patch: Partial<IndexEntry> = {}) =>
    entry(`${directory}/SKILL.md`, {
      kind: "skill",
      skillDir: directory,
      name,
      description: `What ${name} does.`,
      ...patch,
    });

  /** A repository with an index of its default branch, as if somebody had opened it. */
  async function indexed(
    owner: HostRepository["owner"],
    name: string,
    entries: IndexEntry[],
    options: { visibility?: "public" | "private"; status?: "ready" | "pending" } = {},
  ) {
    const repo = await saveRepository(
      database,
      { host: "gh", owner: owner.login.toLowerCase(), repo: name },
      {
        hostRepoId: String(unique()),
        name,
        defaultBranch: "main",
        description: `About ${name}.`,
        visibility: options.visibility ?? "public",
        owner,
      },
      T0,
    );
    const scope = { accountId: repo.accountId, repoId: repo.id };
    const commit = `${unique()}`.padStart(40, "a");
    await saveCachedRef(database, scope, "", commit, T0);
    const snapshot = await ensureSnapshot(database, scope, commit, 1, T0);
    if (options.status !== "pending") {
      const claim = { accountId: repo.accountId, snapshotId: snapshot.id };
      await claimSnapshot(database, claim, "owner", T0, 60_000);
      await writeSnapshotIndex(
        database,
        claim,
        "owner",
        {
          entries,
          truncated: false,
          indexedBytes: 0,
          diagnostics: [],
          license: NO_LICENSE,
          version: 1,
        },
        T0,
      );
    }
    return { repo, commit };
  }

  it("are the public ones whose default branch holds skills, most skills first", async () => {
    const owner = { hostAccountId: String(unique()), login: "Maker", kind: "user" as const };
    const big = await indexed(owner, "toolbox", [
      skill("skills/b", "bravo"),
      skill("skills/a", "alpha"),
      skill("skills/c", "charlie"),
      // A copy that is listed nowhere is not a skill anyone can find.
      skill(".agents/a", "alpha", { searchable: false }),
      // One the manifest leaves out is known to the index and served by nothing.
      skill("drafts/d", "delta", { visible: false }),
      entry("SKILLCDN.md", {
        kind: "manifest",
        name: "The Toolbox",
        description: "Tools for the job.",
        frontMatter: {
          metadata: {},
          warnings: [],
          image: "art/cover.png",
          translations: { ko: { name: "도구 상자" } },
        },
      }),
      entry("docs/guide.md"),
    ]);
    await indexed(owner, "one-skill", [skill("skill", "solo")]);
    await indexed(owner, "docs-only", [entry("README.md")]);
    await indexed(owner, "hidden", [skill("s", "secret")], { visibility: "private" });
    await indexed(owner, "unfinished", [skill("s", "later")], { status: "pending" });
    // Another account's repositories are another account's.
    await indexed({ hostAccountId: String(unique()), login: "Other", kind: "user" }, "elsewhere", [
      skill("s", "theirs"),
    ]);

    const listed = await listIndexedRepositories(
      database,
      { host: "gh", hostAccountId: owner.hostAccountId },
      { repositories: 10, skillNames: 2 },
    );
    expect(listed.map((repository) => repository.name)).toEqual(["toolbox", "one-skill"]);
    expect(listed[0]).toEqual({
      host: "gh",
      owner: "Maker",
      name: "toolbox",
      hostRepoId: big.repo.repository.hostRepoId,
      defaultBranch: "main",
      description: "About toolbox.",
      commit: big.commit,
      skillCount: 3,
      // By path, and only as many as were asked for.
      skills: ["alpha", "bravo"],
      manifest: {
        name: "The Toolbox",
        description: "Tools for the job.",
        translations: { ko: { name: "도구 상자" } },
        image: "art/cover.png",
      },
    });
    expect(listed[1]).toMatchObject({ skillCount: 1, skills: ["solo"], manifest: undefined });

    expect(
      await listIndexedRepositories(
        database,
        { host: "gh", hostAccountId: owner.hostAccountId },
        { repositories: 1, skillNames: 5 },
      ),
    ).toHaveLength(1);
    expect(
      await listIndexedRepositories(
        database,
        { host: "gh", hostAccountId: "1" },
        { repositories: 10, skillNames: 5 },
      ),
    ).toEqual([]);
  });

  it("no longer include a repository the host stopped showing to everyone", async () => {
    const owner = { hostAccountId: String(unique()), login: "Keeper", kind: "user" as const };
    const kept = await indexed(owner, "kept", [skill("s", "stays")]);
    const gone = await indexed(owner, "gone", [skill("s", "leaves")]);
    const names = async () =>
      (
        await listIndexedRepositories(
          database,
          { host: "gh", hostAccountId: owner.hostAccountId },
          { repositories: 10, skillNames: 5 },
        )
      ).map((repository) => repository.name);
    expect((await names()).sort()).toEqual(["gone", "kept"]);

    // Only within its account, like every write on tenant data.
    const stranger = await indexed(
      { hostAccountId: String(unique()), login: "Stranger", kind: "user" },
      "theirs",
      [skill("s", "other")],
    );
    await markRepositoryNotPublic(
      database,
      { accountId: stranger.repo.accountId, repoId: gone.repo.id },
      T0,
    );
    expect((await names()).sort()).toEqual(["gone", "kept"]);
    expect(kept.repo.accountId).toBe(gone.repo.accountId);
    await markRepositoryNotPublic(
      database,
      { accountId: gone.repo.accountId, repoId: gone.repo.id },
      T0,
    );
    expect(await names()).toEqual(["kept"]);
    // Its index stays for whoever may still see it; what it is to them is written when they ask.
    const alias = await findRepoByAlias(database, { host: "gh", owner: "keeper", repo: "gone" });
    expect(alias?.repository.visibility).toBe("private");
  });
});
