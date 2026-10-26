import { describe, expect, it } from "vitest";
import {
  createBreaker,
  createGate,
  cutText,
  type FetchLike,
  InferenceError,
  isTransientInferenceError,
  postJson,
} from "./inference.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof InferenceError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
};

const call = (fetchLike: FetchLike, key?: string) => ({
  url: "http://inference.test/v1/embeddings",
  key,
  userAgent: "skillcdn-test",
  fetch: fetchLike,
  timeoutMs: 1000,
  maxReplyBytes: 1024,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("the gate", () => {
  it("lets as many calls run at once as it has slots, and the next one in when a slot frees", async () => {
    const gate = createGate(2);
    const first = deferred<string>();
    const second = deferred<string>();
    let started = 0;
    const run = (work: Deferred<string>) =>
      gate.run(1000, () => {
        started += 1;
        return work.promise;
      });
    const calls = [run(first), run(second), run(first)];
    await Promise.resolve();
    expect(started).toBe(2);
    second.resolve("second");
    await calls[1];
    await Promise.resolve();
    expect(started).toBe(3);
    first.resolve("first");
    await expect(Promise.all(calls)).resolves.toEqual(["first", "second", "first"]);
  });

  it("fails a call that cannot start before its time is up, without ever starting it", async () => {
    const gate = createGate(1);
    const held = deferred<void>();
    const holder = gate.run(1000, () => held.promise);
    let started = false;
    const waiting = gate.run(20, async () => {
      started = true;
    });
    await expect(codeOf(waiting)).resolves.toBe("inference_busy");
    expect(started).toBe(false);
    held.resolve();
    await holder;
  });

  it("gives a call that waited only the time it has left", async () => {
    let clock = 0;
    const gate = createGate(1, () => clock);
    const held = deferred<void>();
    const holder = gate.run(1000, () => held.promise);
    const waiting = gate.run(500, async (remainingMs) => remainingMs);
    clock = 120;
    held.resolve();
    await holder;
    await expect(waiting).resolves.toBe(380);
  });
});

describe("the breaker", () => {
  const away = () =>
    Promise.reject(new InferenceError("inference_unreachable", "the inference server is away"));

  it("stops asking after the failures in a row it was given, and asks once again after the cooldown", async () => {
    let clock = 0;
    const breaker = createBreaker({ failures: 3, cooldownMs: 10_000 }, () => clock);
    let asked = 0;
    const ask = (work: () => Promise<string>) =>
      breaker.run(() => {
        asked += 1;
        return work();
      });
    for (let failure = 0; failure < 3; failure += 1) {
      await expect(codeOf(ask(away))).resolves.toBe("inference_unreachable");
    }
    expect(asked).toBe(3);
    // Open: the server is not asked, and the call fails at once.
    await expect(codeOf(ask(async () => "back"))).resolves.toBe("inference_unreachable");
    expect(asked).toBe(3);
    // The cooldown over, one call probes; a probe that fails opens the breaker again.
    clock = 10_000;
    await expect(codeOf(ask(away))).resolves.toBe("inference_unreachable");
    expect(asked).toBe(4);
    await expect(codeOf(ask(async () => "back"))).resolves.toBe("inference_unreachable");
    expect(asked).toBe(4);
    // A probe that answers closes it, and every call is asked again.
    clock = 20_000;
    await expect(ask(async () => "back")).resolves.toBe("back");
    await expect(ask(async () => "still")).resolves.toBe("still");
    expect(asked).toBe(6);
  });

  it("lets one probe through at a time, and counts only the server's failures", async () => {
    let clock = 0;
    const breaker = createBreaker({ failures: 2, cooldownMs: 1000 }, () => clock);
    await expect(codeOf(breaker.run(away))).resolves.toBe("inference_unreachable");
    // A refusal is the server answering: the count starts over.
    await expect(
      codeOf(breaker.run(() => Promise.reject(new InferenceError("inference_refused", "no")))),
    ).resolves.toBe("inference_refused");
    await expect(codeOf(breaker.run(away))).resolves.toBe("inference_unreachable");
    await expect(breaker.run(async () => "open?")).resolves.toBe("open?");
    // Two in a row open it; during the probe, the others fail without being asked.
    await expect(codeOf(breaker.run(away))).resolves.toBe("inference_unreachable");
    await expect(codeOf(breaker.run(away))).resolves.toBe("inference_unreachable");
    clock = 1000;
    const probe = deferred<string>();
    const probing = breaker.run(() => probe.promise);
    await expect(codeOf(breaker.run(async () => "meanwhile"))).resolves.toBe(
      "inference_unreachable",
    );
    probe.resolve("answered");
    await expect(probing).resolves.toBe("answered");
    await expect(breaker.run(async () => "closed")).resolves.toBe("closed");
  });
});

describe("postJson", () => {
  it("sends JSON with the credential when there is one, and reads JSON back", async () => {
    let seen: { readonly url: string; readonly init: RequestInit } | undefined;
    const fetchLike: FetchLike = async (url, init) => {
      seen = { url, init };
      return json({ ok: true });
    };
    await expect(postJson(call(fetchLike, "a-key"), { hello: 1 })).resolves.toEqual({ ok: true });
    expect(seen?.url).toBe("http://inference.test/v1/embeddings");
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.body).toBe('{"hello":1}');
    expect(seen?.init.redirect).toBe("error");
    expect(seen?.init.signal).toBeInstanceOf(AbortSignal);
    expect(seen?.init.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "skillcdn-test",
      authorization: "Bearer a-key",
    });

    await postJson(call(fetchLike), {});
    expect(seen?.init.headers).not.toHaveProperty("authorization");
  });

  it("tells apart a server that is away, one that is overloaded, one that failed and one that refused", async () => {
    const away: FetchLike = () => Promise.reject(new TypeError("fetch failed"));
    await expect(codeOf(postJson(call(away), {}))).resolves.toBe("inference_unreachable");
    await expect(postJson(call(away), {})).rejects.toThrow(
      /^the inference server could not be reached$/,
    );
    const reply = (status: number, body = "") =>
      postJson(
        call(async () => new Response(body, { status })),
        {},
      );
    await expect(codeOf(reply(429))).resolves.toBe("inference_busy");
    await expect(codeOf(reply(503))).resolves.toBe("inference_failed");
    await expect(codeOf(reply(400))).resolves.toBe("inference_refused");
    await expect(codeOf(reply(301))).resolves.toBe("inference_refused");
    expect(isTransientInferenceError(new InferenceError("inference_busy", ""))).toBe(true);
    expect(isTransientInferenceError(new InferenceError("inference_refused", ""))).toBe(false);
    expect(isTransientInferenceError(new Error("other"))).toBe(false);
  });

  it("keeps one clean line of a refusal for the log", async () => {
    const said = `{"error": "model\u0000 not\n found ${"x".repeat(300)}"}`;
    const refused = postJson(
      call(async () => new Response(said, { status: 422 })),
      {},
    );
    const error = await refused.catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(InferenceError);
    const message = (error as InferenceError).message;
    expect(message).toContain("(422)");
    expect(message).toContain('{"error": "model not found');
    expect(message).not.toContain("\u0000");
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThan(300);
  });

  it("gives up when the server does not answer in time, and says so with the time it had", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(codeOf(postJson({ ...call(hanging), timeoutMs: 20 }, {}))).resolves.toBe(
      "inference_unreachable",
    );
    await expect(postJson({ ...call(hanging), timeoutMs: 20 }, {})).rejects.toThrow(
      "the inference server did not answer within 20 ms",
    );
    // An answer that starts in time and does not end in time is the same failure.
    const trickling: FetchLike = async (_url, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data": ['));
            init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        }),
        { status: 200 },
      );
    const cutShort = postJson({ ...call(trickling), timeoutMs: 20 }, {});
    await expect(codeOf(cutShort)).resolves.toBe("inference_unreachable");
    await expect(postJson({ ...call(trickling), timeoutMs: 20 }, {})).rejects.toThrow(
      "the inference server did not answer within 20 ms",
    );
  });

  it("answers malformed for what is not JSON, and for more than it is willing to read", async () => {
    const text = postJson(
      call(async () => new Response("not json", { status: 200 })),
      {},
    );
    await expect(codeOf(text)).resolves.toBe("inference_malformed");
    // What was answered instead is described by its type and size, never quoted.
    await expect(
      postJson(
        call(async () => new Response("<html>away</html>", { status: 200 })),
        {},
      ),
    ).rejects.toThrow("did not answer JSON (text/plain;charset=UTF-8, 17 characters)");
    const long = postJson(
      call(async () => json({ pad: "y".repeat(2000) })),
      {},
    );
    await expect(codeOf(long)).resolves.toBe("inference_malformed");
  });
});

describe("cutText", () => {
  it("cuts at the limit, never through a surrogate pair", () => {
    expect(cutText("abcdefg", 5)).toBe("abcde");
    expect(cutText("abc", 5)).toBe("abc");
    const smile = String.fromCodePoint(0x1f600);
    expect(cutText(`abcd${smile}fg`, 5)).toBe("abcd");
    expect(cutText(`abcd${smile}fg`, 6)).toBe(`abcd${smile}`);
  });
});
