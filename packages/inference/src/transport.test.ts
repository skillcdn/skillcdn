import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { InferenceError, postJson } from "./inference.js";
import { inferenceFetch } from "./transport.js";

// The transport over a server of this process, on the loopback interface: nothing leaves the
// machine. What a call does with an answer is `postJson`'s, so the two are tested together.

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server | undefined;

afterEach(async () => {
  const running = server;
  server = undefined;
  if (running !== undefined) {
    running.closeAllConnections();
    await new Promise<void>((resolve) => running.close(() => resolve()));
  }
});

/** A server that answers as `handler` says, and the URL it listens at. */
async function serving(handler: Handler): Promise<string> {
  const started = createServer(handler);
  server = started;
  await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(started.address() as AddressInfo).port}/v1/embeddings`;
}

const call = (url: string, timeoutMs = 2000) => ({
  url,
  key: "a-key",
  userAgent: "skillcdn-test",
  fetch: inferenceFetch,
  timeoutMs,
  maxReplyBytes: 1024,
});

const failureOf = async (work: Promise<unknown>): Promise<InferenceError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof InferenceError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
};

describe("the transport of a call", () => {
  it("sends the method, the headers and the body, and answers what the server said", async () => {
    const seen: { method?: string; headers?: IncomingMessage["headers"]; body?: string } = {};
    const url = await serving((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        seen.method = request.method ?? "";
        seen.headers = request.headers;
        seen.body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    await expect(postJson(call(url), { input: ["héllo"] })).resolves.toEqual({ ok: true });
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe(JSON.stringify({ input: ["héllo"] }));
    expect(seen.headers).toMatchObject({
      authorization: "Bearer a-key",
      "content-type": "application/json",
      "user-agent": "skillcdn-test",
      // The length is said, not a body in chunks: some servers take no other.
      "content-length": String(Buffer.byteLength(JSON.stringify({ input: ["héllo"] }))),
    });
  });

  it("answers a refusal with what the server said, and a redirect without following it", async () => {
    let asked = 0;
    const url = await serving((request, response) => {
      asked += 1;
      if (request.url === "/v1/embeddings") {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("no such model");
        return;
      }
      response.writeHead(302, { location: "/v1/embeddings" });
      response.end();
    });
    const refused = await failureOf(postJson(call(url), {}));
    expect(refused.code).toBe("inference_refused");
    expect(refused.message).toContain("(400): no such model");
    const redirected = await failureOf(postJson(call(url.replace("/v1/embeddings", "/moved")), {}));
    expect(redirected.code).toBe("inference_refused");
    expect(redirected.message).toContain("(302)");
    expect(asked).toBe(2);
  });

  it("ends a call the server does not answer when its time is up, and says it was the time", async () => {
    const url = await serving(() => {
      // Never answers.
    });
    const started = Date.now();
    const silent = await failureOf(postJson(call(url, 80), {}));
    expect(silent.code).toBe("inference_unreachable");
    expect(silent.message).toBe("the inference server did not answer within 80 ms");
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("ends a call whose answer stops halfway when its time is up", async () => {
    const url = await serving((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"data": [');
    });
    const halfway = await failureOf(postJson(call(url, 80), {}));
    expect(halfway.code).toBe("inference_unreachable");
    expect(halfway.message).toBe("the inference server did not answer within 80 ms");
  });

  it("waits for an answer that takes its time, begun late and paused in the middle", async () => {
    const url = await serving((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"slow":');
        setTimeout(() => response.end(" true}"), 150);
      }, 150);
    });
    await expect(postJson(call(url), {})).resolves.toEqual({ slow: true });
  });

  it("stops reading an answer past what it may hold, and lets the connection go", async () => {
    let closed = false;
    const url = await serving((_request, response) => {
      response.on("close", () => {
        closed = true;
      });
      response.writeHead(200, { "content-type": "application/json" });
      const more = (): void => {
        if (!response.destroyed && response.write("x".repeat(512))) {
          setImmediate(more);
        } else if (!response.destroyed) {
          response.once("drain", more);
        }
      };
      more();
    });
    const tooMuch = await failureOf(postJson(call(url), {}));
    expect(tooMuch.code).toBe("inference_malformed");
    expect(tooMuch.message).toContain("more than 1024 bytes");
    await expect.poll(() => closed).toBe(true);
  });

  it("says a server that is not there could not be reached", async () => {
    const url = await serving(() => {});
    const running = server;
    server = undefined;
    await new Promise<void>((resolve) => running?.close(() => resolve()));
    const away = await failureOf(postJson(call(url), {}));
    expect(away.code).toBe("inference_unreachable");
    expect(away.message).toBe("the inference server could not be reached");
  });

  it("answers a status without a body as one", async () => {
    const url = await serving((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const response = await inferenceFetch(url, { method: "POST", body: "{}" });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });
});
