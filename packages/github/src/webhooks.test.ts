import { createHmac } from "node:crypto";
import { GitHostDeliveryError, type GitHostDeliveryProblem } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { createGitHubEvents } from "./webhooks.js";

// The host's deliveries cannot be recorded without a registered app: the payloads here are
// written by hand, in the shape the host documents and trimmed to a little more than what the
// reader looks at. Every id is made up.

// Made up here: what the host and a deployment would share.
const SECRET = "a webhook secret for tests, long enough to be one";
const events = createGitHubEvents({ secret: SECRET });

const sign = (body: string | Uint8Array, secret = SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function read(event: string, payload: unknown, headers: Record<string, string> = {}) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const all: Record<string, string> = {
    "x-github-event": event,
    "x-github-delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
    "x-hub-signature-256": sign(body),
    ...headers,
  };
  return events.read({ header: (name) => all[name], body });
}

function problemOf(run: () => unknown): GitHostDeliveryProblem | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GitHostDeliveryError) {
      // Nothing of the secret or of a signature is ever part of what is thrown.
      expect(`${error.message} ${error.code}`).not.toContain(SECRET);
      return error.problem;
    }
    throw error;
  }
  return undefined;
}

const repository = { id: 1_296_269, name: "skills", full_name: "acme/skills", private: true };
const organization = { id: 42, login: "acme" };

describe("the signature of a delivery", () => {
  const body = new TextEncoder().encode('{"zen":"Keep it logically awesome."}');
  const withSignature = (signature: string | undefined, bytes: Uint8Array = body) =>
    problemOf(() =>
      events.read({
        header: (name) =>
          name === "x-hub-signature-256"
            ? signature
            : name === "x-github-event"
              ? "ping"
              : undefined,
        body: bytes,
      }),
    );

  it("is the host's when it was made over these bytes with the shared secret", () => {
    expect(withSignature(sign(body))).toBeUndefined();
    expect(withSignature(sign(body).toUpperCase().replace("SHA256=", "sha256="))).toBeUndefined();
  });

  it("is nobody's otherwise, whatever the delivery says", () => {
    const good = sign(body);
    for (const signature of [
      undefined,
      "",
      "sha256=",
      good.slice(0, -1),
      `${good}0`,
      good.replace("sha256=", "sha1="),
      good.replace("sha256=", ""),
      sign(body, "another secret, as long as the real one is"),
      `sha256=${"0".repeat(64)}`,
      `sha256=${"z".repeat(64)}`,
    ]) {
      expect(withSignature(signature)).toBe("unsigned");
    }
    // The same signature over other bytes: one byte more, one byte changed.
    expect(
      withSignature(good, new TextEncoder().encode(`${new TextDecoder().decode(body)} `)),
    ).toBe("unsigned");
    expect(
      withSignature(
        good,
        body.map((byte, index) => (index === 3 ? byte ^ 1 : byte)),
      ),
    ).toBe("unsigned");
  });

  it("is verified before anything of the body is read", () => {
    // Not JSON, not even text: refused for its signature, never for what it is.
    const garbage = new Uint8Array([0xff, 0xfe, 0x00, 0x7b]);
    expect(withSignature("sha256=abc", garbage)).toBe("unsigned");
    expect(withSignature(undefined, garbage)).toBe("unsigned");
  });
});

describe("what a delivery ends", () => {
  it("names the delivery for the log, by its event and its action", () => {
    expect(read("ping", { zen: "Keep it logically awesome.", hook_id: 1 })).toEqual({
      id: "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      name: "ping",
      events: [],
    });
    expect(read("repository", { action: "renamed", repository }).name).toBe("repository.renamed");
    // What is not an action as the host writes them is not written to a log.
    expect(read("repository", { action: "re named\n", repository }).name).toBe("repository");
    expect(read("ping", {}, { "x-github-delivery": "not an id\n" }).id).toBeUndefined();
  });

  it("a push, a new branch or tag, a deleted one: the refs of the repository", () => {
    const pushed = {
      ref: "refs/heads/main",
      before: "a".repeat(40),
      after: "b".repeat(40),
      created: false,
      deleted: false,
      forced: false,
      repository,
      commits: [{ id: "b".repeat(40), message: "anything", added: ["SKILL.md"] }],
    };
    for (const [event, payload] of [
      ["push", pushed],
      ["push", { ...pushed, ref: "refs/tags/v1.2.0", deleted: true, after: "0".repeat(40) }],
      ["create", { ref: "release/1.2", ref_type: "branch", repository }],
      ["delete", { ref: "v1.0.0", ref_type: "tag", repository }],
    ] as const) {
      expect(read(event, payload).events).toEqual([
        { kind: "refs_changed", hostRepoId: "1296269" },
      ]);
    }
  });

  it("a repository that changed: what is known about it, and at once that it closed", () => {
    const changed = (action: string | undefined, event = "repository") =>
      read(event, { action, repository, changes: {} }).events;
    for (const action of ["renamed", "transferred", "edited", "archived", "unarchived"]) {
      expect(changed(action)).toEqual([
        { kind: "repository_changed", hostRepoId: "1296269", closed: undefined },
      ]);
    }
    // An event that says a repository opened is not taken at its word: the host is asked.
    expect(changed("publicized")).toEqual([
      { kind: "repository_changed", hostRepoId: "1296269", closed: undefined },
    ]);
    expect(changed(undefined, "public")).toEqual([
      { kind: "repository_changed", hostRepoId: "1296269", closed: undefined },
    ]);
    expect(changed("privatized")).toEqual([
      { kind: "repository_changed", hostRepoId: "1296269", closed: "private" },
    ]);
    expect(changed("deleted")).toEqual([
      { kind: "repository_changed", hostRepoId: "1296269", closed: "gone" },
    ]);
    expect(changed("created")).toEqual([]);
  });

  it("the app taken off an account or off repositories, or suspended", () => {
    const installation = { id: 7, account: { id: 42, login: "acme", type: "Organization" } };
    const about = (action: string) =>
      read("installation", { action, installation, repositories: [repository] }).events;
    expect(about("deleted")).toEqual([
      { kind: "installation_removed", scope: { hostAccountId: "42" } },
    ]);
    expect(about("suspend")).toEqual([{ kind: "access_changed", scope: { hostAccountId: "42" } }]);
    for (const action of ["created", "unsuspend", "new_permissions_accepted"]) {
      expect(about(action)).toEqual([]);
    }
    // A delivery that names no account is about the repositories it lists, when it lists any.
    const listed = { action: "deleted", installation: { id: 7, account: null } };
    expect(read("installation", { ...listed, repositories: [repository] }).events).toEqual([
      { kind: "installation_removed", scope: { hostRepoIds: ["1296269"] } },
    ]);
    expect(read("installation", listed).events).toEqual([]);
    expect(read("installation", { action: "deleted", installation: { id: 7 } }).events).toEqual([]);

    const changed = (action: string, removed: unknown[]) =>
      read("installation_repositories", {
        action,
        installation,
        repository_selection: "selected",
        repositories_added: action === "added" ? [repository] : [],
        repositories_removed: removed,
      }).events;
    expect(changed("removed", [repository, { id: 7, name: "other", private: false }])).toEqual([
      { kind: "installation_removed", scope: { hostRepoIds: ["1296269", "7"] } },
    ]);
    expect(changed("removed", [])).toEqual([]);
    expect(changed("added", [])).toEqual([]);
  });

  it("a person who takes back what they allowed the app", () => {
    const sender = { id: 1001, login: "alice", type: "User" };
    expect(read("github_app_authorization", { action: "revoked", sender }).events).toEqual([
      { kind: "authorization_revoked", hostAccountId: "1001" },
    ]);
    expect(read("github_app_authorization", { action: "other", sender }).events).toEqual([]);
  });

  it("collaborators, teams and members: who sees a repository, or what an account has", () => {
    const forRepository = [{ kind: "access_changed", scope: { hostRepoIds: ["1296269"] } }];
    const forAccount = [{ kind: "access_changed", scope: { hostAccountId: "42" } }];
    const member = { id: 1002, login: "bob" };
    expect(read("member", { action: "removed", member, repository }).events).toEqual(forRepository);
    expect(read("team_add", { team: { id: 9 }, repository, organization }).events).toEqual(
      forRepository,
    );
    expect(
      read("team", { action: "removed_from_repository", team: { id: 9 }, repository, organization })
        .events,
    ).toEqual(forRepository);
    expect(read("team", { action: "deleted", team: { id: 9 }, organization }).events).toEqual(
      forAccount,
    );
    expect(
      read("team", { action: "edited", team: { id: 9 }, repository: null, organization }).events,
    ).toEqual(forAccount);
    expect(
      read("membership", {
        action: "removed",
        scope: "team",
        member,
        team: { id: 9 },
        organization,
      }).events,
    ).toEqual(forAccount);
    expect(
      read("organization", { action: "member_removed", membership: { user: member }, organization })
        .events,
    ).toEqual(forAccount);
  });

  it("reads the payload from a form field too, which is the other way the host sends one", () => {
    const payload = JSON.stringify({ ref: "refs/heads/main", repository });
    const body = new TextEncoder().encode(`payload=${encodeURIComponent(payload)}`);
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      "x-github-event": "push",
      "x-hub-signature-256": sign(body),
    };
    expect(events.read({ header: (name) => headers[name], body }).events).toEqual([
      { kind: "refs_changed", hostRepoId: "1296269" },
    ]);
    // A form without the field, and a form whose field is not JSON.
    for (const text of ["other=1", "payload=", "payload=%7B"]) {
      const bytes = new TextEncoder().encode(text);
      expect(
        problemOf(() =>
          events.read({
            header: (name) => ({ ...headers, "x-hub-signature-256": sign(bytes) })[name],
            body: bytes,
          }),
        ),
      ).toBe("malformed");
    }
  });

  it("nothing, for the many events that say nothing about refs or about who sees what", () => {
    for (const event of ["star", "issues", "pull_request", "installation_target", "meta"]) {
      // Not even read: what such a delivery holds does not matter.
      const body = new TextEncoder().encode("not json at all");
      const delivery = events.read({
        header: (name) =>
          name === "x-github-event"
            ? event
            : name === "x-hub-signature-256"
              ? sign(body)
              : undefined,
        body,
      });
      expect(delivery).toEqual({ id: undefined, name: event, events: [] });
    }
  });
});

describe("a delivery that cannot be read", () => {
  it("is refused when it does not name its event", () => {
    for (const name of [undefined, "", "Push", "push event", "x".repeat(65), "push\n"]) {
      expect(
        problemOf(() => read("push", { repository }, { "x-github-event": name as string })),
      ).toBe("malformed");
    }
  });

  it("is refused when it lacks what its event is read by", () => {
    for (const [event, payload] of [
      ["push", {}],
      ["push", { repository: null }],
      ["push", { repository: {} }],
      ["push", { repository: { id: "1296269" } }],
      ["push", { repository: { id: -1 } }],
      ["push", { repository: { id: 1.5 } }],
      ["push", { repository: { id: 2 ** 60 } }],
      ["push", []],
      ["push", "push"],
      ["push", null],
      ["repository", { action: 7, repository }],
      ["installation", { action: "deleted" }],
      ["installation", { action: "deleted", installation: { id: 7, account: { login: "acme" } } }],
      ["installation", { action: "deleted", installation: { id: 7 }, repositories: [{}] }],
      ["installation_repositories", { action: "removed", repositories_removed: [{ name: "x" }] }],
      ["installation_repositories", { action: "removed", repositories_removed: "all" }],
      ["github_app_authorization", { action: "revoked" }],
      ["member", { action: "removed", member: { id: 1 } }],
      ["team", { action: "deleted" }],
      ["organization", { action: "member_removed", organization: { login: "acme" } }],
    ] as const) {
      expect(
        problemOf(() => read(event, payload)),
        `${event} ${JSON.stringify(payload)}`,
      ).toBe("malformed");
    }
  });

  it("is refused when it is not JSON, however it is not", () => {
    const signed = (bytes: Uint8Array) =>
      problemOf(() =>
        events.read({
          header: (name) =>
            name === "x-github-event"
              ? "push"
              : name === "x-hub-signature-256"
                ? sign(bytes)
                : undefined,
          body: bytes,
        }),
      );
    const text = (value: string) => new TextEncoder().encode(value);
    // A form that does not say it is one is read as the JSON it is not.
    expect(signed(text("payload=%7B%22repository%22%3A%7B%22id%22%3A1%7D%7D"))).toBe("malformed");
    expect(signed(text(""))).toBe("malformed");
    expect(signed(text('{"repository":{"id":1}'))).toBe("malformed");
    // Bytes that are not text in the encoding JSON is written in.
    expect(signed(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))).toBe("malformed");
    // Nested deeper than anything the host sends.
    expect(signed(text(`${"[".repeat(200_000)}${"]".repeat(200_000)}`))).toBe("malformed");
  });
});
